/**
 * Just enough of the TrueType format to read metrics out of the bundled fonts.
 *
 * Tests assert against the .ttf files themselves rather than against numbers
 * copied into a comment, because a regenerated icon font or a swapped face
 * moves those numbers without touching any source a reviewer would read.
 * No dependency: the tables needed here are fixed-offset big-endian records
 * (https://learn.microsoft.com/en-us/typography/opentype/spec/otff).
 */

/** Byte offset of a table in the font, from the table directory. */
export function tableOffset(font: Buffer, tag: string): number {
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (font.toString('ascii', rec, rec + 4) === tag) {
      return font.readUInt32BE(rec + 8);
    }
  }
  return -1;
}

/**
 * The TTF's Unicode cmap, as a codepoint -> glyph index lookup.
 *
 * Format 4 only, because that is what svg2ttf (under fantasticon) writes for a
 * BMP Private-Use font, and failing on anything else is better than a lookup
 * that quietly returns 0 for every codepoint.
 */
export function cmapOf(font: Buffer): (code: number) => number {
  const cmap = tableOffset(font, 'cmap');
  expect(cmap).toBeGreaterThan(0);
  let sub = -1;
  const count = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < count; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = font.readUInt16BE(rec);
    const encoding = font.readUInt16BE(rec + 2);
    if (platform === 3 && encoding === 1) {
      sub = cmap + font.readUInt32BE(rec + 4);
    }
  }
  expect(sub).toBeGreaterThan(0);
  expect(font.readUInt16BE(sub)).toBe(4);
  // idDelta arithmetic is modulo 65536 by the spec; `%` rather than `& 0xffff`
  // because the lint config bans bitwise operators.
  const wrap16 = (n: number): number => ((n % 0x10000) + 0x10000) % 0x10000;
  const segX2 = font.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return code => {
    for (let i = 0; i < segX2 / 2; i++) {
      const end = font.readUInt16BE(ends + i * 2);
      const start = font.readUInt16BE(starts + i * 2);
      if (code < start || code > end) {
        continue;
      }
      const delta = font.readInt16BE(deltas + i * 2);
      const range = font.readUInt16BE(ranges + i * 2);
      if (range === 0) {
        return wrap16(code + delta);
      }
      const g = font.readUInt16BE(ranges + i * 2 + range + (code - start) * 2);
      return g === 0 ? 0 : wrap16(g + delta);
    }
    return 0;
  };
}

/** `head.unitsPerEm`. */
export function unitsPerEm(font: Buffer): number {
  return font.readUInt16BE(tableOffset(font, 'head') + 18);
}

/** `OS/2.sCapHeight`, in font units (OS/2 version 2 and later). */
export function capHeight(font: Buffer): number {
  const os2 = tableOffset(font, 'OS/2');
  expect(os2).toBeGreaterThan(0);
  expect(font.readUInt16BE(os2)).toBeGreaterThanOrEqual(2);
  return font.readInt16BE(os2 + 88);
}

/** Whether bit `bit` of a flag byte is set, without a bitwise operator (lint). */
const hasBit = (flags: number, bit: number): boolean =>
  Math.floor(flags / 2 ** bit) % 2 === 1;

/**
 * A simple glyph's ink box in font units, relative to the baseline (y = 0),
 * computed from its OUTLINE POINTS rather than read from the `glyf` header.
 *
 * The header is not trustworthy in the fonts this repo generates: svg2ttf
 * (under fantasticon) writes `seal-check-fill` with a header box of 0,0..948,948
 * while its outline actually spans 52..948 (fontTools agrees with the points).
 * TrueType outlines are quadratic, so the curve never leaves the hull of its
 * points: the min/max over every on- and off-curve point is the box the
 * rasteriser can ink, and for Phosphor's shapes it is exact.
 * https://learn.microsoft.com/en-us/typography/opentype/spec/glyf
 */
export function glyphBounds(
  font: Buffer,
  glyph: number,
): { xMin: number; yMin: number; xMax: number; yMax: number } {
  const head = tableOffset(font, 'head');
  const longLoca = font.readInt16BE(head + 50) === 1;
  const loca = tableOffset(font, 'loca');
  const glyf = tableOffset(font, 'glyf');
  expect(loca).toBeGreaterThan(0);
  expect(glyf).toBeGreaterThan(0);
  const at = longLoca
    ? font.readUInt32BE(loca + glyph * 4)
    : font.readUInt16BE(loca + glyph * 2) * 2;
  let pos = glyf + at;
  const contours = font.readInt16BE(pos);
  // Composite glyphs (negative contour count) are not needed by any test yet.
  expect(contours).toBeGreaterThan(0);
  pos += 10;
  const lastPoint = font.readUInt16BE(pos + (contours - 1) * 2);
  pos += contours * 2;
  const points = lastPoint + 1;
  pos += 2 + font.readUInt16BE(pos); // instructions

  const flags: number[] = [];
  while (flags.length < points) {
    const flag = font.readUInt8(pos++);
    flags.push(flag);
    if (hasBit(flag, 3)) {
      const repeat = font.readUInt8(pos++);
      for (let r = 0; r < repeat; r++) {
        flags.push(flag);
      }
    }
  }

  // X_SHORT is bit 1 / sign-or-same bit 4; Y_SHORT bit 2 / bit 5.
  const readAxis = (shortBit: number, sameBit: number): number[] => {
    const out: number[] = [];
    let v = 0;
    for (const flag of flags) {
      if (hasBit(flag, shortBit)) {
        const d = font.readUInt8(pos++);
        v += hasBit(flag, sameBit) ? d : -d;
      } else if (!hasBit(flag, sameBit)) {
        v += font.readInt16BE(pos);
        pos += 2;
      }
      out.push(v);
    }
    return out;
  };
  const xs = readAxis(1, 4);
  const ys = readAxis(2, 5);
  return {
    xMin: Math.min(...xs),
    yMin: Math.min(...ys),
    xMax: Math.max(...xs),
    yMax: Math.max(...ys),
  };
}
