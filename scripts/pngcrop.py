#!/usr/bin/env python3
"""Crop and nearest-neighbour zoom a PNG, with no third-party dependencies.

`sips` only crops from the centre and this machine has neither Pillow nor
ImageMagick, which makes "look closely at one 96px tile of a 1080x2400 device
screenshot" surprisingly hard. Verifying a launcher icon by eye is exactly that
task, so it is worth forty lines.

Handles 8-bit RGB and RGBA, which is what `adb exec-out screencap -p` produces.

    python3 scripts/pngcrop.py in.png out.png X Y W H [ZOOM]
"""
from __future__ import annotations

import struct
import sys
import zlib

CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}


def read_png(path: str) -> tuple[int, int, int, bytearray]:
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path}: not a PNG")

    pos = 8
    header = None
    idat = bytearray()
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
        pos += 12 + length

    if header is None:
        raise SystemExit(f"{path}: no IHDR")
    width, height, depth, colour, _, _, interlace = header
    if depth != 8 or interlace != 0 or colour not in CHANNELS:
        raise SystemExit(f"{path}: unsupported (depth={depth} colour={colour})")

    bpp = CHANNELS[colour]
    stride = width * bpp
    raw = zlib.decompress(bytes(idat))
    out = bytearray(height * stride)

    # Undo the per-scanline filters. Straight from the PNG spec; `prior` is the
    # already-reconstructed row above, which is why this cannot be vectorised
    # away without keeping the same order.
    for y in range(height):
        ftype = raw[y * (stride + 1)]
        line = raw[y * (stride + 1) + 1 : (y + 1) * (stride + 1)]
        base = y * stride
        prior = base - stride
        for x in range(stride):
            a = out[base + x - bpp] if x >= bpp else 0
            b = out[prior + x] if y > 0 else 0
            c = out[prior + x - bpp] if (y > 0 and x >= bpp) else 0
            v = line[x]
            if ftype == 1:
                v += a
            elif ftype == 2:
                v += b
            elif ftype == 3:
                v += (a + b) >> 1
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                v += a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            out[base + x] = v & 0xFF
    return width, height, bpp, out


def write_png(path: str, width: int, height: int, bpp: int, pixels: bytes) -> None:
    colour = {1: 0, 2: 4, 3: 2, 4: 6}[bpp]
    stride = width * bpp
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none. Simplicity over a few kilobytes.
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, colour, 0, 0, 0))
        )
        handle.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        handle.write(chunk(b"IEND", b""))


def main() -> None:
    if len(sys.argv) < 7:
        raise SystemExit(__doc__)
    src, dst = sys.argv[1], sys.argv[2]
    cx, cy, cw, ch = (int(v) for v in sys.argv[3:7])
    zoom = int(sys.argv[7]) if len(sys.argv) > 7 else 1

    width, height, bpp, pixels = read_png(src)
    cw = min(cw, width - cx)
    ch = min(ch, height - cy)

    out = bytearray(cw * zoom * ch * zoom * bpp)
    for y in range(ch * zoom):
        sy = cy + y // zoom
        for x in range(cw * zoom):
            sx = cx + x // zoom
            si = (sy * width + sx) * bpp
            di = (y * cw * zoom + x) * bpp
            out[di : di + bpp] = pixels[si : si + bpp]

    write_png(dst, cw * zoom, ch * zoom, bpp, bytes(out))
    print(f"{dst}: {cw}x{ch} from ({cx},{cy}) at {zoom}x")


if __name__ == "__main__":
    main()
