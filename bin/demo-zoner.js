#!/usr/bin/env -S gjs -m
// bin/demo-zoner.js — ручной запуск zoner.js, показывает размеры всех
// встроенных зон для переданного изображения.
//
// Отдельный файл по той же причине, что и demo-extractor.js — см. комментарий
// там. Ничего не экспортирует и не должен импортироваться другими модулями.
//
// Запуск: gjs -m bin/demo-zoner.js ~/Pictures/Wallpapers/wall3.png

import System from 'system';
import { extractPixels } from '../src/extractor.js';
import { cutAllZones } from '../src/zoner.js';

const args = System.programArgs;

if (args.length === 0) {
    printerr('Использование: gjs -m bin/demo-zoner.js <путь-к-изображению>');
} else {
    const path = args[0];

    const buffer = extractPixels(path);
    print(`Исходный буфер: ${buffer.width}x${buffer.height}`);
    print('');

    const zones = cutAllZones(buffer, {});
    for (const [name, zone] of Object.entries(zones)) {
        print(`${name.padEnd(14)} → ${zone.width}x${zone.height} (${zone.pixels.length} байт)`);
    }
}
