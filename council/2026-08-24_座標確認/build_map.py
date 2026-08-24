#!/usr/bin/env python3
"""ポイント座標の確認ページを生成する。

なぜ作るか:
  DIVE_POINTS の座標のうち 黒島北・シュガーヒル・クエフ北 は開発者の推定のまま。
  さらに Open-Meteo Marine は緯度1/12度(約9.3km x 8.3km)の格子に丸めるため、
  黒島北は基準地点「慶良間沖」と同じ格子に落ちて数値が常に完全一致しとる。
  ＝ 独立した情報になっとらん。

方針(2026-08-23 決定の案A):
  優くんに地図作業をさせず、こちらが作った図を見て「そこは違う」と言うてもらう。

海岸線: OpenStreetMap (ODbL)。Overpass で取得 → prep.py で間引き → stitch.py で環にする。
出力: index.html（1枚完結・外部通信なし。Artifact のCSPが外部ホストを塞ぐため）
"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
SHAPES = json.load(open(os.path.join(HERE, 'coast_shapes.json')))

# js/config.js と同じ値（写し間違いを防ぐため、変えるときは両方直すこと）
KERAMA = ('慶良間沖', 26.20, 127.31)
POINTS = [
    ('下曽根',         26.06,  127.24,  '久場島南・外洋',           False),
    ('ウチザン礁',     26.25,  127.40,  '前島〜渡嘉敷間',           False),
    ('黒島北',         26.24,  127.33,  'ツインロック',             True),
    ('トライアングル', 26.055, 127.575, '本島南・糸満沖',           False),
    ('粟国（筆ん崎）', 26.57,  127.21,  '遠征・ギンガメ',           False),
    ('渡名喜',         26.37,  127.14,  '遠征・慶良間北西',         False),
    ('シュガーヒル',   26.26,  127.57,  'チービシ・砂の丘',         True),
    ('クエフ北',       26.25,  127.59,  'チービシ・近場',           True),
]

GRID = 12.0  # 格子は 1/12 度刻み（APIが返す中心座標から実測）


def cell_of(lat, lon):
    """その座標が入る格子の範囲 (南, 北, 西, 東) を度で返す"""
    i, j = math.floor(lat * GRID), math.floor(lon * GRID)
    return i / GRID, (i + 1) / GRID, j / GRID, (j + 1) / GRID


def km(dlat, dlon, lat):
    return math.hypot(dlat * 111.32, dlon * 111.32 * math.cos(math.radians(lat)))


class Panel:
    """1枚の海図パネル。緯度経度 → SVG座標の変換を持つ"""

    def __init__(self, s, n, w, e, width=560):
        self.s, self.n, self.w, self.e = s, n, w, e
        self.k = math.cos(math.radians((s + n) / 2))     # 経度の縮み
        self.W = width
        self.H = round(width * (n - s) / ((e - w) * self.k))

    def x(self, lon):
        return (lon - self.w) * self.k / ((self.e - self.w) * self.k) * self.W

    def y(self, lat):
        return (self.n - lat) / (self.n - self.s) * self.H

    def path(self, ring):
        """視野の外は捨てる。1点でも枠内にあれば描く（海岸線が切れんように）"""
        if not any(self.w - .02 <= p[0] <= self.e + .02 and self.s - .02 <= p[1] <= self.n + .02
                   for p in ring):
            return None
        d = [f'M{self.x(ring[0][0]):.1f} {self.y(ring[0][1]):.1f}']
        d += [f'L{self.x(a):.1f} {self.y(b):.1f}' for a, b in ring[1:]]
        return ''.join(d)

    def land(self):
        out = []
        for ring in SHAPES['polys']:
            d = self.path(ring)
            if d:
                out.append(f'<path d="{d}Z" fill="var(--land)" stroke="var(--land-edge)" stroke-width="0.6"/>')
        for line in SHAPES['lines']:
            d = self.path(line)
            if d:
                out.append(f'<path d="{d}" fill="none" stroke="var(--land-edge)" stroke-width="0.8"/>')
        return '\n'.join(out)

    def graticule(self):
        """1/12度の経緯線。これは飾りやなく、データを取ってくる格子そのもの"""
        out = []
        i = math.ceil(self.s * GRID)
        while i / GRID <= self.n:
            y = self.y(i / GRID)
            out.append(f'<line x1="0" y1="{y:.1f}" x2="{self.W}" y2="{y:.1f}" '
                       f'stroke="var(--rule)" stroke-width="0.7"/>')
            i += 1
        j = math.ceil(self.w * GRID)
        while j / GRID <= self.e:
            x = self.x(j / GRID)
            out.append(f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{self.H}" '
                       f'stroke="var(--rule)" stroke-width="0.7"/>')
            j += 1
        return '\n'.join(out)

    def cell_box(self, lat, lon, flag=False):
        s, n, w, e = cell_of(lat, lon)
        col = 'var(--flag)' if flag else 'var(--ink-soft)'
        fill = 'var(--flag-fill)' if flag else 'none'
        return (f'<rect x="{self.x(w):.1f}" y="{self.y(n):.1f}" '
                f'width="{self.x(e) - self.x(w):.1f}" height="{self.y(s) - self.y(n):.1f}" '
                f'fill="{fill}" stroke="{col}" stroke-width="2" stroke-dasharray="6 4"/>')

    def pin(self, lat, lon, label, flag=False, base=False, dx=8, dy=-8, anchor='start'):
        x, y = self.x(lon), self.y(lat)
        col = 'var(--flag)' if flag else ('var(--base)' if base else 'var(--ink)')
        shape = (f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5.5" fill="{col}" '
                 f'stroke="var(--card)" stroke-width="2"/>')
        if base:  # 基準地点は四角で区別する（色だけに頼らん）
            shape = (f'<rect x="{x - 5:.1f}" y="{y - 5:.1f}" width="10" height="10" fill="{col}" '
                     f'stroke="var(--card)" stroke-width="2"/>')
        return (shape + f'<text x="{x + dx:.1f}" y="{y + dy:.1f}" text-anchor="{anchor}" '
                f'class="pin-label" fill="{col}">{label}</text>')

    def scalebar(self):
        """海図らしく実距離の目盛りを入れる。目測の助けになる"""
        for cand in (1, 2, 5, 10, 20):
            px = cand / (111.32 * self.k) / (self.e - self.w) * self.W
            if px > self.W * 0.16:
                break
        x0, y0 = 14, self.H - 16
        return (f'<line x1="{x0}" y1="{y0}" x2="{x0 + px:.1f}" y2="{y0}" '
                f'stroke="var(--ink)" stroke-width="2.5"/>'
                f'<line x1="{x0}" y1="{y0 - 4}" x2="{x0}" y2="{y0 + 4}" stroke="var(--ink)" stroke-width="2.5"/>'
                f'<line x1="{x0 + px:.1f}" y1="{y0 - 4}" x2="{x0 + px:.1f}" y2="{y0 + 4}" '
                f'stroke="var(--ink)" stroke-width="2.5"/>'
                f'<text x="{x0 + px / 2:.1f}" y="{y0 - 8}" text-anchor="middle" class="scale">{cand}km</text>')

    def svg(self, inner):
        return (f'<svg viewBox="0 0 {self.W} {self.H}" width="100%" '
                f'style="aspect-ratio:{self.W}/{self.H}" role="img">'
                f'<rect width="{self.W}" height="{self.H}" fill="var(--sea)"/>'
                f'{self.graticule()}{self.land()}{inner}{self.scalebar()}</svg>')


def overview():
    p = Panel(26.015, 26.625, 127.075, 127.70)
    g = [p.cell_box(*KERAMA[1:], flag=True), p.cell_box(26.24, 127.33, flag=True)]
    g.append(p.pin(KERAMA[1], KERAMA[2], '慶良間沖（基準）', base=True, dx=10, dy=14))
    # ラベルの逃がし方は個別に決める（自動配置やと隣同士でぶつかる。実際に
    # ウチザン礁とシュガーヒルが重なっとった）
    off = {'クエフ北': (10, 18, 'start'), 'シュガーヒル': (-9, -21, 'end')}
    for name, lat, lon, _note, unsure in POINTS:
        dx, dy, anc = off.get(name, (-9 if lon > 127.5 else 9, -9,
                                     'end' if lon > 127.5 else 'start'))
        g.append(p.pin(lat, lon, name, flag=unsure, dx=dx, dy=dy, anchor=anc))
    return p.svg(''.join(g))


def kuroshima():
    p = Panel(26.150, 26.268, 127.212, 127.352)
    s, n, w, e = cell_of(26.24, 127.33)
    g = [p.cell_box(26.24, 127.33, flag=True)]
    # 東の境界まであと何m か
    d = km(0, e - 127.33, 26.24) * 1000
    g.append(f'<line x1="{p.x(127.33):.1f}" y1="{p.y(26.24):.1f}" x2="{p.x(e):.1f}" y2="{p.y(26.24):.1f}" '
             f'stroke="var(--flag)" stroke-width="1.5" stroke-dasharray="3 3"/>')
    g.append(f'<text x="{(p.x(127.33) + p.x(e)) / 2:.1f}" y="{p.y(26.24) + 19:.1f}" text-anchor="middle" '
             f'class="pin-label" fill="var(--flag)">{d:.0f}m</text>')
    g.append(p.pin(KERAMA[1], KERAMA[2], '慶良間沖（基準）', base=True, dx=0, dy=20, anchor='middle'))
    g.append(p.pin(26.24, 127.33, '黒島北', flag=True, dx=-11, dy=-13, anchor='end'))
    return p.svg(''.join(g))


def chibishi():
    # 那覇の海岸線が入るまで東へ広げる。チービシの島は小さく、海だけでは方角が掴めん
    p = Panel(26.185, 26.345, 127.495, 127.705)
    g = [p.cell_box(26.26, 127.57), p.cell_box(26.25, 127.59)]
    g.append(p.pin(26.26, 127.57, 'シュガーヒル', flag=True, dx=-10, dy=-10, anchor='end'))
    g.append(p.pin(26.25, 127.59, 'クエフ北', flag=True, dx=10, dy=16))
    return p.svg(''.join(g))


TPL = '''<title>ポイントはこの位置で合っていますか</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
:root {{
  --paper:#F3EFE6; --card:#FCFAF5; --sea:#DBE9EC; --land:#E5D8BD; --land-edge:#A5946F;
  --ink:#13303A; --ink-soft:#516973; --rule:#AFC6CB; --base:#1F6B7D;
  --flag:#A81A6E; --flag-fill:rgba(168,26,110,.09); --edge:#D9D2C2;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --paper:#0D171B; --card:#152329; --sea:#12333C; --land:#3A3426; --land-edge:#6D6243;
    --ink:#E3ECEE; --ink-soft:#8CA6AE; --rule:#2A4852; --base:#5FBBD0;
    --flag:#F175BC; --flag-fill:rgba(241,117,188,.13); --edge:#25343A;
  }}
}}
:root[data-theme="dark"] {{
  --paper:#0D171B; --card:#152329; --sea:#12333C; --land:#3A3426; --land-edge:#6D6243;
  --ink:#E3ECEE; --ink-soft:#8CA6AE; --rule:#2A4852; --base:#5FBBD0;
  --flag:#F175BC; --flag-fill:rgba(241,117,188,.13); --edge:#25343A;
}}
* {{ box-sizing:border-box; }}
body {{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"Zen Kaku Gothic New",-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;
  font-size:17px; line-height:1.85; -webkit-text-size-adjust:100%;
}}
.wrap {{ max-width:600px; margin:0 auto; padding:28px 18px 64px; display:flex; flex-direction:column; gap:30px; }}
header {{ display:flex; flex-direction:column; gap:10px; }}
.eyebrow {{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--ink-soft);
}}
h1 {{ font-size:27px; line-height:1.4; font-weight:700; margin:0; text-wrap:balance; }}
h2 {{ font-size:19px; font-weight:700; margin:0; text-wrap:balance; }}
p {{ margin:0; }}
.lede {{ color:var(--ink-soft); }}
.card {{
  background:var(--card); border:1px solid var(--edge); border-radius:4px;
  padding:20px 18px; display:flex; flex-direction:column; gap:14px;
}}
.qtag {{
  font-family:"IBM Plex Mono",ui-monospace,monospace; font-weight:600; font-size:12px;
  letter-spacing:.1em; color:var(--flag); border:1px solid var(--flag); border-radius:2px;
  padding:2px 7px; align-self:flex-start;
}}
.qtag.calm {{ color:var(--ink-soft); border-color:var(--ink-soft); }}
figure {{ margin:0; display:flex; flex-direction:column; gap:8px; }}
svg {{ display:block; border:1px solid var(--edge); border-radius:3px; background:var(--sea); }}
.pin-label {{ font-family:"Zen Kaku Gothic New",sans-serif; font-size:13px; font-weight:700;
  paint-order:stroke; stroke:var(--card); stroke-width:3px; stroke-linejoin:round; }}
.scale {{ font-family:"IBM Plex Mono",monospace; font-size:11px; fill:var(--ink); }}
figcaption {{ font-size:14px; color:var(--ink-soft); line-height:1.7; }}
.ask {{
  font-weight:500; border-left:2px solid var(--flag); padding-left:13px; margin:0;
}}
.ask b {{ font-weight:700; }}
.legend {{ display:flex; flex-wrap:wrap; gap:8px 18px; font-size:14px; color:var(--ink-soft); }}
.legend span {{ display:flex; align-items:center; gap:7px; }}
.key {{ width:13px; height:13px; border-radius:50%; flex:none; }}
.key.sq {{ border-radius:2px; }}
.key.box {{ border-radius:0; background:none; border:2px dashed var(--flag); }}
.tablewrap {{ overflow-x:auto; }}
table {{ border-collapse:collapse; width:100%; font-size:14px; }}
th,td {{ text-align:left; padding:8px 10px; border-bottom:1px solid var(--edge); white-space:nowrap; }}
th {{ font-size:12px; letter-spacing:.08em; color:var(--ink-soft); font-weight:500; }}
td.num {{ font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; }}
tr.flag td {{ color:var(--flag); }}
.note {{
  border-left:3px solid var(--base); padding:2px 0 2px 15px;
  display:flex; flex-direction:column; gap:8px;
}}
footer {{ font-size:13px; color:var(--ink-soft); line-height:1.8; border-top:1px solid var(--edge); padding-top:18px; }}
a {{ color:var(--base); }}
a:focus-visible, [tabindex]:focus-visible {{ outline:2px solid var(--base); outline-offset:2px; }}
</style>

<div class="wrap">
  <header>
    <div class="eyebrow">Kerama / dive sites</div>
    <h1>ポイントはこの位置で<br>合っていますか</h1>
    <p class="lede">アプリが海況を取ってくる位置を、地図にしました。作った側の推定のままになっている場所が、基準地点をふくめて4か所あります。地図を見て「合っている / 違う」を教えてもらえれば直します。質問は4つ、2分ほどで終わります。</p>
  </header>

  <section class="card">
    <h2>全体図</h2>
    <figure>
      {overview}
      <figcaption>■＝アプリの基準地点（慶良間沖）／ ●＝ダイビングポイント。細い線は、海況データが区切られている升目です。1マスは約 9.3km × 8.3km あります。</figcaption>
    </figure>
    <div class="legend">
      <span><i class="key sq" style="background:var(--base)"></i>基準地点</span>
      <span><i class="key" style="background:var(--ink)"></i>位置は確認済み</span>
      <span><i class="key" style="background:var(--flag)"></i>位置が推定のまま</span>
      <span><i class="key box"></i>データを取る升目</span>
    </div>
  </section>

  <section class="card">
    <h2>慶良間沖（基準）と黒島北</h2>
    <figure>
      {kuroshima}
      <figcaption>この2つは同じ升目に入っています。そのため黒島北の波の数値は、いつも慶良間沖とまったく同じ値になります。升目の東の境目までは <b>約330m</b> です。</figcaption>
    </figure>
    <p>あわせて、基準地点（■）はいま <b>島の上</b> に置かれています。海況データは自動的に一番近い海の升目から取られるので数値は出ていますが、位置としては置き直したほうが良さそうです。</p>
    <p class="ask">Q1&nbsp;&nbsp;基準地点は、どのあたりが「慶良間のダイブエリア」の代表として妥当でしょうか。</p>
    <p class="ask">Q2&nbsp;&nbsp;黒島北は、この●の位置で合っていますか。違う場合は「もっと北」「もっと東」くらいで大丈夫です。</p>
  </section>

  <section class="card">
    <h2>チービシの2か所</h2>
    <figure>
      {chibishi}
      <figcaption>この2つは別々の升目に入っているので、数値はそれぞれ違う値が出ます。ただし位置そのものが推定なので、合っているかは確かめられていません。</figcaption>
    </figure>
    <p class="ask">Q3&nbsp;&nbsp;シュガーヒルは、この●の位置で合っていますか。</p>
    <p class="ask">Q4&nbsp;&nbsp;クエフ北は、この●の位置で合っていますか。</p>
  </section>

  <section class="card">
    <span class="qtag calm">参考</span>
    <h2>いま入っている座標</h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>ポイント</th><th>緯度</th><th>経度</th><th>位置</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <div class="note">
      <h2>船で聞ける機会があれば</h2>
      <p>船の運転台にあるGPS（プロッタ）に、ポイントが登録されていることがあります。もし船長に聞ける機会があれば、<b>画面をそのまま写真に撮って</b>送ってもらえると、地図を見るより確実です。</p>
      <p class="lede">数字を書き写すと桁を間違えやすいので（<code>26°14.4'</code> と <code>26.144</code> は別の場所で、10km以上ずれます）、写真のままで大丈夫です。急ぎではないので、海が落ち着いてからで構いません。</p>
    </div>
  </section>

  <footer>
    海岸線 © OpenStreetMap contributors（ODbL）。海況データの升目は Open-Meteo Marine の緯度1/12度グリッドを実測したものです。<br>
    このページは確認用です。出港・ダイビングの判断に使うものではありません。
  </footer>
</div>
'''


def rows():
    out = []
    for name, lat, lon, note, unsure in POINTS:
        cls = ' class="flag"' if unsure else ''
        mark = '推定' if unsure else '確認済み'
        out.append(f'<tr{cls}><td>{name}</td><td class="num">{lat}</td>'
                   f'<td class="num">{lon}</td><td>{note}／{mark}</td></tr>')
    out.append(f'<tr><td>{KERAMA[0]}（基準）</td><td class="num">{KERAMA[1]}</td>'
               f'<td class="num">{KERAMA[2]}</td><td>スコア計算の地点</td></tr>')
    return '\n'.join(out)


html = TPL.format(overview=overview(), kuroshima=kuroshima(), chibishi=chibishi(), rows=rows())
path = os.path.join(HERE, 'index.html')
open(path, 'w', encoding='utf-8').write(html)
print(f'{path} ({len(html) / 1024:.0f}KB)')
