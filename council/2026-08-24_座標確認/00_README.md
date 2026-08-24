# ポイント座標の確認（2026-08-24）

`js/config.js` の `DIVE_POINTS` と `LOCATIONS.kerama` の座標を、優くんに確認してもらうための
1枚ページ。**優くんに地図作業をさせず、こちらが作った図を見て「そこは違う」と言うてもらう**
方針（2026-08-23 決定の案A）。

`council/2026-07-19_三段階目標/20_優くん協力依頼_質問案.md` の末尾にある
「Googleマップでピンを立てて共有してもらう」は**この案に置き換わった古い記述**。

## 作り直しかた

```bash
# 1. 海岸線を取り直す（普段は不要。coast_shapes.json を再利用すればええ）
curl -s -X POST --data-binary @q.overpass https://overpass-api.de/api/interpreter -o coast.json
python3 prep.py     # Douglas-Peucker で間引き（約17m）→ coast_detail.json
python3 stitch.py   # 開いた海岸線を環に綴じて塗れるようにする → coast_shapes.json

# 2. ページを生成する（座標を変えたらこれだけでええ）
python3 build_map.py   # → index.html
```

`index.html` は Artifact として公開する前提で、**外部通信を一切せん**ように作っとる
（Artifact の CSP が外部ホストを塞ぐため、海岸線は全部ファイルの中に埋め込み済み。
Google Fonts だけは CSP が許しとる例外）。

座標は `js/config.js` からの**手写し**なので、config を変えたら `build_map.py` の
`KERAMA` / `POINTS` も直すこと。

## データの出どころ

- 海岸線: **© OpenStreetMap contributors**（[ODbL](https://opendatacommons.org/licenses/odbl/)）。
  Overpass API で `natural=coastline` を取得
- 格子: Open-Meteo Marine が返す中心座標から実測（緯度1/12度）
