import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export type DemoArtMotif =
  | 'starfighter'
  | 'rpg_citadel'
  | 'cyber_highway'
  | 'mecha_horizon'
  | 'dungeon_orb'
  | 'crystal_peak';

export interface DemoCoverSpec {
  title: string;
  consoleLabel: string;
  eraTag: string;
  genreTag: string;
  regionTag: string;
  palette: {
    headerBg: [number, number, number];
    headerAccent: [number, number, number];
    skyTop: [number, number, number];
    skyBottom: [number, number, number];
    accent: [number, number, number];
    highlight: [number, number, number];
  };
  motif: DemoArtMotif;
  seed: number;
}

export interface DemoScreenshotSpec {
  title: string;
  consoleLabel: string;
  sceneIndex: number;
  motif: DemoArtMotif;
  palette: DemoCoverSpec['palette'];
  seed: number;
}

// Compact 5x7 uppercase bitmap font (subset A-Z, 0-9, punctuation) for crisp pixel art banners
const FONT_5X7: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

// Precompute IEEE 802.3 CRC32 table for fast valid PNG chunk encoding
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // None filter
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, alpha = 1): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 3;
    if (alpha >= 0.999) {
      this.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      this.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      this.data[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
    } else if (alpha > 0) {
      const inv = 1 - alpha;
      this.data[idx] = Math.max(0, Math.min(255, Math.round(this.data[idx] * inv + r * alpha)));
      this.data[idx + 1] = Math.max(
        0,
        Math.min(255, Math.round(this.data[idx + 1] * inv + g * alpha)),
      );
      this.data[idx + 2] = Math.max(
        0,
        Math.min(255, Math.round(this.data[idx + 2] * inv + b * alpha)),
      );
    }
  }

  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: [number, number, number],
    alpha = 1,
  ): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        this.setPixel(px, py, color[0], color[1], color[2], alpha);
      }
    }
  }

  fillGradientV(
    x: number,
    y: number,
    w: number,
    h: number,
    top: [number, number, number],
    bottom: [number, number, number],
  ): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const denom = Math.max(1, y1 - y0 - 1);
    for (let py = y0; py < y1; py += 1) {
      const t = (py - y0) / denom;
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      for (let px = x0; px < x1; px += 1) {
        this.setPixel(px, py, r, g, b);
      }
    }
  }

  fillCircle(
    cx: number,
    cy: number,
    radius: number,
    color: [number, number, number],
    alpha = 1,
  ): void {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let py = y0; py <= y1; py += 1) {
      const dy = py - cy;
      for (let px = x0; px <= x1; px += 1) {
        const dx = px - cx;
        if (dx * dx + dy * dy <= r2) {
          this.setPixel(px, py, color[0], color[1], color[2], alpha);
        }
      }
    }
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    thickness: number,
    color: [number, number, number],
    alpha = 1,
  ): void {
    this.fillRect(x, y, w, thickness, color, alpha);
    this.fillRect(x, y + h - thickness, w, thickness, color, alpha);
    this.fillRect(x, y, thickness, h, color, alpha);
    this.fillRect(x + w - thickness, y, thickness, h, color, alpha);
  }

  drawText(
    text: string,
    x: number,
    y: number,
    scale: number,
    color: [number, number, number],
    shadowColor?: [number, number, number],
  ): void {
    const upper = text.toUpperCase();
    const step = 6 * scale;
    let cursorX = Math.floor(x);
    for (let i = 0; i < upper.length; i += 1) {
      const glyph = FONT_5X7[upper[i]] ?? FONT_5X7[' '];
      for (let row = 0; row < glyph.length; row += 1) {
        const line = glyph[row];
        for (let col = 0; col < line.length; col += 1) {
          if (line[col] !== '1') continue;
          const px = cursorX + col * scale;
          const py = Math.floor(y) + row * scale;
          if (shadowColor) {
            this.fillRect(px + scale, py + scale, scale, scale, shadowColor, 0.8);
          }
          this.fillRect(px, py, scale, scale, color, 1);
        }
      }
      cursorX += step;
    }
  }

  measureText(text: string, scale: number): number {
    if (!text.length) return 0;
    return text.length * 6 * scale - scale;
  }

  drawCenteredText(
    text: string,
    centerX: number,
    y: number,
    scale: number,
    color: [number, number, number],
    shadowColor?: [number, number, number],
  ): void {
    const width = this.measureText(text, scale);
    this.drawText(text, Math.round(centerX - width / 2), y, scale, color, shadowColor);
  }

  applyScanlines(strength = 0.14): void {
    for (let y = 0; y < this.height; y += 2) {
      for (let x = 0; x < this.width; x += 1) {
        this.setPixel(x, y, 0, 0, 0, strength);
      }
    }
  }

  toPngBuffer(): Buffer {
    return encodeRgbPng(this.width, this.height, this.data);
  }
}

function seededRand(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function wrapUpperTitle(title: string, maxChars: number): string[] {
  const words = title.toUpperCase().replace(/[^A-Z0-9:\-!./ ]/g, '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word.slice(0, maxChars);
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function drawRetroSceneArtwork(
  canvas: PixelCanvas,
  x: number,
  y: number,
  w: number,
  h: number,
  motif: DemoArtMotif,
  palette: DemoCoverSpec['palette'],
  seed: number,
  variant = 0,
): void {
  const rand = seededRand(seed + variant * 997);
  canvas.fillGradientV(x, y, w, h, palette.skyTop, palette.skyBottom);

  // Crisp pixel starfield
  const starCount = Math.floor((w * h) / 2600);
  for (let i = 0; i < starCount; i += 1) {
    const sx = x + Math.floor(rand() * w);
    const sy = y + Math.floor(rand() * (h * 0.68));
    const size = rand() > 0.85 ? 2 : 1;
    const bright = 0.45 + rand() * 0.55;
    canvas.fillRect(
      sx,
      sy,
      size,
      size,
      [
        Math.min(255, Math.round(palette.highlight[0] * bright + 70)),
        Math.min(255, Math.round(palette.highlight[1] * bright + 70)),
        Math.min(255, Math.round(palette.highlight[2] * bright + 70)),
      ],
      0.85,
    );
  }

  const horizonY = Math.floor(y + h * (variant === 1 ? 0.58 : 0.64));

  // Luminous celestial disc / sun / planet
  const sunR = Math.floor(Math.min(w, h) * (variant === 2 ? 0.16 : 0.21));
  const sunX = Math.floor(x + w * (variant === 1 ? 0.68 : variant === 2 ? 0.32 : 0.5));
  const sunY = Math.floor(horizonY - sunR * 0.45);
  canvas.fillCircle(sunX, sunY, Math.round(sunR * 1.28), palette.accent, 0.22);
  canvas.fillCircle(sunX, sunY, sunR, palette.highlight, 0.92);
  // Retro synthwave sun cutouts
  for (let sy = sunY + Math.floor(sunR * 0.12); sy < sunY + sunR; sy += 7) {
    const barH = sy > sunY + sunR * 0.55 ? 3 : 2;
    canvas.fillRect(sunX - sunR, sy, sunR * 2, barH, palette.skyBottom, 0.78);
  }

  // Far mountain ridge silhouette
  const ridgeColor: [number, number, number] = [
    Math.max(8, Math.round(palette.skyTop[0] * 0.55)),
    Math.max(10, Math.round(palette.skyTop[1] * 0.55)),
    Math.max(14, Math.round(palette.skyTop[2] * 0.65)),
  ];
  for (let px = x; px < x + w; px += 2) {
    const nx = (px - x) / w;
    const peak =
      Math.abs(Math.sin(nx * Math.PI * 3.1 + seed * 0.3 + variant)) * (h * 0.16) +
      Math.abs(Math.cos(nx * Math.PI * 7.2 + seed)) * (h * 0.06);
    const py = Math.floor(horizonY - peak);
    canvas.fillRect(px, py, 2, horizonY - py, ridgeColor, 1);
  }

  // Ground perspective grid
  const groundH = y + h - horizonY;
  canvas.fillGradientV(
    x,
    horizonY,
    w,
    groundH,
    [
      Math.max(8, Math.round(palette.skyBottom[0] * 0.4)),
      Math.max(10, Math.round(palette.skyBottom[1] * 0.4)),
      Math.max(14, Math.round(palette.skyBottom[2] * 0.5)),
    ],
    [8, 12, 16],
  );
  canvas.fillRect(x, horizonY, w, 2, palette.accent, 0.9);

  // Horizontal perspective lines
  for (let i = 1; i <= 8; i += 1) {
    const t = Math.pow(i / 8, 1.75);
    const gy = Math.floor(horizonY + t * groundH);
    canvas.fillRect(x, gy, w, 1, palette.accent, 0.35 + t * 0.35);
  }
  // Converging radial rails
  const vanishX = x + w * 0.5;
  for (let ray = -6; ray <= 6; ray += 1) {
    const bottomX = vanishX + ray * (w * 0.16);
    for (let step = 0; step < groundH; step += 2) {
      const frac = step / Math.max(1, groundH);
      const rx = vanishX + (bottomX - vanishX) * frac;
      canvas.fillRect(rx, horizonY + step, 2, 2, palette.accent, 0.25 + frac * 0.35);
    }
  }

  // Motif-specific centerpiece silhouette
  const cx = Math.floor(x + w * 0.5);
  const cy = Math.floor(y + h * 0.52);

  if (motif === 'starfighter') {
    // Sleek 16-bit spacefighter + twin plasma thrusters
    for (let i = 0; i < 24; i += 1) {
      const span = Math.floor((i / 24) * (w * 0.26));
      canvas.fillRect(cx - span, cy - 26 + i * 2, span * 2, 2, [225, 240, 250], 0.95);
    }
    canvas.fillRect(cx - 8, cy - 16, 16, 12, palette.accent, 0.95);
    canvas.fillCircle(cx - 18, cy + 26, 7, palette.highlight, 0.9);
    canvas.fillCircle(cx + 18, cy + 26, 7, palette.highlight, 0.9);
    // Laser bolts
    canvas.fillRect(cx - 32, cy - 56, 3, 28, palette.highlight, 0.9);
    canvas.fillRect(cx + 29, cy - 56, 3, 28, palette.highlight, 0.9);
  } else if (motif === 'rpg_citadel') {
    // Floating pixel fortress & glowing crystal spire
    const baseW = Math.floor(w * 0.34);
    const baseH = Math.floor(h * 0.24);
    canvas.fillRect(cx - baseW / 2, horizonY - baseH, baseW, baseH, [24, 28, 44], 1);
    canvas.fillRect(cx - baseW * 0.6, horizonY - baseH * 1.15, 18, baseH * 1.15, [30, 36, 56], 1);
    canvas.fillRect(cx + baseW * 0.6 - 18, horizonY - baseH * 1.15, 18, baseH * 1.15, [30, 36, 56], 1);
    canvas.fillRect(cx - 14, horizonY - baseH * 1.48, 28, baseH * 1.48, [34, 42, 66], 1);
    // Illuminated stained-glass windows
    canvas.fillRect(cx - 5, horizonY - baseH * 1.25, 10, 22, palette.highlight, 0.95);
    canvas.fillRect(cx - baseW * 0.28, horizonY - baseH * 0.68, 8, 14, palette.accent, 0.9);
    canvas.fillRect(cx + baseW * 0.28 - 8, horizonY - baseH * 0.68, 8, 14, palette.accent, 0.9);
  } else if (motif === 'cyber_highway') {
    // Low-slung retro supercar silhouette + twin neon taillights
    const carW = Math.floor(w * 0.42);
    const carY = Math.floor(horizonY + groundH * 0.26);
    canvas.fillRect(cx - carW / 2, carY, carW, 24, [18, 22, 32], 1);
    canvas.fillRect(cx - carW * 0.34, carY - 14, carW * 0.68, 16, [28, 34, 48], 1);
    canvas.fillRect(cx - carW * 0.26, carY - 11, carW * 0.52, 9, palette.accent, 0.72);
    // Tail light bar
    canvas.fillRect(cx - carW * 0.44, carY + 7, carW * 0.88, 5, palette.highlight, 0.98);
    // Spoiler
    canvas.fillRect(cx - carW * 0.48, carY - 4, carW * 0.96, 3, palette.accent, 0.9);
  } else if (motif === 'mecha_horizon') {
    // Stylized giant mecha bust silhouette + glowing visor
    canvas.fillRect(cx - 38, cy - 12, 76, 56, [24, 30, 44], 1);
    canvas.fillRect(cx - 58, cy - 2, 24, 38, [32, 42, 62], 1);
    canvas.fillRect(cx + 34, cy - 2, 24, 38, [32, 42, 62], 1);
    canvas.fillRect(cx - 22, cy - 40, 44, 30, [36, 46, 68], 1);
    // V-fin antenna & glowing visor
    canvas.fillRect(cx - 34, cy - 48, 24, 4, palette.highlight, 0.95);
    canvas.fillRect(cx + 10, cy - 48, 24, 4, palette.highlight, 0.95);
    canvas.fillRect(cx - 14, cy - 27, 28, 7, palette.accent, 0.98);
  } else if (motif === 'dungeon_orb') {
    // Floating geometric crystal & concentric arcane rings
    canvas.fillCircle(cx, cy - 6, 46, palette.accent, 0.22);
    canvas.fillCircle(cx, cy - 6, 30, palette.highlight, 0.32);
    for (let dy = -34; dy <= 34; dy += 2) {
      const half = Math.max(2, Math.floor(24 * (1 - Math.abs(dy) / 36)));
      canvas.fillRect(cx - half, cy - 6 + dy, half * 2, 2, dy < 0 ? palette.highlight : palette.accent, 0.94);
    }
  } else {
    // Crystal peak with twin floating islands
    canvas.fillCircle(cx, cy - 16, 38, palette.accent, 0.25);
    for (let dy = 0; dy < 68; dy += 2) {
      const half = Math.floor((dy / 68) * 52);
      canvas.fillRect(cx - half, horizonY - 68 + dy, half * 2, 2, palette.accent, 0.72);
    }
    canvas.fillRect(cx - 66, cy - 30, 32, 9, palette.highlight, 0.85);
    canvas.fillRect(cx + 34, cy - 42, 36, 9, palette.highlight, 0.85);
  }
}

export function renderDemoCoverPng(spec: DemoCoverSpec): Buffer {
  const width = 360;
  const height = 480;
  const canvas = new PixelCanvas(width, height);

  // Outer cartridge/box shell
  canvas.fillRect(0, 0, width, height, [12, 16, 22]);

  // Console top header band
  const headerH = 54;
  canvas.fillRect(0, 0, width, headerH, spec.palette.headerBg);
  canvas.fillRect(0, headerH - 4, width, 4, spec.palette.headerAccent);
  canvas.drawText(spec.consoleLabel, 18, 18, 3, [242, 248, 244], [10, 14, 18]);

  // Era pill on top-right
  const eraW = canvas.measureText(spec.eraTag, 2) + 16;
  canvas.fillRect(width - eraW - 14, 14, eraW, 24, [12, 16, 22], 0.85);
  canvas.strokeRect(width - eraW - 14, 14, eraW, 24, 2, spec.palette.headerAccent, 0.95);
  canvas.drawText(spec.eraTag, width - eraW - 6, 19, 2, spec.palette.headerAccent);

  // Main artwork window
  const artY = headerH + 10;
  const artH = 292;
  drawRetroSceneArtwork(canvas, 12, artY, width - 24, artH, spec.motif, spec.palette, spec.seed, 0);
  canvas.strokeRect(12, artY, width - 24, artH, 2, spec.palette.headerAccent, 0.75);

  // Title plaque below artwork
  const plaqueY = artY + artH + 10;
  const plaqueH = height - plaqueY - 12;
  canvas.fillGradientV(12, plaqueY, width - 24, plaqueH, [18, 24, 32], [10, 14, 20]);
  canvas.strokeRect(12, plaqueY, width - 24, plaqueH, 2, [46, 64, 58], 0.9);

  const lines = wrapUpperTitle(spec.title, 15);
  const titleScale = lines.length >= 3 ? 2 : 3;
  const lineH = titleScale * 7 + 8;
  const startY = plaqueY + (lines.length === 1 ? 26 : lines.length === 2 ? 14 : 10);
  lines.forEach((line, idx) => {
    canvas.drawCenteredText(
      line,
      width / 2,
      startY + idx * lineH,
      titleScale,
      [238, 250, 242],
      [6, 10, 12],
    );
  });

  // Footer genre & region seal
  const footerY = height - 34;
  canvas.fillRect(22, footerY - 6, width - 44, 1, spec.palette.headerAccent, 0.45);
  canvas.drawText(spec.genreTag, 24, footerY, 2, spec.palette.highlight);
  const regionW = canvas.measureText(spec.regionTag, 2);
  canvas.drawText(spec.regionTag, width - regionW - 24, footerY, 2, [185, 210, 195]);

  // Subtle CRT texture & crisp box border
  canvas.applyScanlines(0.08);
  canvas.strokeRect(0, 0, width, height, 3, [34, 46, 42], 1);

  return canvas.toPngBuffer();
}

export function renderDemoScreenshotPng(spec: DemoScreenshotSpec): Buffer {
  const width = 640;
  const height = 360;
  const canvas = new PixelCanvas(width, height);

  // Vary sky/horizon palette gently between shots 1, 2, 3 so Lightbox Next/Prev swaps pop cleanly
  const shiftedPalette: DemoCoverSpec['palette'] =
    spec.sceneIndex === 0
      ? spec.palette
      : spec.sceneIndex === 1
        ? {
            ...spec.palette,
            skyTop: [spec.palette.skyTop[2], spec.palette.skyTop[0], Math.min(255, spec.palette.skyTop[1] + 24)],
            skyBottom: [Math.min(255, spec.palette.skyBottom[1] + 28), spec.palette.skyBottom[2], spec.palette.skyBottom[0]],
            accent: spec.palette.highlight,
            highlight: spec.palette.accent,
          }
        : {
            ...spec.palette,
            skyTop: [14, 24, 34],
            skyBottom: [spec.palette.headerBg[0], spec.palette.headerBg[1], spec.palette.headerBg[2]],
          };

  drawRetroSceneArtwork(
    canvas,
    0,
    36,
    width,
    height - 36,
    spec.motif,
    shiftedPalette,
    spec.seed + spec.sceneIndex * 31,
    spec.sceneIndex,
  );

  // Authentic top arcade/console HUD bar
  canvas.fillRect(0, 0, width, 36, [10, 14, 20], 0.96);
  canvas.fillRect(0, 35, width, 2, shiftedPalette.accent, 0.9);

  const stageLabel =
    spec.sceneIndex === 0
      ? 'STAGE 1-1'
      : spec.sceneIndex === 1
        ? 'BOSS ARENA'
        : 'WORLD MAP';
  const scoreVal = String(148200 + spec.sceneIndex * 64500 + (spec.seed % 900) * 10);
  canvas.drawText(`1P ${scoreVal}`, 16, 11, 2, [238, 250, 242]);
  canvas.drawCenteredText(stageLabel, width / 2, 11, 2, shiftedPalette.highlight);

  // Energy / HP bar on top-right
  canvas.drawText('HP', width - 146, 11, 2, [195, 220, 205]);
  canvas.fillRect(width - 114, 11, 98, 14, [24, 34, 42]);
  canvas.fillRect(width - 112, 13, spec.sceneIndex === 1 ? 66 : 88, 10, shiftedPalette.accent);

  // Bottom gameplay dialogue / telemetry strip
  const boxH = 54;
  const boxY = height - boxH - 12;
  canvas.fillRect(16, boxY, width - 32, boxH, [10, 14, 22], 0.86);
  canvas.strokeRect(16, boxY, width - 32, boxH, 2, shiftedPalette.accent, 0.9);
  const caption =
    spec.sceneIndex === 0
      ? `${spec.title.slice(0, 26)} - OPENING SECTOR`
      : spec.sceneIndex === 1
        ? `WARNING: SECTOR GUARDIAN APPROACHING`
        : `${spec.consoleLabel} - OVERWORLD TELEMETRY ACTIVE`;
  canvas.drawText(caption, 28, boxY + 12, 2, [240, 252, 244]);
  canvas.drawText('60FPS RGB240P · CRT CAPTURE', 28, boxY + 32, 2, shiftedPalette.highlight);

  canvas.applyScanlines(0.12);
  return canvas.toPngBuffer();
}

export function writePngFile(absPath: string, pngBytes: Buffer): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, pngBytes);
}
