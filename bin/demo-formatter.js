#!/usr/bin/env -S gjs -m
// bin/demo-formatter.js — полный пайплайн extractor→zoner→analyzer→picker→
// contrast→formatter, печатает результат в CSS, SCSS и JSON разом.
//
// Запуск: gjs -m bin/demo-formatter.js ~/Pictures/Wallpapers/wall6.png

import System from 'system';
import { extractPixels } from '../src/extractor.js';
import { cutAllZones } from '../src/zoner.js';
import { analyzeAllZones, rgbToHsl } from '../src/analyzer.js';
import { pickRoles } from '../src/picker.js';
import { applyContrastCheck } from '../src/contrast.js';
import { format } from '../src/formatter.js';
import { swatch } from './color-swatch.js';

// TEST_ROLES v2 — bg и fg теперь из РАЗНЫХ зон (bottom/top), а не из одной
// "top" сразу двумя стратегиями. Три прогона подряд (wall6, wall10, wall2)
// показали, что одна узкая зона регулярно содержит одновременно очень
// тёмные и очень светлые пиксели — WCAG-коррекция срабатывала систематически,
// откатываясь к чистому чёрному/белому вместо цвета из самого изображения.
// Компромисс: bg из bottom (часто тень/пол/тёмный низ кадра), fg из top
// (часто небо/подсветка сверху) — не гарантия, но статистически разумнее,
// чем читать обе крайности из одного и того же узкого среза.
const TEST_ROLES = {
    bg: { pick: 'darkest', from: 'bottom', fallback: 'full' },
    fg: { pick: 'lightest', from: 'top', fallback: 'full' },
    accent: { pick: 'most-saturated', from: 'bottom', 'min-saturation': 0.6, fallback: 'full' },
    muted: { pick: 'least-saturated', from: 'top' },
    surface: { pick: 'between-bg-fg' },
};

const args = System.programArgs;

if (args.length === 0) {
    printerr('Использование: gjs -m bin/demo-formatter.js <путь-к-изображению>');
} else {
    const path = args[0];

    const buffer = extractPixels(path);
    const zones = cutAllZones(buffer, {});
    const analysis = analyzeAllZones(zones);
    const { colors: rawColors } = pickRoles(analysis, TEST_ROLES);
    const { colors, debug: contrastDebug } = applyContrastCheck(rawColors);

    print('=== Итоговые роли ===');
    for (const [roleName, color] of Object.entries(colors)) {
        const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
        print(
            `  ${roleName.padEnd(10)} ${swatch(color)}  rgb(${color.r},${color.g},${color.b})` +
            `  h=${h.toFixed(0).padStart(3)} s=${s.toFixed(2)} l=${l.toFixed(2)}`
        );
    }
    print(`  (contrast-check: ${JSON.stringify(contrastDebug)})`);
    print('');

    print('=== CSS ===');
    print(format('css', colors));
    print('');

    print('=== SCSS ===');
    print(format('scss', colors));
    print('');

    print('=== JSON (single theme "normal") ===');
    print(format('json', { normal: colors }));
}
