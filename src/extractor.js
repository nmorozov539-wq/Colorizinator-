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

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.GdkPixbuf = '2.0';

const { GdkPixbuf, GLib } = imports.gi;

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
 * @returns {{
 *   width: number,
 *   height: number,
 *   channels: number,
 *   rowstride: number,
 *   hasAlpha: boolean,
 *   pixels: Uint8Array
 * }}
 */
function extractPixels(imagePath, maxDimension = DEFAULT_MAX_DIMENSION) {
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

    return {
        width: scaled.get_width(),
        height: scaled.get_height(),
        channels: scaled.get_n_channels(),   // 3 (RGB) или 4 (RGBA)
        rowstride: scaled.get_rowstride(),    // байт на строку (может быть > width*channels из-за padding)
        hasAlpha: scaled.get_has_alpha(),
        pixels,                               // Uint8Array, длина = rowstride * height
    };
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
function getPixelAt(buffer, x, y) {
    const { pixels, rowstride, channels } = buffer;
    const offset = y * rowstride + x * channels;

    return {
        r: pixels[offset],
        g: pixels[offset + 1],
        b: pixels[offset + 2],
        a: channels === 4 ? pixels[offset + 3] : 255,
    };
}

// --- CLI-запуск для ручного теста модуля отдельно от остального пайплайна ---
// Пример: gjs -m extractor.js ~/Pictures/wall.jpg
if (ARGV.length > 0) {
    const path = ARGV[0];
    const maxDim = ARGV[1] ? parseInt(ARGV[1], 10) : DEFAULT_MAX_DIMENSION;

    const t0 = GLib.get_monotonic_time();
    const buf = extractPixels(path, maxDim);
    const elapsedMs = (GLib.get_monotonic_time() - t0) / 1000;

    print(`Файл: ${path}`);
    print(`Размер после downscale: ${buf.width}x${buf.height} (channels=${buf.channels}, alpha=${buf.hasAlpha})`);
    print(`Время extractPixels(): ${elapsedMs.toFixed(2)}ms`);

    // Сэмпл — цвет центрального пикселя, просто чтобы убедиться, что buffer живой
    const center = getPixelAt(buf, Math.floor(buf.width / 2), Math.floor(buf.height / 2));
    print(`Пиксель в центре: rgb(${center.r}, ${center.g}, ${center.b})`);
}
