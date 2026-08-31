#!/usr/bin/env -S gjs -m
// bin/demo-formatter.js — полный пайплайн extractor→zoner→analyzer→picker→
// contrast→formatter, печатает результат в CSS, SCSS и JSON разом.
//
// Запуск: gjs -m bin/demo-formatter.js ~/Pictures/Wallpapers/wall6.png

import System from 'system';
import { extractPixels } from '../src/extractor.js';
import { cutAllZones } from '../src/zoner.js';
import { analyzeAllZones } from '../src/analyzer.js';
import { pickRoles } from '../src/picker.js';
import { applyContrastCheck } from '../src/contrast.js';
import { format } from '../src/formatter.js';

// Тот же тестовый профиль, что и в demo-picker.js — держим один и тот же
// TEST_ROLES, чтобы результаты между demo-скриптами были сравнимы.
const TEST_ROLES = {
    bg: { pick: 'darkest', from: 'top', fallback: 'full' },
    fg: { pick: 'lightest', from: 'top' },
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
    const { colors } = applyContrastCheck(rawColors);

    print('=== CSS ===');
    print(format('css', colors));
    print('');

    print('=== SCSS ===');
    print(format('scss', colors));
    print('');

    print('=== JSON (single theme "normal") ===');
    print(format('json', { normal: colors }));
}
