"""Minimal SWF (AVM1) parser used by the build checks.

    python -I tools/swflib.py file.swf   # list tags + action string pools
"""
import sys, zlib, struct, os, json

TAGS = {0:'End',1:'ShowFrame',2:'DefineShape',9:'SetBackgroundColor',12:'DoAction',26:'PlaceObject2',
        39:'DefineSprite',43:'FrameLabel',56:'ExportAssets',57:'ImportAssets',59:'DoInitAction',
        14:'DefineSound',15:'StartSound',18:'SoundStreamHead',19:'SoundStreamBlock',
        37:'DefineEditText',34:'DefineButton2',7:'DefineButton',24:'Protect',58:'EnableDebugger',
        64:'EnableDebugger2',65:'ScriptLimits',69:'FileAttributes',77:'Metadata',48:'DefineFont2',
        36:'DefineBitsLossless2',21:'DefineBitsJPEG2',35:'DefineBitsJPEG3',20:'DefineBitsLossless',
        10:'DefineFont',11:'DefineText',13:'DefineFontInfo',33:'DefineText2',8:'JPEGTables',6:'DefineBits',
        28:'RemoveObject2',62:'DefineFontInfo2',88:'DefineFontName',73:'DefineFontAlignZones',74:'CSMTextSettings',
        86:'DefineSceneAndFrameLabelData',60:'DefineVideoStream',46:'DefineMorphShape',22:'DefineShape2',32:'DefineShape3',83:'DefineShape4'}

def load(path):
    d = open(path,'rb').read()
    sig, ver, length = d[:3], d[3], struct.unpack('<I', d[4:8])[0]
    body = zlib.decompress(d[8:]) if sig == b'CWS' else d[8:]
    return ver, length, body

def skip_rect(b, off):
    nbits = b[off] >> 3
    total = 5 + 4*nbits
    return off + (total + 7)//8

def iter_tags(b, off, end):
    while off < end:
        code_len = struct.unpack('<H', b[off:off+2])[0]; off += 2
        code, ln = code_len >> 6, code_len & 0x3f
        if ln == 0x3f:
            ln = struct.unpack('<I', b[off:off+4])[0]; off += 4
        yield code, b[off:off+ln], off
        off += ln
        if code == 0: break

def cstr(b, off):
    e = b.index(b'\0', off)
    return b[off:e].decode('latin-1'), e+1

def actions(code):
    """yield (opcode, payload)"""
    i = 0
    while i < len(code):
        op = code[i]; i += 1
        if op == 0: yield 0, b''; continue
        if op >= 0x80:
            ln = struct.unpack('<H', code[i:i+2])[0]; i += 2
            yield op, code[i:i+ln]; i += ln
        else:
            yield op, b''

def pool_strings(code):
    out = []
    for op, p in actions(code):
        if op == 0x88:  # ConstantPool
            n = struct.unpack('<H', p[:2])[0]; o = 2
            for _ in range(n):
                s, o = cstr(p, o); out.append(s)
        elif op == 0x83:  # GetURL
            a, o = cstr(p, 0); t, _ = cstr(p, o); out.append(f'GETURL[{a}|{t}]')
        elif op == 0x96:  # Push
            o = 0
            while o < len(p):
                t = p[o]; o += 1
                if t == 0:
                    s, o = cstr(p, o); out.append(s)
                elif t == 1: o += 4
                elif t in (2,3): pass
                elif t == 4: o += 1
                elif t == 5: o += 1
                elif t == 6: o += 8
                elif t == 7: o += 4
                elif t == 8: o += 1
                elif t == 9: o += 2
                else: break
    return out

def walk(b, off, end, depth, ctx, results):
    for code, data, at in iter_tags(b, off, end):
        name = TAGS.get(code, str(code))
        if code == 39:
            sid = struct.unpack('<H', data[:2])[0]
            walk(data, 4, len(data), depth+1, f'{ctx}/sprite{sid}', results)
        elif code == 12:
            results.append((ctx, 'DoAction', data))
        elif code == 59:
            sid = struct.unpack('<H', data[:2])[0]
            results.append((ctx, f'DoInitAction(sprite{sid})', data[2:]))
        elif code == 56:
            n = struct.unpack('<H', data[:2])[0]; o = 2; names = []
            for _ in range(n):
                cid = struct.unpack('<H', data[o:o+2])[0]; o += 2
                s, o = cstr(data, o); names.append(f'{cid}:{s}')
            results.append((ctx, 'Export', names))
        elif code == 57:
            url, o = cstr(data, 0)
            results.append((ctx, 'Import', url))
        elif code == 43:
            results.append((ctx, 'FrameLabel', cstr(data,0)[0]))

if __name__ == '__main__':
    path = sys.argv[1]
    ver, length, b = load(path)
    off = skip_rect(b, 0) + 4
    counts = {}
    for code, data, at in iter_tags(b, off, len(b)):
        counts[TAGS.get(code, str(code))] = counts.get(TAGS.get(code, str(code)), 0) + 1
    print(f'# {os.path.basename(path)} ver={ver} len={length} toplevel tags={counts}')
    res = []
    walk(b, off, len(b), 0, '', res)
    mode = sys.argv[2] if len(sys.argv) > 2 else 'strings'
    for ctx, kind, data in res:
        if kind in ('Export','Import','FrameLabel'):
            print(ctx or '/', kind, data)
        elif mode == 'strings':
            print(f'== {ctx or "/"} {kind} ({len(data)} bytes)')
            print('   ', pool_strings(data))

def button_actions(data):
    """DefineButton2: yields action blocks"""
    o = 3  # id(2) + flags(1)
    act_off = struct.unpack('<H', data[o:o+2])[0]
    if act_off == 0: return []
    o = o + act_off; out = []
    while True:
        size, cond = struct.unpack('<HH', data[o:o+4])
        end = o + size if size else len(data)
        out.append((cond, data[o+4:end]))
        if size == 0: break
        o = end
    return out
