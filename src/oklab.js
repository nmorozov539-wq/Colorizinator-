// oklab.js — перцептивное цветовое пространство OKLab/OKLCH (Björn Ottosson, 2020).
//
// Зачем: HSL не соответствует восприятию — «одинаковая» lightness у жёлтого и
// синего выглядит по-разному, а saturation у почти чёрных цветов ломается.
// В OKLab расстояние (ΔE) и lightness ведут себя предсказуемо, поэтому
// выбор «насыщенного» цвета, затемнение bg и подгонка fg делаются здесь.
// Все публичные функции принимают/возвращают цвета как {r,g,b} (0..255).

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return v * 255;
}

/** {r,g,b} → {L, a, b}; L 0..1, a/b примерно -0.4..0.4. */
export function rgbToOklab({ r, g, b }) {
    const lr = SRGB_TO_LINEAR[Math.round(r)];
    const lg = SRGB_TO_LINEAR[Math.round(g)];
    const lb = SRGB_TO_LINEAR[Math.round(b)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return {
        L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
}

/** Oklab → нелинейный sRGB в float, БЕЗ обрезки (значения могут выходить за 0..255). */
function oklabToRgbRaw(L, a, b) {
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [
        linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -0.5 && v <= 255.5);

/** {r,g,b} → {L, C, h}; h в градусах 0..360 (для C≈0 hue не несёт смысла). */
export function rgbToOklch(rgb) {
    const { L, a, b } = rgbToOklab(rgb);
    const C = Math.hypot(a, b);
    const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    return { L, C, h };
}

/**
 * OKLCH → {r,g,b}. Если цвет не помещается в sRGB, понижается chroma (L и hue
 * сохраняются) — так подгонка lightness не «сжигает» оттенок клиппингом каналов.
 */
export function oklchToRgb(L, C, h) {
    L = Math.max(0, Math.min(1, L));
    const rad = h * Math.PI / 180;
    let raw = oklabToRgbRaw(L, C * Math.cos(rad), C * Math.sin(rad));

    if (!inGamut(raw)) {
        let lo = 0, hi = C;
        for (let i = 0; i < 20; i++) {
            const mid = (lo + hi) / 2;
            const t = oklabToRgbRaw(L, mid * Math.cos(rad), mid * Math.sin(rad));
            if (inGamut(t)) lo = mid; else hi = mid;
        }
        raw = oklabToRgbRaw(L, lo * Math.cos(rad), lo * Math.sin(rad));
    }
    const clip = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return { r: clip(raw[0]), g: clip(raw[1]), b: clip(raw[2]) };
}

/** Евклидово расстояние в OKLab (≈ 0.02 — едва заметно, 0.2+ — явно разные цвета). */
export function deltaEOk(c1, c2) {
    const p = rgbToOklab(c1), q = rgbToOklab(c2);
    return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** Смешивание в OKLab: t=0 → c1, t=1 → c2. */
export function mixOklab(c1, c2, t) {
    const p = rgbToOklab(c1), q = rgbToOklab(c2);
    const L = p.L + (q.L - p.L) * t;
    const a = p.a + (q.a - p.a) * t;
    const b = p.b + (q.b - p.b) * t;
    const C = Math.hypot(a, b);
    const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    return oklchToRgb(L, C, h);
}

/** Угловая разница оттенков 0..180. */
export function hueDistance(h1, h2) {
    const d = Math.abs(h1 - h2) % 360;
    return d > 180 ? 360 - d : d;
}
