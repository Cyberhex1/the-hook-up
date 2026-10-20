"""AVM1 disassembler for DoInitAction/DoAction blocks. Usage: avm1dis.py file.swf ClassSubstring|--all"""
import sys, struct
sys.path.insert(0, __import__('os').path.dirname(__file__))
from swflib import load, skip_rect, walk, cstr

OPS = {0x04:'NextFrame',0x05:'PrevFrame',0x06:'Play',0x07:'Stop',0x08:'ToggleQuality',0x09:'StopSounds',
0x0A:'Add',0x0B:'Subtract',0x0C:'Multiply',0x0D:'Divide',0x0E:'Equals',0x0F:'Less',0x10:'And',0x11:'Or',0x12:'Not',
0x13:'StringEquals',0x14:'StringLength',0x15:'StringExtract',0x17:'Pop',0x18:'ToInteger',0x1C:'GetVariable',0x1D:'SetVariable',
0x20:'SetTarget2',0x21:'StringAdd',0x22:'GetProperty',0x23:'SetProperty',0x24:'CloneSprite',0x25:'RemoveSprite',0x26:'Trace',
0x27:'StartDrag',0x28:'EndDrag',0x29:'StringLess',0x2A:'Throw',0x2B:'CastOp',0x2C:'ImplementsOp',0x30:'RandomNumber',
0x31:'MBStringLength',0x32:'CharToAscii',0x33:'AsciiToChar',0x34:'GetTime',0x35:'MBStringExtract',0x36:'MBCharToAscii',
0x37:'MBAsciiToChar',0x3A:'Delete',0x3B:'Delete2',0x3C:'DefineLocal',0x3D:'CallFunction',0x3E:'Return',0x3F:'Modulo',
0x40:'NewObject',0x41:'DefineLocal2',0x42:'InitArray',0x43:'InitObject',0x44:'TypeOf',0x45:'TargetPath',0x46:'Enumerate',
0x47:'Add2',0x48:'Less2',0x49:'Equals2',0x4A:'ToNumber',0x4B:'ToString',0x4C:'PushDuplicate',0x4D:'StackSwap',
0x4E:'GetMember',0x4F:'SetMember',0x50:'Increment',0x51:'Decrement',0x52:'CallMethod',0x53:'NewMethod',0x54:'InstanceOf',
0x55:'Enumerate2',0x60:'BitAnd',0x61:'BitOr',0x62:'BitXor',0x63:'BitLShift',0x64:'BitRShift',0x65:'BitURShift',
0x66:'StrictEquals',0x67:'Greater',0x68:'StringGreater',0x69:'Extends',
0x81:'GotoFrame',0x83:'GetURL',0x87:'StoreRegister',0x88:'ConstantPool',0x8A:'WaitForFrame',0x8B:'SetTarget',
0x8C:'GoToLabel',0x8D:'WaitForFrame2',0x8E:'DefineFunction2',0x8F:'Try',0x94:'With',0x96:'Push',0x99:'Jump',
0x9A:'GetURL2',0x9B:'DefineFunction',0x9D:'If',0x9E:'Call',0x9F:'GotoFrame2'}

def dis(code, pool=None, indent=0, out=None, base=0):
    pool = pool if pool is not None else []
    out = out if out is not None else []
    i = 0; pad = '  '*indent
    while i < len(code):
        at = i; op = code[i]; i += 1
        if op == 0:
            out.append(f'{pad}{base+at:05x} End'); continue
        p = b''
        if op >= 0x80:
            ln = struct.unpack('<H', code[i:i+2])[0]; i += 2
            p = code[i:i+ln]; i += ln
        name = OPS.get(op, f'op{op:02x}')
        arg = ''
        if op == 0x88:
            n = struct.unpack('<H', p[:2])[0]; o = 2; pool.clear()
            for _ in range(n):
                s, o = cstr(p, o); pool.append(s)
            arg = f'({n} entries)'
        elif op == 0x96:
            vals = []; o = 0
            while o < len(p):
                t = p[o]; o += 1
                if t == 0: s, o = cstr(p, o); vals.append(repr(s))
                elif t == 1: vals.append(str(struct.unpack('<f', p[o:o+4])[0])); o += 4
                elif t == 2: vals.append('null')
                elif t == 3: vals.append('undefined')
                elif t == 4: vals.append(f'r{p[o]}'); o += 1
                elif t == 5: vals.append('true' if p[o] else 'false'); o += 1
                elif t == 6:
                    hi, lo = struct.unpack('<II', p[o:o+8]); o += 8
                    vals.append(repr(struct.unpack('<d', struct.pack('<II', lo, hi))[0]))
                elif t == 7: vals.append(str(struct.unpack('<i', p[o:o+4])[0])); o += 4
                elif t == 8: idx = p[o]; o += 1; vals.append(repr(pool[idx]) if idx < len(pool) else f'c{idx}')
                elif t == 9: idx = struct.unpack('<H', p[o:o+2])[0]; o += 2; vals.append(repr(pool[idx]) if idx < len(pool) else f'c{idx}')
            arg = ', '.join(vals)
        elif op in (0x99, 0x9D):
            off = struct.unpack('<h', p)[0]; arg = f'-> {base+i+off:05x}'
        elif op == 0x87: arg = f'r{p[0]}'
        elif op == 0x83:
            a, o = cstr(p, 0); t, _ = cstr(p, o); arg = f'{a!r} {t!r}'
        elif op == 0x8C: arg = repr(cstr(p, 0)[0])
        elif op == 0x81: arg = str(struct.unpack('<H', p)[0])
        elif op == 0x9A: arg = f'flags={p[0]}'
        elif op == 0x8E:
            fn, o = cstr(p, 0)
            nparams, nregs, flags = struct.unpack('<HBH', p[o:o+5]); o += 5
            params = []
            for _ in range(nparams):
                r = p[o]; o += 1; s, o = cstr(p, o); params.append(f'{s}@r{r}' if r else s)
            size = struct.unpack('<H', p[o:o+2])[0]
            out.append(f'{pad}{base+at:05x} function {fn or "<anon>"}({", ".join(params)}) regs={nregs} flags={flags:#x} {{')
            dis(code[i:i+size], pool, indent+1, out, base+i)
            out.append(f'{pad}}}')
            i += size; continue
        elif op == 0x9B:
            fn, o = cstr(p, 0); n = struct.unpack('<H', p[o:o+2])[0]; o += 2; params = []
            for _ in range(n): s, o = cstr(p, o); params.append(s)
            size = struct.unpack('<H', p[o:o+2])[0]
            out.append(f'{pad}{base+at:05x} function {fn or "<anon>"}({", ".join(params)}) {{')
            dis(code[i:i+size], pool, indent+1, out, base+i)
            out.append(f'{pad}}}')
            i += size; continue
        elif op == 0x8F:
            flags = p[0]; try_s, catch_s, fin_s = struct.unpack('<HHH', p[1:7])
            arg = f'try={try_s} catch={catch_s} finally={fin_s}'
        elif op == 0x94:
            arg = f'size={struct.unpack("<H", p)[0]}'
        out.append(f'{pad}{base+at:05x} {name} {arg}'.rstrip())
    return out

if __name__ == '__main__':
    ver, length, b = load(sys.argv[1])
    off = skip_rect(b, 0) + 4
    res = []; walk(b, off, len(b), 0, '', res)
    want = sys.argv[2]
    exports = {}
    for ctx, kind, data in res:
        if kind == 'Export':
            for e in data:
                cid, nm = e.split(':', 1); exports[cid] = nm
    for ctx, kind, data in res:
        if kind not in ('DoAction',) and not kind.startswith('DoInitAction'): continue
        label = kind
        if kind.startswith('DoInitAction'):
            cid = kind[len('DoInitAction(sprite'):-1]; label = exports.get(cid, kind)
        if want == '--all' or want in label or (want == '--doaction' and kind == 'DoAction'):
            print(f'######## {ctx or "/"} {label}')
            print('\n'.join(dis(data)))
