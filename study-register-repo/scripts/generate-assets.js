#!/usr/bin/env node
'use strict';

/*
 * Generates the Study Register app icon and macOS menu bar template icon
 * without any image dependencies. Run with: npm run icons
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const ICON_DIR = path.join(ROOT, 'src', 'assets', 'icons');

/* ---------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* --------------------------------- shapes -------------------------------- */

function sdRoundedRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function cov(sdf) {
  return Math.max(0, Math.min(1, 0.5 - sdf));
}

function inArc(x, y, cx, cy, startDeg, sweepDeg) {
  let angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  let offset = ((angle - startDeg) % 360 + 360) % 360;
  return offset <= sweepDeg;
}

function blend(px, i, r, g, b, a) {
  if (a <= 0) return;
  const da = px[i + 3] / 255;
  const out = a + da * (1 - a);
  if (out <= 0) return;
  px[i] = Math.round((r * a + px[i] * da * (1 - a)) / out);
  px[i + 1] = Math.round((g * a + px[i + 1] * da * (1 - a)) / out);
  px[i + 2] = Math.round((b * a + px[i + 2] * da * (1 - a)) / out);
  px[i + 3] = Math.round(out * 255);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(colorA, colorB, t) {
  return [
    Math.round(lerp(colorA[0], colorB[0], t)),
    Math.round(lerp(colorA[1], colorB[1], t)),
    Math.round(lerp(colorA[2], colorB[2], t))
  ];
}

/* -------------------------------- app icon ------------------------------- */

function drawAppIcon() {
  const size = 1024;
  const px = new Uint8ClampedArray(size * size * 4);
  const accentTop = [169, 186, 255];
  const accentBottom = [95, 125, 240];
  const white = [245, 245, 247];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;

      // Rounded tile with vertical charcoal gradient.
      const tile = cov(sdRoundedRect(x, y, 512, 512, 440, 440, 208));
      if (tile > 0) {
        const t = Math.max(0, Math.min(1, (y - 72) / 880));
        const base = mix([32, 36, 50], [11, 12, 16], t);
        const glowDist = Math.hypot(x - 760, y - 250) / 520;
        const glow = Math.pow(Math.max(0, 1 - glowDist), 2.4) * 0.3;
        blend(px, i, Math.min(255, base[0] + 124 * glow), Math.min(255, base[1] + 156 * glow), Math.min(255, base[2] + 255 * glow), tile);
      }

      // Hairline inner edge.
      const innerEdge = cov(sdRoundedRect(x, y, 512, 512, 431, 431, 199)) *
        (1 - cov(sdRoundedRect(x, y, 512, 512, 428, 428, 197)));
      if (innerEdge > 0) blend(px, i, 255, 255, 255, innerEdge * 0.1);

      // Base ring.
      const ring = cov(Math.abs(sdCircle(x, y, 512, 500, 258)) - 22);
      if (ring > 0) {
        const color = mix(accentTop, accentBottom, Math.max(0, Math.min(1, (y - 260) / 500)));
        blend(px, i, color[0], color[1], color[2], ring * 0.2);
      }

      // 270° progress arc with rounded caps.
      const arcRing = cov(Math.abs(sdCircle(x, y, 512, 500, 258)) - 22);
      if (arcRing > 0 && inArc(x, y, 512, 500, -90, 270)) {
        const color = mix(accentTop, accentBottom, Math.max(0, Math.min(1, (y - 260) / 500)));
        blend(px, i, color[0], color[1], color[2], arcRing);
      }
      const capStart = cov(sdCircle(x, y, 512, 242, 22));
      const capEnd = cov(sdCircle(x, y, 254, 500, 22));
      if (capStart > 0) blend(px, i, accentTop[0], accentTop[1], accentTop[2], capStart);
      if (capEnd > 0) blend(px, i, accentBottom[0], accentBottom[1], accentBottom[2], capEnd);

      // Clock hands.
      const hourHand = cov(sdSegment(x, y, 512, 500, 512, 360) - 11);
      const minuteHand = cov(sdSegment(x, y, 512, 500, 660, 500) - 8);
      if (hourHand > 0) blend(px, i, white[0], white[1], white[2], hourHand);
      if (minuteHand > 0) blend(px, i, white[0], white[1], white[2], minuteHand);

      // Center pin.
      const pin = cov(sdCircle(x, y, 512, 500, 25));
      if (pin > 0) blend(px, i, 17, 18, 22, pin);
      const pinInner = cov(sdCircle(x, y, 512, 500, 13));
      if (pinInner > 0) blend(px, i, accentTop[0], accentTop[1], accentTop[2], pinInner);

      // Completion dot.
      const dotGlow = Math.pow(Math.max(0, 1 - Math.hypot(x - 792, y - 792) / 150), 2) * 0.35;
      if (dotGlow > 0) blend(px, i, 53, 201, 139, dotGlow * 0.5);
      const dot = cov(sdCircle(x, y, 792, 792, 66));
      if (dot > 0) blend(px, i, 24, 26, 32, dot);
      const dotInner = cov(sdCircle(x, y, 792, 792, 50));
      if (dotInner > 0) blend(px, i, 53, 201, 139, dotInner);
      const tick = cov(sdSegment(x, y, 766, 792, 786, 812) - 9);
      const tick2 = cov(sdSegment(x, y, 786, 812, 822, 770) - 9);
      if (tick > 0) blend(px, i, 255, 255, 255, tick);
      if (tick2 > 0) blend(px, i, 255, 255, 255, tick2);
    }
  }
  return { size, px };
}

/* -------------------------------- tray icon ------------------------------ */

function drawTrayMaster() {
  const scale = 8;
  const size = 22 * scale;
  const px = new Uint8ClampedArray(size * size * 4);
  const c = 11 * scale;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      let alpha = 0;
      const ring = cov(Math.abs(sdCircle(x, y, c, 11 * scale, 7.6 * scale)) - 0.95 * scale);
      alpha = Math.max(alpha, ring);
      const hour = cov(sdSegment(x, y, c, 11 * scale, c, 6.1 * scale) - 0.85 * scale);
      const minute = cov(sdSegment(x, y, c, 11 * scale, 15.2 * scale, 11 * scale) - 0.75 * scale);
      alpha = Math.max(alpha, hour, minute);
      const pin = cov(sdCircle(x, y, c, 11 * scale, 1.15 * scale));
      alpha = Math.max(alpha, pin);
      px[i] = 0;
      px[i + 1] = 0;
      px[i + 2] = 0;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return { size, px, scale };
}

function downsample(src, srcSize, factor) {
  const outSize = Math.round(srcSize / factor);
  const out = new Uint8ClampedArray(outSize * outSize * 4);
  for (let y = 0; y < outSize; y += 1) {
    for (let x = 0; x < outSize; x += 1) {
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let oy = 0; oy < factor; oy += 1) {
        for (let ox = 0; ox < factor; ox += 1) {
          const sx = x * factor + ox;
          const sy = y * factor + oy;
          if (sx >= srcSize || sy >= srcSize) continue;
          const i = (sy * srcSize + sx) * 4;
          const alpha = src[i + 3] / 255;
          a += alpha;
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          count += 1;
        }
      }
      const oi = (y * outSize + x) * 4;
      const alphaAvg = a / count;
      out[oi + 3] = Math.round(alphaAvg * 255);
      if (a > 0) {
        out[oi] = Math.round(r / a);
        out[oi + 1] = Math.round(g / a);
        out[oi + 2] = Math.round(b / a);
      }
    }
  }
  return { size: outSize, px: out };
}

/* ---------------------------------- main --------------------------------- */

function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(ICON_DIR, { recursive: true });

  const appIcon = drawAppIcon();
  const appPng = encodePng(appIcon.size, appIcon.size, appIcon.px);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), appPng);
  fs.writeFileSync(path.join(ICON_DIR, 'appIcon.png'), appPng);

  const iconset = path.join(BUILD_DIR, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ];
  sizes.forEach(([dimension, name]) => {
    execFileSync('sips', ['-z', String(dimension), String(dimension), path.join(BUILD_DIR, 'icon.png'), '--out', path.join(iconset, name)], { stdio: 'ignore' });
  });
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD_DIR, 'icon.icns')], { stdio: 'ignore' });
  fs.rmSync(iconset, { recursive: true, force: true });

  const trayMaster = drawTrayMaster();
  const tray44 = downsample(trayMaster.px, trayMaster.size, trayMaster.scale / 2);
  const tray22 = downsample(trayMaster.px, trayMaster.size, trayMaster.scale);
  fs.writeFileSync(path.join(ICON_DIR, 'trayTemplate.png'), encodePng(22, 22, tray22.px));
  fs.writeFileSync(path.join(ICON_DIR, 'trayTemplate@2x.png'), encodePng(44, 44, tray44.px));

  console.log('Generated build/icon.png, build/icon.icns and tray template icons.');
}

main();
