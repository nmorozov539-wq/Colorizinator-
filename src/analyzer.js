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

import { rgbToOklch, hueDistance } from './oklab.js';

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
 * Группирует пиксели зоны по укрупнённым корзинам (каждый RGB-канал,
 * округлённый до кратного `bucket`) и считает частоту каждой группы;
 * цвет группы — среднее её реальных пикселей, а не центр корзины — это и есть "dominant" (по площади), в отличие от "average"
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

        // Корзина — только ключ группировки. Квантованный цвет НЕ становится
        // результатом (иначе #12141c превращался бы в #101020 — цвет, которого
        // на картинке нет): в группе копятся суммы реальных значений, а
        // представитель считается как их среднее (см. ниже).
        const key = (Math.round(r / bucket) << 16) | (Math.round(g / bucket) << 8) | Math.round(b / bucket);

        const existing = buckets.get(key);
        if (existing) {
            existing.count++;
            existing.sr += r; existing.sg += g; existing.sb += b;
        } else {
            buckets.set(key, { count: 1, sr: r, sg: g, sb: b });
        }
    }

    const groups = [];
    for (const v of buckets.values()) {
        groups.push({
            r: Math.round(v.sr / v.count),
            g: Math.round(v.sg / v.count),
            b: Math.round(v.sb / v.count),
            count: v.count,
        });
    }
    // Детерминированный порядок: по count desc, при равенстве — по цвету.
    return groups.sort((a, b) => (b.count - a.count) || (a.r - b.r) || (a.g - b.g) || (a.b - b.b));
}

/**
 * Параметры поиска «самого насыщенного» цвета (OKLCH).
 *
 * Насыщенность меряем chroma в OKLCH, а не HSL-saturation: у HSL почти
 * чёрные/почти белые пиксели «насыщены» (rgb(3,2,0) → s≈1), поэтому раньше
 * приходилось штрафовать её по lightness. У OKLCH chroma вырожденных случаев
 * нет, а у плавного градиента (свечение, закат) единый оттенок не дробится.
 */
const VIVID_MIN_CHROMA = 0.04;      // ниже — цвет считается серым и в кандидаты не идёт
const VIVID_L_RANGE = [0.12, 0.97]; // у почти чёрного/белого chroma не информативна
const VIVID_MIN_SHARE = 0.001;      // доля зоны, которую должен занимать ОТТЕНОК (±20°)
const VIVID_HUE_WINDOW = 20;        // градусов: что считаем «тем же оттенком»

/**
 * Самый насыщенный цвет зоны с защитой от шума и бликов.
 *
 * Группы RGB-корзин по отдельности малы (плавный градиент рассыпается на
 * десятки корзин по 0.2–0.4%), поэтому «присутствие» считается не по корзине,
 * а по ОТТЕНКУ: суммарная доля всех хроматичных групп в пределах ±20° hue.
 * Единичные шумовые пиксели (разные оттенки, по 0.01%) порог не проходят,
 * а честный маленький акцент (0.1%+ площади) — проходит. Результат —
 * среднее по «ядру» оттенка (группы с chroma ≥ 85% пика), а не один пиксель.
 *
 * @param {Array<{r:number,g:number,b:number,count:number}>} groups
 * @param {number} opaqueCount
 * @returns {{r:number,g:number,b:number}}
 */
function pickMostSaturated(groups, opaqueCount) {
    const info = groups.map((g) => ({ g, ...rgbToOklch(g) }));
    const chromatic = info.filter((x) =>
        x.C >= VIVID_MIN_CHROMA && x.L >= VIVID_L_RANGE[0] && x.L <= VIVID_L_RANGE[1]);

    if (chromatic.length === 0) {
        // Ч/б или почти монохром: честно возвращаем наименее серую группу,
        // дальше решает refine (там это «акцента нет»).
        let best = info[0];
        for (const x of info) if (x.C > best.C) best = x;
        return { r: best.g.r, g: best.g.g, b: best.g.b };
    }

    // Гистограмма оттенка по 5° (кольцевая) → доля в окне ±VIVID_HUE_WINDOW.
    const BINS = 72;
    const hist = new Float64Array(BINS);
    for (const x of chromatic) hist[Math.floor(x.h / 5) % BINS] += x.g.count;
    const reach = Math.round(VIVID_HUE_WINDOW / 5);
    const windowCount = (h) => {
        const bin = Math.floor(h / 5) % BINS;
        let sum = 0;
        for (let d = -reach; d <= reach; d++) sum += hist[(bin + d + BINS) % BINS];
        return sum;
    };

    const minCount = Math.max(2, Math.ceil(opaqueCount * VIVID_MIN_SHARE));
    let candidates = chromatic.filter((x) => windowCount(x.h) >= minCount);
    if (candidates.length === 0) candidates = chromatic; // крайний случай: не падаем

    let peak = candidates[0];
    for (const x of candidates) if (x.C > peak.C) peak = x;

    let sr = 0, sg = 0, sb = 0, total = 0;
    for (const x of candidates) {
        if (hueDistance(x.h, peak.h) <= VIVID_HUE_WINDOW && x.C >= 0.85 * peak.C && Math.abs(x.L - peak.L) <= 0.2) {
            sr += x.g.r * x.g.count; sg += x.g.g * x.g.count; sb += x.g.b * x.g.count; total += x.g.count;
        }
    }
    return { r: Math.round(sr / total), g: Math.round(sg / total), b: Math.round(sb / total) };
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
    let leastSaturated = null, leastSaturatedS = Infinity;

    for (const c of candidates) {
        const { s, l } = rgbToHsl(c.r, c.g, c.b);

        if (l < darkestL) { darkestL = l; darkest = { r: c.r, g: c.g, b: c.b }; }
        if (l > lightestL) { lightestL = l; lightest = { r: c.r, g: c.g, b: c.b }; }

        if (s < leastSaturatedS) { leastSaturatedS = s; leastSaturated = { r: c.r, g: c.g, b: c.b }; }
    }

    const mostSaturated = pickMostSaturated(quantized, opaqueCount);

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
