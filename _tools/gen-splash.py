# _tools/gen-splash.py - 生成 Android 原生启动图（**只画渐变背景，不画任何图案**）
#
# ⚠️ 为什么只有背景、没有圆圈/脸/文字（2026-10-12 教训）：
#   曾经在这张图上画了「圆头像 + 品牌文字 + 进度槽」，想跟 cover 页无缝衔接。
#   但 .9.png 的图案区是**不可拉伸的固定像素**（xxhdpi 内容宽 1080），
#   而 cover 页的圆圈是 **rpx 布局**（340rpx = 屏幕宽 × 340/750）：
#     · 1212px 宽的屏幕上：splash 圆圈 ≈ 490px，cover 圆圈 ≈ 549px（差 12%）
#     · 若设备命中 xhdpi（内容宽 720），差 40%
#   屏幕越宽差得越多 → 用户实测「第一张跟第二张之间圆圈错位/跳一下」。
#   位图图案的绝对尺寸不可能跟上每台屏幕的宽度，这是死结 ——
#   所以图案（圆圈、脸、文字、进度条）**全部交给 cover 页自己画并淡入**，
#   原生启动图只保留一张被拉伸也看不出来的**渐变背景**：两边衔接只剩背景，
#   而背景是平滑渐变，fitXY 拉伸无感（check-cover-mascot.js 第 4 组守这条）。
#
# ⚠️ 仍必须 **.9.png**（九宫格）而不是普通 png：
#   云打包时启动图会被**铺满整屏**（fitXY）。普通 png 的比例只要和屏幕对不上，
#   整张图就被拉长/压扁 —— 实测事故：图是 1080x1882（比例 0.574），
#   手机是 1212x2616（比例 0.463），纵向被拉长约 24%
#   （用户反馈"第一次打开软件图片是被拉伸的"）。
#   渐变内容 + 全幅可拉伸 = 任意比例屏幕都无感。
#
#   9-patch 的四条黑边（画在图像最外一圈 1px，其余边缘像素必须透明）：
#     上边、左边 = 可拉伸区（全幅，因为画面里没有任何不许变形的东西）
#     右边、下边 = padding 区（官方要求"拉满"，不拉满部分设备会显示灰边）
#
# 用法：python gen-splash.py        （输出到 ../uniapp/static/splash/，需重新云打包生效）
#
# 尺寸取自 uni-app 官方 manifest 说明：hdpi 480x800 / xhdpi 720x1280 / xxhdpi 1080x1920
# （这里指的是**内容区**，落盘文件会各方向 +2px 放黑边）
from PIL import Image
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'uniapp', 'static', 'splash')
SCRATCH = os.path.join(HERE, '_scratch')

# 渐变与 cover 页 .cover 的第一组 CSS 声明同色同角度
# （CSS: linear-gradient(165deg, #f2f7ff 0%, #e0ecff 52%, #cfe0ff 100%)）
GRAD_COLORS = [(0.00, (242, 247, 255)), (0.52, (224, 236, 255)), (1.00, (207, 224, 255))]
GRAD_DEG = 165            # CSS 角度：0deg = to top，顺时针为正


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


def build(w, h, out_path):
    """整幅都是平滑渐变 → 全幅可拉伸，任何屏幕比例都无感"""
    img = make_gradient(w, h)
    nine = add_ninepatch(img, [(0, w)], [(0, h)])
    nine.save(out_path, 'PNG', optimize=True)
    return {
        'file': os.path.basename(out_path),
        'content': (w, h),
        'file_size': nine.size,
        'bytes': os.path.getsize(out_path),
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [('splash-hdpi.9.png', 480, 800),
               ('splash-xhdpi.9.png', 720, 1280),
               ('splash-xxhdpi.9.png', 1080, 1920)]
    for name, w, h in targets:
        r = build(w, h, os.path.join(OUT, name))
        print('  \u2713 %-24s 内容 %dx%d \u2192 文件 %dx%d  %d KB\uff08\u7eaf\u6e10\u53d8\u80cc\u666f\uff0c\u65e0\u56fe\u6848\uff09'
              % (r['file'], r['content'][0], r['content'][1],
                 r['file_size'][0], r['file_size'][1], r['bytes'] // 1024))

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
