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
import { applyContrastCheck, contrastRatio } from '../src/contrast.js';
import { swatch } from './color-swatch.js';

// TEST_ROLES v2 — bg и fg из РАЗНЫХ зон (bottom/top), см. подробный
// комментарий в demo-formatter.js. Три прогона подряд на одной зоне для
// обеих ролей систематически проваливали WCAG-контраст.
const TEST_ROLES = {
    bg: {
        pick: 'darkest',
        from: 'bottom',
        fallback: 'full',
    },
    fg: {
        pick: 'lightest',
        from: 'top',
        fallback: 'full',
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
    printerr('           или: gjs -m bin/demo-picker.js --test-contrast  (синтетическая проверка автокоррекции)');
} else if (args[0] === '--test-contrast') {
    // Синтетическая проверка: два похожих пастельных цвета с заведомо
    // низким ratio (~1.23), чтобы убедиться, что автокоррекция реально
    // срабатывает, а не просто "не ломается" на случаях, где и так всё ок.
    const bg = { r: 180, g: 170, b: 200 };
    const fg = { r: 200, g: 190, b: 210 };

    const before = contrastRatio(bg, fg);
    const { colors, debug } = applyContrastCheck({ bg, fg });

    print('=== Синтетический тест автокоррекции ===');
    print(`  bg (не трогается) ${swatch(bg)}  rgb(${bg.r},${bg.g},${bg.b})`);
    print(`  fg (исходный)     ${swatch(fg)}  rgb(${fg.r},${fg.g},${fg.b})   ratio до: ${before.toFixed(2)}:1`);
    print(`  fg (после):       ${swatch(colors.fg)}  rgb(${colors.fg.r},${colors.fg.g},${colors.fg.b})`);
    print(`  ${JSON.stringify(debug)}`);
} else {
    const path = args[0];

    const buffer = extractPixels(path);
    const zones = cutAllZones(buffer, {});
    const analysis = analyzeAllZones(zones);
    const { colors: rawColors, debug: pickerDebug } = pickRoles(analysis, TEST_ROLES);

    const before = rawColors.bg && rawColors.fg ? contrastRatio(rawColors.bg, rawColors.fg) : null;
    const { colors, debug: contrastDebug } = applyContrastCheck(rawColors);

    print('=== Выбранные роли (после contrast-check) ===');
    for (const [roleName, color] of Object.entries(colors)) {
        const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
        print(
            `  ${roleName.padEnd(10)} ${swatch(color)}  rgb(${color.r},${color.g},${color.b})` +
            `  h=${h.toFixed(0).padStart(3)} s=${s.toFixed(2)} l=${l.toFixed(2)}`
        );
    }

    print('');
    print('=== Contrast-check (bg/fg, WCAG AA >= 4.5) ===');
    if (before !== null) {
        print(`  до коррекции:  ${before.toFixed(2)}:1`);
    }
    print(`  ${JSON.stringify(contrastDebug)}`);

    print('');
    print('=== Debug-трейс picker ===');
    for (const d of pickerDebug) {
        print(`  ${JSON.stringify(d)}`);
    }
}
