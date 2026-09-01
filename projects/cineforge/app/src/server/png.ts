import { deflateSync } from "zlib";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 生成纯色 PNG（无第三方依赖），供 Ref2VA 参考图与种子素材。 */
export function solidPng(
  width: number,
  height: number,
  rgb: [number, number, number],
): Buffer {
  const [r, g, b] = rgb;
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const o = i * 3;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
  }
  return encodePng(width, height, px);
}

export function hashColor(seed: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return [40 + (h & 0x7f), 30 + ((h >>> 8) & 0x7f), 20 + ((h >>> 16) & 0x5f)];
}

export function pngDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

type ShotKind = "scene" | "character" | "object";
type ShotFraming = "wide" | "medium" | "close";

function setPx(
  px: Buffer,
  w: number,
  x: number,
  y: number,
  rgb: [number, number, number],
  a = 1,
) {
  if (x < 0 || y < 0 || x >= w) return;
  const h = px.length / (w * 3);
  if (y >= h) return;
  const o = (y * w + x) * 3;
  px[o] = Math.round(px[o] * (1 - a) + rgb[0] * a);
  px[o + 1] = Math.round(px[o + 1] * (1 - a) + rgb[1] * a);
  px[o + 2] = Math.round(px[o + 2] * (1 - a) + rgb[2] * a);
}

function fillRect(
  px: Buffer,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgb: [number, number, number],
  a = 1,
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) setPx(px, w, x, y, rgb, a);
  }
}

function fillEllipse(
  px: Buffer,
  w: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rgb: [number, number, number],
) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPx(px, w, x, y, rgb);
    }
  }
}

function barCode(
  px: Buffer,
  w: number,
  x: number,
  y: number,
  seed: string,
  color: [number, number, number],
) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 48; i++) {
    const bit = (h >>> (i % 28)) & 1;
    if (bit) fillRect(px, w, x + i * 3, y, x + i * 3 + 2, y + 10, color);
  }
}

/**
 * 构图种子参考图：场景/人物/物品 × 广/中/特，几何构图而非纯色块，
 * 给 Ref2VA 可区分的身份锚（仍非真人照片）。
 */
export function composeShotPng(opts: {
  kind: ShotKind;
  framing: ShotFraming;
  name: string;
  palette: [[number, number, number], [number, number, number]];
}): Buffer {
  const w = 640;
  const h = 360;
  const [bg, accent] = opts.palette;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const o = i * 3;
    const y = Math.floor(i / w);
    const t = y / h;
    px[o] = Math.round(bg[0] * (1 - t) + accent[0] * t * 0.25);
    px[o + 1] = Math.round(bg[1] * (1 - t) + accent[1] * t * 0.25);
    px[o + 2] = Math.round(bg[2] * (1 - t) + accent[2] * t * 0.25);
  }

  if (opts.kind === "scene") {
    fillRect(px, w, 0, 220, w, h, [18, 16, 14]);
    fillRect(px, w, 80, 70, 560, 260, [36, 28, 18]);
    fillRect(px, w, 200, 100, 440, 250, [70, 52, 28], 0.85);
    fillRect(px, w, 250, 40, 390, 90, accent);
    if (opts.framing === "wide") {
      fillRect(px, w, 40, 180, 120, 300, [28, 24, 20]);
      fillRect(px, w, 520, 180, 600, 300, [28, 24, 20]);
    } else if (opts.framing === "medium") {
      fillRect(px, w, 160, 140, 480, 300, [48, 36, 22]);
      fillRect(px, w, 300, 180, 360, 280, [90, 70, 40]);
    } else {
      fillRect(px, w, 180, 100, 460, 280, [55, 42, 26]);
      fillEllipse(px, w, 320, 160, 40, 28, accent);
    }
  } else if (opts.kind === "character") {
    const scale = opts.framing === "wide" ? 0.55 : opts.framing === "medium" ? 0.75 : 1;
    const cx = 320;
    const headY = opts.framing === "close" ? 130 : 110;
    const headR = Math.round(42 * scale);
    fillEllipse(px, w, cx, headY, headR, headR, [210, 190, 170]);
    fillRect(
      px,
      w,
      Math.round(cx - 55 * scale),
      Math.round(headY + headR * 0.7),
      Math.round(cx + 55 * scale),
      opts.framing === "close" ? 300 : 330,
      accent,
    );
    if (opts.framing !== "wide") {
      fillRect(px, w, cx - 18, headY - 8, cx - 6, headY - 2, [40, 30, 28]);
    }
    if (opts.name.includes("周")) {
      fillRect(px, w, cx - 36, headY - 4, cx + 36, headY + 2, [200, 180, 120]);
    }
  } else {
    const cupW = opts.framing === "close" ? 140 : opts.framing === "medium" ? 100 : 70;
    const cupH = Math.round(cupW * 1.1);
    const left = 320 - cupW / 2;
    const top = opts.framing === "wide" ? 160 : 110;
    fillRect(px, w, left, top, left + cupW, top + cupH, [230, 225, 210]);
    fillRect(px, w, left, top + 20, left + cupW, top + 34, [90, 120, 160]);
    fillRect(px, w, left + cupW - 18, top, left + cupW, top + 16, [40, 36, 30]);
    if (opts.framing !== "wide") {
      fillEllipse(px, w, 320, top + 8, cupW * 0.35, 8, [200, 200, 200]);
    }
  }

  fillRect(px, w, 16, 16, 220, 42, [12, 10, 8], 0.75);
  barCode(px, w, 24, 22, `${opts.kind}-${opts.framing}-${opts.name}`, accent);
  fillRect(px, w, 16, h - 36, 280, h - 16, [12, 10, 8], 0.7);
  barCode(px, w, 24, h - 30, opts.name + opts.framing, [200, 180, 140]);

  return encodePng(w, h, px);
}
