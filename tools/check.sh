#!/bin/bash
# Единая проверка: таблица палитр + прогон демо. Запуск из любого места.
cd "$(dirname "$0")/.." || exit 1
shopt -s nullglob
echo "=== palettes ==="
gjs -m tools/run-baseline.js --table test-subjects/synthetic/*.png test-subjects/wal*.* 2>/dev/null
echo "=== demos ==="
for f in bin/demo-*.js; do
    gjs -m "$f" test-subjects/wal1.jpg >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done
