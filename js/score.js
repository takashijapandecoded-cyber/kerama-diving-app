import { SCORE_THRESHOLDS, SCORE_WEIGHTS, WAVE_PENALTY_FACTOR, SEA_WARNING_CODES, WARNING_SCORE_CAPS } from './config.js';

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
  if (!Number.isFinite(waveHeight) || !Number.isFinite(windSpeed)) return null;
  const waveScore   = scoreFromTable(waveHeight, SCORE_THRESHOLDS.wave);
  const windScore   = scoreFromTable(windSpeed,  SCORE_THRESHOLDS.wind);
  const weatherScore = Number.isFinite(weatherCode) ? scoreWeatherCode(weatherCode) : 5; // 不明時は中立
  const swellScore  = Number.isFinite(swellPeriod) ? scoreSwellPeriod(swellPeriod) : 5;  // 不明時は中立

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
    wave:    Number.isFinite(waveHeight)  ? scoreFromTable(waveHeight, SCORE_THRESHOLDS.wave) : null,
    wind:    Number.isFinite(windSpeed)   ? scoreFromTable(windSpeed,  SCORE_THRESHOLDS.wind) : null,
    weather: Number.isFinite(weatherCode) ? scoreWeatherCode(weatherCode) : null,
    swell:   Number.isFinite(swellPeriod) ? scoreSwellPeriod(swellPeriod) : null,
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
export function findTidePeaks(times, heights) {
  const peaks = [];
  for (let i = 1; i < heights.length - 1; i++) {
    const prev = heights[i - 1];
    const curr = heights[i];
    const next = heights[i + 1];
    if (curr > prev && curr > next) {
      peaks.push({ time: times[i], height: curr, type: 'high' });
    } else if (curr < prev && curr < next) {
      peaks.push({ time: times[i], height: curr, type: 'low' });
    }
  }
  return peaks;
}

// 今日の日付（JST）に絞った潮汐ピーク
export function todayPeaks(peaks) {
  const todayStr = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');

  return peaks.filter(p => p.time.startsWith(todayStr.slice(0, 10)));
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
