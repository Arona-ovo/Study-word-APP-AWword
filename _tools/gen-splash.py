# _tools/gen-splash.py - 生成 Android 原生启动图（与 pages/cover/cover.vue 首屏同色同构）
#
# ⚠️ 为什么是 **.9.png**（九宫格）而不是普通 png：
#   云打包时启动图会被**铺满整屏**（fitXY）。普通 png 的比例只要和屏幕对不上，
#   整张图就被拉长/压扁 —— 实测事故：图是 1080x1882（比例 0.574），
#   手机是 1212x2616（比例 0.463），纵向被拉长约 24%，
#   圆头像变椭圆、字母被抻长（用户反馈"第一次打开软件图片是被拉伸的"）。
#   Android 官方与 uni-app 文档给的解法就是 .9.png：
#     "推荐使用 .9.png 来适配不同分辨率……它可以指定特定的区域进行拉伸而不失真"
#     —— https://uniapp.dcloud.net.cn/collocation/manifest  （App Splashscreen 一节）
#
#   所以这里把画面拆成三块：
#     · 图案（圆头像 + 品牌文字）：**不可拉伸** → 圆永远是圆，字不被抻长
#     · 图案上方留白：不可拉伸 → 图案距顶固定（与 cover 页 pad_top 一致）
#     · 图案与底部进度槽之间：**可拉伸** → 屏幕高出来的部分全在这里吸收
#     · 底部进度槽 + 底边留白：不可拉伸 → 进度槽距底固定（与 cover 页 bottom 一致）
#   横向同理：左右两条边缘可拉伸，含图案的中间段不可拉伸。
#
#   9-patch 的四条黑边（画在图像最外一圈 1px，其余边缘像素必须透明）：
#     上边 = 可水平拉伸的列；左边 = 可垂直拉伸的行
#     右边、下边 = padding 区（官方要求"拉满"，不拉满部分设备会显示灰边）
#
# 用法：python gen-splash.py        （输出到 ../uniapp/static/splash/）
#
# 尺寸取自 uni-app 官方 manifest 说明：hdpi 480x800 / xhdpi 720x1280 / xxhdpi 1080x1920
# （这里指的是**内容区**，落盘文件会各方向 +2px 放黑边）
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'uniapp', 'static', 'splash')
SCRATCH = os.path.join(HERE, '_scratch')
MASCOT = os.path.join(HERE, '..', 'uniapp', 'static', 'mascot', 'arona-hi.jpg')
FONT_BOLD = 'C:/Windows/Fonts/georgiab.ttf'
FONT_REG = 'C:/Windows/Fonts/georgia.ttf'

DESIGN_W = 750            # 设计稿基准宽度（rpx）
GRAD_COLORS = [(0.00, (242, 247, 255)), (0.52, (224, 236, 255)), (1.00, (207, 224, 255))]
GRAD_DEG = 165            # CSS: linear-gradient(165deg, ...)

BRAND = (29, 79, 216)
INK = (23, 32, 26)

# 图案下方到底边之间那段是"可拉伸"的，但进度槽上下要不许拉：
# 与 cover 页 bottom:100rpx + 进度槽高 4rpx 对齐
BOTTOM_RESERVE_RPX = 104

# 黑线判定阈值：与纯渐变背景差多少才算"这里画了东西"
DIFF_THRESHOLD = 4


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def grad_color(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(GRAD_COLORS) - 1):
        t0, c0 = GRAD_COLORS[i]
        t1, c1 = GRAD_COLORS[i + 1]
        if t0 <= t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0)
    return GRAD_COLORS[-1][1]


def make_gradient(w, h):
    """按 CSS 角度算线性渐变。低分辨率逐像素算准，再放大（渐变本身是平滑的，放大无损观感）。"""
    lw, lh = max(2, w // 8), max(2, h // 8)
    rad = math.radians(GRAD_DEG)
    dx, dy = math.sin(rad), -math.cos(rad)   # CSS 0deg = to top，顺时针为正
    projs = [(x * dx + y * dy) for x in (0, lw) for y in (0, lh)]
    lo, hi = min(projs), max(projs)
    span = (hi - lo) or 1
    small = Image.new('RGB', (lw, lh))
    px = small.load()
    for y in range(lh):
        for x in range(lw):
            px[x, y] = grad_color(((x * dx + y * dy) - lo) / span)
    return small.resize((w, h), Image.BILINEAR)


def text_w(draw, s, font, ls):
    """带字距的文本宽度"""
    if not s:
        return 0
    w = sum(draw.textlength(ch, font=font) for ch in s)
    return w + ls * (len(s) - 1)


def draw_spaced(draw, cx, y, s, font, fill, ls):
    """居中 + 字距绘制"""
    w = text_w(draw, s, font, ls)
    x = cx - w / 2
    for ch in s:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + ls
    return w


def circle_mask(size, ss):
    m = Image.new('L', (size * ss, size * ss), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * ss - 1, size * ss - 1), fill=255)
    return m.resize((size, size), Image.LANCZOS)


def render_content(w, h, ss=2):
    """画出内容图（不含黑边），返回 (RGB 图, 图案包围盒 [x0,y0,x1,y1])"""
    S = (w / DESIGN_W) * ss       # rpx -> px（含超采样倍率）
    W, H = w * ss, h * ss
    bg = make_gradient(W, H)
    img = bg.copy()

    def R(v):                     # rpx → px
        return v * S

    pad_top = R(180)
    stage = R(340)
    ring_bw = max(2, round(R(3)))
    mascot = R(320)
    cx = W / 2
    halo = R(18)                  # 光晕模糊半径：包围盒要把它算进去

    # ---- 光晕：ring 内侧的柔和品牌色投影（近似 cover 的 box-shadow）
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(
        (cx - stage / 2, pad_top + R(8), cx + stage / 2, pad_top + stage + R(8)),
        fill=(46, 107, 255, 60))
    sh = sh.filter(ImageFilter.GaussianBlur(halo))
    img = Image.alpha_composite(img.convert('RGBA'), sh).convert('RGB')

    # ---- 吉祥物（圆形裁剪 + 白底圆）
    face = Image.open(MASCOT).convert('RGB')
    side = min(face.size)
    face = face.crop(((face.width - side) // 2, (face.height - side) // 2,
                      (face.width + side) // 2, (face.height + side) // 2))
    msz = int(round(mascot))
    face = face.resize((msz, msz), Image.LANCZOS)
    img.paste(face, (int(round(cx - msz / 2)), int(round(pad_top + (stage - mascot) / 2))),
              circle_mask(msz, ss))

    d = ImageDraw.Draw(img)

    # ---- 外圈
    d.ellipse((cx - stage / 2, pad_top, cx + stage / 2, pad_top + stage),
              outline=(46, 107, 255, 102), width=ring_bw)

    # ---- 品牌文字
    y = pad_top + stage + R(72)
    f_name = ImageFont.truetype(FONT_BOLD, max(8, round(R(46))))
    draw_spaced(d, cx, y, 'ENGLISH TRAINER', f_name, BRAND, R(10))
    y += round(R(46) * 1.2) + R(36)

    d.line((cx - R(64) / 2, y, cx + R(64) / 2, y), fill=(46, 107, 255, 97), width=max(1, round(R(2))))
    y += R(32)

    f_en = ImageFont.truetype(FONT_REG, max(7, round(R(20))))
    draw_spaced(d, cx, y, 'FUJIAN \u00b7 TRANSLATION PRACTICE', f_en, (29, 79, 216), R(5))

    # ---- 底部进度槽（cover 页那条进度条的空槽，位置一致，便于动画接管）
    by = H - R(100) - R(4)
    d.rounded_rectangle((cx - R(240) / 2, by, cx + R(240) / 2, by + max(2, round(R(4)))),
                        radius=max(1, round(R(2))), fill=(46, 107, 255, 46))

    img = img.resize((w, h), Image.LANCZOS)
    bg = bg.resize((w, h), Image.LANCZOS)

    # ---- 量"图案"到底占了哪块（与纯渐变比差异），供 9-patch 划不可拉伸区。
    #      ⚠️ 裁剪边界要比进度槽顶再往上退几像素：LANCZOS 缩放在色块边界会有
    #      振铃（overshoot），进度槽顶边会让它上面 1~2 行也出现超过阈值的差异，
    #      结果图案包围盒一路顶到画面底部，"可拉伸区"就空了（踩过这个坑）。
    progress_top = int(round(h - (BOTTOM_RESERVE_RPX / DESIGN_W) * w))
    diff = ImageChops.difference(img, bg).convert('L')
    mask = diff.point(lambda v: 255 if v > DIFF_THRESHOLD else 0)
    cut = max(1, progress_top - 4)
    bbox = mask.crop((0, 0, w, cut)).getbbox() or (0, 0, w, cut)
    # 图案边缘可能有半透明的抗锯齿像素，往回收 2px 安全余量
    bbox = (max(0, bbox[0] - 2), max(0, bbox[1] - 2),
            min(w, bbox[2] + 2), min(cut, bbox[3] + 2))
    return img, bbox, progress_top, halo * (w / DESIGN_W)


def add_ninepatch(img, x_stretch, y_stretch):
    """
    在内容图外圈加 1px 黑边，产出 .9.png。
      x_stretch = [(a, b), ...] 内容图坐标系里可水平拉伸的列区间（其余不可拉伸）
      y_stretch = [(a, b), ...] 可垂直拉伸的行区间
    右/下两条黑线按官方要求"拉满"（= padding 覆盖整幅，避免部分设备显示灰边）。
    四边除黑线外的像素必须**完全透明**，aapt 才能认出黑线。
    """
    w, h = img.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(img.convert('RGBA'), (1, 1))
    px = out.load()
    BLACK = (0, 0, 0, 255)

    for (a, b) in x_stretch:                     # 上边：可水平拉伸的列
        for x in range(max(0, a), min(w, b)):
            px[x + 1, 0] = BLACK
    for (a, b) in y_stretch:                     # 左边：可垂直拉伸的行
        for y in range(max(0, a), min(h, b)):
            px[0, y + 1] = BLACK
    for y in range(h):                           # 右边：拉满（padding）
        px[w + 1, y + 1] = BLACK
    for x in range(w):                           # 下边：拉满（padding）
        px[x + 1, h + 1] = BLACK
    return out


def stretch_from_black(path):
    """从 .9.png 里把黑线读回来（校验用）：返回 (x_stretch, y_stretch, padding_ok)"""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()

    def dark(p):
        return p[3] > 200 and p[0] < 16 and p[1] < 16 and p[2] < 16

    xs, ys = [], []
    run = None
    for x in range(1, w - 1):
        if dark(px[x, 0]):
            run = (x - 1, x) if run is None else (run[0], x)
        elif run:
            xs.append((run[0], run[1] + 1)); run = None
    if run:
        xs.append((run[0], run[1] + 1))
    run = None
    for y in range(1, h - 1):
        if dark(px[0, y]):
            run = (y - 1, y) if run is None else (run[0], y)
        elif run:
            ys.append((run[0], run[1] + 1)); run = None
    if run:
        ys.append((run[0], run[1] + 1))
    right_full = all(dark(px[w - 1, y]) for y in range(1, h - 1))
    bottom_full = all(dark(px[x, h - 1]) for x in range(1, w - 1))
    return xs, ys, (right_full and bottom_full)


def render_ninepatch(path, out_w, out_h):
    """把 .9.png 按目标尺寸渲染出来（本地预览用，还原 Android 的拉伸规则）"""
    xs_all, ys_all, _ = stretch_from_black(path)
    im = Image.open(path).convert('RGBA').crop((1, 1, Image.open(path).size[0] - 1,
                                                Image.open(path).size[1] - 1))
    w, h = im.size

    def segs(size, ranges):
        """把 [0,size) 切成 (段起, 段止, 是否可拉伸) 列表"""
        out, cur = [], 0
        for (a, b) in ranges:
            if a > cur:
                out.append((cur, a, False))
            out.append((a, b, True))
            cur = b
        if cur < size:
            out.append((cur, size, False))
        return out

    cols = segs(w, xs_all)
    rows = segs(h, ys_all)
    fixed_w = sum(b - a for a, b, s in cols if not s)
    fixed_h = sum(b - a for a, b, s in rows if not s)
    kx = max(0.0, (out_w - fixed_w)) / max(1, sum(b - a for a, b, s in cols if s))
    ky = max(0.0, (out_h - fixed_h)) / max(1, sum(b - a for a, b, s in rows if s))

    xs_pos, x = [], 0
    for a, b, s in cols:
        n = max(1, int(round((b - a) * (kx if s else 1))))
        xs_pos.append((a, b, x, x + n)); x += n
    ys_pos, y = [], 0
    for a, b, s in rows:
        n = max(1, int(round((b - a) * (ky if s else 1))))
        ys_pos.append((a, b, y, y + n)); y += n

    out = Image.new('RGBA', (x, y), (255, 255, 255, 255))
    for (a, b, dx0, dx1) in xs_pos:
        for (c, d, dy0, dy1) in ys_pos:
            piece = im.crop((a, c, b, d)).resize((max(1, dx1 - dx0), max(1, dy1 - dy0)),
                                                 Image.NEAREST if (dx1 - dx0) <= 2 else Image.BILINEAR)
            out.paste(piece, (dx0, dy0))
    return out


def build(w, h, out_path, ss=2):
    S = (w / DESIGN_W) * ss
    img, bbox, progress_top, halo = render_content(w, h, ss)
    x0, y0, x1, y1 = bbox
    pattern_bottom = y1          # bbox 已经挖掉进度槽那一段了（见 render_content）
    # 上边：左右两条边缘可水平拉伸，中间（含图案）不拉伸
    x_stretch = []
    if x0 > 0:
        x_stretch.append((0, x0))
    if x1 < w:
        x_stretch.append((x1, w))
    # 左边：**只有**图案与进度槽之间那段可垂直拉伸
    y_stretch = [(pattern_bottom, progress_top)] if progress_top > pattern_bottom else []
    nine = add_ninepatch(img, x_stretch, y_stretch)
    nine.save(out_path, 'PNG', optimize=True)
    return {
        'file': os.path.basename(out_path),
        'content': (w, h),
        'file_size': nine.size,
        'bbox': bbox,
        'stretch_x': x_stretch,
        'stretch_y': y_stretch,
        'progress_top': progress_top,
        'halo': halo,
        'bytes': os.path.getsize(out_path),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [('splash-hdpi.9.png', 480, 800),
               ('splash-xhdpi.9.png', 720, 1280),
               ('splash-xxhdpi.9.png', 1080, 1920)]
    info = []
    for name, w, h in targets:
        r = build(w, h, os.path.join(OUT, name))
        info.append(r)
        print('  \u2713 %-24s 内容 %dx%d → 文件 %dx%d  %d KB'
              % (r['file'], r['content'][0], r['content'][1],
                 r['file_size'][0], r['file_size'][1], r['bytes'] // 1024))
        print('      图案包围盒 %s  垂直可拉伸 %s（图案底 %d / 进度槽顶 %d）'
              % (r['bbox'], r['stretch_y'], r['bbox'][3], r['progress_top']))

    # ---- 本地预览：按常见机型的屏幕尺寸把 xxhdpi 那张渲染出来，肉眼核对不变形
    os.makedirs(SCRATCH, exist_ok=True)
    big = os.path.join(OUT, 'splash-xxhdpi.9.png')
    for (dw, dh, tag) in [(1212, 2616, '20-9'), (1080, 1920, '16-9'), (1080, 2340, '19.5-9')]:
        pv = render_ninepatch(big, dw, dh)
        p = os.path.join(SCRATCH, 'splash-preview-%s.png' % tag)
        pv.convert('RGB').save(p, 'PNG', optimize=True)
        print('  \u2713 预览 %-8s %dx%d → _tools/_scratch/splash-preview-%s.png'
              % (tag, dw, dh, tag))


if __name__ == '__main__':
    main()
