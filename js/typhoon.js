// 気象庁 台風情報の取得・解析（ブラウザ・Node共用の純粋ロジック＋取得）
//
// 沖縄では台風が年に何度も来る。船の係留・お客様への連絡・避難のタイミングは
// 「波が高い」ではなく「台風がいつどこに来るか」で決まるため、波高経由の
// 間接的な影響だけでなく台風そのものを扱う。
//
// データ源（いずれも無料・登録不要・CORS許可済み。2026-08-23 に実測確認）
//   一覧   https://www.jma.go.jp/bosai/typhoon/data/targetTc.json          (約0.4KB)
//   個別   https://www.jma.go.jp/bosai/typhoon/data/<ID>/specifications.json (約1KB)
//   確率   気象庁XMLフィードの VPTA5x                     (生1.8MB / gzip後 約56KB)
//
// 確率XMLだけ重いので、台風が PROBABILITY_FETCH_KM 以内に来たときだけ取りに行く。

// 慶良間の代表座標（config.js の LOCATIONS.kerama と同じ）
export const KERAMA = { lat: 26.20, lon: 127.31 };

// 気象庁の細分区域コード。「慶良間・粟国諸島」がそのまま存在する（自前で距離を測らんでよい）
export const KERAMA_AREA_CODE = '471013';

const TARGET_URL   = 'https://www.jma.go.jp/bosai/typhoon/data/targetTc.json';
const SPEC_URL     = id => `https://www.jma.go.jp/bosai/typhoon/data/${id}/specifications.json`;
const XML_FEED_URL = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';

const FETCH_TIMEOUT_MS = 10 * 1000;
// これより遠い台風の確率XMLは取りに行かん（1本56KBを無駄に落とさんため）
const PROBABILITY_FETCH_KM = 1500;

function timeoutSignal() { try { return AbortSignal.timeout?.(FETCH_TIMEOUT_MS); } catch { return undefined; } }

// 2点間の大円距離（km）
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function firstRangeKm(list) {
  // stormWarning/galeWarning は方位ごとに複数入ることがある。最大半径を採る（安全側）
  if (!Array.isArray(list) || !list.length) return null;
  const kms = list.map(x => x?.range?.km).filter(v => Number.isFinite(v));
  return kms.length ? Math.max(...kms) : null;
}

// specifications.json の1ブロック（実況 or 予報）を正規化
function normalizeBlock(b) {
  const deg = b?.position?.deg;
  if (!Array.isArray(deg) || deg.length < 2) return null;
  const [lat, lon] = deg.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const stormKm = firstRangeKm(b.stormWarning);
  const km = distanceKm(KERAMA.lat, KERAMA.lon, lat, lon);

  return {
    // advancedHours は実況が0、予報が12/24/48/72/96/120。日本語ラベルを解析するより確実
    hours:      Number.isFinite(b.advancedHours) ? b.advancedHours : null,
    isAnalysis: b.advancedHours === 0,
    lat, lon,
    distanceKm:   Math.round(km),
    pressure:     b.pressure != null ? Number(b.pressure) : null,
    windMs:       b.maximumWind?.sustained?.['m/s'] != null ? Number(b.maximumWind.sustained['m/s']) : null,
    gustMs:       b.maximumWind?.gust?.['m/s']      != null ? Number(b.maximumWind.gust['m/s'])      : null,
    stormRadiusKm: stormKm,
    galeRadiusKm:  firstRangeKm(b.galeWarning),
    // 予報位置のばらつき。地図に描かんと進路が確定しとるように見える
    probabilityCircleKm: b.probabilityCircleRadius?.km ?? null,
    // 暴風域の半径より内側に慶良間が入るか（確率XMLが無いときの代替判定）
    insideStorm:  stormKm != null ? km <= stormKm : null,
    category:     b.category?.jp ?? null,
    course:       b.course ?? null,
    location:     b.location ?? null,
    validTime:    b.validtime?.JST ?? null,
  };
}

// specifications.json 全体を正規化
export function parseSpecifications(json, id = null) {
  if (!Array.isArray(json)) return null;
  const title = json.find(p => p.part === 'title');
  if (!title) return null;

  const blocks = json
    .filter(p => p.part !== 'title')
    .map(normalizeBlock)
    .filter(Boolean)
    .sort((a, b) => (a.hours ?? 0) - (b.hours ?? 0));

  const analysis = blocks.find(b => b.isAnalysis) ?? blocks[0] ?? null;

  return {
    id,
    number:   title.typhoonNumber ?? null,     // 例 '2618' = 2026年第18号
    name:     title.name?.jp ?? null,          // 例 'ソウデル'
    category: title.category?.jp ?? null,      // 例 '台風'
    issued:   title.issue?.JST ?? null,
    analysis,
    forecasts: blocks.filter(b => !b.isAnalysis),
    // 予報のどこかで暴風域に入るか＋そのうち最も近い距離
    everInsideStorm: blocks.some(b => b.insideStorm === true),
    nearestKm: blocks.length ? Math.min(...blocks.map(b => b.distanceKm)) : null,
  };
}

// XMLフィードから VPTA5x（台風の暴風域に入る確率）のURLを新しい順に返す
export function pickProbabilityUrls(feedText) {
  return [...feedText.matchAll(/href="(https:\/\/www\.data\.jma\.go\.jp\/[^"]*_VPTA\d\d_\d+\.xml)"/g)]
    .map(m => m[1]);
}

// 確率XMLから「慶良間・粟国諸島」の累積確率を取り出す
// 戻り値: { eventId, baseTime, series: [{ hours, percent }] }  hours は 24/48/72/96/120
// baseTime は TargetDateTime。percent は「baseTime から hours 時間後までに入る累積確率」
export function parseKeramaProbability(xmlText) {
  const eventId  = xmlText.match(/<EventID>([^<]+)<\/EventID>/)?.[1] ?? null;
  const baseTime = xmlText.match(/<TargetDateTime>([^<]+)<\/TargetDateTime>/)?.[1] ?? null;
  const series = [];

  // 各 Item の直前に現れる Duration（PT24H 等）と対応づける
  const re = /<Duration>PT(\d+)H<\/Duration>|<Item>([\s\S]*?)<\/Item>/g;
  let currentHours = null;
  let m;
  while ((m = re.exec(xmlText)) !== null) {
    if (m[1] != null) { currentHours = Number(m[1]); continue; }
    const item = m[2];
    if (!item.includes(`<Code>${KERAMA_AREA_CODE}</Code>`)) continue;
    const pct = item.match(/<FiftyKtWindProbability unit="%">(\d+)<\/FiftyKtWindProbability>/)?.[1];
    // 24時間刻みの累積確率だけを拾う（同じファイルに3時間刻みの別区分が入っとる）
    if (pct != null && currentHours != null && currentHours >= 24) {
      series.push({ hours: currentHours, percent: Number(pct) });
    }
  }
  series.sort((a, b) => a.hours - b.hours);
  return { eventId, baseTime, series };
}

// 確率の系列から「最大の確率」と「初めてそこに達する時間」を要約
export function summarizeProbability(series, threshold = 50) {
  if (!series?.length) return { max: null, hitHours: null };
  const max = Math.max(...series.map(s => s.percent));
  const hit = series.find(s => s.percent >= threshold);
  return { max, hitHours: hit ? hit.hours : null };
}

async function getJson(url) {
  const res = await fetch(url, { signal: timeoutSignal() });
  if (!res.ok) throw new Error(`台風情報の取得エラー (HTTP ${res.status})`);
  return res.json();
}

// 追跡中の台風をすべて取得し、慶良間との関係を付けて返す。
// 戻り値: { status: 'ok'|'unavailable', typhoons: [...] }
//   status を必ず返すのは「取得失敗」と「台風なし」を画面で区別するため
//   （既存の警報チップと同じ流儀。2026-07-19 評議会）
export async function fetchTyphoons() {
  let list;
  try {
    list = await getJson(TARGET_URL);
  } catch {
    return { status: 'unavailable', typhoons: [] };
  }
  if (!Array.isArray(list) || !list.length) return { status: 'ok', typhoons: [] };

  const settled = await Promise.allSettled(
    list.map(async t => parseSpecifications(await getJson(SPEC_URL(t.tropicalCyclone)), t.tropicalCyclone))
  );
  const typhoons = settled
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  // 1つでも取れんかったら、その事実を隠さず unavailable として扱う
  if (!typhoons.length) return { status: 'unavailable', typhoons: [] };

  await attachProbabilities(typhoons);
  return { status: 'ok', typhoons };
}

// 近い台風にだけ、気象庁公式の「暴風域に入る確率」を付ける
async function attachProbabilities(typhoons) {
  const near = typhoons.filter(t => t.nearestKm != null && t.nearestKm <= PROBABILITY_FETCH_KM);
  if (!near.length) return;

  let urls;
  try {
    const res = await fetch(XML_FEED_URL, { signal: timeoutSignal() });
    if (!res.ok) return;
    urls = pickProbabilityUrls(await res.text());
  } catch {
    return; // 確率が取れんでも、距離と暴風域半径による判定は残る
  }

  // ファイル名から対象の台風が分からんため、必要な分が揃うまで順に開ける。
  // 1本 約56KB(gzip後)。近い台風の確率が全部揃った時点で打ち切る
  const needed = new Set(near.map(t => t.id));
  const byEvent = new Map();
  for (const url of urls.slice(0, 8)) {
    if (!needed.size) break;
    try {
      const res = await fetch(url, { signal: timeoutSignal() });
      if (!res.ok) continue;
      const p = parseKeramaProbability(await res.text());
      if (p.eventId && !byEvent.has(p.eventId)) {
        byEvent.set(p.eventId, p);
        needed.delete(p.eventId);
      }
    } catch { /* 1本落ちても他を続ける */ }
  }
  for (const t of typhoons) {
    const p = byEvent.get(t.id);
    if (p?.series?.length) {
      t.probability = p.series;
      t.probabilityBaseTime = p.baseTime;
      t.probabilitySummary = summarizeProbability(p.series);
    }
  }
}

// ── 表示用の整形 ────────────────────────────────────────────

// JSTの 'YYYY-MM-DD'
function jstDate(d) {
  return d.toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' });
}

// 画面に出す1つを選ぶ。慶良間への確率が最大のもの → 同点なら近いもの。
// 全部0%（＝今日の判断に効かん）なら null を返し、呼び出し側はチップだけ出す
export function pickPrimary(typhoons) {
  const scored = (typhoons ?? []).map(t => ({
    t,
    pct: t.probabilitySummary?.max ?? 0,
    km:  t.nearestKm ?? Infinity,
  }));
  const hot = scored.filter(s => s.pct > 0);
  if (!hot.length) return null;
  hot.sort((a, b) => b.pct - a.pct || a.km - b.km);
  return hot[0].t;
}

// 日別の見通しを作る。確率（その日までの累積）と、同じ日の慶良間の最大波高を並べる。
//   waveByDate: { 'YYYY-MM-DD': 最大波高 }
// 値が無い日は null のまま返す（呼び出し側で「—」を出す。良好値で埋めない）
export function dailyOutlook(typhoon, waveByDate = {}, now = new Date(), days = 4) {
  const base = typhoon?.probabilityBaseTime ? new Date(typhoon.probabilityBaseTime) : null;
  const byDate = new Map();
  if (base) {
    for (const s of typhoon.probability ?? []) {
      const d = new Date(base.getTime() + s.hours * 3600 * 1000);
      byDate.set(jstDate(d), s.percent);
    }
  }

  const todayStr = jstDate(now);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() + i * 86400 * 1000);
    const key = jstDate(d);
    out.push({
      date:    key,
      dayNum:  Number(key.slice(8, 10)),
      weekday: d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'short' }),
      isToday: key === todayStr,
      percent: byDate.has(key) ? byDate.get(key) : null,
      waveMax: Number.isFinite(waveByDate[key]) ? waveByDate[key] : null,
    });
  }
  return out;
}

// 確率の基準時刻（TargetDateTime）の「時」をJSTで返す。取れんときは null。
//
// 気象庁の累積確率は「その日の24時まで」やなく「基準時刻と同じ時刻まで」の値。
// 基準が21時なら「8/25 17%」は 8/25 21時までの17%であって、8/25いっぱいの値ではない。
// 注釈にこの時刻を書かんと、読む側で丸1日ずれる（2026-08-24 実測で発覚）。
export function probabilityCutoffHour(typhoon) {
  const base = typhoon?.probabilityBaseTime ? new Date(typhoon.probabilityBaseTime) : null;
  if (!base || Number.isNaN(base.getTime())) return null;
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false,
  }).format(base);
  return Number(h);
}

// 最接近を「幅」で返す。{ fromTime, toTime, withinKm, coarse } / 予報が無ければ null
//
// 予報点は24時間先までは3時間刻みやが、その先は24時間刻みに粗くなる。標本の最小値を
// そのまま「最接近」として出すと、粗い区間に隠れた本当の谷を取り逃す。
// 2026-08-24 の台風18号では 199km（8/25 21時）と出とったが、次の予報点との間を
// 補間すると 8/26 07時ごろ 約130km で、69km も過大やった。
//
// 補間値は自前の推定になるため本文には出さん。代わりに
//   ・最小の標本の前後の予報点で挟んだ「区間」
//   ・距離は切り上げた「◯km以内」（標本の最小値は真の最接近以上なので上限として正しい）
// を返す。
export function approachWindow(typhoon) {
  const blocks = (typhoon?.forecasts ?? []).filter(b => Number.isFinite(b?.distanceKm));
  if (!blocks.length) return null;

  let mi = 0;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].distanceKm < blocks[mi].distanceKm) mi = i;
  }
  const from = blocks[Math.max(0, mi - 1)];
  const to   = blocks[Math.min(blocks.length - 1, mi + 1)];
  const spanMs = new Date(to.validTime).getTime() - new Date(from.validTime).getTime();

  return {
    fromTime: from.validTime,
    toTime:   to.validTime,
    withinKm: Math.ceil(blocks[mi].distanceKm / 10) * 10,
    // 前後が3時間刻みで詰まっとるなら幅を出す必要はない（予報が細かい区間）
    coarse:   spanMs > 6 * 3600 * 1000,
  };
}

// marine の hourly から日別の最大波高を作る（renderCalendar と同じ考え方）
export function waveMaxByDate(marine) {
  const times = marine?.hourly?.time ?? [];
  const waves = marine?.hourly?.wave_height ?? [];
  const acc = {};
  times.forEach((t, i) => {
    const v = waves[i];
    if (!Number.isFinite(v)) return;
    const d = t.slice(0, 10);
    acc[d] = acc[d] == null ? v : Math.max(acc[d], v);
  });
  return acc;
}
