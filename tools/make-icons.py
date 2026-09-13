import zlib, struct, os

# ---------- decode ----------
def read_png(path):
    d = open(path, 'rb').read()
    i, idat = 8, []
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]; t = d[i+4:i+8]
        if t == b'IHDR':
            w, h, bd, ct, _, _, il = struct.unpack('>IIBBBBB', d[i+8:i+21])
            assert bd == 8 and ct == 6 and il == 0, "expect 8-bit RGBA, non-interlaced"
        elif t == b'IDAT': idat.append(d[i+8:i+8+ln])
        elif t == b'IEND': break
        i += 12 + ln
    raw = zlib.decompress(b''.join(idat))
    bpp, stride = 4, w * 4
    out = bytearray(h * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if f == 1:
            for x in range(bpp, stride): line[x] = (line[x] + line[x-bpp]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0
                c = prev[x-bpp] if x >= bpp else 0
                b = prev[x]
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, out

def write_png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(px[y*w*4:(y+1)*w*4]) for y in range(h))
    def ch(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n'
        + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))

W, H, PX = read_png('icons/source-artwork.png')
def at(x, y):
    i = (y*W + x)*4
    return (PX[i], PX[i+1], PX[i+2])
BG = at(8, 8)
print('source', W, 'x', H, 'background', BG)

# ---------- crop square around the subject ----------
def crop(cx, cy, size):
    half = size // 2
    out = bytearray(size*size*4)
    for y in range(size):
        sy = cy - half + y
        for x in range(size):
            sx = cx - half + x
            if 0 <= sx < W and 0 <= sy < H:
                i = (sy*W + sx)*4
                j = (y*size + x)*4
                out[j] = PX[i]; out[j+1] = PX[i+1]; out[j+2] = PX[i+2]; out[j+3] = 255
            else:
                j = (y*size + x)*4
                out[j] = BG[0]; out[j+1] = BG[1]; out[j+2] = BG[2]; out[j+3] = 255
    return out, size

# box downsample
def resize(src, s, dst):
    out = bytearray(dst*dst*4)
    scale = s / dst
    for y in range(dst):
        y0, y1 = int(y*scale), max(int((y+1)*scale), int(y*scale)+1)
        for x in range(dst):
            x0, x1 = int(x*scale), max(int((x+1)*scale), int(x*scale)+1)
            r = g = b = n = 0
            for yy in range(y0, min(y1, s)):
                base = yy*s*4
                for xx in range(x0, min(x1, s)):
                    i = base + xx*4
                    r += src[i]; g += src[i+1]; b += src[i+2]; n += 1
            j = (y*dst + x)*4
            out[j] = r//n; out[j+1] = g//n; out[j+2] = b//n; out[j+3] = 255
    return out

# 犬の中心はほぼ画像中心。通常アイコンは寄せ気味、maskable は余白多め。
CX, CY = 560, 1030
tight, ts = crop(CX, CY, 880)    # any
wide,  ws = crop(CX, CY, 1140)   # maskable (安全域 80% に収まるよう余白を足す)

for s in (512, 192, 180, 32):
    write_png('icons/icon-%d.png' % s, s, s, resize(tight, ts, s))
    print('icons/icon-%d.png' % s, os.path.getsize('icons/icon-%d.png' % s))
write_png('icons/icon-maskable-512.png', 512, 512, resize(wide, ws, 512))
print('icons/icon-maskable-512.png', os.path.getsize('icons/icon-maskable-512.png'))
print('BGHEX #%02X%02X%02X' % BG)
