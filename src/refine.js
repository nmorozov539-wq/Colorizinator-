// refine.js — нормализация выбранных ролей под тёмную тему (после picker'а,
// перед contrast.js). Работает в OKLCH.
//
// Принцип «проверить и починить»: каждая роль, выбранная picker'ом, проверяется
// на пригодность; если подходит — остаётся как есть (action: 'kept'); если нет —
// сначала ищется замена среди других зон ('searched'), затем цвет подгоняется
// ('adjusted'), и только в крайнем случае выводится из других ролей ('derived')
// или синтезируется ('synthesized'). Каждое решение пишется в debug, чтобы
// было видно, откуда взялся финальный цвет.
//
// Что НЕ меняется: формат профиля, стратегии picker'а, порядок pipeline.
// Эта стадия — страховочный слой между «что нашли на картинке» и
// «что можно отдавать потребителю».

import { rgbToOklch, oklchToRgb, mixOklab, deltaEOk } from './oklab.js';
import { contrastRatio } from './contrast.js';
import { pickBetween } from './picker.js';

/** Целевые диапазоны тёмной темы (OKLCH: L 0..1, C ≈ 0..0.37). */
export const DARK = {
    bg:     { lMax: 0.28, cMax: 0.045 },
    fg:     { lMin: 0.88, lMax: 0.97, cMax: 0.04, searchLMin: 0.75 },
    accent: { minChroma: 0.06, lMin: 0.60, lMax: 0.82, minContrast: 3.5,
              synthChroma: 0.10, synthL: 0.72, achromaticL: 0.78, hueFromChroma: 0.015 },
    muted:  { minContrast: 3.0, minDeltaE: 0.12, maxChroma: 0.06, mix: 0.55 },
};

const hexOf = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sameColor = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b;

/** Зоны для поиска замены: сначала fallback роли и 'full', затем остальные. */
function searchOrder(analysis, roleConfig) {
    const names = [roleConfig?.from, roleConfig?.fallback, 'full', ...Object.keys(analysis)];
    return [...new Set(names)].filter((n) => n && analysis[n] && !analysis[n].empty);
}

function refineBg(picked, analysis, roleConfig) {
    const cfg = DARK.bg;
    const trace = { role: 'bg', picked: hexOf(picked), notes: [] };
    let color = picked;

    if (rgbToOklch(color).L > cfg.lMax) {
        trace.notes.push('выбранный bg слишком светлый для тёмной темы');
        for (const zone of searchOrder(analysis, roleConfig)) {
            const cand = analysis[zone].darkest;
            if (rgbToOklch(cand).L <= cfg.lMax) {
                color = cand;
                trace.action = 'searched';
                trace.zone = zone;
                break;
            }
        }
    }

    const lch = rgbToOklch(color);
    const L = Math.min(lch.L, cfg.lMax);
    const C = Math.min(lch.C, cfg.cMax);
    if (L !== lch.L || C !== lch.C) {
        color = oklchToRgb(L, C, lch.h);
        trace.action = trace.action ? `${trace.action}+adjusted` : 'adjusted';
        trace.notes.push('lightness/chroma приведены к диапазону bg');
    }
    trace.action = trace.action || 'kept';
    trace.final = hexOf(color);
    return { color, trace };
}

function refineFg(picked, bg, analysis, roleConfig) {
    const cfg = DARK.fg;
    const trace = { role: 'fg', picked: hexOf(picked), notes: [] };
    let color = picked;

    if (rgbToOklch(color).L < cfg.searchLMin) {
        for (const zone of searchOrder(analysis, roleConfig)) {
            const cand = analysis[zone].lightest;
            if (rgbToOklch(cand).L >= cfg.searchLMin) {
                color = cand;
                trace.action = 'searched';
                trace.zone = zone;
                break;
            }
        }
        if (!trace.action) trace.notes.push('светлых цветов на картинке нет — fg выводится из выбранного оттенка');
    }

    // Оттенок берём у найденного цвета, но fg — это текст: светлый и малохроматичный.
    const lch = rgbToOklch(color);
    const L = clamp(lch.L, cfg.lMin, cfg.lMax);
    const C = Math.min(lch.C, cfg.cMax);
    const out = oklchToRgb(L, C, lch.h);
    if (!sameColor(out, color)) {
        trace.action = trace.action ? `${trace.action}+adjusted` : 'adjusted';
    }
    trace.action = trace.action || 'kept';
    trace.final = hexOf(out);
    return { color: out, trace };
}

function fallbackColor_(lch, cfg) {
    return oklchToRgb(Math.min(lch.L, cfg.lMax), lch.C, lch.h);
}

function refineAccent(picked, bg, analysis, roleConfig) {
    const cfg = DARK.accent;
    const trace = { role: 'accent', picked: hexOf(picked), notes: [] };
    let color = picked;

    const pickedLch = rgbToOklch(color);
    if (pickedLch.C < cfg.minChroma || pickedLch.L > cfg.lMax) {
        trace.notes.push(pickedLch.C < cfg.minChroma ? 'выбранный акцент почти серый' : 'выбранный акцент выбелен (слишком светлый)');
        const fallbackColor = color;
        color = null;
        for (const zone of searchOrder(analysis, roleConfig)) {
            const cand = analysis[zone].mostSaturated;
            const c = rgbToOklch(cand);
            if (c.C >= cfg.minChroma && c.L <= cfg.lMax) {
                color = cand;
                trace.action = 'searched';
                trace.zone = zone;
                break;
            }
        }
    }

    if (!color && pickedLch.C >= cfg.minChroma) {
        color = fallbackColor_(pickedLch, cfg); // выбелен везде — просто темнеем до lMax ниже
        trace.action = 'adjusted';
    }

    if (!color) {
        // Акцента на картинке нет. Берём оттенок самого «цветного» кандидата;
        // если и он серый — акцент остаётся нейтральным (честно для ч/б).
        let best = null;
        for (const zone of searchOrder(analysis, roleConfig)) {
            const c = rgbToOklch(analysis[zone].mostSaturated);
            if (!best || c.C > best.C) best = c;
        }
        if (best && best.C >= cfg.hueFromChroma) {
            color = oklchToRgb(cfg.synthL, cfg.synthChroma, best.h);
            trace.notes.push('акцент синтезирован из оттенка картинки (своего яркого цвета нет)');
        } else {
            color = oklchToRgb(cfg.achromaticL, 0, 0);
            trace.notes.push('картинка ахроматична — акцент нейтральный');
        }
        trace.action = 'synthesized';
    }

    // Читаемость на bg: поднимаем lightness (hue/chroma сохраняются).
    let lch = rgbToOklch(color);
    let L = clamp(lch.L, cfg.lMin, cfg.lMax);
    let out = oklchToRgb(L, lch.C, lch.h);
    while (contrastRatio(bg, out) < cfg.minContrast && L < cfg.lMax) {
        L = Math.min(cfg.lMax, L + 0.02);
        out = oklchToRgb(L, lch.C, lch.h);
    }
    if (!sameColor(out, color)) {
        trace.action = trace.action ? `${trace.action}+adjusted` : 'adjusted';
    }
    trace.action = trace.action || 'kept';
    trace.final = hexOf(out);
    return { color: out, trace };
}

function refineMuted(picked, bg, fg) {
    const cfg = DARK.muted;
    const trace = { role: 'muted', picked: hexOf(picked), notes: [] };

    const problems = [];
    if (contrastRatio(bg, picked) < cfg.minContrast) problems.push('низкий контраст с bg');
    if (deltaEOk(bg, picked) < cfg.minDeltaE) problems.push('неотличим от bg');
    if (rgbToOklch(picked).C > cfg.maxChroma) problems.push('слишком цветной для muted');
    if (deltaEOk(fg, picked) < cfg.minDeltaE) problems.push('неотличим от fg');

    if (problems.length === 0) {
        trace.action = 'kept'; trace.final = hexOf(picked);
        return { color: picked, trace };
    }

    let t = cfg.mix;
    let out = mixOklab(bg, fg, t);
    while (contrastRatio(bg, out) < cfg.minContrast && t < 0.85) {
        t += 0.05;
        out = mixOklab(bg, fg, t);
    }
    trace.action = 'derived';
    trace.notes.push(...problems, `выведен смешиванием bg→fg (t=${t.toFixed(2)})`);
    trace.final = hexOf(out);
    return { color: out, trace };
}

/**
 * Проверка итоговой палитры на инварианты. Не меняет цвета, только сообщает.
 *
 * @param {Object<string,{r:number,g:number,b:number}>} colors
 * @returns {string[]} список нарушений (пустой — всё в порядке)
 */
export function checkPalette(colors) {
    const issues = [];
    const { bg, fg, accent, muted, surface } = colors;
    if (bg && fg && contrastRatio(bg, fg) < 4.5) issues.push('contrast(bg,fg) < 4.5');
    const pairs = [
        ['bg', 'surface', 0.025], ['bg', 'muted', 0.12], ['bg', 'accent', 0.20],
        ['fg', 'muted', 0.08], ['muted', 'accent', 0.05],
    ];
    for (const [a, b, min] of pairs) {
        if (colors[a] && colors[b] && deltaEOk(colors[a], colors[b]) < min) {
            issues.push(`${a} и ${b} почти неразличимы (ΔE<${min})`);
        }
    }
    if (accent && bg && contrastRatio(bg, accent) < 3) issues.push('contrast(bg,accent) < 3');
    void muted; void surface;
    return issues;
}

/**
 * Основная точка входа.
 *
 * @param {Object<string,{r:number,g:number,b:number}>} colors - результат pickRoles()
 * @param {Object} analysis - результат analyzeAllZones()
 * @param {Object} rolesConfig - roles-секция профиля
 * @returns {{colors: Object, debug: Object[]}}
 */
export function refineRoles(colors, analysis, rolesConfig) {
    const out = { ...colors };
    const debug = [];

    if (colors.bg) {
        const r = refineBg(colors.bg, analysis, rolesConfig.bg);
        out.bg = r.color; debug.push(r.trace);
    }
    if (colors.fg && out.bg) {
        const r = refineFg(colors.fg, out.bg, analysis, rolesConfig.fg);
        out.fg = r.color; debug.push(r.trace);
    }
    if (colors.accent && out.bg) {
        const r = refineAccent(colors.accent, out.bg, analysis, rolesConfig.accent);
        out.accent = r.color; debug.push(r.trace);
    }
    if (colors.muted && out.bg && out.fg) {
        const r = refineMuted(colors.muted, out.bg, out.fg);
        out.muted = r.color; debug.push(r.trace);
    }

    // Роли «между bg и fg» пересчитываются от уже исправленных bg/fg
    // (picker считал их от сырых значений, которые теперь изменились).
    if (out.bg && out.fg) {
        for (const [name, cfg] of Object.entries(rolesConfig)) {
            if (cfg.pick === 'between-bg-fg') {
                const c = pickBetween(out.bg, out.fg, cfg);
                debug.push({ role: name, picked: hexOf(colors[name] ?? c), action: 'derived', final: hexOf(c), notes: ['пересчитан от финальных bg/fg'] });
                out[name] = c;
            }
        }
    }

    return { colors: out, debug };
}
