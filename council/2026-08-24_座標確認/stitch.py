import json, os
SP = os.path.dirname(os.path.abspath(__file__))
ways=[[tuple(p) for p in l] for l in json.load(open(SP+'/coast_detail.json'))]

closed=[w for w in ways if w[0]==w[-1]]
open_=[w for w in ways if w[0]!=w[-1]]

# 端点が一致する open way をつないで環にする（OSMの海岸線は本島などが分割されとる）
from collections import defaultdict
ends=defaultdict(list)
for i,w in enumerate(open_): ends[w[0]].append(i); ends[w[-1]].append(i)
used=[False]*len(open_)
rings=[]; lines=[]
for i in range(len(open_)):
    if used[i]: continue
    used[i]=True; chain=list(open_[i])
    grew=True
    while grew:
        grew=False
        for j in ends.get(chain[-1],[]):
            if used[j]: continue
            w=open_[j]
            if   w[0]==chain[-1]: chain+=w[1:];               used[j]=True; grew=True; break
            elif w[-1]==chain[-1]: chain+=list(reversed(w))[1:]; used[j]=True; grew=True; break
        if chain[0]==chain[-1]: break
    (rings if chain[0]==chain[-1] and len(chain)>3 else lines).append(chain)

print(f'閉way {len(closed)} / つないでできた環 {len(rings)} / 環にならんかった線 {len(lines)}')
polys=[[list(p) for p in w] for w in closed+rings]
strokes=[[list(p) for p in w] for w in lines]
json.dump({'polys':polys,'lines':strokes}, open(SP+'/coast_shapes.json','w'), separators=(',',':'))
print('塗れる島:', len(polys), '/ 線のまま:', len(strokes))
import os; print(f"{os.path.getsize(SP+'/coast_shapes.json')/1024:.0f}KB")
