import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))

def dp(pts, tol):
    """Douglas-Peucker。外部ライブラリ無しで書く（この環境にshapely等は無い）"""
    if len(pts) < 3: return pts
    keep = [False]*len(pts); keep[0]=keep[-1]=True
    stack=[(0,len(pts)-1)]
    while stack:
        i,j = stack.pop()
        if j <= i+1: continue
        x1,y1 = pts[i]; x2,y2 = pts[j]
        dx,dy = x2-x1, y2-y1
        den = math.hypot(dx,dy)
        best=-1.0; bi=-1
        for k in range(i+1, j):
            x0,y0 = pts[k]
            d = abs(dy*x0 - dx*y0 + x2*y1 - y2*x1)/den if den else math.hypot(x0-x1,y0-y1)
            if d > best: best, bi = d, k
        if best > tol:
            keep[bi]=True; stack.append((i,bi)); stack.append((bi,j))
    return [p for p,k in zip(pts,keep) if k]

d = json.load(open(os.path.join(HERE, 'coast.json')))
ways = [e['geometry'] for e in d.get('elements',[]) if e.get('type')=='way' and e.get('geometry')]
raw  = [[(g['lon'], g['lat']) for g in w] for w in ways]
print('元:', sum(len(w) for w in raw), '点 /', len(raw), '本')

# 許容誤差 0.00015度 ≒ 17m。地図はスマホ幅で見るため、これ以上細かくしても見えん
TOL = 0.00015
simp = [dp(w, TOL) for w in raw]
simp = [w for w in simp if len(w) >= 2]
out = [[[round(x,5), round(y,5)] for x,y in w] for w in simp]
s = json.dumps(out, separators=(',',':'))
open(os.path.join(HERE, 'coast_detail.json'), 'w').write(s)
print(f'間引き後(tol={TOL}): {sum(len(w) for w in simp)}点 / {len(simp)}本 / {len(s)/1024:.0f}KB')
