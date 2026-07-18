// 安全パッチ（2026-07-19 評議会 裁可項目1・8）の回帰テスト
// 実行: node --test tests/
// スコア・警報は安全の中核ロジックのため、ここだけは「知らぬ間に挙動が変わる」を防ぐ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcScore, warningScoreCap, scoreLabel, findCurrentHourIndex } from '../js/score.js';
import { parseWarnings, feedIsAlive } from '../js/warnings.js';

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
