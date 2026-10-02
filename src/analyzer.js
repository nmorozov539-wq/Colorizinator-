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
 * Пиксели с alpha ниже этого порога считаются прозрачными и в анализе
 * не участвуют (иначе прозрачные пиксели читались бы как чёрные: у них
 * RGB обычно 0,0,0). Для 3-канальных буферов alpha нет — все пиксели непрозрачны.
 */
export const ALPHA_MIN = 128;

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
        if (channels === 4 && pixels[offset + 3] < ALPHA_MIN) continue;
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
 * "Эффективная" насыщенность для целей picker'а — НЕ то же самое, что чистая
 * HSL-saturation. У HSL-saturation есть математическая особенность: у почти
 * чёрных или почти белых пикселей s может быть близка к 1.0 при мизерной
 * разнице между каналами (например rgb(3,2,0) → s≈1.0), хотя визуально это
 * шум/тень, а не "насыщенный цвет" в человеческом понимании.
 *
 * Штрафуем saturation на приближении lightness к 0 или к 1, чтобы кандидат
 * на mostSaturated не мог быть одновременно почти чёрным. Вес подобран так,
 * чтобы не отсеивать честные тёмно-насыщенные цвета (l=0.2-0.3 с высоким s
 * остаются кандидатами), но резать вырожденный случай l<0.05.
 *
 * @param {number} s - HSL saturation (0..1)
 * @param {number} l - HSL lightness (0..1)
 * @returns {number} 0..1
 */
function effectiveSaturation(s, l) {
    // Треугольная весовая функция: пик в l=0.5, спад к 0 на l=0 и l=1.
    // На l=0.05 и l=0.95 вес уже ~0.1 — почти полностью гасит вырожденный
    // случай, но не резко (без разрыва), чтобы не создавать новый артефакт.
    const lightnessWeight = 1 - Math.pow(Math.abs(l - 0.5) * 2, 2);
    return s * Math.max(0, lightnessWeight);
}

/**
 * Минимальная доля зоны, которую должна занимать квантованная группа цвета,
 * чтобы считаться кандидатом на darkest/lightest/mostSaturated/leastSaturated.
 * Пользовательский кейс: на wall10.png один пиксель солнечного блика после
 * downscale (rgb 255,255,255) побеждал в конкурсе на "lightest" зоны из
 * тысяч пикселей — визуально невидимый артефакт диктовал весь bg/fg. Порог
 * 0.5% отсекает единичные/редкие пиксели, но не мешает честному крупному
 * пятну (даже маленькая, но реальная деталь на фото обычно занимает больше
 * 0.5% зоны после downscale до ~256px).
 */
const MIN_CANDIDATE_SHARE = 0.005;

/**
 * Полный анализ зоны — единственный проход по пикселям, дающий кандидатов
 * под все стратегии picker'а разом (ТЗ п.5.2).
 *
 * darkest/lightest/mostSaturated/leastSaturated ищутся СРЕДИ КВАНТОВАННЫХ
 * ГРУПП (не отдельных пикселей) с count >= MIN_CANDIDATE_SHARE * pixelCount —
 * это защищает от единичных пикселей-выбросов (блики, шум, JPEG-артефакты
 * на границах), которые иначе могли бы в одиночку продиктовать весь bg/fg
 * через WCAG-коррекцию (см. историю с wall10.png). average/uniformity
 * по-прежнему считаются по ВСЕМ пикселям без исключений — там единичный
 * выброс и так тонет в сумме, фильтр им не нужен.
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

    // --- Проход 1: average/uniformity считаются по ВСЕМ пикселям без
    // исключений (агрегирующие метрики, выброс и так тонет в сумме).
    let sumR = 0, sumG = 0, sumB = 0;
    let sumL = 0, sumL2 = 0;
    let opaqueCount = 0;

    for (let i = 0; i < pixelCount; i++) {
        const offset = i * channels;
        if (channels === 4 && pixels[offset + 3] < ALPHA_MIN) continue;
        opaqueCount++;
        const r = pixels[offset];
        const g = pixels[offset + 1];
        const b = pixels[offset + 2];
        const { l } = rgbToHsl(r, g, b);

        sumR += r; sumG += g; sumB += b;
        sumL += l; sumL2 += l * l;
    }

    // Зона целиком прозрачная — анализировать нечего. Не бросаем исключение:
    // picker умеет уходить в fallback для пустых зон.
    if (opaqueCount === 0) {
        return { empty: true, pixelCount, opaqueCount: 0 };
    }

    const average = {
        r: Math.round(sumR / opaqueCount),
        g: Math.round(sumG / opaqueCount),
        b: Math.round(sumB / opaqueCount),
    };

    const meanL = sumL / opaqueCount;
    const varianceL = (sumL2 / opaqueCount) - (meanL * meanL);
    const uniformity = Math.max(0, 1 - Math.min(1, varianceL / 0.25));

    // --- Проход 2 (переиспользует quantize()): darkest/lightest/
    // mostSaturated/leastSaturated ищутся среди квантованных групп,
    // отфильтрованных по минимальному count — см. MIN_CANDIDATE_SHARE.
    const quantized = quantize(zone);
    const minCount = Math.max(1, Math.ceil(opaqueCount * MIN_CANDIDATE_SHARE));
    let candidates = quantized.filter((g) => g.count >= minCount);

    // Если фильтр отсёк ВСЕ группы (крайний случай — очень мелкая зона или
    // все цвета уникальны), откатываемся к полному списку без фильтра, а не
    // падаем с пустым результатом. Лучше честно вернуться к старому
    // поведению для этой зоны, чем выбросить исключение на границе.
    if (candidates.length === 0) {
        candidates = quantized;
    }

    let darkest = null, darkestL = Infinity;
    let lightest = null, lightestL = -Infinity;
    let mostSaturated = null, mostSaturatedEffS = -Infinity;
    let leastSaturated = null, leastSaturatedS = Infinity;

    for (const c of candidates) {
        const { s, l } = rgbToHsl(c.r, c.g, c.b);

        if (l < darkestL) { darkestL = l; darkest = { r: c.r, g: c.g, b: c.b }; }
        if (l > lightestL) { lightestL = l; lightest = { r: c.r, g: c.g, b: c.b }; }

        const effS = effectiveSaturation(s, l);
        if (effS > mostSaturatedEffS) { mostSaturatedEffS = effS; mostSaturated = { r: c.r, g: c.g, b: c.b }; }

        if (s < leastSaturatedS) { leastSaturatedS = s; leastSaturated = { r: c.r, g: c.g, b: c.b }; }
    }

    const dominant = quantized[0]; // самый частый квантованный цвет (без фильтра — dominant это и есть "самый частый")

    return {
        darkest,
        lightest,
        mostSaturated,
        leastSaturated,
        dominant: { r: dominant.r, g: dominant.g, b: dominant.b },
        average,
        uniformity,
        pixelCount,
        opaqueCount,
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
