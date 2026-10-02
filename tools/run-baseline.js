#!/usr/bin/env -S gjs -m
// Харнесс: прогоняет реальный pipeline по списку файлов.
//   gjs -m tools/run-baseline.js [--table] [--no-refine] файлы...
// По умолчанию — JSON-строки (по одной на файл); --table — компактная таблица.
import GLib from 'gi://GLib';
import { generatePalette } from '../src/pipeline.js';

const flags = ARGV.filter((a) => a.startsWith('--'));
const FILES = ARGV.filter((a) => !a.startsWith('--'));
const TABLE = flags.includes('--table');
const REFINE = !flags.includes('--no-refine');

const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');

for (const path of FILES) {
    const t0 = GLib.get_monotonic_time();
    const out = { file: path };
    try {
        const { colors, debug } = generatePalette(path, { refine: REFINE });
        out.roles = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, hex(v)]));
        out.trimmed = debug.trimmed;
        out.contrast = debug.contrast;
        out.issues = debug.issues;
        out.refine = debug.refine;
        out.ms = (GLib.get_monotonic_time() - t0) / 1000;
    } catch (e) {
        out.error = String(e.message || e);
    }
    if (!TABLE) { print(JSON.stringify(out)); continue; }

    const name = path.split('/').pop().padEnd(26);
    if (out.error) { print(`${name} ERROR ${out.error}`); continue; }
    const r = out.roles;
    const acts = out.refine.map((t) => `${t.role}:${t.action}`).filter((s) => !s.endsWith(':kept')).join(' ');
    const warn = out.issues.length ? `  ⚠ ${out.issues.join('; ')}` : '';
    print(`${name} bg=${r.bg} fg=${r.fg} acc=${r.accent} mut=${r.muted} surf=${r.surface} ${out.contrast.finalRatio}:1 ${Math.round(out.ms)}ms${warn}`);
    if (acts) print(`${''.padEnd(26)} [${acts}]`);
}
