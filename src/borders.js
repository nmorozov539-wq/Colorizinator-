// borders.js — обрезка «пустых» краёв изображения до зонирования.
//
// Зачем: чёрные полосы letterbox/pillarbox и прозрачные поля PNG — не часть
// картинки. Если их не убрать, зоны top/bottom/left/right целиком уходят в
// чёрный/пустоту, а darkest/bg превращаются в #000000 (см. tools/run-baseline.js,
// кейсы letterbox/pillarbox/windowbox/transparent_padding).
//
// Правила (намеренно консервативные — ложная обрезка хуже пропущенной):
//   * Прозрачные края (alpha < ALPHA_MIN) режутся с каждой стороны независимо.
//   * Чёрные края режутся ТОЛЬКО если полосы есть с ОБЕИХ противоположных
//     сторон и сопоставимы по толщине (>= MIN_SYMMETRY). Иначе чёрная «земля»
//     силуэтного пейзажа (чёрное только снизу) была бы принята за рамку.
//   * С каждой стороны режется не более MAX_TRIM_SHARE размера.
//   * Крошечные изображения не трогаем.

import { ALPHA_MIN } from './analyzer.js';

/** Пиксель считается «чёрным», если max(r,g,b) не выше порога. */
export const NEAR_BLACK_MAX = 12;
/** Доля пустых пикселей в строке/столбце, чтобы считать его пустым. */
const EMPTY_SHARE = 0.99;
/** Максимум, который можно срезать с одной стороны (доля размера). */
const MAX_TRIM_SHARE = 0.4;
/** Минимальное отношение толщин полос (меньшая/большая) для чёрной рамки. */
const MIN_SYMMETRY = 0.5;
/** Ниже этого размера (по любой оси) чёрные полосы не ищем. */
const MIN_SIZE_FOR_BLACK = 16;
/** Запас в 1 px после чёрной полосы: пиксель на стыке смешан билинейным downscale. */
const BLEND_MARGIN = 1;

/**
 * Для каждой строки (axis='row') или столбца (axis='col') считает долю
 * прозрачных и «пустых» (прозрачных или чёрных) пикселей.
 */
function lineShares(buf, axis) {
    const { width, height, channels, rowstride, pixels } = buf;
    const outer = axis === 'row' ? height : width;
    const inner = axis === 'row' ? width : height;
    const transparent = new Float64Array(outer);
    const empty = new Float64Array(outer);

    for (let o = 0; o < outer; o++) {
        let t = 0, e = 0;
        for (let i = 0; i < inner; i++) {
            const x = axis === 'row' ? i : o;
            const y = axis === 'row' ? o : i;
            const off = y * rowstride + x * channels;
            if (channels === 4 && pixels[off + 3] < ALPHA_MIN) { t++; e++; continue; }
            if (Math.max(pixels[off], pixels[off + 1], pixels[off + 2]) <= NEAR_BLACK_MAX) e++;
        }
        transparent[o] = t / inner;
        empty[o] = e / inner;
    }
    return { transparent, empty };
}

/** Длина непрерывной серии строк с share >= EMPTY_SHARE от начала/конца, не больше cap. */
function run(shares, fromEnd, cap) {
    const n = shares.length;
    let count = 0;
    while (count < cap && count < n) {
        const idx = fromEnd ? n - 1 - count : count;
        if (shares[idx] < EMPTY_SHARE) break;
        count++;
    }
    return count;
}

/** Решает, сколько резать с двух противоположных сторон одной оси. */
function axisTrim(shares, size) {
    const cap = Math.floor(size * MAX_TRIM_SHARE);
    const tA = run(shares.transparent, false, cap);
    const tB = run(shares.transparent, true, cap);
    let a = tA, b = tB, black = false;

    if (size >= MIN_SIZE_FOR_BLACK) {
        const eA = run(shares.empty, false, cap);
        const eB = run(shares.empty, true, cap);
        if (eA > 0 && eB > 0 && Math.min(eA, eB) / Math.max(eA, eB) >= MIN_SYMMETRY) {
            a = Math.min(cap, eA + BLEND_MARGIN);
            b = Math.min(cap, eB + BLEND_MARGIN);
            black = true;
        }
    }
    return { a, b, black };
}

/**
 * Определяет, сколько пикселей пустых краёв нужно срезать.
 *
 * @param {{width:number,height:number,channels:number,rowstride:number,pixels:Uint8Array}} buf
 * @returns {{top:number,bottom:number,left:number,right:number,blackBars:boolean}}
 */
export function detectBorders(buf) {
    const rows = axisTrim(lineShares(buf, 'row'), buf.height);
    const cols = axisTrim(lineShares(buf, 'col'), buf.width);
    return {
        top: rows.a, bottom: rows.b, left: cols.a, right: cols.b,
        blackBars: rows.black || cols.black,
    };
}

/**
 * Возвращает буфер без пустых краёв (компактный, rowstride = width*channels)
 * и описание обрезки в поле `trimmed`. Если резать нечего — исходный буфер
 * с `trimmed = null`.
 */
export function trimBorders(buf) {
    const b = detectBorders(buf);
    if (b.top + b.bottom + b.left + b.right === 0) {
        return { ...buf, trimmed: null };
    }

    const width = buf.width - b.left - b.right;
    const height = buf.height - b.top - b.bottom;
    if (width < 1 || height < 1) {
        return { ...buf, trimmed: null }; // страховка: не режем в ноль
    }

    const { channels, rowstride, pixels } = buf;
    const out = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) {
        const srcStart = (y + b.top) * rowstride + b.left * channels;
        out.set(pixels.subarray(srcStart, srcStart + width * channels), y * width * channels);
    }

    return {
        width, height, channels,
        rowstride: width * channels,
        hasAlpha: buf.hasAlpha,
        pixels: out,
        trimmed: b,
    };
}
