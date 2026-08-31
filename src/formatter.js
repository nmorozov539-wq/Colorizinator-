// formatter.js — генерация CSS/JSON/SCSS из финального набора ролей
// (ТЗ п.9). Единственный модуль, который знает про текстовые форматы
// вывода — все предыдущие модули оперируют только {r,g,b} объектами.
//
// ВАЖНО про alpha: роль сама по себе (bg/fg/accent/...) всегда непрозрачна —
// alpha появляется только у derivatives (ТЗ п.8, напр. accent-glow с
// alpha:0.15). Поэтому formatter принимает {r,g,b} ИЛИ {r,g,b,a} — если
// `a` присутствует и < 1, CSS выводит rgba(...), а не hex (hex+alpha
// технически возможен как #RRGGBBAA, но в примере ТЗ п.9.1 использован
// именно rgba(), так и делаем — не изобретаем свой формат).

/**
 * {r,g,b} → "#rrggbb" в нижнем регистре (стандарт для CSS custom properties).
 *
 * @param {{r:number,g:number,b:number}} color
 * @returns {string}
 */
export function toHex({ r, g, b }) {
    const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * {r,g,b,a} → "rgba(r, g, b, a)". `a` округляется до 2 знаков — три штриха
 * после запятой в CSS никому не нужны и раздувают файл.
 *
 * @param {{r:number,g:number,b:number,a:number}} color
 * @returns {string}
 */
export function toRgba({ r, g, b, a }) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(2))})`;
}

/**
 * Выбирает hex или rgba() в зависимости от наличия и значения alpha.
 * Роли без `a` или с `a === 1` идут как hex — так czss остаётся компактным
 * для подавляющего большинства переменных (только derivatives с открытым
 * alpha < 1 получают rgba()).
 *
 * @param {{r:number,g:number,b:number,a?:number}} color
 * @returns {string}
 */
function formatColor(color) {
    if (typeof color.a === 'number' && color.a < 1) {
        return toRgba(color);
    }
    return toHex(color);
}

/**
 * Генерирует CSS custom properties блок (ТЗ п.9.1).
 *
 * @param {Object<string, {r:number,g:number,b:number,a?:number}>} colors - плоский набор роль→цвет (включая derivatives)
 * @param {string} [prefix='panel'] - префикс переменной, ТЗ пример использует "panel"
 * @returns {string}
 */
export function toCss(colors, prefix = 'panel') {
    const lines = [':root {'];
    for (const [name, color] of Object.entries(colors)) {
        lines.push(`  --${prefix}-${name}: ${formatColor(color)};`);
    }
    lines.push('}');
    return lines.join('\n');
}

/**
 * Генерирует SCSS-переменные (ТЗ п.9.3) — тот же префикс, что и CSS,
 * но без :root-обёртки и с $ вместо --.
 *
 * @param {Object<string, {r:number,g:number,b:number,a?:number}>} colors
 * @param {string} [prefix='panel']
 * @returns {string}
 */
export function toScss(colors, prefix = 'panel') {
    return Object.entries(colors)
        .map(([name, color]) => `$${prefix}-${name}: ${formatColor(color)};`)
        .join('\n');
}

/**
 * Генерирует JSON-объект (ТЗ п.9.2). Цвета всегда как hex-строки — JSON
 * пример в ТЗ не показывает alpha-варианты, поэтому берём formatColor
 * так же, как CSS (rgba() как строка тоже валиден внутри JSON-значения).
 *
 * `themes` — именованные наборы (ТЗ пример: normal/night), каждый —
 * такой же плоский roles→color объект. Если передан только один набор
 * без явного имени темы, оборачиваем его в { normal: ... } для единообразия
 * структуры (а не отдаём голый объект без темы — иначе потребитель JSON
 * не может отличить однотемный вывод от многотемного без доп. проверки).
 *
 * @param {Object<string, Object<string,{r:number,g:number,b:number,a?:number}>>} themes - {themeName: {role: color}}
 * @returns {string} JSON.stringify с отступом 2 (человекочитаемо, ТЗ пример так и оформлен)
 */
export function toJson(themes) {
    const output = {};
    for (const [themeName, colors] of Object.entries(themes)) {
        output[themeName] = {};
        for (const [role, color] of Object.entries(colors)) {
            output[themeName][role] = formatColor(color);
        }
    }
    return JSON.stringify(output, null, 2);
}

/**
 * Единая точка входа — выбирает формат по имени (ТЗ п.9: css/json/scss).
 * Для 'json' ожидает themes-объект (см. toJson); для 'css'/'scss' ожидает
 * плоский roles→color объект одной темы (derivatives уже должны быть
 * влиты в этот объект до вызова — formatter не занимается их вычислением,
 * это задача derivatives.js).
 *
 * @param {string} format - 'css' | 'json' | 'scss'
 * @param {Object} colorsOrThemes
 * @param {{prefix?: string}} [options]
 * @returns {string}
 */
export function format(format_, colorsOrThemes, options = {}) {
    const prefix = options.prefix || 'panel';
    switch (format_) {
        case 'css': return toCss(colorsOrThemes, prefix);
        case 'scss': return toScss(colorsOrThemes, prefix);
        case 'json': return toJson(colorsOrThemes);
        default:
            throw new Error(`format(): неизвестный формат "${format_}" (ожидается css/json/scss)`);
    }
}
