// pipeline.js — сборка полного конвейера в одну функцию:
//   extractor → (borders) → zoner → analyzer → picker → refine → contrast
// Форматирование (formatter.js) остаётся отдельным шагом на стороне вызывающего.

import { extractPixels } from './extractor.js';
import { cutAllZones } from './zoner.js';
import { analyzeAllZones } from './analyzer.js';
import { pickRoles } from './picker.js';
import { refineRoles, checkPalette } from './refine.js';
import { applyContrastCheck } from './contrast.js';

/**
 * Текущая экспериментальная конфигурация ролей (копия TEST_ROLES v2 из
 * последнего коммита). Позже уедет во встроенные JSON-профили (ТЗ п.3).
 */
export const DEFAULT_ROLES = {
    bg:      { pick: 'darkest',         from: 'bottom', fallback: 'full' },
    fg:      { pick: 'lightest',        from: 'top',    fallback: 'full' },
    accent:  { pick: 'most-saturated',  from: 'bottom', 'min-saturation': 0.6, fallback: 'full' },
    muted:   { pick: 'least-saturated', from: 'top' },
    surface: { pick: 'between-bg-fg' },
};

/**
 * @param {string} imagePath
 * @param {{roles?: Object, zones?: Object, refine?: boolean, trim?: boolean, maxDimension?: number}} [options]
 * @returns {{colors: Object<string,{r:number,g:number,b:number}>, debug: Object}}
 */
export function generatePalette(imagePath, options = {}) {
    const roles = options.roles ?? DEFAULT_ROLES;

    const buffer = extractPixels(imagePath, options.maxDimension ?? 256, { trim: options.trim !== false });
    const analysis = analyzeAllZones(cutAllZones(buffer, options.zones ?? {}));
    const picked = pickRoles(analysis, roles);

    const refined = options.refine === false
        ? { colors: picked.colors, debug: [] }
        : refineRoles(picked.colors, analysis, roles);

    const contrast = applyContrastCheck(refined.colors);

    return {
        colors: contrast.colors,
        debug: {
            trimmed: buffer.trimmed,
            picks: picked.debug,
            refine: refined.debug,
            contrast: contrast.debug,
            issues: checkPalette(contrast.colors),
        },
    };
}
