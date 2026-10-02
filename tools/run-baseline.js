#!/usr/bin/env -S gjs -m
// Харнесс: прогоняет реальный pipeline по списку файлов, печатает JSON-строки.
import GLib from 'gi://GLib';
import System from 'system';
import { extractPixels } from '../src/extractor.js';
import { cutAllZones } from '../src/zoner.js';
import { analyzeAllZones } from '../src/analyzer.js';
import { pickRoles } from '../src/picker.js';
import { applyContrastCheck } from '../src/contrast.js';

const TEST_ROLES = {
    bg: { pick: 'darkest', from: 'bottom', fallback: 'full' },
    fg: { pick: 'lightest', from: 'top', fallback: 'full' },
    accent: { pick: 'most-saturated', from: 'bottom', 'min-saturation': 0.6, fallback: 'full' },
    muted: { pick: 'least-saturated', from: 'top' },
    surface: { pick: 'between-bg-fg' },
};
const hex = (c) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');

for (const path of ARGV) {
    const t0 = GLib.get_monotonic_time();
    const out = { file: path };
    try {
        const buf = extractPixels(path);
        out.trimmed = buf.trimmed;
        const zones = cutAllZones(buf);
        const analysis = analyzeAllZones(zones);
        const { colors } = pickRoles(analysis, TEST_ROLES);
        const { colors: final, debug } = applyContrastCheck(colors);
        out.roles = Object.fromEntries(Object.entries(final).map(([k, v]) => [k, hex(v)]));
        out.contrast = debug;
        out.ms = (GLib.get_monotonic_time() - t0) / 1000;
    } catch (e) {
        out.error = String(e.message || e);
    }
    print(JSON.stringify(out));
}
