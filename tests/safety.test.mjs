// 安全パッチ（2026-07-19 評議会 裁可項目1・8）の回帰テスト
// 実行: node --test tests/safety.test.mjs
//       （Node 22+ では `node --test tests/` のディレクトリ指定が解決に失敗する）
// スコア・警報は安全の中核ロジックのため、ここだけは「知らぬ間に挙動が変わる」を防ぐ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcScore, warningScoreCap, scoreLabel, findCurrentHourIndex } from '../js/score.js';
import { parseWarnings, feedIsAlive, fetchWarningsViaXml, pickLatestWarningXmlUrl } from '../js/warnings.js';
import { WARNING_AREAS, DIVE_POINTS } from '../js/config.js';
import { readFileSync } from 'node:fs';
import { isWithinWindow } from '../js/notice.js';

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
