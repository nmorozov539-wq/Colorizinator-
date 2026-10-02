#!/usr/bin/env -S gjs -m
// extractor.js — GdkPixbuf → downscale → raw pixel buffer
//
// Роль в пайплайне (см. ТЗ п.2.1, п.2.2):
//   Вход: путь к изображению
//   Выход: { width, height, channels, rowstride, pixels: Uint8Array }
//
// Читаем пиксели через GdkPixbuf.get_pixels() ОДНИМ вызовом (raw buffer),
// а не через get_pixel() по координатам — на 1920x1080+ разница на порядок,
// т.к. каждый get_pixel() пересекает границу JS↔C биндингов отдельно.
// Критерий приёмки ТЗ п.16: генерация CSS < 500ms на 1920x1080.

import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import GLib from 'gi://GLib';
import { trimBorders } from './borders.js';

/**
 * Максимальная сторона изображения после downscale.
 * Зоны считаются в процентах (см. zoner.js), поэтому абсолютное
 * разрешение после downscale не влияет на точность зон — только
 * на скорость и на "зерно" анализа внутри зоны.
 *
 * 256px — компромисс: значительно быстрее полного 4K-скана,
 * но достаточно пикселей, чтобы analyzer.js не терял мелкие
 * контрастные пятна (см. кейс "аниме" — маленькие яркие детали).
 */
const DEFAULT_MAX_DIMENSION = 256;

/**
 * Загружает изображение, уменьшает его и возвращает raw-буфер пикселей.
 *
 * @param {string} imagePath - путь к файлу изображения
 * @param {number} [maxDimension=DEFAULT_MAX_DIMENSION] - максимальная сторона после downscale
 * @param {{trim?: boolean}} [options] - trim (по умолчанию true): срезать чёрные
 *   полосы letterbox/pillarbox и прозрачные поля (см. borders.js). В результате
 *   поле `trimmed` описывает срез ({top,bottom,left,right,blackBars}) или null.
 * @returns {{
 *   width: number,
 *   height: number,
 *   channels: number,
 *   rowstride: number,
 *   hasAlpha: boolean,
 *   pixels: Uint8Array
 * }}
 */
export function extractPixels(imagePath, maxDimension = DEFAULT_MAX_DIMENSION, options = {}) {
    let original;
    try {
        original = GdkPixbuf.Pixbuf.new_from_file(imagePath);
    } catch (e) {
        throw new Error(`Не удалось открыть изображение "${imagePath}": ${e.message}`);
    }

    const { width: origW, height: origH } = original;

    // Downscale с сохранением aspect ratio — длинная сторона = maxDimension.
    // Это ОБЯЗАТЕЛЬНЫЙ шаг перед зонированием (ТЗ п.2.1, шаг [1]):
    // зоны считаются в процентах, так что скейлинг не искажает разметку.
    const scale = Math.min(maxDimension / origW, maxDimension / origH, 1);
    const scaledW = Math.max(1, Math.round(origW * scale));
    const scaledH = Math.max(1, Math.round(origH * scale));

    const scaled = (scale < 1)
        ? original.scale_simple(scaledW, scaledH, GdkPixbuf.InterpType.BILINEAR)
        : original;

    if (!scaled) {
        throw new Error(`scale_simple вернул null для "${imagePath}" (${scaledW}x${scaledH})`);
    }

    // --- Единственное чтение raw-буфера. Всё дальнейшее (zoner/analyzer)
    // работает по индексам в этом Uint8Array, не трогая GdkPixbuf снова.
    const pixels = scaled.get_pixels();

    const buffer = {
        width: scaled.get_width(),
        height: scaled.get_height(),
        channels: scaled.get_n_channels(),   // 3 (RGB) или 4 (RGBA)
        rowstride: scaled.get_rowstride(),    // байт на строку (может быть > width*channels из-за padding)
        hasAlpha: scaled.get_has_alpha(),
        pixels,                               // Uint8Array, длина = rowstride * height
    };

    return (options.trim === false) ? { ...buffer, trimmed: null } : trimBorders(buffer);
}

/**
 * Читает цвет одного пикселя из raw-буфера, полученного extractPixels().
 * Используется zoner.js/analyzer.js для перебора зоны — НЕ обращается
 * к GdkPixbuf повторно, только offset-математика по Uint8Array.
 *
 * @param {ReturnType<typeof extractPixels>} buffer
 * @param {number} x
 * @param {number} y
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function getPixelAt(buffer, x, y) {
    const { pixels, rowstride, channels } = buffer;
    const offset = y * rowstride + x * channels;

    return {
        r: pixels[offset],
        g: pixels[offset + 1],
        b: pixels[offset + 2],
        a: channels === 4 ? pixels[offset + 3] : 255,
    };
}

/**
 * Ручной тестовый прогон extractor'а с выводом тайминга по этапам.
 * Вызывается явно из CLI-блока ниже — НЕ выполняется автоматически при
 * импорте extractor.js из другого модуля (zoner.js и т.д.), в отличие от
 * кода на верхнем уровне модуля, который выполнился бы при любом импорте.
 *
 * @param {string} path
 * @param {number} maxDim
 */
export function runCliDemo(path, maxDim = DEFAULT_MAX_DIMENSION) {
    const tStart = GLib.get_monotonic_time();

    const original = GdkPixbuf.Pixbuf.new_from_file(path);
    const tDecode = GLib.get_monotonic_time();

    const { width: origW, height: origH } = original;
    const scale = Math.min(maxDim / origW, maxDim / origH, 1);
    const scaledW = Math.max(1, Math.round(origW * scale));
    const scaledH = Math.max(1, Math.round(origH * scale));
    const scaled = (scale < 1)
        ? original.scale_simple(scaledW, scaledH, GdkPixbuf.InterpType.BILINEAR)
        : original;
    const tScale = GLib.get_monotonic_time();

    const pixels = scaled.get_pixels();
    const tRead = GLib.get_monotonic_time();

    const decodeMs = (tDecode - tStart) / 1000;
    const scaleMs = (tScale - tDecode) / 1000;
    const readMs = (tRead - tScale) / 1000;
    const totalMs = (tRead - tStart) / 1000;

    print(`Файл: ${path}`);
    print(`Оригинал: ${origW}x${origH} → после downscale: ${scaledW}x${scaledH}`);
    print(`  decode (new_from_file):  ${decodeMs.toFixed(2)}ms`);
    print(`  scale (scale_simple):    ${scaleMs.toFixed(2)}ms`);
    print(`  read (get_pixels):       ${readMs.toFixed(2)}ms`);
    print(`  ИТОГО:                   ${totalMs.toFixed(2)}ms`);

    const center = getPixelAt(
        { pixels, rowstride: scaled.get_rowstride(), channels: scaled.get_n_channels() },
        Math.floor(scaledW / 2),
        Math.floor(scaledH / 2)
    );
    print(`Пиксель в центре: rgb(${center.r}, ${center.g}, ${center.b})`);

    // --- Диагностика: проверяем реальную длину буфера против ожидаемой.
    // ГИПОТЕЗА (не подтверждена): GdkPixbuf.get_pixels() в GJS может
    // возвращать Uint8Array короче, чем rowstride*height, если последняя
    // строка изображения не занимает полный rowstride (задокументированное
    // поведение GdkPixbuf на уровне C API) — тогда offset-чтение в
    // getPixelAt()/analyzer.js уходит за пределы массива и получает
    // undefined вместо реального байта.
    const rowstride = scaled.get_rowstride();
    const expectedLength = rowstride * scaledH;
    const actualLength = pixels.length;
    print('');
    print('--- Диагностика длины буфера ---');
    print(`  rowstride:            ${rowstride}`);
    print(`  height:               ${scaledH}`);
    print(`  ожидаемая длина:      ${expectedLength} (rowstride * height)`);
    print(`  реальная длина:       ${actualLength} (pixels.length)`);
    print(`  совпадает:            ${expectedLength === actualLength}`);
    if (actualLength < expectedLength) {
        print(`  ⚠ БУФЕР КОРОЧЕ ОЖИДАЕМОГО на ${expectedLength - actualLength} байт!`);
    }

    // Дополнительно: пробуем прочитать последний пиксель последней строки —
    // если гипотеза верна, это вернёт undefined вместо числа.
    const lastPixel = getPixelAt(
        { pixels, rowstride, channels: scaled.get_n_channels() },
        scaledW - 1,
        scaledH - 1
    );
    print(`  последний пиксель:    r=${lastPixel.r} g=${lastPixel.g} b=${lastPixel.b}`);
    if (lastPixel.r === undefined) {
        print(`  ⚠ ПОДТВЕРЖДЕНО: чтение за пределами буфера даёт undefined`);
    }

    // --- Диагностика формата пикселей: исключаем рассинхронизацию каналов
    // (например если реально RGBA, а мы читаем как RGB со сдвигом).
    print('');
    print('--- Диагностика формата пикселей ---');
    print(`  channels:        ${scaled.get_n_channels()}`);
    print(`  hasAlpha:        ${scaled.get_has_alpha()}`);
    print(`  bits_per_sample: ${scaled.get_bits_per_sample()}`);
    print(`  colorspace:      ${scaled.get_colorspace()}`);
    const rawFirst12 = Array.from(pixels.slice(0, 12));
    print(`  первые 12 байт буфера: [${rawFirst12.join(', ')}]`);

    // --- Прямой поиск экстремумов внутри РЕАЛЬНЫХ границ top-зоны (y=0..20
    // для этого разрешения, crop "0,0,100,15"). Раньше проверяли отдельные
    // строки (y=0 — честный чёрный, y=72 — честный плавный) — теперь считаем
    // min/max luminance по ВСЕЙ top-зоне разом, чтобы окончательно понять,
    // является ли lightest=255,255,255 честным бликом внутри неё или багом.
    print('');
    const topZoneHeight = Math.ceil(scaledH * 0.15);
    print(`--- Поиск экстремумов в top-зоне (y=0..${topZoneHeight - 1}, честная проверка без zoner.js) ---`);
    const nCh = scaled.get_n_channels();
    let minSum = 765, maxSum = -1, minPos = null, maxPos = null;
    for (let y = 0; y < topZoneHeight; y++) {
        for (let x = 0; x < scaledW; x++) {
            const p = getPixelAt({ pixels, rowstride, channels: nCh }, x, y);
            const sum = p.r + p.g + p.b;
            if (sum < minSum) { minSum = sum; minPos = { x, y, ...p }; }
            if (sum > maxSum) { maxSum = sum; maxPos = { x, y, ...p }; }
        }
    }
    print(`  самый тёмный:  x=${minPos.x} y=${minPos.y}  rgb(${minPos.r},${minPos.g},${minPos.b})`);
    print(`  самый светлый: x=${maxPos.x} y=${maxPos.y}  rgb(${maxPos.r},${maxPos.g},${maxPos.b})`);
}

// extractor.js — ЧИСТЫЙ библиотечный модуль, никакого кода верхнего уровня
// с побочными эффектами. Демо-запуск теперь в bin/demo-extractor.js — так
// импорт этого файла из zoner.js/analyzer.js гарантированно ничего не печатает
// и не читает CLI-аргументы, вне зависимости от поведения System.programPath
// (не удалось надёжно определить entry-point через него на практике — см.
// git-историю, попытка с programPath не устранила дублирование вывода).
