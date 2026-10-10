# _tools/gen-avatar.py - 生成「我的」页默认头像（uniapp/static/avatar-default.jpg）
#
# 为什么要有这个脚本：
#   默认头像原来复用的是 static/mascot.jpg ——  那是张 800x480 的横版看板娘线稿，
#   而头像在 profile.vue 里是 110rpx 的正圆（mode="aspectFill"）。
#   横图塞进正圆：aspectFill 先按短边放大再裁掉左右，脸会被拉大、头顶和蝴蝶结全被切掉，
#   实际显示出来只剩半张脸，很难看。
#   这里把方形的看板娘原画（static/icons/icon-1024.png，与应用图标同源）裁成正方形，
#   让「脸」落在正圆中心，再压成 512x512 的 jpg。
#
# 用法：python gen-avatar.py      （输出 ../../uniapp/static/avatar-default.jpg）
#
# 尺寸怎么来的（对着原画量的）：
#   1024x1024 原画里，人物笔画范围约 x 0..986 / y 109..1023（左下角身体被画布裁掉）；
#   脸（含腮红）大致在 x 300..620 / y 380..650，脸心约 (430, 500)。
#   取 780x780 的方框、圆心 (450, 465)，即方框里那个内切圆（= 圆形头像实际可见范围）
#   刚好把脸摆在圆心、头发和领结都留住，只切掉右上蝴蝶结的尖儿和左下角身体。
#   换原画/换构图就调下面三个常量，然后看一眼 _tools/_scratch/preview-avatar.py 的预览图。
from PIL import Image
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'uniapp', 'static', 'icons', 'icon-1024.png')
OUT = os.path.join(HERE, '..', 'uniapp', 'static', 'avatar-default.jpg')

CROP_SIDE = 780           # 裁切方框边长（原画像素）
CROP_CX = 450             # 方框中心 x（对齐"脸心偏右一点点"，把蝴蝶结多留一点）
CROP_CY = 465             # 方框中心 y
OUT_SIZE = 512            # 输出边长（头像最大就显示 158px 物理像素，512 足够 3x 屏）
QUALITY = 88


def main():
    if not os.path.exists(SRC):
        raise SystemExit('找不到原画：' + SRC)
    im = Image.open(SRC).convert('RGB')
    side = min(CROP_SIDE, im.width, im.height)
    l = max(0, min(im.width - side, CROP_CX - side // 2))
    t = max(0, min(im.height - side, CROP_CY - side // 2))
    box = (l, t, l + side, t + side)
    out = im.crop(box).resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)
    out.save(OUT, quality=QUALITY, optimize=True, progressive=True)
    print('crop %s -> %s  %dx%d  %.1fKB'
          % (box, os.path.relpath(OUT, os.path.join(HERE, '..')),
             OUT_SIZE, OUT_SIZE, os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    main()
