# _tools/gen-avatar.py - 生成「我的」页默认头像（uniapp/static/avatar-default.jpg）
#
# 为什么要有这个脚本（两代原因的叠加）：
#   ① 最早默认头像复用的是 static/mascot.jpg —— 800x480 横图，塞进 110rpx 正圆后
#      人物又小又偏（光环、蝴蝶结都被切掉），于是改成专门裁一张方形头像，把脸摆在圆心。
#   ② 2026-10-11 用户反馈：那张裁切版「显示偏大」—— 裁切本身就是放大，画面被顶到圆的
#      边缘，头顶蝴蝶结的尖、右上光环、左下围裙全落在圆外。要求「原框尽可能显示图片的全部」。
#      所以现在改成 **整幅等比缩进去、一刀不裁**：把原画缩到外框的 FIT 比例，
#      居中贴在方形画布上，四周补一圈取自原画四角的底色（JPEG 没有透明通道，
#      补画面自己的浅蓝比补白更不突兀）。
#   配合 profile.vue 的 mode="aspectFit"：默认图与用户自选的图，圆框里呈现的都是
#   「完整的一幅」，而不是「被裁过的一块」。
#
#   注意：改这里只影响默认头像。用户自己选的头像走的是 utils/... 的本地文件，
#   那个由 profile.vue 的 chooseAvatar() 负责，跟本脚本无关。
#
# 用法：python gen-avatar.py      （输出 ../../uniapp/static/avatar-default.jpg）
from PIL import Image
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'uniapp', 'static', 'icons', 'icon-1024.png')
OUT = os.path.join(HERE, '..', 'uniapp', 'static', 'avatar-default.jpg')

FIT = 0.86          # 画面占外框的比例；剩下的当留白（太满就又是"偏大"）
OUT_SIZE = 512      # 头像最大只显示 158px 物理像素，512 足够 3x 屏
QUALITY = 88


def bg_color(im):
    """取原画四角 8x8 的平均色当留白底色 —— 原画背景是浅蓝渐变，
    补它自己的颜色，接缝几乎看不出来（补白会有一圈白边）。"""
    w, h = im.size
    k = 8
    pts = [(0, 0), (w - k, 0), (0, h - k), (w - k, h - k)]
    rs = gs = bs = 0
    for x, y in pts:
        patch = im.crop((x, y, x + k, y + k))
        r, g, b = patch.resize((1, 1), Image.BOX).getpixel((0, 0))
        rs += r
        gs += g
        bs += b
    n = len(pts)
    return (rs // n, gs // n, bs // n)


def main():
    if not os.path.exists(SRC):
        raise SystemExit('找不到原画：' + SRC)
    im = Image.open(SRC).convert('RGB')
    # 原画是非正方时取中间的正方（现在是 1024x1024，这一步是防呆）
    side = min(im.width, im.height)
    l = (im.width - side) // 2
    t = (im.height - side) // 2
    square = im.crop((l, t, l + side, t + side))

    inner = int(round(OUT_SIZE * FIT))
    canvas = Image.new('RGB', (OUT_SIZE, OUT_SIZE), bg_color(square))
    off = (OUT_SIZE - inner) // 2
    canvas.paste(square.resize((inner, inner), Image.LANCZOS), (off, off))
    canvas.save(OUT, quality=QUALITY, optimize=True, progressive=True)
    print('fit %dx%d -> %d/%d  原画 %dx%d  底色 %s  %dx%d  %.1fKB'
          % (side, side, inner, OUT_SIZE, im.width, im.height,
             bg_color(square), OUT_SIZE, OUT_SIZE, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
