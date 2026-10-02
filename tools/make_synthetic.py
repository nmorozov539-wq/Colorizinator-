# Генератор синтетических тестовых изображений для проверки экстракции.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os
rng = np.random.default_rng(42)
OUT = os.path.join(os.path.dirname(__file__), '..', 'test-subjects', 'synthetic')
W, H = 1280, 720

def save(name, arr_or_img, mode=None):
    img = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img.astype('uint8'))
    img.save(os.path.join(OUT, name))

def vgrad(top, bottom, w=W, h=H):
    t = np.linspace(0, 1, h)[:, None, None]
    top = np.array(top)[None, None, :]; bottom = np.array(bottom)[None, None, :]
    return np.repeat(top * (1 - t) + bottom * t, w, axis=1)

# 1-2 однотонные
save('solid_dark.png', np.full((H, W, 3), (18, 20, 28)))
save('solid_light.png', np.full((H, W, 3), (236, 232, 222)))
# 3 серый градиент
g = np.repeat(np.linspace(0, 255, W)[None, :, None], H, 0).repeat(3, 2)
save('gray_gradient.png', g)
# 4 cyberpunk: тёмное небо, неон снизу, голубая вывеска
a = vgrad((8, 8, 20), (40, 10, 50))
img = Image.fromarray(a.astype('uint8')); d = ImageDraw.Draw(img)
d.rectangle([0, 520, W, H], fill=(255, 0, 170))
d.rectangle([1000, 250, 1100, 450], fill=(0, 255, 170))
for i in range(40):
    x = rng.integers(0, W); d.rectangle([x, 300, x + rng.integers(10, 60), 520], fill=(20, 22, 40))
save('cyberpunk.png', img.filter(ImageFilter.GaussianBlur(1.2)))
# 5 letterbox: яркая картинка с чёрными полосами 12% сверху/снизу
inner = vgrad((250, 120, 40), (40, 90, 200), h=int(H * .76))
a = np.zeros((H, W, 3)); a[int(H * .12):int(H * .12) + inner.shape[0]] = inner
save('letterbox.png', a)
# 6 светлый пастельный пейзаж
a = vgrad((200, 225, 245), (250, 240, 215))
img = Image.fromarray(a.astype('uint8')); d = ImageDraw.Draw(img)
d.ellipse([900, 80, 1000, 180], fill=(255, 250, 235))
d.polygon([(0, 720), (400, 420), (800, 720)], fill=(170, 200, 160))
d.polygon([(300, 720), (800, 380), (1280, 720)], fill=(140, 175, 150))
save('light_pastel.png', img)
# 7 ч/б фото-подобное (шум + градиент)
base = vgrad((30, 30, 30), (200, 200, 200))[:, :, 0]
n = (base + rng.normal(0, 18, base.shape)).clip(0, 255)
save('bw_noise.png', np.stack([n] * 3, 2))
# 8 сепия, почти монохром
n = (base + rng.normal(0, 10, base.shape)).clip(0, 255) / 255
save('sepia.png', np.stack([n * 255, n * 215, n * 165], 2))
# 9 закат с солнцем
a = vgrad((20, 20, 60), (255, 110, 40))
img = Image.fromarray(a.astype('uint8')); d = ImageDraw.Draw(img)
d.ellipse([560, 420, 720, 580], fill=(255, 245, 200))
d.rectangle([0, 600, W, H], fill=(10, 8, 20))
save('sunset.png', img.filter(ImageFilter.GaussianBlur(2)))
# 10 белый фон с мелким тёмным текстом/деталями
a = np.full((H, W, 3), 250.)
img = Image.fromarray(a.astype('uint8')); d = ImageDraw.Draw(img)
for i in range(30):
    x, y = rng.integers(0, W - 40), rng.integers(0, H - 20); d.rectangle([x, y, x + 30, y + 8], fill=(30, 30, 40))
save('white_with_details.png', img)
# 11 цветной шум
save('color_noise.png', rng.integers(0, 256, (180, 320, 3)))
# 12 RGBA с прозрачностью (полупрозрачная левая половина)
a = np.zeros((H, W, 4)); a[..., :3] = vgrad((20, 80, 160), (200, 40, 90)); a[..., 3] = 255; a[:, :W // 2, 3] = 0
save('rgba_half_transparent.png', Image.fromarray(a.astype('uint8'), 'RGBA'))
# 13 крошечные
save('tiny_8x8.png', rng.integers(0, 256, (8, 8, 3)))
save('tiny_1x1.png', np.full((1, 1, 3), (200, 30, 30)))
# 14 панорама 4:1
a = vgrad((10, 30, 60), (20, 120, 140), w=2400, h=300); save('panorama.png', a)
# 15 тёмный с малым ярким акцентом (шанс потерять accent)
a = np.full((H, W, 3), (14, 14, 18.))
img = Image.fromarray(a.astype('uint8')); d = ImageDraw.Draw(img)
d.ellipse([600, 300, 640, 340], fill=(255, 80, 40))
save('dark_tiny_accent.png', img)
# 16 серый средний (низкий контраст)
save('midgray_flat.png', np.stack([np.clip(rng.normal(128, 4, (H, W)), 0, 255)] * 3, 2))
# 17 красный монохром насыщенный
save('red_mono.png', vgrad((60, 0, 0), (255, 40, 30)))
# --- шаг (а): альфа и рамки ---
# 18 pillarbox: контент 960x720 по центру, чёрные боковые полосы
inner = vgrad((250, 160, 60), (30, 60, 160), w=960)
a = np.zeros((H, W, 3)); a[:, 160:1120] = inner
save('pillarbox.png', a)
# 19 windowbox: чёрная рамка со всех сторон
inner = vgrad((240, 90, 90), (60, 40, 140), w=1000, h=560)
a = np.zeros((H, W, 3)); a[80:640, 140:1140] = inner
save('windowbox.png', a)
# 20 широкий letterbox 2.39:1 (полосы ~16%)
inner = vgrad((60, 160, 120), (200, 80, 40), h=int(H * .68))
a = np.zeros((H, W, 3)); a[int(H * .16):int(H * .16) + inner.shape[0]] = inner
save('letterbox_wide.png', a)
# 21 силуэт: чёрная земля ТОЛЬКО снизу (НЕ рамка, обрезать нельзя)
a = vgrad((255, 150, 70), (60, 40, 110))
img = Image.fromarray(a.astype('uint8')); d = ImageDraw.Draw(img)
d.rectangle([0, 540, W, H], fill=(0, 0, 0))
for x in range(0, W, 90):
    d.polygon([(x, 540), (x + 30, 470 - (x % 7) * 6), (x + 60, 540)], fill=(0, 0, 0))
save('silhouette_ground.png', img)
# 22 прозрачные поля вокруг контента
a = np.zeros((H, W, 4)); a[100:620, 200:1080, :3] = vgrad((30, 140, 200), (230, 60, 120), w=880, h=520); a[100:620, 200:1080, 3] = 255
save('transparent_padding.png', Image.fromarray(a.astype('uint8'), 'RGBA'))
# 23 полностью прозрачное (должна быть внятная ошибка)
save('fully_transparent.png', Image.fromarray(np.zeros((H, W, 4), dtype='uint8'), 'RGBA'))
print('ok', len(os.listdir(OUT)))
