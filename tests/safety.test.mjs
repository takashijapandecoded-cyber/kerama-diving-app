// 安全パッチ（2026-07-19 評議会 裁可項目1・8）の回帰テスト
// 実行: node --test tests/safety.test.mjs
//       （Node 22+ では `node --test tests/` のディレクトリ指定が解決に失敗する）
// スコア・警報は安全の中核ロジックのため、ここだけは「知らぬ間に挙動が変わる」を防ぐ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcScore, warningScoreCap, scoreLabel, findCurrentHourIndex,
         findTidePeaks, tidePeriods } from '../js/score.js';
import { parseWarnings, feedIsAlive, fetchWarningsViaXml, pickLatestWarningXmlUrl } from '../js/warnings.js';
import { WARNING_AREAS, DIVE_POINTS } from '../js/config.js';
import { readFileSync } from 'node:fs';
import { isWithinWindow } from '../js/notice.js';
import { distanceKm, parseSpecifications, parseKeramaProbability,
         summarizeProbability, fetchTyphoons,
         pickPrimary, dailyOutlook, waveMaxByDate,
         approachWindow, probabilityCutoffHour } from '../js/typhoon.js';

test('欠損・異常値では絶対にスコアを出さない（誤GO防止）', () => {
  assert.equal(calcScore({}), null);
  assert.equal(calcScore({ waveHeight: null, windSpeed: null }), null);
  assert.equal(calcScore({ waveHeight: NaN, windSpeed: 3 }), null);
  assert.equal(calcScore({ waveHeight: 0.5, windSpeed: undefined }), null);
  assert.equal(calcScore({ windSpeed: 3, weatherCode: 0, swellPeriod: 10 }), null);
});

test('揃った入力では従来どおりスコアが出る', () => {
  assert.equal(calcScore({ waveHeight: 0.5, windSpeed: 3, weatherCode: 0, swellPeriod: 10 }), 10);
  // 波2.5m超は他が完璧でも最大2（既存の安全ルール維持）
  assert.ok(calcScore({ waveHeight: 2.6, windSpeed: 3, weatherCode: 0, swellPeriod: 10 }) <= 2);
});

test('天気・うねりのみ欠損なら中立値で計算は続く', () => {
  assert.ok(Number.isFinite(calcScore({ waveHeight: 0.5, windSpeed: 3 })));
});

test('警報スコア上限: 海の警報=3・注意報=6・特別警報=1・対象外=上限なし', () => {
  const w = list => ({ items: list.map(([code, level]) => ({ code, level })) });
  assert.equal(warningScoreCap(w([['05', 'warning']])), 3);    // 暴風警報
  assert.equal(warningScoreCap(w([['07', 'warning']])), 3);    // 波浪警報
  assert.equal(warningScoreCap(w([['16', 'advisory']])), 6);   // 波浪注意報
  assert.equal(warningScoreCap(w([['37', 'emergency']])), 1);  // 波浪特別警報
  assert.equal(warningScoreCap(w([['33', 'emergency']])), 1);  // 特別警報は種類を問わず1
  assert.equal(warningScoreCap(w([['14', 'advisory']])), 10);  // 雷注意報は対象外
  assert.equal(warningScoreCap(w([['16', 'advisory'], ['05', 'warning']])), 3); // 複数は最小
  assert.equal(warningScoreCap(null), 10);
  assert.equal(warningScoreCap({ items: [] }), 10);
});

test('警報→上限→バナー連動: 暴風警報＋モデル凪でも出港OK圏に入らない', () => {
  const raw = calcScore({ waveHeight: 0.3, windSpeed: 2, weatherCode: 0, swellPeriod: 12 }); // 凪＝10点
  const parsed = parseWarnings({
    reportDatetime: new Date().toISOString(),
    via: 'xml',
    areaTypes: [{ areas: [{ code: '4735300', warnings: [{ code: '05', status: '発表' }] }] }],
  });
  const capped = Math.min(raw, warningScoreCap(parsed));
  assert.ok(capped <= 3, `暴風警報中にスコア${capped}は出港OK圏`);
});

test('scoreLabel(null) は判定不能表示', () => {
  assert.match(scoreLabel(null).text, /判定不能/);
});

test('findCurrentHourIndex は見つからんとき -1（先頭の別時刻に倒さない）', () => {
  assert.equal(findCurrentHourIndex([]), -1);
  assert.equal(findCurrentHourIndex(['2020-01-01T00:00', '2020-01-01T01:00']), -1);
});

test('findCurrentHourIndex は現在時刻（T区切りのAPI形式）を見つける', () => {
  // 旧実装はスペース区切りとT区切りの不一致で一度もマッチせず、常に先頭（0時の値）を使っとった
  const nowIso = new Date().toLocaleString('sv', { timeZone: 'Asia/Tokyo' })
    .slice(0, 13).replace(' ', 'T') + ':00';
  assert.equal(findCurrentHourIndex(['2020-01-01T00:00', nowIso]), 1);
});

test('parseWarnings の状態区別: 不正=null・古いbosai=stale・XML経由は鮮度免除', () => {
  assert.equal(parseWarnings(null), null);
  assert.equal(parseWarnings({}), null);
  const oldDt = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  assert.equal(parseWarnings({ reportDatetime: oldDt, areaTypes: [{ areas: [] }] }).stale, true);
  assert.equal(parseWarnings({ reportDatetime: oldDt, areaTypes: [{ areas: [] }], via: 'xml' }).stale, false);
});

test('feedIsAlive: フィード自体の更新が止まっとれば死とみなす', () => {
  const fresh = `<feed><updated>${new Date().toISOString()}</updated></feed>`;
  const dead  = `<feed><updated>${new Date(Date.now() - 7 * 3600 * 1000).toISOString()}</updated></feed>`;
  assert.equal(feedIsAlive(fresh), true);
  assert.equal(feedIsAlive(dead), false);
  assert.equal(feedIsAlive('<feed></feed>'), false);
});

// 沖縄の最後の発表が1週間ウィンドウから抜けると、凍結bosaiに落ちて「更新停止中」を
// 誤表示しとった不具合（2026-07-21発覚）の回帰テスト。fetch をモックして検証する
test('平穏（1週間発表なし）でも凍結予備に落ちず「発表なし」を返す', async () => {
  const orig = globalThis.fetch;
  // 短期も長期も、生きとるが沖縄VPWW54を含まないフィードを返す
  const aliveFeedNoOkinawa = `<feed><updated>${new Date().toISOString()}</updated>` +
    `<entry><link href="https://www.data.jma.go.jp/developer/xml/data/x_0_VPWW54_130000.xml"/></entry></feed>`;
  globalThis.fetch = async () => ({ ok: true, text: async () => aliveFeedNoOkinawa });
  try {
    const r = await fetchWarningsViaXml();
    assert.equal(r.via, 'xml');
    const parsed = parseWarnings(r);
    assert.equal(parsed.stale, false, '平穏をstale(更新停止)にしてはいけない');
    assert.equal(parsed.items.length, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test('フィード自体が更新停止ならthrow（呼び出し側のbosaiフォールバックに回す）', async () => {
  const orig = globalThis.fetch;
  const deadFeed = `<feed><updated>${new Date(Date.now() - 7 * 3600 * 1000).toISOString()}</updated></feed>`;
  globalThis.fetch = async () => ({ ok: true, text: async () => deadFeed });
  try {
    await assert.rejects(fetchWarningsViaXml());
  } finally {
    globalThis.fetch = orig;
  }
});

// ── 監視エリアのコード取り違え（2026-08-23 発見）─────────────
// 粟国=4734800（実際は与那原町）・渡名喜=4735000（実際は南風原町）と誤っとり、
// 内陸の南風原町には波浪注意報が構造上出んため、渡名喜ポイントの波関連スコア上限が
// ずっと効いとらんかった。コードは正しく、定数だけが誤っとったので既存テストは全部通っとった。
const EXPECTED_AREA_MUNICIPALITIES = {
  '4720100': '那覇市',
  '4735300': '渡嘉敷村',
  '4735400': '座間味村',
  '4721000': '糸満市',
  '4735500': '粟国村',
  '4735600': '渡名喜村',
};

test('監視エリアの市町村コードが正しい島を指しとる（オフライン固定）', () => {
  const configured = Object.values(WARNING_AREAS).flatMap(a => a.codes).sort();
  assert.deepEqual(
    configured,
    Object.keys(EXPECTED_AREA_MUNICIPALITIES).sort(),
    'WARNING_AREAS のコードが期待と違う。気象庁の実XMLで市町村名を突き合わせること',
  );
  // ダイビングポイントの warnKey が実在するエリアを指しとるか
  for (const p of DIVE_POINTS) {
    assert.ok(WARNING_AREAS[p.warnKey], `${p.name} の warnKey "${p.warnKey}" が WARNING_AREAS に無い`);
  }
});

test('気象庁の実データでも市町村コードと名前が一致する（ネット必須・不通なら skip）', async (t) => {
  let xmlText;
  try {
    const feed = await fetch('https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml', {
      signal: AbortSignal.timeout(30000),
    });
    if (!feed.ok) return t.skip('気象庁フィードに到達できず');
    const url = pickLatestWarningXmlUrl(await feed.text());
    if (!url) return t.skip('沖縄のVPWW54が見つからず');
    const xml = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!xml.ok) return t.skip('警報XMLに到達できず');
    xmlText = await xml.text();
  } catch {
    return t.skip('ネットワーク不通');
  }

  // <Item> ごとに Area の Name と Code を拾う
  const found = {};
  for (const item of xmlText.match(/<Item>[\s\S]*?<\/Item>/g) ?? []) {
    const m = item.match(/<Area>[\s\S]*?<Name>([^<]+)<\/Name>[\s\S]*?<Code>(\d+)<\/Code>/);
    if (m) found[m[2]] = m[1];
  }
  assert.ok(Object.keys(found).length > 10, '市町村を抽出できとらん（XML書式が変わった可能性）');

  for (const [code, expected] of Object.entries(EXPECTED_AREA_MUNICIPALITIES)) {
    assert.equal(found[code], expected, `コード ${code} は気象庁では「${found[code]}」。設定は「${expected}」のつもり`);
  }
});

// ── 風速の単位（2026-08-23 統一）───────────────────────────
// しきい値は m/s。以前は API から km/h で受けて各所で /3.6 しとったが、
// 変換を1箇所でも書き漏らすと 3.6倍のスコア誤差（例: 実際7m/sが25m/s扱い）に直結する。
// 入口で m/s に固定し、風に対する変換をコードから消した状態を維持する。
test('風速は m/s で受け取り、コード中に風の /3.6 換算が残っとらん', () => {
  const files = ['js/api.js', 'notify/daily-brief.js'];
  for (const rel of files) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf-8');
    // assert.match だと失敗時にファイル全文がログへ出て読めんため、真偽値で判定する
    assert.ok(/wind_speed_unit'?,?\s*'ms'/.test(src),   `${rel}: 風速の単位が ms になっとらん`);
    assert.ok(!/wind_speed_unit'?,?\s*'kmh'/.test(src), `${rel}: kmh の指定が残っとる`);
  }
  // 風を扱う行に 3.6 が現れたら換算の残骸（潮流 ocean_current_velocity は km/h 固定なので対象外）
  for (const rel of ['js/api.js', 'js/app.js', 'js/ui.js', 'notify/daily-brief.js']) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf-8');
    src.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('//')) return;           // コメントは対象外
      if (!/wind_speed_10m|windSpeed|windMax|wWinds|windArr/.test(line)) return;
      assert.ok(!line.includes('3.6'), `${rel}:${i + 1} 風の行に 3.6 換算が残っとる → ${line.trim()}`);
    });
  }
});

test('しきい値が m/s 前提のまま（km/h の値を渡すと極端に低く出ることの確認）', () => {
  const base = { waveHeight: 0.4, weatherCode: 0, swellPeriod: 12 };
  // 3.5 m/s は穏やか → 満点圏
  assert.equal(calcScore({ ...base, windSpeed: 3.5 }), 10);
  // 同じ風を km/h（12.6）のまま渡すと 6点まで落ちる＝取り違えたら必ず数字が動く
  assert.ok(calcScore({ ...base, windSpeed: 12.6 }) < 10);
});

// ── 一度きりのお知らせポップアップ（2026-08-24 の m/s 変更告知）──────
// 「明日だけ出して明後日には消える」が本当に効くか。日付をまたぐ挙動は
// 実機で待って確かめられんため、境界値を固定して検証する
test('お知らせは表示期間の内側だけ true（前日・翌日は false）', () => {
  assert.equal(isWithinWindow('2026-08-23'), false, '前日に出とる');
  assert.equal(isWithinWindow('2026-08-24'), true,  '当日に出とらん');
  assert.equal(isWithinWindow('2026-08-25'), false, '翌日に出とる（消え残り）');
  // 期間を延ばした場合も両端を含む
  assert.equal(isWithinWindow('2026-08-24', '2026-08-24', '2026-08-26'), true);
  assert.equal(isWithinWindow('2026-08-26', '2026-08-24', '2026-08-26'), true);
  assert.equal(isWithinWindow('2026-08-27', '2026-08-24', '2026-08-26'), false);
});

// ── 台風情報（2026-08-23 追加）─────────────────────────────
// 沖縄では台風が年に何度も来る。波高経由の間接的な影響だけでなく、
// 台風そのものを扱うためのデータ層。実データの形は同日に実測して確認済み。

test('distanceKm: 既知の距離と一致する', () => {
  // 慶良間(26.20,127.31) → 台風2618の48h後予報位置(26.3,129.1) は約179km
  const d = distanceKm(26.20, 127.31, 26.3, 129.1);
  assert.ok(Math.abs(d - 179) < 5, `179km前後のはずが ${d.toFixed(0)}km`);
  // 同一点は0
  assert.equal(Math.round(distanceKm(26.2, 127.31, 26.2, 127.31)), 0);
});

test('parseSpecifications: 実況と予報を分け、暴風域の内外を判定する', () => {
  // 2026-08-23 の台風2618ソウデルの実データと同じ形
  const json = [
    { part: 'title', typhoonNumber: '2618', name: { jp: 'ソウデル' },
      category: { jp: '台風' }, issue: { JST: '2026-08-23T21:45:00+09:00' } },
    { part: { jp: '実況' }, advancedHours: 0, pressure: '950',
      position: { deg: [22.5, 139.5] },
      maximumWind: { sustained: { 'm/s': '45' }, gust: { 'm/s': '60' } },
      stormWarning: [{ range: { km: 150 } }], galeWarning: [{ range: { km: 390 } }],
      location: '日本の南', course: '北西' },
    { part: { jp: '予報　４８時間後' }, advancedHours: 48, pressure: '955',
      position: { deg: [26.3, 129.1] },
      maximumWind: { sustained: { 'm/s': '40' } },
      stormWarning: [{ range: { km: 250 } }] },
  ];
  const t = parseSpecifications(json, 'TC2621');
  assert.equal(t.number, '2618');
  assert.equal(t.name, 'ソウデル');
  assert.equal(t.analysis.hours, 0);
  assert.equal(t.analysis.pressure, 950);
  assert.equal(t.analysis.windMs, 45);
  assert.equal(t.forecasts.length, 1);
  // 実況は1301km・暴風域150km → 外側
  assert.equal(t.analysis.insideStorm, false);
  // 48h後は179km・暴風域250km → 内側（ここが安全上の要）
  assert.equal(t.forecasts[0].insideStorm, true);
  assert.equal(t.everInsideStorm, true);
  assert.ok(t.nearestKm < 200);
});

test('parseSpecifications: 暴風域を持たん熱帯低気圧でも壊れん', () => {
  const json = [
    { part: 'title', typhoonNumber: 'd', category: { jp: '熱帯低気圧' } },
    { part: { jp: '実況' }, advancedHours: 0, pressure: '1002',
      position: { deg: [13.6, 136.2] },
      maximumWind: { sustained: { 'm/s': '15' } } },  // stormWarning なし
  ];
  const t = parseSpecifications(json, 'TC2624');
  assert.equal(t.analysis.stormRadiusKm, null);
  assert.equal(t.analysis.insideStorm, null);  // 不明は false ではなく null
  assert.equal(t.everInsideStorm, false);
});

test('parseKeramaProbability: 慶良間・粟国諸島(471013)だけを時間別に拾う', () => {
  const xml = `<Report><EventID>TC2621</EventID>
    <Duration>PT24H</Duration>
    <Item><Kind><Property><FiftyKtWindProbabilityPart>
      <FiftyKtWindProbability unit="%">0</FiftyKtWindProbability>
    </FiftyKtWindProbabilityPart></Property></Kind>
    <Area><Name>慶良間・粟国諸島</Name><Code>471013</Code></Area></Item>
    <Item><Kind><Property><FiftyKtWindProbabilityPart>
      <FiftyKtWindProbability unit="%">88</FiftyKtWindProbability>
    </FiftyKtWindProbabilityPart></Property></Kind>
    <Area><Name>よその島</Name><Code>999999</Code></Area></Item>
    <Duration>PT48H</Duration>
    <Item><Kind><Property><FiftyKtWindProbabilityPart>
      <FiftyKtWindProbability unit="%">36</FiftyKtWindProbability>
    </FiftyKtWindProbabilityPart></Property></Kind>
    <Area><Name>慶良間・粟国諸島</Name><Code>471013</Code></Area></Item>
    <Duration>PT72H</Duration>
    <Item><Kind><Property><FiftyKtWindProbabilityPart>
      <FiftyKtWindProbability unit="%">96</FiftyKtWindProbability>
    </FiftyKtWindProbabilityPart></Property></Kind>
    <Area><Name>慶良間・粟国諸島</Name><Code>471013</Code></Area></Item>
  </Report>`;
  const { eventId, series } = parseKeramaProbability(xml);
  assert.equal(eventId, 'TC2621');
  // よその島(88%)を拾っとらんこと＝取り違えたら安全判断が狂う
  assert.deepEqual(series, [
    { hours: 24, percent: 0 }, { hours: 48, percent: 36 }, { hours: 72, percent: 96 },
  ]);
  const s = summarizeProbability(series);
  assert.equal(s.max, 96);
  assert.equal(s.hitHours, 72);   // 50%を最初に超えるのは72時間後
});

test('summarizeProbability: 全部0%なら到達なし', () => {
  const s = summarizeProbability([{ hours: 24, percent: 0 }, { hours: 48, percent: 0 }]);
  assert.equal(s.max, 0);
  assert.equal(s.hitHours, null);
  assert.deepEqual(summarizeProbability([]), { max: null, hitHours: null });
});

test('fetchTyphoons: 取得できんときは「台風なし」ではなく unavailable', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('不通'); };
  try {
    const r = await fetchTyphoons();
    // 「台風なし(ok/0件)」と「取得失敗」を混同すると、画面に何も出ず
    // 台風が無いのか繋がらんのか区別できん（既存の警報チップと同じ原則）
    assert.equal(r.status, 'unavailable');
    assert.deepEqual(r.typhoons, []);
  } finally {
    globalThis.fetch = orig;
  }
});

test('fetchTyphoons: 追跡中ゼロなら ok かつ空（平常時）', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    const r = await fetchTyphoons();
    assert.equal(r.status, 'ok');
    assert.equal(r.typhoons.length, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

// ── 台風カードの表示ロジック（2026-08-24 追加）──────────────
test('pickPrimary: 全部0%なら null（カードを出さずチップだけにする）', () => {
  const mk = (id, pct, km) => ({ id, nearestKm: km, probabilitySummary: { max: pct } });
  assert.equal(pickPrimary([mk('a', 0, 800), mk('b', 0, 1200)]), null);
  assert.equal(pickPrimary([]), null);
  assert.equal(pickPrimary(undefined), null);
  // 確率が高い方を選ぶ
  assert.equal(pickPrimary([mk('a', 36, 200), mk('b', 96, 900)]).id, 'b');
  // 同点なら近い方
  assert.equal(pickPrimary([mk('a', 96, 900), mk('b', 96, 200)]).id, 'b');
  // 確率が未取得(undefined)でも落ちん
  assert.equal(pickPrimary([{ id: 'c', nearestKm: 300 }]), null);
});

test('dailyOutlook: 確率を正しい日付に割り付ける', () => {
  const typhoon = {
    probabilityBaseTime: '2026-08-23T21:00:00+09:00',
    probability: [
      { hours: 24, percent: 0 }, { hours: 48, percent: 36 },
      { hours: 72, percent: 96 }, { hours: 96, percent: 96 },
    ],
  };
  const waves = { '2026-08-24': 1.7, '2026-08-25': 5.02, '2026-08-26': 8.48 };
  const now = new Date('2026-08-24T06:00:00+09:00');
  const out = dailyOutlook(typhoon, waves, now, 4);

  assert.deepEqual(out.map(d => d.date),
    ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27']);
  // 基準時刻+24h = 8/24 なので 0%、+72h = 8/26 で 96%
  assert.deepEqual(out.map(d => d.percent), [0, 36, 96, 96]);
  assert.equal(out[0].isToday, true);
  assert.equal(out[1].isToday, false);
  // 波高が無い日は良好値で埋めず null のまま
  assert.equal(out[3].waveMax, null);
  assert.equal(out[0].waveMax, 1.7);
});

test('dailyOutlook: 確率が無い台風でも日付の枠は返る（全部null）', () => {
  const out = dailyOutlook({}, {}, new Date('2026-08-24T06:00:00+09:00'), 4);
  assert.equal(out.length, 4);
  assert.ok(out.every(d => d.percent === null && d.waveMax === null));
});

test('waveMaxByDate: 日ごとの最大波高を拾う（欠損は無視）', () => {
  const marine = { hourly: {
    time:        ['2026-08-24T00:00', '2026-08-24T12:00', '2026-08-25T00:00'],
    wave_height: [1.2, 1.7, null],
  }};
  const w = waveMaxByDate(marine);
  assert.equal(w['2026-08-24'], 1.7);   // 同じ日の最大を採る
  assert.equal(w['2026-08-25'], undefined); // null しか無い日は作らん
  assert.deepEqual(waveMaxByDate(null), {});
});

test('気象庁の台風番号 2618 は「18号」（2026年の第18号）', () => {
  // 表示ロジックと同じ変換。そのまま出すと「台風2618号」になる
  const toNo = n => (/^\d{4}$/.test(n ?? '') ? Number(String(n).slice(2)) : null);
  assert.equal(toNo('2618'), 18);
  assert.equal(toNo('2601'), 1);
  assert.equal(toNo('d'), null);      // 熱帯低気圧は番号なし
  assert.equal(toNo(undefined), null);
});

// ── 潮汐（2026-08-24 発覚：頂点がフラットな日に満潮が1つも出んかった）──────

// 2026-08-24 の慶良間の実データ（Open-Meteo）。朝も夕方も満潮が2時間フラット
const TIDE_0824 = [
  ['00:00',1.18],['01:00',1.29],['02:00',1.40],['03:00',1.48],['04:00',1.48],['05:00',1.39],
  ['06:00',1.20],['07:00',0.96],['08:00',0.70],['09:00',0.50],['10:00',0.38],['11:00',0.37],
  ['12:00',0.47],['13:00',0.66],['14:00',0.91],['15:00',1.17],['16:00',1.37],['17:00',1.47],
  ['18:00',1.47],['19:00',1.39],['20:00',1.24],['21:00',1.09],['22:00',1.00],['23:00',0.99],
];
const tideTimes   = TIDE_0824.map(r => `2026-08-24T${r[0]}`);
const tideHeights = TIDE_0824.map(r => r[1]);

test('findTidePeaks: 頂点が2時間フラットでも満潮を取りこぼさない', () => {
  const peaks = findTidePeaks(tideTimes, tideHeights);
  const highs = peaks.filter(p => p.type === 'high');
  const lows  = peaks.filter(p => p.type === 'low');
  // 厳密な > だけの旧実装ではここが 0 やった（1.48,1.48 と 1.47,1.47 が両方落ちる）
  assert.equal(highs.length, 2, '満潮は朝と夕の2回');
  assert.equal(lows.length, 1);
  // フラットな区間は中央の時刻を代表にする
  assert.equal(highs[0].time, '2026-08-24T03:00');
  assert.equal(highs[1].time, '2026-08-24T17:00');
  assert.equal(lows[0].time,  '2026-08-24T11:00');
});

test('findTidePeaks: 満潮が拾えれば上げ潮帯・下げ潮帯も連鎖で出る', () => {
  const periods = tidePeriods(findTidePeaks(tideTimes, tideHeights));
  // 旧実装では満潮が消えてペアが作れず、両方とも空＝「--」表示になっとった
  assert.deepEqual(periods.filter(p => p.type === 'falling'), [{ type: 'falling', from: '03:00', to: '11:00' }]);
  assert.deepEqual(periods.filter(p => p.type === 'rising'),  [{ type: 'rising',  from: '11:00', to: '17:00' }]);
});

test('findTidePeaks: 尖った頂点は従来どおり1点で拾う（挙動を変えとらん）', () => {
  const t = ['T0','T1','T2','T3','T4'];
  const h = [1.0, 1.2, 1.5, 1.2, 1.0];
  assert.deepEqual(findTidePeaks(t, h), [{ time: 'T2', height: 1.5, type: 'high' }]);
});

test('findTidePeaks: 欠損（null）が混ざっても落ちん', () => {
  const t = ['T0','T1','T2','T3','T4'];
  const h = [1.0, null, 1.5, null, 1.0];
  assert.deepEqual(findTidePeaks(t, h), []);
});

test('findTidePeaks: 末尾のピークは翌日の値まで渡さんと拾えない（メールをアプリと揃えた理由）', () => {
  // 23時の干潮は「次の値」＝翌日00時が要る。今日ぶんだけ渡すと落ちる
  const onlyToday = findTidePeaks(tideTimes, tideHeights).filter(p => p.type === 'low');
  assert.equal(onlyToday.length, 1, '今日ぶんだけでは 23:00 の干潮が落ちる');

  const plusNextDay = findTidePeaks(
    [...tideTimes, '2026-08-25T00:00'],
    [...tideHeights, 1.06],
  ).filter(p => p.time.startsWith('2026-08-24') && p.type === 'low');
  assert.deepEqual(plusNextDay.map(p => p.time), ['2026-08-24T11:00', '2026-08-24T23:00']);
});

test('notify 側の潮汐は48時間窓で拾う（アプリと同じ数になること）', () => {
  const src = readFileSync(new URL('../notify/daily-brief.js', import.meta.url), 'utf8');
  assert.ok(/slice\(0, 48\)/.test(src), 'アプリ側 renderTideChart と同じ48時間窓にすること');
  assert.ok(!/peakTimes\.filter\(t => t\.startsWith\(todayStr\)\)/.test(src),
    '今日ぶんだけを渡すと末尾のピークが落ちる');
});

test('notify 側に潮汐の自前コピーを置かない（アプリと不一致になる元）', () => {
  const src = readFileSync(new URL('../notify/daily-brief.js', import.meta.url), 'utf8');
  assert.ok(!/function\s+findPeaks\s*\(/.test(src), 'daily-brief.js は js/score.js の findTidePeaks を使う');
  assert.ok(src.includes('findTidePeaks'), 'アプリと同じ関数を import しとること');
});

// ── 台風の最接近と確率の基準時刻（2026-08-24 発覚）────────────────────

test('approachWindow: 予報が粗い区間の谷を1点で断定せず、幅と上限で返す', () => {
  // 実データ（台風18号ソウデル）。8/25 21:00 までは3時間刻み、その先は24時間刻み
  const tc = { forecasts: [
    { validTime: '2026-08-25T18:00:00+09:00', distanceKm: 237 },
    { validTime: '2026-08-25T21:00:00+09:00', distanceKm: 199 },
    { validTime: '2026-08-26T21:00:00+09:00', distanceKm: 246 },
  ]};
  const w = approachWindow(tc);
  // 最小の標本(199km)を挟む前後の予報点で区間を作る
  assert.equal(w.fromTime, '2026-08-25T18:00:00+09:00');
  assert.equal(w.toTime,   '2026-08-26T21:00:00+09:00');
  // 標本の最小値は真の最接近以上。切り上げて「◯km以内」＝上限として正しい
  assert.equal(w.withinKm, 200);
  assert.equal(w.coarse, true, '24時間刻みを含むので幅の理由を注記する');
});

test('approachWindow: 3時間刻みで詰まっとる区間は coarse=false', () => {
  const tc = { forecasts: [
    { validTime: '2026-08-25T15:00:00+09:00', distanceKm: 281 },
    { validTime: '2026-08-25T18:00:00+09:00', distanceKm: 237 },
    { validTime: '2026-08-25T21:00:00+09:00', distanceKm: 250 },
  ]};
  assert.equal(approachWindow(tc).coarse, false);
});

test('approachWindow: 予報が無ければ null（推測で埋めない）', () => {
  assert.equal(approachWindow({ forecasts: [] }), null);
  assert.equal(approachWindow(null), null);
  assert.equal(approachWindow({ forecasts: [{ validTime: 'x', distanceKm: null }] }), null);
});

test('probabilityCutoffHour: 累積確率の締め時刻をJSTで返す', () => {
  // 「8/25 17%」は 8/25 21時までの17%。24時までやない
  assert.equal(probabilityCutoffHour({ probabilityBaseTime: '2026-08-24T21:00:00+09:00' }), 21);
  // UTC 表記でもJSTに直して返す（15:00Z ＝ 翌0時 JST）
  assert.equal(probabilityCutoffHour({ probabilityBaseTime: '2026-08-24T15:00:00Z' }), 0);
  assert.equal(probabilityCutoffHour({}), null);
  assert.equal(probabilityCutoffHour({ probabilityBaseTime: 'ではない' }), null);
});
