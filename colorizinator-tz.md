# Техническое задание: Colorizinator

**Версия документа:** 1.0  
**Дата:** 2026-08-31  
**Автор концепции:** Riv  
**Аналитик / архитектор:** Kimi Chat (Moonshot AI)  
**Статус:** Концепция утверждена, готова к разработке

---

## 1. Общие положения

### 1.1. Назначение

Colorizinator — это лёгкая CLI-утилита для Linux, которая извлекает семантическую цветовую палитру из изображения (обычно — обоев рабочего стола) и генерирует готовый CSS/JSON/SCSS для использования в панелях, терминалах, лаунчерах и других элементах ricing-окружения.

### 1.2. Философия продукта

> **Colorizinator — это фотолаборатория, а не фотошоп.**
>
> Вы приносите фотографию (обои). Лаборатория проявляет её в палитру. Вы можете выбрать: контрастная плёнка, мягкая плёнка, чёрно-белая. Можете попросить: «сделайте побольше оттенков серого». Но вы не рисуете каждый пиксель руками — для этого есть другие инструменты.

**Ключевые принципы:**
- **Unix-way:** делает одну задачу и делает её хорошо
- **Лёгкость:** зависимости — только `gjs` + `gtk4` (GdkPixbuf)
- **Универсальность:** выходной формат не привязан к конкретной панели (ags, waybar, eww, sway, i3, polybar, rofi, dunst)
- **Умность:** алгоритм сам находит лучшие цвета, но пользователь может переназначить
- **Глубина:** от «запустил и забыл» до «нарезал свои зоны и крутил фильтры"

### 1.3. Что Colorizinator НЕ делает

- Не рисует GUI (только CLI + ANSI-цветной вывод)
- Не позволяет задавать hex-коды руками (это Gpick, не Colorizinator)
- Не хранит ручные палитры без привязки к изображению
- Не требует Python, imagemagick, feh или pywal

---

## 2. Архитектура

### 2.1. Общая схема работы

```
Вход: путь к изображению (обои)
  ↓
[1] Экстракция
    - Downscale через GdkPixbuf
    - Нарезка на зоны (встроенные или пользовательские)
    - Анализ каждой зоны (luminance, saturation, dominance)
  ↓
[2] Ролевая выборка
    - Для каждой роли (bg, fg, accent, muted, surface) выбирается лучший кандидат
    - Автоматический fallback: если primary-зона не даёт качественного результата, сканируются остальные
    - Контраст-проверка: если bg/fg не проходят WCAG 4.5, fg форсируется к белому/чёрному
  ↓
[3] Генерация производных
    - Из 5 базовых цветов генерируются оттенки (tint/shade/alpha)
    - Пользователь может задать сколько производных нужно
  ↓
[4] Применение фильтра (опционально)
    - normal / night / zen / edit
    - Фильтр мутирует HSL базовых цветов по правилам
  ↓
[5] Форматирование
    - CSS (custom properties или @define-color)
    - JSON (структурированная палитра)
    - SCSS (переменные)
  ↓
Выход: файл или stdout
```

### 2.2. Компоненты системы

| Компонент | Ответственность |
|---|---|
| `extractor` | GdkPixbuf → downscale → pixel array |
| `zoner` | Нарезка изображения на зоны по процентным координатам |
| `analyzer` | Анализ зоны: доминантные цвета, luminance, saturation, uniformity |
| `picker` | Выбор цвета для роли из зоны по стратегии (darkest, lightest, most-saturated, etc.) |
| `fallback` | Если primary-зона не удовлетворяет критериям — поиск в других зонах |
| `contrast` | Проверка contrast ratio, автокоррекция fg |
| `derivative` | Генерация tint/shade/alpha-вариаций из базовых цветов |
| `filter` | Применение вариаций (normal → night → zen → edit) |
| `formatter` | Преобразование палитры в CSS / JSON / SCSS |
| `watcher` | Gio.FileMonitor для --watch режима |
| `studio` | Интерактивный CLI-режим для фриков |

---

## 3. Профили

### 3.1. Что такое профиль

Профиль — это JSON-файл, описывающий:
- Как нарезать изображение на зоны
- Как извлекать роли (стратегии, primary-зоны, fallback)
- Какие производные генерировать
- Какие фильтры доступны

### 3.2. Встроенные профили

| Профиль | Назначение | Зоны по умолчанию | Особенности |
|---|---|---|---|
| `panel` | Верхняя/нижняя панель | top-15, bottom-15, quarters, full | Акцент на читаемости, контраст обязателен |
| `terminal` | 16-цветная палитра терминала | full | Квантизация, равномерное покрытие спектра |
| `desktop` | Полный набор для всего окружения | full + top-30 | Максимальное количество ролей и производных |
| `accent` | Только акцентный цвет | full | Самый насыщенный цвет + комплементарный |

### 3.3. Пользовательские профили

Хранятся в `~/.config/colorizinator/profiles/`.

Могут:
- Наследоваться от встроенных (`"extends": "panel"`)
- Переопределять зоны, роли, фильтры
- Создаваться через CLI: `colorizinator profile add mypanel --from panel`

### 3.4. Структура профиля

```json
{
  "name": "mycyber",
  "extends": "panel",
  "extraction": {
    "mode": "deep",
    "zones": {
      "sky": { "crop": "0,0,100,20" },
      "horizon": { "crop": "0,15,100,30" },
      "neon-bottom": { "crop": "0,70,100,30" },
      "right-sign": { "crop": "80,40,20,40" }
    }
  },
  "roles": {
    "bg": {
      "pick": "darkest",
      "from": "sky",
      "fallback": "full",
      "min-contrast-to": "fg"
    },
    "fg": {
      "pick": "lightest",
      "ensure-readable-on": "bg"
    },
    "accent": {
      "pick": "most-saturated",
      "from": "neon-bottom",
      "min-saturation": 0.6,
      "fallback": "right-sign"
    },
    "muted": {
      "pick": "least-saturated",
      "from": "sky"
    },
    "surface": {
      "pick": "between-bg-fg"
    }
  },
  "derivatives": {
    "surface-100": { "from": "surface", "tint": 0.1 },
    "surface-200": { "from": "surface", "tint": 0.2 },
    "accent-glow": { "from": "accent", "alpha": 0.15 }
  },
  "filters": {
    "night": {
      "bg": { "hueShift": 15, "saturation": -0.2, "lightness": -0.1 },
      "fg": { "lightness": -0.05 },
      "accent": { "saturation": -0.3 }
    },
    "zen": {
      "desaturateExcept": ["accent"],
      "merge": ["bg", "surface"]
    },
    "edit": {
      "accent": { "complement": true },
      "surface": { "alpha": 0.08, "tint": 0.1 }
    }
  }
}
```

---

## 4. Зоны (Zones)

### 4.1. Формат зоны

Каждая зона — это именованный crop в процентах:
```json
"zone-name": { "crop": "x,y,w,h" }
```
Где `x,y,w,h` — в процентах от ширины/высоты изображения.

### 4.2. Встроенные зоны (доступны в любом профиле)

| Зона | Crop | Описание |
|---|---|---|
| `full` | `0,0,100,100` | Целое изображение |
| `top` | `0,0,100,15` | Верхняя часть |
| `bottom` | `0,85,100,15` | Нижняя часть |
| `left` | `0,0,50,100` | Левая половина |
| `right` | `50,0,50,100` | Правая половина |
| `center` | `25,25,50,50` | Центральная область |
| `top-left` | `0,0,50,50` | Левый верхний квадрант |
| `top-right` | `50,0,50,50` | Правый верхний квадрант |
| `bottom-left` | `0,50,50,50` | Левый нижний квадрант |
| `bottom-right` | `50,50,50,50` | Правый нижний квадрант |

### 4.3. Пользовательские зоны

Пользователь может определить любое количество зон с любыми именами и координатами. Зоны могут перекрываться.

**Пример:**
```json
"zones": {
  "sky": { "crop": "0,0,100,20" },
  "neon-bottom": { "crop": "0,70,100,30" },
  "right-sign": { "crop": "80,40,20,40" }
}
```

---

## 5. Роли (Roles)

### 5.1. Базовые роли

| Роль | Семантика | Пример использования |
|---|---|---|
| `bg` | Фон панели/окна | `--panel-bg` |
| `fg` | Основной текст | `--panel-fg` |
| `accent` | Акцентные элементы, фокус | `--panel-accent` |
| `muted` | Вторичный текст, неактивные иконки | `--panel-muted` |
| `surface` | Фон пилюль, кнопок, карточек | `--panel-surface` |
| `danger` | Ошибки, предупреждения | `--panel-danger` |

### 5.2. Стратегии выбора (pick)

| Стратегия | Описание |
|---|---|
| `darkest` | Самый тёмный цвет в зоне |
| `lightest` | Самый светлый цвет в зоне |
| `most-saturated` | Самый насыщенный цвет |
| `least-saturated` | Самый тусклый цвет |
| `dominant` | Доминантный цвет (по площади) |
| `average` | Средний цвет зоны |
| `between-bg-fg` | Цвет между bg и fg по luminance |

### 5.3. Ограничения и fallback

Каждая роль может иметь:
- `from` — primary зона
- `fallback` — зона для резервной выборки
- `min-saturation` — минимальная насыщенность
- `min-contrast-to` — минимальный контраст с другой ролью
- `ensure-readable-on` — гарантия читаемости на фоне другой роли

---

## 6. Режимы экстракции

### 6.1. Быстрый режим (fast)

- Одна primary зона (обычно `top` или `full`)
- Быстрый luminance sort
- Подходит для 90% случаев
- Используется по умолчанию

### 6.2. Углублённый режим (deep)

- Multi-zone analysis: все зоны профиля сканируются
- Для каждой роли выбирается лучшая зона
- Fallback срабатывает автоматически
- Рекомендуется для сложных/детализированных обоев (киберпанк, абстракция)

### 6.3. Автоматический выбор

Если быстрый режим даёт `weak` результат (accent saturation < 0.4 или контраст < 4.5), Colorizinator **автоматически** переключается на deep. Пользователь не замечаете.

### 6.4. Auto-boost (deep/авто-режим)

Если после deep-анализа лучший кандидат на роль всё равно не проходит `min-saturation` (например: пастельные/монохромные обои), Colorizinator **автоматически** подкручивает найденный (не подставляет чужой) цвет множителем saturation в диапазоне **~1.3–1.5x**, не трогая hue. Это часть основного целевого сценария (не костыль): большинству пользователей нужен рабочий результат без ручного вмешательства.

Обязательно логируется в debug-выводе: `"boosted": true, "original_saturation": ..., "boosted_to": ..., "multiplier": ...`.

Auto-boost — это авто-подстраховка, а не свобода действий. Порог множителя фиксирован намеренно (~1.3–1.5x), чтобы не скатиться в "фотошоп": цель — сделать акцент минимально заметным, а не перекрасить его во что-то произвольно яркое.

### 6.5. Ручной множитель (только Studio mode)

В отличие от auto-boost, в Studio mode пользователь может явно запросить произвольный множитель (например «увеличь насыщенность в 3 раза») без верхнего ограничения. Разница в философии:

- **Auto/deep-режим** — целевая точка продукта, должна работать для всех молча и в рамках приличия (fast — «забежал в лабораторию на секунду», deep — полноценный анализ с деликатной подстраховкой)
- **Studio** — режим для пользователей, осознанно пришедших вручную докручивать свой рисинг; здесь можно выходить за пределы «приличного» результата, потому что человек видит live-preview и сам несёт ответственность за то, во что превращает палитру

Синтаксис флага для non-studio ручного форсирования пока не определён (рабочее название `--force-accent`) — доступен как обычный CLI-флаг наравне со всеми остальными.

**Важное архитектурное уточнение:** Studio mode не обладает эксклюзивными возможностями. Все команды и параметры (включая ручной множитель насыщенности) изначально существуют как CLI-флаги. Studio — это интерактивная обучающая обёртка, которая визуально показывает пользователю, какие флаги/параметры существуют и как их применить (например, через `[a] Assign role` в Studio под капотом просто формирует и показывает эквивалентный CLI-вызов). Это следует общей философии Unix-way (п.1.2) — Studio не является отдельной подсистемой с особыми правами, а инструментом обучения и визуализации уже существующего API.

---

## 7. Фильтры (вариации палитры)

### 7.1. Концепция

Фильтр — это функция `Palette → Palette`. Он берёт уже извлечённые цвета и мутирует их по HSL-правилам. Переключение фильтра — мгновенно, без повторного анализа обоев.

### 7.2. Встроенные фильтры

| Фильтр | Описание | HSL-манипуляции |
|---|---|---|
| `normal` | Исходная палитра, без изменений | — |
| `night` | Тёплая, приглушённая палитра для ночи | bg: hue +15°, sat -20%; fg: lightness -5%; accent: sat -30% |
| `zen` | Фокус-режим, всё приглушено кроме accent | desaturate всё кроме accent на 80%; merge bg+surface |
| `edit` | Режим редактирования, структурная подсветка | accent → complement; surface: alpha 0.08, tint +10% |

### 7.3. Пользовательские фильтры

Определяются в профиле:
```json
"filters": {
  "myfocus": {
    "desaturateExcept": ["accent", "fg"],
    "merge": ["bg", "surface"]
  }
}
```

---

## 8. Производные (Derivatives)

### 8.1. Концепция

Из 5-7 базовых цветов генерируются производные через HSL-манипуляции:
- `tint` — светлее
- `shade` — темнее
- `alpha` — прозрачность
- `saturate` / `desaturate` — насыщенность

### 8.2. Пример

```json
"derivatives": {
  "surface-100": { "from": "surface", "tint": 0.1 },
  "surface-200": { "from": "surface", "tint": 0.2 },
  "accent-glow": { "from": "accent", "alpha": 0.15 },
  "accent-hover": { "from": "accent", "tint": 0.2 }
}
```

---

## 9. Форматы вывода

### 9.1. CSS (default)

```css
:root {
  --panel-bg: #1a1a2e;
  --panel-fg: #e0e0e0;
  --panel-accent: #7aa2f7;
  --panel-muted: #565f89;
  --panel-surface: #24283b;
  --panel-surface-100: #2f3347;
  --panel-accent-glow: rgba(122, 162, 247, 0.15);
}
```

### 9.2. JSON

```json
{
  "normal": {
    "bg": "#1a1a2e",
    "fg": "#e0e0e0",
    "accent": "#7aa2f7",
    "muted": "#565f89",
    "surface": "#24283b"
  },
  "night": {
    "bg": "#1f1f33",
    "fg": "#d5d5d5",
    "accent": "#6b8bc7"
  }
}
```

### 9.3. SCSS

```scss
$panel-bg: #1a1a2e;
$panel-fg: #e0e0e0;
$panel-accent: #7aa2f7;
```

---

## 10. CLI API

### 10.1. Базовые команды

```bash
# Быстрая генерация (default: profile=panel, format=css)
colorizinator --wallpaper ~/wall.jpg --output ~/.config/waybar/colors.css

# Указать профиль и формат
colorizinator --wallpaper ~/wall.jpg --profile terminal --format json

# Применить фильтр
colorizinator --wallpaper ~/wall.jpg --filter night

# Deep mode (явно)
colorizinator --wallpaper ~/wall.jpg --deep

# Watch mode — следить за файлом и перегенерировать
colorizinator --watch ~/wall.jpg --output ~/.config/ags-panel/palette.css

# Fallback-тема (без обоев)
colorizinator --theme tokyo-night --output ~/.config/waybar/colors.css
```

### 10.2. Управление профилями

```bash
# Список профилей
colorizinator profile list

# Добавить профиль (наследование)
colorizinator profile add mypanel --from panel

# Удалить
colorizinator profile remove mypanel

# Сбросить к оригиналу
colorizinator profile reset panel
```

### 10.3. Studio mode (для фриков)

```bash
colorizinator studio --wallpaper ~/wall.jpg --profile panel
```

Интерактивный CLI с ANSI-цветными блоками:
- Просмотр зон и извлечённых цветов
- Переназначение ролей выбором из зон
- Переключение фильтров
- Сравнение snapshot'ов
- Редактирование зон
- Экспорт профиля

---

## 11. Studio Mode: детализация

### 11.1. Интерфейс

Терминальный интерфейс с ANSI-цветными превью. Никакого GUI.

### 11.2. Основные экраны

**Экран зон:**
```
ZONES ANALYZED (profile: mycyber)
┌──────────────┬──────────────┐
│ sky          │              │
│ #0a0a12      │              │
│ (dark)       │              │
├──────────────┤ right-sign   │
│ horizon      │ #00ffaa      │
│ #ff0055      │ (cyan neon)  │
├──────────────┤              │
│ neon-bottom  │              │
│ #ff00aa      │              │
│ (magenta)    │              │
└──────────────┴──────────────┘
```

**Экран ролей:**
```
CURRENT PALETTE (normal)
bg:      ████ #0a0a12  [sky, auto]
fg:      ████ #e0e0e0  [sky, auto]
accent:  ████ #ff00aa  [neon-bottom, auto]
muted:   ████ #565f89  [sky, auto]
surface: ████ #24283b  [sky, auto]

[a] Assign role    [f] Switch filter
[z] Edit zones     [p] Preview CSS
[s] Save snapshot  [c] Compare
[q] Quit
```

**Экран назначения роли:**
```
Select source for accent:
[1] sky          (#0a0a12, dark, boring)
[2] horizon      (#ff0055, neon, sat 0.90)
[3] neon-bottom  (#ff00aa, neon, sat 0.95)  ← RECOMMENDED
[4] right-sign   (#00ffaa, neon, sat 0.92)
```

### 11.3. Редактирование зон

```
> z
Edit zones:
[1] sky: 0,0,100,20
[2] horizon: 0,15,100,30
[3] neon-bottom: 0,70,100,30

[a] Add zone    [e] Edit zone    [d] Delete zone
> a
Zone name: left-alley
Crop (x,y,w,h %): 0,30,30,40
Zone 'left-alley' added. Rescan? [y/n] > y
```

### 11.4. Snapshot / Compare

```
> s
Save snapshot name: cyberpunk-v1

> c
Compare: cyberpunk-v1 vs cyberpunk-v2
┌─────────┬──────────────┬──────────────┐
│ Role    │ v1           │ v2           │
├─────────┼──────────────┼──────────────┤
│ accent  │ ████ #ff00aa │ ████ #00ffaa │
│         │ (magenta)    │ (cyan)       │
└─────────┴──────────────┴──────────────┘
```

---

## 12. Файловая структура

```
/usr/share/colorizinator/
├── profiles/
│   ├── panel.json
│   ├── terminal.json
│   ├── desktop.json
│   └── accent.json
└── themes/
    ├── tokyo-night.json
    ├── gruvbox-dark.json
    └── catppuccin-mocha.json

~/.config/colorizinator/
├── config.json              # глобальные настройки
├── profiles/
│   ├── mypanel.json         # пользовательские профили
│   └── cyberpunk.json
└── snapshots/               # snapshot'ы из Studio mode
    ├── cyberpunk-v1.json
    └── cyberpunk-v2.json
```

---

## 13. Зависимости

| Зависимость | Минимальная версия | Обязательность |
|---|---|---|
| `gjs` | 1.70+ | Да |
| `gtk4` | 4.6+ | Да (GdkPixbuf) |
| `glib` | 2.70+ | Да (Gio.FileMonitor) |

**Не требуется:** Python, imagemagick, feh, pywal, AGS, systemd.

---

## 14. Распространение

### 14.1. AUR

Пакет `colorizinator-git` с depends на `gjs`, `gtk4`.

### 14.2. Ручная установка

```bash
git clone https://github.com/.../colorizinator.git
cd colorizinator
sudo make install
```

### 14.3. Интеграция с панелями

**waybar:**
```css
@import "/home/user/.cache/colorizinator/colors.css";
* { background: @panel_bg; color: @panel_fg; }
```

**ags-panel:**
```ts
import { generatePalette, paletteToCss } from "colorizinator"
const palette = await generatePalette(wallpaperPath)
const css = paletteToCss(palette, "css")
walProvider.load_from_string(css)
```

**eww:**
```yuck
(defpoll palette :interval "0s"
  `colorizinator --wallpaper $(cat ~/.cache/wallpaper) --format json`)
```

---

## 15. Roadmap

### Phase 1: MVP
- [ ] `extractor` + `zoner` + `analyzer`
- [ ] `picker` + `fallback` + `contrast`
- [ ] Базовые профили: panel, terminal
- [ ] Форматтеры: CSS, JSON
- [ ] CLI: `--wallpaper`, `--profile`, `--output`, `--format`

### Phase 2: Умность
- [ ] Deep mode + автоактивация
- [ ] Производные (derivatives)
- [ ] Фильтры: normal, night, zen, edit
- [ ] Watch mode
- [ ] Fallback-темы (tokyo-night, gruvbox)

### Phase 3: Studio
- [ ] Интерактивный Studio mode
- [ ] Snapshot / Compare
- [ ] Редактирование зон
- [ ] Экспорт/импорт профилей

### Phase 4: Релиз 
- [ ] README + документация
- [ ] PKGBUILD для AUR
- [ ] Примеры интеграции с waybar/eww/sway

---

## 16. Критерии приёмки

- [ ] Утилита запускается на чистой системе с `gjs` + `gtk4`
- [ ] Генерация CSS из обоев занимает < 500ms (1920×1080)
- [ ] Deep mode корректно обрабатывает сложные обои (киберпанк, абстракция)
- [ ] Контраст bg/fg всегда ≥ 4.5 (WCAG AA)
- [ ] Studio mode позволяет переназначить роль без перезапуска
- [ ] Профиль можно экспортировать и импортировать одним файлом
- [ ] Watch mode корректно реагирует на смену обоев

---

*Техническое задание составлено на основе концептуальных обсуждений между автором проекта (Riv) и аналитиком (Kimi Chat, Moonshot AI).*

> **Подпись:** Kimi Chat (Moonshot AI)  
> **Роль:** Архитектор / аналитик  
> **Дата:** 2026-08-31  
> **Версия ТЗ:** 1.0
