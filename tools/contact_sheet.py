# Контактный лист: миниатюра + полосы ролей под каждой картинкой.
import json, sys
from PIL import Image, ImageDraw
src, out = sys.argv[1], sys.argv[2]
rows = [json.loads(l) for l in open(src)]
TW, TH, SW = 300, 170, 300
cols = 3
cell_h = TH + 46
sheet = Image.new('RGB', (cols * (TW + 10) + 10, ((len(rows) + cols - 1) // cols) * (cell_h + 10) + 10), (40, 40, 44))
d = ImageDraw.Draw(sheet)
for i, r in enumerate(rows):
    x = 10 + (i % cols) * (TW + 10); y = 10 + (i // cols) * (cell_h + 10)
    name = r['file'].split('/')[-1]
    im = Image.open(r['file']).convert('RGBA'); im.thumbnail((TW, TH))
    bgc = Image.new('RGBA', im.size, (90, 90, 90, 255)); bgc.alpha_composite(im)
    sheet.paste(bgc.convert('RGB'), (x, y))
    if 'roles' in r:
        w = SW // 5
        for j, k in enumerate(['bg', 'fg', 'accent', 'muted', 'surface']):
            d.rectangle([x + j * w, y + TH + 2, x + (j + 1) * w - 1, y + TH + 30], fill=r['roles'][k])
        d.text((x, y + TH + 33), f"{name}  {r['contrast']['finalRatio']}:1", fill=(230, 230, 230))
    else:
        d.text((x, y + TH + 10), f"{name} ERROR", fill=(255, 100, 100))
sheet.save(out)
