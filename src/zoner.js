#!/usr/bin/env -S gjs -m
// zoner.js — нарезка pixel-буфера (из extractor.js) на именованные зоны.
//
// Роль в пайплайне (ТЗ п.2.2, п.4):
//   Вход: буфер extractor'а + описание зон профиля ("x,y,w,h" в процентах)
//   Выход: список { name, pixels: Uint8Array, width, height } — по одному
//          компактному RGB(A)-буферу на зону, готовому для analyzer.js
//
// Зоны намеренно МОГУТ пересекаться (ТЗ п.4.3) — zoner не разрешает
// конфликты между зонами, он просто вырезает то, что описано в профиле.
// Разрешение конфликтов на уровне РОЛЕЙ (не зон) — задача picker.js/analyzer.js,
// см. историю обсуждения (role_collisions в debug-выводе).

import { extractPixels, getPixelAt } from './extractor.js';
import System from 'system';

/**
 * Встроенные зоны — доступны в любом профиле без переопределения (ТЗ п.4.2).
 * Формат crop: "x,y,w,h" в процентах от ширины/высоты изображения.
 */
export const BUILTIN_ZONES = {
    'full':          '0,0,100,100',
    'top':           '0,0,100,15',
    'bottom':        '0,85,100,15',
    'left':          '0,0,50,100',
    'right':         '50,0,50,100',
    'center':        '25,25,50,50',
    'top-left':      '0,0,50,50',
    'top-right':     '50,0,50,50',
    'bottom-left':   '0,50,50,50',
    'bottom-right':  '50,50,50,50',
};

/**
 * Разбирает строку crop "x,y,w,h" (проценты) в объект с процентными полями.
 * Валидирует диапазоны — зона обязана укладываться в 0..100 по каждой оси,
 * иначе дальше по пайплайну легко улететь за границы буфера.
 *
 * @param {string} cropStr
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function parseCrop(cropStr) {
    const parts = cropStr.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 4 || parts.some(Number.isNaN)) {
        throw new Error(`Некорректный формат crop: "${cropStr}" (ожидается "x,y,w,h")`);
    }
    const [x, y, w, h] = parts;

    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 100 || y + h > 100) {
        throw new Error(
            `crop "${cropStr}" выходит за границы изображения (x+w и y+h не должны превышать 100)`
        );
    }
    return { x, y, w, h };
}

/**
 * Переводит процентный crop в пиксельные координаты для конкретного буфера.
 *
 * @param {{x:number,y:number,w:number,h:number}} crop - в процентах
 * @param {number} bufferWidth - ширина исходного буфера в пикселях
 * @param {number} bufferHeight - высота исходного буфера в пикселях
 * @returns {{px: number, py: number, pw: number, ph: number}} - в пикселях
 */
export function cropToPixels(crop, bufferWidth, bufferHeight) {
    const px = Math.floor((crop.x / 100) * bufferWidth);
    const py = Math.floor((crop.y / 100) * bufferHeight);
    // Ширину/высоту считаем от координаты, а не округляем независимо —
    // иначе соседние зоны типа top(0,0,100,15)+bottom(0,85,100,15) могут
    // либо оставить зазор в 1px, либо вылезти за буфер на границе.
    const pw = Math.max(1, Math.floor(((crop.x + crop.w) / 100) * bufferWidth) - px);
    const ph = Math.max(1, Math.floor(((crop.y + crop.h) / 100) * bufferHeight) - py);

    return { px, py, pw, ph };
}

/**
 * Вырезает одну зону из буфера extractor'а в собственный компактный Uint8Array.
 * Копирует пиксели (а не хранит offset-view поверх общего буфера) — так
 * analyzer.js работает с зоной как с самостоятельным изображением, не думая
 * про rowstride/padding исходного буфера.
 *
 * @param {ReturnType<typeof import('./extractor.js').extractPixels>} sourceBuffer
 * @param {string} cropStr - "x,y,w,h" в процентах
 * @returns {{width: number, height: number, channels: number, pixels: Uint8Array}}
 */
export function cutZone(sourceBuffer, cropStr) {
    const crop = parseCrop(cropStr);
    const { px, py, pw, ph } = cropToPixels(crop, sourceBuffer.width, sourceBuffer.height);
    const channels = sourceBuffer.channels;

    const zonePixels = new Uint8Array(pw * ph * channels);

    for (let zy = 0; zy < ph; zy++) {
        for (let zx = 0; zx < pw; zx++) {
            const srcPixel = getPixelAt(sourceBuffer, px + zx, py + zy);
            const dstOffset = (zy * pw + zx) * channels;
            zonePixels[dstOffset] = srcPixel.r;
            zonePixels[dstOffset + 1] = srcPixel.g;
            zonePixels[dstOffset + 2] = srcPixel.b;
            if (channels === 4) {
                zonePixels[dstOffset + 3] = srcPixel.a;
            }
        }
    }

    return { width: pw, height: ph, channels, pixels: zonePixels };
}

/**
 * Нарезает буфер на все зоны, описанные в профиле, объединяя встроенные
 * зоны (всегда доступны) с зонами профиля (могут переопределять встроенные
 * по имени — профильная зона с именем "top" заменит дефолтную "top").
 *
 * @param {ReturnType<typeof import('./extractor.js').extractPixels>} sourceBuffer
 * @param {Object<string, {crop: string}>} profileZones - zones-секция профиля
 * @returns {Object<string, {width:number,height:number,channels:number,pixels:Uint8Array}>}
 */
export function cutAllZones(sourceBuffer, profileZones = {}) {
    const mergedDefs = { ...BUILTIN_ZONES };
    for (const [name, def] of Object.entries(profileZones)) {
        mergedDefs[name] = def.crop;
    }

    const result = {};
    for (const [name, cropStr] of Object.entries(mergedDefs)) {
        try {
            result[name] = cutZone(sourceBuffer, cropStr);
        } catch (e) {
            throw new Error(`Ошибка нарезки зоны "${name}" (crop="${cropStr}"): ${e.message}`);
        }
    }
    return result;
}

// --- CLI-запуск для ручного теста: показывает размеры всех встроенных зон ---
// Пример: gjs -m zoner.js ~/Pictures/Wallpapers/wall3.png
//
// Та же защита от повторного срабатывания при импорте, что и в extractor.js —
// см. подробный комментарий там. Актуально уже сейчас: analyzer.js в
// следующем шаге пайплайна будет импортировать cutAllZones() отсюда.
const isEntryPoint =
    typeof System !== 'undefined' &&
    typeof System.programPath === 'string' &&
    import.meta.url.endsWith(System.programPath.replace(/^.*\//, ''));

const cliArgs = (typeof System !== 'undefined' && System.programArgs)
    ? System.programArgs
    : (typeof ARGV !== 'undefined' ? ARGV : []);

if (isEntryPoint && cliArgs.length > 0) {
    const path = cliArgs[0];

    const buffer = extractPixels(path);
    print(`Исходный буфер: ${buffer.width}x${buffer.height}`);
    print('');

    const zones = cutAllZones(buffer, {});
    for (const [name, zone] of Object.entries(zones)) {
        print(`${name.padEnd(14)} → ${zone.width}x${zone.height} (${zone.pixels.length} байт)`);
    }
}
