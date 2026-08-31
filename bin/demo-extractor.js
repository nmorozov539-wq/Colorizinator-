#!/usr/bin/env -S gjs -m
// bin/demo-extractor.js — ручной запуск extractor.js с выводом тайминга.
//
// НАМЕРЕННО отдельный файл, а не код внутри src/extractor.js. Раньше CLI-блок
// жил прямо в extractor.js на верхнем уровне модуля и выполнялся ПОВТОРНО
// при любом импорте extractor.js из другого модуля (zoner.js и т.д.) —
// System.programArgs/ARGV общие на весь процесс gjs, а надёжного способа
// определить "я точка входа или просто импортирован" в GJS ES-модулях найти
// не удалось (проверяли System.programPath — не помогло на практике).
//
// Раз gjs выполняет любой импортированный модуль целиком, единственный
// надёжный способ не дублировать демо-вывод — не давать этому коду попасть
// в файл, который вообще может быть кем-то импортирован. Этот скрипт
// импортируется только человеком из терминала, никогда — из другого .js.
//
// Запуск: gjs -m bin/demo-extractor.js ~/Pictures/Wallpapers/wall.jpg [maxDim]

import System from 'system';
import { runCliDemo } from '../src/extractor.js';

const args = System.programArgs;

if (args.length === 0) {
    printerr('Использование: gjs -m bin/demo-extractor.js <путь-к-изображению> [maxDimension]');
} else {
    const path = args[0];
    const maxDim = args[1] ? parseInt(args[1], 10) : undefined;
    runCliDemo(path, maxDim);
}
