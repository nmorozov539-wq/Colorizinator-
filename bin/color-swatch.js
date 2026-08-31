// bin/color-swatch.js — печать цвета цветным квадратиком в терминале через
// ANSI true-color (24-bit) escape-коды, как это делает pywal при выводе
// палитры. Общий хелпер для всех demo-*.js скриптов — не только analyzer,
// но и будущий demo-picker.js захочет показывать финально выбранные роли
// теми же квадратиками.
//
// Формат ANSI true-color background: \x1b[48;2;R;G;Bm  ...текст...  \x1b[0m

/**
 * Возвращает строку с цветным квадратиком (несколько пробелов на цветном
 * фоне) — вставляется прямо в print() как обычная строка.
 *
 * @param {{r:number,g:number,b:number}} color
 * @param {number} [width=4] - ширина квадратика в символах
 * @returns {string}
 */
export function swatch({ r, g, b }, width = 4) {
    return `\x1b[48;2;${r};${g};${b}m${' '.repeat(width)}\x1b[0m`;
}

/**
 * Строка "квадратик + rgb(...) + HSL" — стандартная строка для demo-выводов,
 * чтобы не собирать её руками в каждом скрипте.
 *
 * @param {{r:number,g:number,b:number}} color
 * @param {{h:number,s:number,l:number}} [hsl] - опционально, если уже посчитан
 * @returns {string}
 */
export function swatchLine(color, hsl = null) {
    const { r, g, b } = color;
    const rgbPart = `rgb(${r},${g},${b})`.padEnd(16);
    const hslPart = hsl
        ? `h=${hsl.h.toFixed(0).padStart(3)} s=${hsl.s.toFixed(2)} l=${hsl.l.toFixed(2)}`
        : '';
    return `${swatch(color)}  ${rgbPart}${hslPart}`;
}
