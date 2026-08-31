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

function fmtRgb({ r, g, b }) {
    return `rgb(${r},${g},${b})`;
}

function fmtHsl({ r, g, b }) {
    const { h, s, l } = rgbToHsl(r, g, b);
    return `h=${h.toFixed(0)} s=${s.toFixed(2)} l=${l.toFixed(2)}`;
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
        print(`  darkest:        ${fmtRgb(a.darkest)}  ${fmtHsl(a.darkest)}`);
        print(`  lightest:       ${fmtRgb(a.lightest)}  ${fmtHsl(a.lightest)}`);
        print(`  mostSaturated:  ${fmtRgb(a.mostSaturated)}  ${fmtHsl(a.mostSaturated)}`);
        print(`  leastSaturated: ${fmtRgb(a.leastSaturated)}  ${fmtHsl(a.leastSaturated)}`);
        print(`  dominant:       ${fmtRgb(a.dominant)}  ${fmtHsl(a.dominant)}`);
        print(`  average:        ${fmtRgb(a.average)}  ${fmtHsl(a.average)}`);
        print('');
    }
}
