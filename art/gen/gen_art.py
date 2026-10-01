#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""熄灯盘的美术母本生成器：一条命令重画出全部位图，输入只有下面这份常量表。

    python3 art/gen/gen_art.py            # 重画 art/ 下所有位图
    python3 art/gen/gen_art.py --check    # 只校验盘上位图与本脚本是否一致

母题 `lampgrid4`：一块深色电木盘面，上面 4×4 盏灯，中央 2×2 还亮着。
选它有三个理由，全部可在仓内复验，不是审美偏好：
  1. 玩法本身是"把最后几盏按熄"，残灯即目标，不需要文字就能读懂；
  2. 4×4 是本仓唯一被 js/core/solve.js 全量复核过的尺寸（65536 盘面 / 0 处不一致），
     母题的几何直接抄 js/view.js 的 metrics()：pad=0.055、gap=0.016、圆角=0.26*cell，
     图标与游戏内画面因此是同一套数；
  3. 配色一个都没新造：十六进制全部抽自 css/game.css 的 :root 与 js/view.js 的 PALETTE。

位图与游戏内纹理由同一份 LCG 驱动（SEED 固定），重跑逐字节可复现；--check 会拿
sha256 对账，改了常量表却没重画就会被它抓到。
"""
import argparse
import hashlib
import json
import os
import random
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.exit('需要 Pillow：python3 -m pip install pillow（本脚本只用来产资产，运行时不依赖）')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_ICONS = os.path.join(ROOT, 'art', 'icons')
OUT_TEX = os.path.join(ROOT, 'art', 'textures')
OUT_SPR = os.path.join(ROOT, 'art', 'sprites')

SEED = 0x1F7BEE  # 不动它：动了所有位图重画，--check 会全红

# 抽自 css/game.css :root 与 js/view.js PALETTE（两边本来就描述同一盏灯）。
INK = (230, 233, 239)       # --ink
DIM = (139, 149, 167)       # --ink-dim
BG_TOP = (18, 21, 29)       # --bg-2
BG_BOT = (11, 13, 18)       # --bg
PLATE_TOP = (21, 26, 35)    # view.js plate
PLATE_BOT = (14, 17, 24)    # view.js floor
OFF_TOP = (44, 53, 66)      # view.js lampOffCore
OFF_BOT = (35, 42, 54)      # view.js lampOff
LAMP_CORE = (255, 246, 216)  # view.js lampOnCore
LAMP = (255, 211, 92)       # view.js lampOn / --lamp
LAMP_DEEP = (201, 147, 42)  # view.js 灯面第三段
ACCENT = (120, 220, 255)    # --accent
GOOD = (110, 231, 183)      # --good

N = 4                        # 4×4：全量复核过的那个尺寸
PAD = 0.055                  # 以下三个几何常量与 js/view.js metrics() 一致
GAP = 0.016
RADIUS = 0.26
LIT = (5, 6, 9, 10)          # 中央 2×2：还亮着的那几盏
ICON_SIZES = [1024, 512, 192, 180, 96, 64, 48, 32, 16]
MASKABLE_SIZES = [512, 192]
TIER_LABEL = 'GF(2) 陪集枚举 · 4×4 全量 BFS 复核'


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def vgrad(size, c0, c1):
    """竖直渐变方块，顶端 c0 底端 c1。手工建行，不用 Image.linear_gradient（它是横向的）。"""
    w, h = size
    rows = []
    for y in range(h):
        t = 0.0 if h == 1 else y / (h - 1)
        row = bytes([int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)])
        rows.append(row * w)
    return Image.frombytes('RGB', (w, h), b''.join(rows)).convert('RGBA')


def vfade(size, frac, alpha_max):
    """顶部 alpha_max、往下线性衰减到 0 的 alpha 遮罩，给斜光/高光用。"""
    w, h = size
    span = max(1, int(h * frac))
    rows = []
    for y in range(h):
        a = int(alpha_max * max(0.0, 1 - y / span)) if y < span else 0
        rows.append(bytes((a,) * w))
    return Image.frombytes('L', (w, h), b''.join(rows))


def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m


def tile_geometry(side):
    """盘面边长 side -> 4×4 每格的位置。抄 js/view.js metrics() 的比例。"""
    pad = side * PAD
    gap = max(3.0, side * GAP)
    cell = (side - pad * 2 - gap * (N - 1)) / N
    return pad, gap, cell


def stroke_layer(size):
    """低 alpha 笔画必须先画在透明层上再 alpha_composite：ImageDraw 是直接替换像素的。"""
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    return layer, ImageDraw.Draw(layer)


def draw_plate(img, origin, side, rng):
    """电木盘：竖直渐变 + 1px 亮边 + 一层很轻的磨砂，就地画进 img。"""
    x, y = origin
    mask = rounded_mask((side, side), int(side * 0.075))
    img.paste(vgrad((side, side), PLATE_TOP, PLATE_BOT), (x, y), mask)
    # 磨砂：种子随机，幅度小到不会读成噪点，只破掉"纯色块拼贴"的塑料感。
    noise = Image.frombytes('L', (side, side), bytes(rng.getrandbits(8) for _ in range(side * side)))
    grain = Image.new('RGBA', (side, side), rgba(INK, 0))
    grain.putalpha(noise.point(lambda v: max(0, int((v - 150) * 0.55))))
    img.alpha_composite(grain, (x, y))
    edge, ed = stroke_layer(img.size)
    ed.rounded_rectangle([x, y, x + side - 1, y + side - 1], radius=int(side * 0.075),
                         outline=rgba(INK, 26), width=max(1, int(side * 0.004)))
    img.alpha_composite(edge)
    return img


def draw_lamps(img, origin, side, rng, glow_out=None):
    """4×4 灯。亮的走琥珀三段渐变 + 白灯丝，暗的是石板面；暖光单独叠一层给 bloom 用。"""
    x0, y0 = origin
    pad, gap, cell = tile_geometry(side)
    glow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    radius = int(cell * RADIUS)

    # 先画连线：一根"按这里也会翻那里"的视觉陈述，与 js/view.js drawRoom 的 wire 同色同宽。
    wires, wd = stroke_layer(img.size)
    for i in range(N * N):
        r, c = divmod(i, N)
        cx = x0 + pad + c * (cell + gap) + cell / 2
        cy = y0 + pad + r * (cell + gap) + cell / 2
        if c + 1 < N:
            nx = x0 + pad + (c + 1) * (cell + gap) + cell / 2
            wd.line([cx + cell * 0.12, cy, nx - cell * 0.12, cy], fill=rgba(INK, 15),
                    width=max(1, int(side * 0.004)))
        if r + 1 < N:
            ny = y0 + pad + (r + 1) * (cell + gap) + cell / 2
            wd.line([cx, cy + cell * 0.12, cx, ny - cell * 0.12], fill=rgba(INK, 15),
                    width=max(1, int(side * 0.004)))
    img.alpha_composite(wires)

    faces, fd = stroke_layer(img.size)
    for i in range(N * N):
        r, c = divmod(i, N)
        x = int(round(x0 + pad + c * (cell + gap)))
        y = int(round(y0 + pad + r * (cell + gap)))
        s = int(round(cell))
        lit = i in LIT
        face = vgrad((s, s), LAMP_CORE if lit else OFF_TOP, LAMP_DEEP if lit else OFF_BOT)
        img.paste(face, (x, y), rounded_mask((s, s), radius))
        fd.rounded_rectangle([x, y, x + s - 1, y + s - 1], radius=radius,
                             outline=rgba(LAMP_CORE, 140) if lit else rgba(INK, 20),
                             width=max(1, int(side * 0.0025)))
        # 灯丝：灰度截图里也认得出这是盏灯（与 drawLamp 中间那个圆点同用途）。
        fr = s * (0.16 if lit else 0.10)
        ccx, ccy = x + s / 2, y + s / 2
        fd.ellipse([ccx - fr, ccy - fr, ccx + fr, ccy + fr],
                   fill=rgba((255, 255, 255), 230) if lit else rgba(INK, 30))
        if lit:
            gr = s * 0.62
            gd.ellipse([ccx - gr, ccy - gr, ccx + gr, ccy + gr], fill=rgba(LAMP, 120))
    img.alpha_composite(faces)
    if glow_out is not None:
        glow_out.append(glow)
    return img


def compose_master(size, rng, maskable=False):
    """一张母图。maskable=True 时把母题缩到 62% 居中，安全区内不裁灯。"""
    img = vgrad((size, size), BG_TOP, BG_BOT)
    side = int(size * (0.62 if maskable else 0.88))
    origin = ((size - side) // 2, (size - side) // 2)
    draw_plate(img, origin, side, rng)
    glows = []
    draw_lamps(img, origin, side, rng, glow_out=glows)
    bloom = glows[0].filter(ImageFilter.GaussianBlur(max(1.0, size * 0.020)))
    img = Image.alpha_composite(img, bloom)
    img = Image.alpha_composite(img, bloom.filter(ImageFilter.GaussianBlur(max(1.0, size * 0.055))))
    # 顶部一道极淡的斜光，避免整张图像纯色块拼贴。
    sheen = Image.new('RGBA', (size, size), rgba(INK, 0))
    sheen.putalpha(vfade((size, size), 0.34, 13))
    img = Image.alpha_composite(img, sheen)
    # 压回不透明底：图标带 alpha 洞会在启动台/桌面上透出系统底色。
    base = vgrad((size, size), BG_TOP, BG_BOT)
    base.alpha_composite(img)
    return base.convert('RGBA')


# ---- 派生资产 --------------------------------------------------------------

def grain_texture(size=256, rng=None):
    """游戏内 backdrop 用的高斯磨砂 + 淡网格；可平铺，不含任何语义信息。"""
    rng = rng or random.Random(SEED)
    noise = [rng.getrandbits(8) for _ in range(size * size)]
    # 3x3 盒式模糊，纯 python，256x256 够用
    s = size
    blur = bytearray(s * s)
    for y in range(s):
        for x in range(s):
            acc = 0
            for dy in (-1, 0, 1):
                yy = (y + dy) % s
                for dx in (-1, 0, 1):
                    acc += noise[yy * s + ((x + dx) % s)]
            blur[y * s + x] = acc // 9
    img = Image.frombytes('L', (s, s), bytes(blur)).point(lambda v: int(128 + (v - 128) * 0.55))
    out = Image.new('RGBA', (s, s))
    out.putalpha(img.point(lambda v: max(0, int((v - 118) * 0.9))))
    grid, gd = stroke_layer((s, s))
    step = s // 4
    for k in range(0, s, step):
        gd.line([k, 0, k, s], fill=rgba(INK, 7), width=1)
        gd.line([0, k, s, k], fill=rgba(INK, 7), width=1)
    out.alpha_composite(grid)
    return out


def spark_sprite(size=64):
    """粒子贴图：中心实心、边缘平滑衰减的白点，染色在运行时用 globalAlpha 做。"""
    cx = cy = (size - 1) / 2
    pix = bytearray()
    for y in range(size):
        for x in range(size):
            dx, dy = (x - cx) / (size / 2), (y - cy) / (size / 2)
            r2 = dx * dx + dy * dy
            a = 0 if r2 > 1 else int(255 * (1 - r2) ** 2.2)
            core = 1.0 if r2 < 0.10 else max(0.0, 1 - (r2 - 0.10) / 0.9)
            v = min(255, int(200 + 55 * core))
            pix.extend(bytes((v, v, min(255, int(v * 0.97)), a)))
    return Image.frombytes('RGBA', (size, size), bytes(pix))


def font(path_candidates, size):
    for p in path_candidates:
        if os.path.exists(p):
            try:
                return ImageFont_cache(p, size)
            except Exception:
                continue
    return None


_FONT_CACHE = {}


def ImageFont_cache(path, size):
    from PIL import ImageFont
    key = (path, size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(path, size)
    return _FONT_CACHE[key]


CJK_FONTS = ['/System/Library/Fonts/Hiragino Sans GB.ttc',
             '/System/Library/Fonts/STHeiti Medium.ttc',
             '/System/Library/Fonts/PingFang.ttc',
             '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
             '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
LATIN_FONTS = ['/System/Library/Fonts/Menlo.ttc',
               '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
               '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']


def social_card(w=1200, h=630, rng=None):
    """og/社交卡：左边母题盘面，右边标题 + 一句可复验的承诺。"""
    rng = rng or random.Random(SEED)
    img = vgrad((w, h), BG_TOP, BG_BOT)
    side = int(h * 0.78)
    draw_plate(img, (int(w * 0.055), (h - side) // 2), side, rng)
    glows = []
    draw_lamps(img, (int(w * 0.055), (h - side) // 2), side, rng, glow_out=glows)
    img = Image.alpha_composite(img, glows[0].filter(ImageFilter.GaussianBlur(14)))

    tx = int(w * 0.055) + side + int(w * 0.06)
    cjk = font(CJK_FONTS, 92)
    cjk_mid = font(CJK_FONTS, 40)
    cjk_small = font(CJK_FONTS, 28)
    latin = font(LATIN_FONTS, 30)
    d = ImageDraw.Draw(img, 'RGBA')
    y = int(h * 0.16)
    if cjk:
        d.text((tx, y), '熄灯盘', font=cjk, fill=rgba(INK))
    else:
        d.text((tx, y), 'LIGHTS OUT', font=latin, fill=rgba(INK))
        print('WARN 没找到中文字体，og 卡退化成纯拉丁', file=sys.stderr)
    y += 118
    if latin:
        d.text((tx, y), 'L I G H T S   O U T', font=latin, fill=rgba(LAMP))
        y += 56
    if cjk_mid:
        d.text((tx, y), '盘上的数字是量出来的', font=cjk_mid, fill=rgba(INK))
        y += 74
    if cjk_small:
        for line in (TIER_LABEL, '4×4 可解盘面 4096 / 65536，0 处不一致', '存档只在这台设备上'):
            d.text((tx, y), line, font=cjk_small, fill=rgba(DIM))
            y += 42
    # 右下角一枚认证章：accent 环 + good 勾，呼应答案显示的两色。
    stamp, sd = stroke_layer((w, h))
    bx, by = w - int(w * 0.055) - 26, h - int(h * 0.10)
    sd.ellipse([bx - 26, by - 26, bx + 26, by + 26], outline=rgba(ACCENT, 160), width=3)
    sd.line([bx - 12, by, bx - 2, by + 11, bx + 14, by - 11], fill=rgba(GOOD), width=4)
    img.alpha_composite(stamp)
    base = vgrad((w, h), BG_TOP, BG_BOT)
    base.alpha_composite(img)
    return base.convert('RGBA')


def write(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def build(force=True):
    report = {'seed': SEED, 'motif': 'lampgrid4', 'n': N, 'lit': list(LIT),
              'geometry': {'pad': PAD, 'gap': GAP, 'radius': RADIUS},
              'palette': {'ink': '%02x%02x%02x' % INK, 'lamp': '%02x%02x%02x' % LAMP,
                          'accent': '%02x%02x%02x' % ACCENT, 'good': '%02x%02x%02x' % GOOD},
              'files': {}}
    master = compose_master(1024, random.Random(SEED))
    files = {}
    for s in ICON_SIZES:
        name = 'icon-%d.png' % s
        files[os.path.join(OUT_ICONS, name)] = master.resize((s, s), Image.LANCZOS)
    files[os.path.join(OUT_ICONS, 'apple-touch-icon.png')] = master.resize((180, 180), Image.LANCZOS)
    for s in MASKABLE_SIZES:
        files[os.path.join(OUT_ICONS, 'icon-maskable-%d.png' % s)] = \
            compose_master(s, random.Random(SEED + s), maskable=True)
    files[os.path.join(ROOT, 'favicon.ico')] = master.resize((48, 48), Image.LANCZOS)
    files[os.path.join(ROOT, 'art', 'og.png')] = social_card(rng=random.Random(SEED + 7))
    files[os.path.join(OUT_TEX, 'plate-grain-256.png')] = grain_texture(256, random.Random(SEED + 3))
    files[os.path.join(OUT_SPR, 'spark-64.png')] = spark_sprite(64)

    for path, img in sorted(files.items()):
        if path.endswith('.ico'):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            img.save(path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
        else:
            write(path, img)
        rel = os.path.relpath(path, ROOT)
        raw = open(path, 'rb').read()
        report['files'][rel] = {'w': img.size[0], 'h': img.size[1], 'bytes': len(raw),
                                'sha256': hashlib.sha256(raw).hexdigest()[:16]}
    with open(os.path.join(HERE, 'asset-report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1, sort_keys=True)
    return report


def check(report):
    bad = []
    for rel, meta in report['files'].items():
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            bad.append('%s 缺失' % rel)
            continue
        raw = open(path, 'rb').read()
        if len(raw) == 0:
            bad.append('%s 是 0 字节' % rel)
        elif hashlib.sha256(raw).hexdigest()[:16] != meta['sha256']:
            bad.append('%s 与生成脚本不一致（改了常量表没重画？）' % rel)
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只校验，不写盘')
    a = ap.parse_args()
    prior = os.path.join(HERE, 'asset-report.json')
    if a.check:
        if not os.path.exists(prior):
            sys.exit('还没有 asset-report.json，先跑一次不带 --check')
        report = json.load(open(prior, encoding='utf-8'))
        bad = check(report)
        print('CHECK ok：%d 张位图与生成脚本逐字节一致' % len(report['files']) if not bad else 'CHECK fail')
        for b in bad:
            print('  -', b)
        raise SystemExit(1 if bad else 0)
    report = build()
    for rel, meta in sorted(report['files'].items()):
        print('%-34s %5dx%-5d %8d B  %s' % (rel, meta['w'], meta['h'], meta['bytes'], meta['sha256']))
    print('-> art/  共 %d 张位图' % len(report['files']))
    if check(report):
        sys.exit('自校验失败')


if __name__ == '__main__':
    main()
