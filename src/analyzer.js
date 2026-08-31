// analyzer.js — анализ вырезанной зоны (из zoner.js): доминантные цвета,
// luminance, saturation, uniformity.
//
// Роль в пайплайне (ТЗ п.2.2, п.5.2):
//   Вход: зона от zoner.js { width, height, channels, pixels }
//   Выход: { darkest, lightest, mostSaturated, leastSaturated, dominant,
//            average, uniformity } — уже готовые кандидаты под КАЖДУЮ
//   стратегию picker'а (ТЗ п.5.2), а не сырые данные, которые picker
//   пересчитывал бы сам. Так analyzer — единственное место, где происходит
//   проход по пикселям зоны; picker дальше просто выбирает нужное поле.

/**
 * RGB (0-255 каждый канал) → HSL (h: 0-360, s: 0-1, l: 0-1).
 * Нужен, потому что почти все стратегии picker'а (darkest/lightest/
 * most-saturated) оперируют в терминах HSL, а не сырого RGB.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{h: number, s: number, l: number}}
 */
export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
        return { h: 0, s: 0, l }; // ахроматичный (серый)
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h;
    switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
        case g: h = ((b - r) / d + 2); break;
        default: h = ((r - g) / d + 4); break;
    }
    h *= 60;

    return { h, s, l };
}

/**
 * Относительная luminance по формуле WCAG (не путать с HSL lightness) —
 * нужна отдельно, т.к. contrast.js будет считать WCAG contrast ratio
 * (ТЗ п.2.2 "contrast: проверка contrast ratio"), а он определён именно
 * через эту формулу, не через HSL l.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0..1
 */
export function relativeLuminance(r, g, b) {
    const toLinear = (c) => {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Квантизует зону в укрупнённую палитру (округление каждого RGB-канала
 * до ближайшего кратного `bucket`) и считает частоту каждого квантованного
 * цвета — это и есть "dominant" (по площади), в отличие от "average"
 * (среднее всех пикселей, которое на пёстрых зонах даёт "грязный" цвет,
 * не встречающийся на самом изображении — см. обсуждение кейса "аниме":
 * много мелких разноцветных деталей размывают average в кашу).
 *
 * @param {{width:number,height:number,channels:number,pixels:Uint8Array}} zone
 * @param {number} [bucket=16] - шаг квантизации на канал (0-255)
 * @returns {Array<{r:number,g:number,b:number,count:number}>} отсортировано по count desc
 */
function quantize(zone, bucket = 16) {
    const { width, height, channels, pixels } = zone;
    const buckets = new Map();

    for (let i = 0; i < width * height; i++) {
        const offset = i * channels;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];

        // Квантуем к центру корзины, а не к нижней границе — иначе
        // "dominant" цвет будет систематически темнее реального пятна.
        const qr = Math.min(255, Math.round(r / bucket) * bucket);
        const qg = Math.min(255, Math.round(g / bucket) * bucket);
        const qb = Math.min(255, Math.round(b / bucket) * bucket);
        const key = `${qr},${qg},${qb}`;

        const existing = buckets.get(key);
        if (existing) {
            existing.count++;
        } else {
            buckets.set(key, { r: qr, g: qg, b: qb, count: 1 });
        }
    }

    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

/**
 * Полный анализ зоны — единственный проход по пикселям, дающий кандидатов
 * под все стратегии picker'а разом (ТЗ п.5.2).
 *
 * @param {{width:number,height:number,channels:number,pixels:Uint8Array}} zone
 * @returns {{
 *   darkest: {r:number,g:number,b:number},
 *   lightest: {r:number,g:number,b:number},
 *   mostSaturated: {r:number,g:number,b:number},
 *   leastSaturated: {r:number,g:number,b:number},
 *   dominant: {r:number,g:number,b:number},
 *   average: {r:number,g:number,b:number},
 *   uniformity: number,
 *   pixelCount: number
 * }}
 */
export function analyzeZone(zone) {
    const { width, height, channels, pixels } = zone;
    const pixelCount = width * height;

    if (pixelCount === 0) {
        throw new Error('analyzeZone: зона пустая (0 пикселей)');
    }

    let darkest = null, darkestL = Infinity;
    let lightest = null, lightestL = -Infinity;
    let mostSaturated = null, mostSaturatedS = -Infinity;
    let leastSaturated = null, leastSaturatedS = Infinity;

    let sumR = 0, sumG = 0, sumB = 0;
    // Для uniformity считаем дисперсию luminance — низкая дисперсия значит
    // зона однородная (как "sky" в мысленном эксперименте с киберпанком),
    // высокая — зона "шумная" (как neon-bottom с отражениями).
    let sumL = 0, sumL2 = 0;

    for (let i = 0; i < pixelCount; i++) {
        const offset = i * channels;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];

        const { s, l } = rgbToHsl(r, g, b);

        if (l < darkestL) { darkestL = l; darkest = { r, g, b }; }
        if (l > lightestL) { lightestL = l; lightest = { r, g, b }; }
        if (s > mostSaturatedS) { mostSaturatedS = s; mostSaturated = { r, g, b }; }
        if (s < leastSaturatedS) { leastSaturatedS = s; leastSaturated = { r, g, b }; }

        sumR += r; sumG += g; sumB += b;
        sumL += l; sumL2 += l * l;
    }

    const average = {
        r: Math.round(sumR / pixelCount),
        g: Math.round(sumG / pixelCount),
        b: Math.round(sumB / pixelCount),
    };

    const meanL = sumL / pixelCount;
    const varianceL = (sumL2 / pixelCount) - (meanL * meanL);
    // uniformity: 1 = абсолютно однородная зона, 0 = максимально разнородная.
    // varianceL у luminance (0..1) физически ограничена сверху ~0.25,
    // нормализуем к этому потолку, чтобы получить интуитивный диапазон 0..1.
    const uniformity = Math.max(0, 1 - Math.min(1, varianceL / 0.25));

    const quantized = quantize(zone);
    const dominant = quantized[0]; // самый частый квантованный цвет

    return {
        darkest,
        lightest,
        mostSaturated,
        leastSaturated,
        dominant: { r: dominant.r, g: dominant.g, b: dominant.b },
        average,
        uniformity,
        pixelCount,
    };
}

/**
 * Прогоняет analyzeZone по всем зонам сразу (удобно для deep-режима,
 * ТЗ п.6.2 — "multi-zone analysis: все зоны профиля сканируются").
 *
 * @param {Object<string, {width:number,height:number,channels:number,pixels:Uint8Array}>} zones
 * @returns {Object<string, ReturnType<typeof analyzeZone>>}
 */
export function analyzeAllZones(zones) {
    const result = {};
    for (const [name, zone] of Object.entries(zones)) {
        result[name] = analyzeZone(zone);
    }
    return result;
}
