// contrast.js — проверка WCAG contrast ratio, автокоррекция fg (ТЗ п.2.1
// шаг [2], п.2.2, критерий приёмки "Контраст bg/fg всегда ≥ 4.5 (WCAG AA)").
//
// Роль в пайплайне: последний шаг перед derivatives/filter/formatter.
// Получает уже выбранные picker'ом роли, проверяет bg/fg на WCAG AA,
// и ЕСЛИ проверка провалена — форсирует fg к белому или чёрному (смотря
// что даёт лучший контраст с данным bg), а не пытается искать другой
// кандидат в зоне. Это осознанное упрощение по ТЗ п.2.1: "fg форсируется
// к белому/чёрному", не "picker переделывает выбор".

import { relativeLuminance } from './analyzer.js';

/** WCAG AA порог для обычного текста (ТЗ, критерий приёмки). */
export const WCAG_AA_THRESHOLD = 4.5;

/**
 * WCAG contrast ratio между двумя цветами: (L1+0.05)/(L2+0.05), где
 * L1 — luminance более светлого цвета. Диапазон 1 (нет контраста) .. 21
 * (чёрный на белом).
 *
 * @param {{r:number,g:number,b:number}} colorA
 * @param {{r:number,g:number,b:number}} colorB
 * @returns {number}
 */
export function contrastRatio(colorA, colorB) {
    const lA = relativeLuminance(colorA.r, colorA.g, colorA.b);
    const lB = relativeLuminance(colorB.r, colorB.g, colorB.b);
    const lighter = Math.max(lA, lB);
    const darker = Math.min(lA, lB);
    return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/**
 * Проверяет contrast ratio между bg и fg. Если ниже порога — форсирует fg
 * к белому или чёрному (какой из двух даёт больший контраст с этим bg).
 *
 * ВАЖНО: это мутирует только fg, никогда bg — таков контракт ТЗ ("fg
 * форсируется", про bg речи нет). Если понадобится симметричная проверка
 * (например для accent на bg), это отдельная будущая функция, не эта.
 *
 * @param {{r:number,g:number,b:number}} bg
 * @param {{r:number,g:number,b:number}} fg
 * @param {number} [threshold=WCAG_AA_THRESHOLD]
 * @returns {{
 *   fg: {r:number,g:number,b:number},
 *   ratio: number,
 *   corrected: boolean,
 *   originalRatio: number
 * }}
 */
export function ensureContrast(bg, fg, threshold = WCAG_AA_THRESHOLD) {
    const originalRatio = contrastRatio(bg, fg);

    if (originalRatio >= threshold) {
        return { fg, ratio: originalRatio, corrected: false, originalRatio };
    }

    // Провал порога — форсируем к тому из белого/чёрного, что даёт
    // больший контраст с данным bg (для очень светлых bg чёрный текст
    // обычно выигрывает, для тёмных — белый, но считаем явно, а не
    // угадываем по luminance bg "на глаз").
    const ratioWithWhite = contrastRatio(bg, WHITE);
    const ratioWithBlack = contrastRatio(bg, BLACK);
    const correctedFg = ratioWithWhite >= ratioWithBlack ? WHITE : BLACK;
    const correctedRatio = Math.max(ratioWithWhite, ratioWithBlack);

    return { fg: correctedFg, ratio: correctedRatio, corrected: true, originalRatio };
}

/**
 * Прогоняет ensureContrast над готовым набором ролей picker'а. Смотрит
 * именно на пару bg/fg (единственная пара, для которой ТЗ прямо требует
 * автокоррекцию) и возвращает обновлённый набор цветов + debug-запись.
 *
 * @param {Object<string, {r:number,g:number,b:number}>} colors - результат pickRoles().colors
 * @param {number} [threshold=WCAG_AA_THRESHOLD]
 * @returns {{colors: Object<string,{r:number,g:number,b:number}>, debug: Object}}
 */
export function applyContrastCheck(colors, threshold = WCAG_AA_THRESHOLD) {
    if (!colors.bg || !colors.fg) {
        // Профиль может не определять fg (например только accent-профиль,
        // ТЗ п.3.2) — тогда проверять нечего, это не ошибка.
        return { colors, debug: { skipped: true, reason: 'bg или fg не определены в профиле' } };
    }

    const result = ensureContrast(colors.bg, colors.fg, threshold);

    const updatedColors = { ...colors, fg: result.fg };
    const debug = {
        pair: ['bg', 'fg'],
        threshold,
        originalRatio: Number(result.originalRatio.toFixed(2)),
        finalRatio: Number(result.ratio.toFixed(2)),
        corrected: result.corrected,
    };

    return { colors: updatedColors, debug };
}
