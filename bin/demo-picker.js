#!/usr/bin/env -S gjs -m
// bin/demo-picker.js — ручной прогон полного пайплайна до picker'а включительно.
// Использует встроенный тестовый профиль (роли bg/fg/accent/muted/surface)
// на основе встроенных зон top/bottom/full — реальный профиль пользователя
// будет грузиться из JSON (это появится в formatter/CLI-слое позже).
//
// Запуск: gjs -m bin/demo-picker.js ~/Pictures/Wallpapers/wall6.png

import System from 'system';
import { extractPixels } from '../src/extractor.js';
import { cutAllZones } from '../src/zoner.js';
import { analyzeAllZones, rgbToHsl } from '../src/analyzer.js';
import { pickRoles } from '../src/picker.js';
import { swatch } from './color-swatch.js';

// Тестовый профиль — упрощённая версия mycyber из ТЗ, но на встроенных зонах
// (top/bottom/full), чтобы не тащить в первый прогон ещё и кастомные zones.
const TEST_ROLES = {
    bg: {
        pick: 'darkest',
        from: 'top',
        fallback: 'full',
    },
    fg: {
        pick: 'lightest',
        from: 'top',
    },
    accent: {
        pick: 'most-saturated',
        from: 'bottom',
        'min-saturation': 0.6,
        fallback: 'full',
    },
    muted: {
        pick: 'least-saturated',
        from: 'top',
    },
    surface: {
        pick: 'between-bg-fg',
    },
};

const args = System.programArgs;

if (args.length === 0) {
    printerr('Использование: gjs -m bin/demo-picker.js <путь-к-изображению>');
} else {
    const path = args[0];

    const buffer = extractPixels(path);
    const zones = cutAllZones(buffer, {});
    const analysis = analyzeAllZones(zones);
    const { colors, debug } = pickRoles(analysis, TEST_ROLES);

    print('=== Выбранные роли ===');
    for (const [roleName, color] of Object.entries(colors)) {
        const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
        print(
            `  ${roleName.padEnd(10)} ${swatch(color)}  rgb(${color.r},${color.g},${color.b})` +
            `  h=${h.toFixed(0).padStart(3)} s=${s.toFixed(2)} l=${l.toFixed(2)}`
        );
    }

    print('');
    print('=== Debug-трейс ===');
    for (const d of debug) {
        print(`  ${JSON.stringify(d)}`);
    }
}
