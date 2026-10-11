// _tools/lib/png.js - 极简 PNG 解码（只读，够校验 9-patch 黑线用）
//
// 为什么不用现成的图像库：_tools 下的校验脚本一律零依赖（见 check-data.js 等），
// 而 .9.png 的合法性**必须看像素**才能判 —— 只看 IHDR 的宽高是查不出
// "黑线画错位置 / 黑线画成一整条 / 忘了透明" 这些要命的错的。
// 这里只实现校验用得到的那一档：8bit、非隔行，colorType 0/2/3/4/6。
const zlib = require('zlib');

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function decode(buf) {
  if (buf.length < 24 || buf.slice(1, 4).toString('latin1') !== 'PNG') {
    throw new Error('不是 PNG（magic 不对）');
  }
  let off = 8;
  let w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
  let palette = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') palette = data;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('只支持 8bit 位深（实际 ' + depth + '）');
  if (interlace !== 0) throw new Error('不支持隔行（Adam7）PNG');
  const ch = CHANNELS[colorType];
  if (!ch) throw new Error('不支持的颜色类型 ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const base = y * stride;
    const prevBase = base - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[base + i - ch] : 0;
      const b = y > 0 ? out[prevBase + i] : 0;
      const c = (y > 0 && i >= ch) ? out[prevBase + i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (f !== 0) {
        throw new Error('未知的行过滤类型 ' + f);
      }
      out[base + i] = v & 0xff;
    }
  }
  return { w, h, ch, colorType, palette, data: out };
}

/** 取某点 RGBA */
function pixel(img, x, y) {
  const i = (y * img.w + x) * img.ch;
  const d = img.data;
  if (img.colorType === 3) {
    const k = d[i] * 3;
    return [img.palette[k], img.palette[k + 1], img.palette[k + 2], 255];
  }
  if (img.ch === 1) return [d[i], d[i], d[i], 255];
  if (img.ch === 2) return [d[i], d[i], d[i], d[i + 1]];
  if (img.ch === 3) return [d[i], d[i + 1], d[i + 2], 255];
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

const isBlack = (p) => p[3] > 200 && p[0] < 16 && p[1] < 16 && p[2] < 16;
const isClear = (p) => p[3] < 16;

/**
 * 把一条边上的连续黑像素切成区间 [start, end)（一律用**内容坐标**，最外 1px 边框不计）。
 * 内容坐标 = 图像坐标 - 1，所以 [0, 内容宽) 就是"拉满"。
 */
function blackRuns(img, edge) {
  const runs = [];
  let run = null;
  const push = () => { if (run) runs.push([run[0], run[1] + 1]); run = null; };
  if (edge === 'top' || edge === 'bottom') {
    const y = edge === 'top' ? 0 : img.h - 1;
    for (let x = 1; x < img.w - 1; x++) {
      const i = x - 1;                       // 内容坐标
      if (isBlack(pixel(img, x, y))) run = run === null ? [i, i] : [run[0], i];
      else push();
    }
  } else {
    const x = edge === 'left' ? 0 : img.w - 1;
    for (let y = 1; y < img.h - 1; y++) {
      const i = y - 1;                       // 内容坐标
      if (isBlack(pixel(img, x, y))) run = run === null ? [i, i] : [run[0], i];
      else push();
    }
  }
  push();
  return runs;
}

/** 一条边上除黑线外的像素是否全透明（aapt 靠这个认出黑线，不透明会被当成内容） */
function restTransparent(img, edge) {
  if (edge === 'top' || edge === 'bottom') {
    const y = edge === 'top' ? 0 : img.h - 1;
    for (let x = 1; x < img.w - 1; x++) {
      const p = pixel(img, x, y);
      if (!isBlack(p) && !isClear(p)) return false;
    }
    return true;
  }
  const x = edge === 'left' ? 0 : img.w - 1;
  for (let y = 1; y < img.h - 1; y++) {
    const p = pixel(img, x, y);
    if (!isBlack(p) && !isClear(p)) return false;
  }
  return true;
}

module.exports = { decode, pixel, blackRuns, restTransparent, isBlack, isClear };
