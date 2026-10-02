// picker.js — выбор финального цвета для каждой роли профиля (ТЗ п.2.2, п.5).
//
// Вход: analysis от analyzer.js { zoneName: {darkest, lightest, ...} }
//       + roles-секция профиля { roleName: {pick, from, fallback, ...} }
// Выход: { roleName: {r,g,b} } — по одному цвету на роль, плюс debug-трейс
//        (кандидаты, tie-break, boost) для отладочного JSON (ТЗ п.6.4).
//
// ВАЖНО: роли не независимы. `between-bg-fg` явно зависит от уже выбранных
// bg/fg. `ensure-readable-on`/`min-contrast-to` тоже ссылаются на другую роль.
// Поэтому picker не может пройти роли в порядке объявления профиля — нужен
// порядок разрешения зависимостей (топологическая сортировка).

import { rgbToHsl } from './analyzer.js';
import { mixOklab } from './oklab.js';

/** Доля пути от bg к fg для `between-bg-fg` по умолчанию (роль surface — чуть светлее bg). */
export const DEFAULT_BETWEEN_MIX = 0.12;

/**
 * Цвет «между bg и fg»: смешивание в OKLab (перцептивно ровное, в отличие
 * от прежнего RGB-midpoint). Профиль может задать `mix` (0..1).
 */
export function pickBetween(bg, fg, roleConfig = {}) {
    const t = typeof roleConfig.mix === 'number' ? roleConfig.mix : DEFAULT_BETWEEN_MIX;
    return mixOklab(bg, fg, t);
}

/** Стратегии, которые не требуют другой уже выбранной роли — их можно
 *  вычислить сразу из analysis одной зоны. */
const DIRECT_STRATEGIES = new Set([
    'darkest', 'lightest', 'most-saturated', 'least-saturated', 'dominant', 'average',
]);

/**
 * Достаёт "сырого" кандидата для direct-стратегии из analysis одной зоны.
 *
 * @param {ReturnType<typeof import('./analyzer.js').analyzeZone>} zoneAnalysis
 * @param {string} strategy
 * @returns {{r:number,g:number,b:number}}
 */
function pickDirect(zoneAnalysis, strategy) {
    switch (strategy) {
        case 'darkest': return zoneAnalysis.darkest;
        case 'lightest': return zoneAnalysis.lightest;
        case 'most-saturated': return zoneAnalysis.mostSaturated;
        case 'least-saturated': return zoneAnalysis.leastSaturated;
        case 'dominant': return zoneAnalysis.dominant;
        case 'average': return zoneAnalysis.average;
        default:
            throw new Error(`pickDirect: неизвестная direct-стратегия "${strategy}"`);
    }
}

/**
 * Строит порядок разрешения ролей так, чтобы `between-bg-fg` и любая роль
 * с `min-contrast-to`/`ensure-readable-on` обрабатывались ПОСЛЕ ролей,
 * от которых они зависят. Простая топологическая сортировка (Kahn's algorithm
 * было бы избыточно для профиля из 5-6 ролей — линейный проход с повтором
 * достаточно быстр и нагляднее для debug-чтения).
 *
 * @param {Object<string, Object>} rolesConfig
 * @returns {string[]} имена ролей в порядке вычисления
 */
function resolveRoleOrder(rolesConfig) {
    const names = Object.keys(rolesConfig);
    const resolved = [];
    const remaining = new Set(names);

    // Зависимость роли — та, что упомянута в between-bg-fg (всегда bg И fg),
    // min-contrast-to, ensure-readable-on.
    function dependenciesOf(roleName) {
        const cfg = rolesConfig[roleName];
        const deps = [];
        if (cfg.pick === 'between-bg-fg') { deps.push('bg', 'fg'); }
        if (cfg['min-contrast-to']) { deps.push(cfg['min-contrast-to']); }
        if (cfg['ensure-readable-on']) { deps.push(cfg['ensure-readable-on']); }
        return deps.filter((d) => names.includes(d));
    }

    let safetyCounter = names.length * names.length + 1; // защита от циклической зависимости
    while (remaining.size > 0) {
        if (safetyCounter-- <= 0) {
            throw new Error(
                `resolveRoleOrder: не удалось разрешить порядок ролей — похоже на циклическую зависимость среди [${[...remaining].join(', ')}]`
            );
        }
        for (const name of [...remaining]) {
            const deps = dependenciesOf(name);
            if (deps.every((d) => resolved.includes(d))) {
                resolved.push(name);
                remaining.delete(name);
            }
        }
    }

    return resolved;
}

/**
 * Выбирает цвет для одной роли согласно её конфигурации в профиле.
 *
 * @param {string} roleName
 * @param {Object} roleConfig - секция роли из профиля (ТЗ п.5.3)
 * @param {Object<string, ReturnType<typeof import('./analyzer.js').analyzeZone>>} analysis - вся зона→анализ
 * @param {Object<string, {r:number,g:number,b:number}>} resolvedRoles - уже выбранные роли (для зависимостей)
 * @returns {{color: {r:number,g:number,b:number}, debug: Object}}
 */
function pickRole(roleName, roleConfig, analysis, resolvedRoles) {
    const debug = { role: roleName, strategy: roleConfig.pick };

    // --- between-bg-fg: не берёт цвет из зоны вообще, а интерполирует
    // между уже выбранными bg и fg по luminance.
    if (roleConfig.pick === 'between-bg-fg') {
        const bg = resolvedRoles.bg;
        const fg = resolvedRoles.fg;
        if (!bg || !fg) {
            throw new Error(`pickRole("${roleName}"): between-bg-fg требует уже выбранных bg и fg`);
        }
        const color = pickBetween(bg, fg, roleConfig);
        debug.interpolatedBetween = ['bg', 'fg'];
        return { color, debug };
    }

    // --- Direct-стратегии: ищем primary-зону, при провале — fallback.
    let primaryZoneName = roleConfig.from || 'full';
    let primaryZone = analysis[primaryZoneName];
    if (!primaryZone) {
        throw new Error(`pickRole("${roleName}"): зона "${primaryZoneName}" не найдена в analysis (проверь профиль)`);
    }

    // Зона может быть пустой (целиком прозрачная) — тогда берём fallback,
    // а если и он пуст/не задан — зону 'full'.
    let fallbackTriggered = false;
    if (primaryZone.empty) {
        const alternatives = [roleConfig.fallback, 'full'].filter((n) => n && analysis[n] && !analysis[n].empty);
        if (alternatives.length === 0) {
            throw new Error(`pickRole("${roleName}"): изображение не содержит непрозрачных пикселей`);
        }
        debug.emptyPrimaryZone = primaryZoneName;
        primaryZoneName = alternatives[0];
        primaryZone = analysis[primaryZoneName];
        fallbackTriggered = true;
    }

    let candidate = pickDirect(primaryZone, roleConfig.pick);
    let usedZone = primaryZoneName;

    // min-saturation проверяем ТОЛЬКО если он задан в профиле (не все роли
    // его требуют — например bg/muted намеренно могут быть малонасыщенными).
    if (typeof roleConfig['min-saturation'] === 'number') {
        const { s } = rgbToHsl(candidate.r, candidate.g, candidate.b);
        if (s < roleConfig['min-saturation'] && roleConfig.fallback) {
            const fallbackZone = analysis[roleConfig.fallback];
            if (fallbackZone && !fallbackZone.empty) {
                const fallbackCandidate = pickDirect(fallbackZone, roleConfig.pick);
                const fallbackS = rgbToHsl(fallbackCandidate.r, fallbackCandidate.g, fallbackCandidate.b).s;
                debug.primaryCandidate = { zone: primaryZoneName, color: candidate, saturation: s };
                if (fallbackS > s) {
                    candidate = fallbackCandidate;
                    usedZone = roleConfig.fallback;
                    fallbackTriggered = true;
                }
            }
        }
    }

    debug.usedZone = usedZone;
    debug.fallbackTriggered = fallbackTriggered;
    debug.selectedColor = candidate;

    return { color: candidate, debug };
}

/**
 * Основная точка входа: выбирает цвета для всех ролей профиля.
 *
 * @param {Object<string, ReturnType<typeof import('./analyzer.js').analyzeZone>>} analysis
 * @param {Object<string, Object>} rolesConfig - roles-секция профиля (ТЗ п.3.4)
 * @returns {{colors: Object<string,{r:number,g:number,b:number}>, debug: Object[]}}
 */
export function pickRoles(analysis, rolesConfig) {
    const order = resolveRoleOrder(rolesConfig);
    const colors = {};
    const debugTrace = [];

    for (const roleName of order) {
        const { color, debug } = pickRole(roleName, rolesConfig[roleName], analysis, colors);
        colors[roleName] = color;
        debugTrace.push(debug);
    }

    return { colors, debug: debugTrace };
}
