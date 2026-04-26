import { SCORE_THRESHOLDS, SCORE_WEIGHTS } from './config.js';

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
export function calcScore({ waveHeight, windSpeed, weatherCode, swellPeriod }) {
  const waveScore   = scoreFromTable(waveHeight ?? 0, SCORE_THRESHOLDS.wave);
  const windScore   = scoreFromTable(windSpeed ?? 0,  SCORE_THRESHOLDS.wind);
  const weatherScore = scoreWeatherCode(weatherCode ?? 0);
  const swellScore  = scoreSwellPeriod(swellPeriod ?? 8);

  const raw =
    waveScore   * SCORE_WEIGHTS.wave +
    windScore   * SCORE_WEIGHTS.wind +
    weatherScore * SCORE_WEIGHTS.weather +
    swellScore  * SCORE_WEIGHTS.swellPeriod;

  return Math.round(Math.min(10, Math.max(1, raw)));
}

// スコアに対応するラベルと色を返す
export function scoreLabel(score) {
  if (score >= 9) return { text: '🌊 絶好のコンディション！',  color: '#0284c7' };
  if (score >= 7) return { text: '✅ 良好なコンディション',    color: '#22c55e' };
  if (score >= 5) return { text: '⚠️ まずまず、注意して',       color: '#84cc16' };
  if (score >= 4) return { text: '⚠️ 要注意（初心者は慎重に）', color: '#f59e0b' };
  if (score >= 2) return { text: '🚫 出港困難',                color: '#ef4444' };
  return               { text: '⛔ 安全優先でキャンセル推奨', color: '#991b1b' };
}

// 週間カレンダー用アイコン
export function calendarIcon(score) {
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

// ベストダイブ時間帯: 満潮前後1時間（日中のみ 6:00〜18:00）
export function bestDiveWindows(peaks) {
  return peaks
    .filter(p => p.type === 'high')
    .filter(p => {
      const h = parseInt(p.time.slice(11, 13));
      return h >= 6 && h <= 17;
    })
    .map(p => {
      const t    = new Date(p.time);
      const from = new Date(t.getTime() - 60 * 60 * 1000);
      const to   = new Date(t.getTime() + 60 * 60 * 1000);
      const fromStr = fmt(from);
      const toStr   = fmt(to);
      const clampFrom = parseInt(fromStr) < 6  ? '06:00' : fromStr;
      const clampTo   = parseInt(toStr)   > 18 ? '18:00' : toStr;
      return `${clampFrom}〜${clampTo}`;
    });
}

function fmt(d) {
  return d.toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit', minute: '2-digit',
  });
}
