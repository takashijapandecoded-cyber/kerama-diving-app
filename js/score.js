import { SCORE_THRESHOLDS, SCORE_WEIGHTS, WAVE_PENALTY_FACTOR, SEA_WARNING_CODES, WARNING_SCORE_CAPS } from './config.js';

// 物理的にありえん値は「取れとらん」と同じ扱いにする。
// Number.isFinite だけやと waveHeight:-1 が「波0.5m以下」の枠に落ちて満点10になる
// （2026-08-25 レビューで発覚。外部APIの異常値・センチネル値をそのまま最高評価にせん）
function validMeasure(v) {
  return Number.isFinite(v) && v >= 0;
}

// WMO天気コードは 0〜99。範囲外は不明として扱う
function validWeatherCode(v) {
  return Number.isFinite(v) && v >= 0 && v <= 99;
}

function scoreFromTable(value, table) {
  for (const entry of table) {
    if (value <= entry.max) return entry.score;
  }
  return 0;
}

function scoreSwellPeriod(period) {
  for (const entry of SCORE_THRESHOLDS.swellPeriod) {
    if (period >= entry.min) return entry.score;
  }
  return 3;
}

// WMOコードを天気スコアに変換
function scoreWeatherCode(code) {
  if (code <= 1) return 10;        // 快晴
  if (code <= 3) return 9;         // 晴れ〜曇り
  if (code <= 49) return 7;        // 霧・靄
  if (code <= 59) return 5;        // 霧雨
  if (code <= 69) return 4;        // 雨
  if (code <= 79) return 3;        // みぞれ・雪
  if (code <= 82) return 4;        // にわか雨
  if (code <= 84) return 3;        // 強いにわか雨
  if (code <= 94) return 6;        // 雷雨なし
  return 0;                        // 雷雨
}

// 総合コンディションスコアを計算（1〜10）
// フェイルセーフ: 必須入力（波高・風速）が欠けとる場合は null（判定不能）を返す。
// 欠損を「良好」な値で埋めて出港OKを出さないため（2026-07-19 評議会 裁可項目1）
export function calcScore({ waveHeight, windSpeed, weatherCode, swellPeriod }) {
  if (!validMeasure(waveHeight) || !validMeasure(windSpeed)) return null;
  const waveScore   = scoreFromTable(waveHeight, SCORE_THRESHOLDS.wave);
  const windScore   = scoreFromTable(windSpeed,  SCORE_THRESHOLDS.wind);
  const weatherScore = validWeatherCode(weatherCode) ? scoreWeatherCode(weatherCode) : 5; // 不明時は中立
  const swellScore  = validMeasure(swellPeriod) ? scoreSwellPeriod(swellPeriod) : 5;      // 不明時は中立

  const raw =
    waveScore   * SCORE_WEIGHTS.wave +
    windScore   * SCORE_WEIGHTS.wind +
    weatherScore * SCORE_WEIGHTS.weather +
    swellScore  * SCORE_WEIGHTS.swellPeriod;

  // 波高ペナルティ: 出港のボトルネックは波高（優くんフィードバック）やけど、
  // 完全キャップは厳しすぎたため、超過分に係数を掛けて減点する中間方式
  const excess = Math.max(0, raw - waveScore);
  let adjusted = raw - excess * WAVE_PENALTY_FACTOR;

  // 安全ルール: 波高スコア0（波2.5m超）の日は係数に関係なく最大2（出港困難）
  if (waveScore === 0) adjusted = Math.min(adjusted, 2);

  return Math.round(Math.min(10, Math.max(1, adjusted)));
}

// 内訳チップ用: 各要素の個別スコア（欠損は null）
export function calcSubScores({ waveHeight, windSpeed, weatherCode, swellPeriod }) {
  return {
    wave:    validMeasure(waveHeight)      ? scoreFromTable(waveHeight, SCORE_THRESHOLDS.wave) : null,
    wind:    validMeasure(windSpeed)       ? scoreFromTable(windSpeed,  SCORE_THRESHOLDS.wind) : null,
    weather: validWeatherCode(weatherCode) ? scoreWeatherCode(weatherCode) : null,
    swell:   validMeasure(swellPeriod)     ? scoreSwellPeriod(swellPeriod) : null,
  };
}

// 気象庁の警報・注意報によるスコア上限（発表なし・対象外なら10）
// warnings は parseWarnings の戻り値（null 可）。
// 特別警報は種類を問わず上限1。警報・注意報は海関連（SEA_WARNING_CODES）のみ対象
export function warningScoreCap(warnings) {
  let cap = 10;
  for (const w of warnings?.items ?? []) {
    if (w.level === 'emergency') {
      cap = Math.min(cap, WARNING_SCORE_CAPS.emergency);
    } else if (SEA_WARNING_CODES.has(w.code)) {
      cap = Math.min(cap, WARNING_SCORE_CAPS[w.level] ?? 10);
    }
  }
  return cap;
}

// スコアに対応するラベルと色を返す
export function scoreLabel(score) {
  if (score == null) return { text: '⚠️ 判定不能（データ取得失敗）', color: '#64748b' };
  if (score >= 9) return { text: '🌊 絶好のコンディション！',  color: '#0284c7' };
  if (score >= 7) return { text: '✅ 良好なコンディション',    color: '#22c55e' };
  if (score >= 5) return { text: '⚠️ まずまず、注意して',       color: '#84cc16' };
  if (score >= 4) return { text: '⚠️ 要注意（初心者は慎重に）', color: '#f59e0b' };
  if (score >= 2) return { text: '🚫 出港困難',                color: '#ef4444' };
  return               { text: '⛔ 安全優先でキャンセル推奨', color: '#991b1b' };
}

// 週間カレンダー用アイコン
export function calendarIcon(score) {
  if (score == null) return '❔';
  if (score >= 7) return '✅';
  if (score >= 4) return '⚠️';
  return '❌';
}

// 潮汐データ（sea_level_height_msl）から満潮・干潮の時刻を検出
//
// 頂点が2時間以上フラットになることがある（1時間刻み・小数2桁のため 1.48, 1.48 と並ぶ）。
// 厳密な > だけで判定すると、そういう満潮は前後どちらの比較でも偽になって
// 「両方とも」落ちる。2026-08-24 の慶良間は朝(03-04時)と夕(17-18時)の満潮が
// 揃ってこれに当たり、満潮が1つも出ん日になっとった（上げ潮帯・下げ潮帯も連鎖で消える）。
// 同じ値の連なりを1つの頂点としてまとめ、中央の時刻を代表にする。
export function findTidePeaks(times, heights) {
  const peaks = [];
  const n = heights.length;
  let i = 1;
  while (i < n - 1) {
    const curr = heights[i];
    if (!Number.isFinite(curr)) { i++; continue; }

    // 同じ値が続く区間 [i, j] をひとまとめにする
    let j = i;
    while (j + 1 < n && heights[j + 1] === curr) j++;

    const prev = heights[i - 1];
    const next = heights[j + 1];   // j+1 === n のときは undefined（＝末尾は従来どおり採らない）
    if (Number.isFinite(prev) && Number.isFinite(next)) {
      const time = times[Math.floor((i + j) / 2)];
      if (curr > prev && curr > next) {
        peaks.push({ time, height: curr, type: 'high' });
      } else if (curr < prev && curr < next) {
        peaks.push({ time, height: curr, type: 'low' });
      }
    }
    i = j + 1;
  }
  return peaks;
}

// 潮汐の窓を作る。{ display, detect } のインデックス配列を返す。
//   display … 画面に描く範囲（dayStr 以降の hours 時間）
//   detect  … ピーク検出に渡す範囲（display の1つ前を含む）
//
// 窓の作り方をアプリとメールに別々に書くと、片方だけ潮が落ちる。実際に2回やった:
//   2026-08-24 メールだけ23時の干潮が消えた（今日ぶんしか渡しとらんかった）
//   2026-08-25 両方で0時のピークが消えた（窓の先頭は prev が無く山にも谷にもなれん）
// 窓の定義はここを唯一の正にする。detect の1つ前は past_days=1 で取っとる前日ぶん
export function tideWindow(times, dayStr, hours = 48) {
  const display = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i].slice(0, 10) < dayStr) continue;
    display.push(i);
    if (display.length >= hours) break;
  }
  if (!display.length) return { display, detect: [] };
  const detect = (display[0] > 0 ? [display[0] - 1] : []).concat(display);
  return { display, detect };
}

// その日の満潮・干潮。窓の作り方も検出もここに集約する（アプリ・メール共用）
export function tidePeaksForDay(times, heights, dayStr, hours = 48) {
  const { detect } = tideWindow(times ?? [], dayStr, hours);
  return findTidePeaks(detect.map(i => times[i]), detect.map(i => heights?.[i]))
    .filter(p => p.time.startsWith(dayStr));
}

// 連続するピークペアから上げ潮・下げ潮の時間帯を返す
// { type: 'rising'|'falling', from: 'HH:MM', to: 'HH:MM' }[]
export function tidePeriods(peaks) {
  const periods = [];
  for (let i = 0; i < peaks.length - 1; i++) {
    const from = peaks[i];
    const to   = peaks[i + 1];
    if (from.type === 'low' && to.type === 'high') {
      periods.push({ type: 'rising',  from: from.time.slice(11, 16), to: to.time.slice(11, 16) });
    } else if (from.type === 'high' && to.type === 'low') {
      periods.push({ type: 'falling', from: from.time.slice(11, 16), to: to.time.slice(11, 16) });
    }
  }
  return periods;
}

// hourly.time 配列から現在時刻（JST）に対応するインデックスを返す
// 見つからん場合は -1（データが古い・凍結しとる兆候）。
// 以前は黙って先頭（別時刻の値）に倒しとったが、古いデータを「現在値」として
// 表示せんよう呼び出し側で判定不能に落とす（2026-07-19 評議会）
export function findCurrentHourIndex(times) {
  // 'sv'ロケールは「YYYY-MM-DD HH:MM」（スペース区切り）を返すが、Open-Meteoの時刻は
  // 「YYYY-MM-DDTHH:MM」（T区切り）。Tに揃えんと一生マッチせん
  // （旧実装はこの不一致を「見つからんかったら先頭」フォールバックが隠しとった）
  const nowStr = new Date().toLocaleString('sv', { timeZone: 'Asia/Tokyo' }).slice(0, 13).replace(' ', 'T');
  return times.findIndex(t => t.startsWith(nowStr));
}

// Open-Meteo が timezone=Asia/Tokyo で返す時刻は「2026-08-25T00:00」のように
// オフセットを持たん素の文字列。そのまま new Date() すると端末のタイムゾーンで
// 解釈されるため、JST以外の端末で開くと表示が時差ぶんずれる（2026-08-25 実測:
// UTC端末で「00:00 JST」が「09:00 JST」と出とった）。JSTとして明示的に読む。
export function parseApiTime(timeStr) {
  if (typeof timeStr !== 'string' || !timeStr) return null;
  const hasZone = /(?:Z|[+-]\d\d:?\d\d)$/.test(timeStr);
  const t = Date.parse(hasZone ? timeStr : `${timeStr}+09:00`);
  return Number.isFinite(t) ? t : null;
}

// current ブロックの鮮度。これより古い「現在値」は凍結とみなす
export const CURRENT_MAX_AGE_H = 2;

// weather.current の time が今のものか。
// 波高・うねりは findCurrentHourIndex で時刻を検証してから使うのに、風と天気だけは
// current をノーチェックで使っとった。天気APIが凍結すると、古い凪の風と最新の波を
// 合成して「絶好のコンディション」が出る（2026-08-25 レビューで発覚）。
// 実測では current.time の遅れは 0.14時間程度なので、2時間あれば正常時に誤検知せん
export function isCurrentFresh(timeStr, now = Date.now()) {
  const t = parseApiTime(timeStr);
  if (t == null) return false;
  const ageH = (now - t) / 3600000;
  return ageH >= -1 && ageH <= CURRENT_MAX_AGE_H;   // -1 は端末時計のずれ吸収
}
