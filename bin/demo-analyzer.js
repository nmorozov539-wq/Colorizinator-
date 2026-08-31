#!/usr/bin/env -S gjs -m
// bin/demo-analyzer.js — ручной прогон extractor → zoner → analyzer,
// печатает darkest/lightest/mostSaturated/dominant/uniformity для каждой
// встроенной зоны. НЕ импортируется другими модулями (см. demo-extractor.js
// про то, почему демо-код живёт отдельно от src/*.js).
//
// Запуск: gjs -m bin/demo-analyzer.js ~/Pictures/Wallpapers/wall6.png

import System from 'system';
import { extractPixels } from '../src/extractor.js';
import { cutAllZones } from '../src/zoner.js';
import { analyzeAllZones, rgbToHsl } from '../src/analyzer.js';
import { swatchLine } from './color-swatch.js';

function line(label, color) {
    return `  ${label.padEnd(16)}${swatchLine(color, rgbToHsl(color.r, color.g, color.b))}`;
}

const args = System.programArgs;

if (args.length === 0) {
    printerr('Использование: gjs -m bin/demo-analyzer.js <путь-к-изображению>');
} else {
    const path = args[0];

    const buffer = extractPixels(path);
    const zones = cutAllZones(buffer, {});
    const analysis = analyzeAllZones(zones);

    for (const [name, a] of Object.entries(analysis)) {
        print(`--- ${name} (${a.pixelCount}px, uniformity=${a.uniformity.toFixed(2)}) ---`);
        print(line('darkest:', a.darkest));
        print(line('lightest:', a.lightest));
        print(line('mostSaturated:', a.mostSaturated));
        print(line('leastSaturated:', a.leastSaturated));
        print(line('dominant:', a.dominant));
        print(line('average:', a.average));
        print('');
    }
}
