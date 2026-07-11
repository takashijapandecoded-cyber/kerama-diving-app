import nodemailer from 'nodemailer';
import { DIVE_POINTS } from '../js/config.js';
import { calcScore } from '../js/score.js';       // アプリと同一ロジック（重複コピー禁止・不一致バグ再発防止）
import { parseWarnings, fetchWarningsViaXml } from '../js/warnings.js'; // 警報・注意報の取得・解析もアプリと共用

// ── 設定（GitHub Secrets から環境変数で渡す） ──────────────
const GMAIL_USER     = process.env.GMAIL_USER;
const GMAIL_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const TO_EMAIL       = process.env.TEST_EMAIL || process.env.TO_EMAIL; // テスト時はTEST_EMAILを優先
const APP_URL        = process.env.APP_URL ?? '';

// ── 場所の座標 ─────────────────────────────────────────────
const LOCATIONS = {
  naha:   { lat: 26.21, lon: 127.67 },
  route:  { lat: 26.18, lon: 127.45 },
  kerama: { lat: 26.20, lon: 127.31 },
};

// ── APIフェッチ ────────────────────────────────────────────
async function fetchWeather() {
  const url = new URL('https://api.open-meteo.com/v1/jma');
  const p = url.searchParams;
  p.set('latitude',   LOCATIONS.naha.lat);
  p.set('longitude',  LOCATIONS.naha.lon);
  p.set('current',    'temperature_2m,wind_speed_10m,wind_direction_10m,weathercode');
  p.set('hourly',     'temperature_2m,wind_speed_10m,wind_direction_10m,weathercode');
  p.set('daily',      'weathercode,wind_speed_10m_max');
  p.set('timezone',   'Asia/Tokyo');
  p.set('forecast_days', '7');
  p.set('wind_speed_unit', 'kmh');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchWeather failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchMarine(locKey) {
  const { lat, lon } = LOCATIONS[locKey];
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  const p = url.searchParams;
  p.set('latitude',  lat);
  p.set('longitude', lon);
  p.set('hourly', 'wave_height,swell_wave_period,sea_level_height_msl,sea_surface_temperature');
  p.set('timezone', 'Asia/Tokyo');
  p.set('forecast_days', '7');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchMarine(${locKey}) failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// 5ダイビングポイントを1回のマルチ座標リクエストで取得（DIVE_POINTSと同じ並びの配列で返る）
async function fetchDivePoints() {
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  const p = url.searchParams;
  p.set('latitude',  DIVE_POINTS.map(d => d.lat).join(','));
  p.set('longitude', DIVE_POINTS.map(d => d.lon).join(','));
  p.set('hourly', 'wave_height,swell_wave_period,ocean_current_velocity,ocean_current_direction');
  p.set('timezone', 'Asia/Tokyo');
  p.set('forecast_days', '2');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`fetchDivePoints failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// 気象庁: 沖縄本島地方の警報・注意報
// 第一候補: 防災情報XML（正式配信） / 予備: bosai JSON（2026/7に停止歴あり）
async function fetchWarningsJma() {
  try {
    return await fetchWarningsViaXml();
  } catch {
    const res = await fetch('https://www.jma.go.jp/bosai/warning/data/warning/471000.json');
    if (!res.ok) throw new Error(`fetchWarningsJma failed: ${res.status} ${res.statusText}`);
    return res.json();
  }
}

// ── 警報・注意報欄を生成 ───────────────────────────────────
function buildWarningsSection(warningsJson) {
  const parsed = parseWarnings(warningsJson);
  if (!parsed) return '';  // 取得失敗時はセクションごと省略（メール自体は送る）

  // 鮮度ガード発動: 古いデータで誤誘導せず、正直に伝える
  if (parsed.stale) {
    const lastStr = parsed.reportDatetime
      ? new Date(parsed.reportDatetime).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })
      : '不明';
    return `\n━━━ 発表中の警報・注意報 ━━━\n⚠️ 気象庁の警報データが更新停止中のため表示できません（最終更新: ${lastStr}）\n→ 最新は https://www.jma.go.jp/bosai/warning/ で確認してください\n`;
  }

  const timeStr = parsed.reportDatetime
    ? new Date(parsed.reportDatetime).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
    : '';
  const header = `━━━ 発表中の警報・注意報（気象庁${timeStr ? ` ${timeStr}発表` : ''}） ━━━`;

  if (!parsed.items.length) {
    return `\n${header}\n✅ 現在、警報・注意報はありません\n`;
  }
  const lines = parsed.items.map(w =>
    `${w.emoji} ${w.name}（${w.allAreas ? '全域' : w.areaLabels.join('・')}）`
  );
  return `\n${header}\n${lines.join('\n')}\n`;
}

// ── 風向変換 ───────────────────────────────────────────────
function degToCompass(deg) {
  const dirs = ['北','北東','東','南東','南','南西','西','北西'];
  return dirs[Math.round(deg / 45) % 8];
}

// ── スコアラベル（メール専用の文言） ───────────────────────
function scoreText(score) {
  if (score >= 9) return '🌊 絶好のコンディション！';
  if (score >= 7) return '✅ 良好なコンディション';
  if (score >= 5) return '⚠️ まずまず、注意して';
  if (score >= 4) return '⚠️ 要注意（初心者は慎重に）';
  if (score >= 2) return '🚫 出港困難';
  return '⛔ 安全優先でキャンセル推奨';
}

// ── 潮汐ピーク検出 ─────────────────────────────────────────
function findPeaks(times, heights) {
  const peaks = [];
  for (let i = 1; i < heights.length - 1; i++) {
    if (heights[i] > heights[i-1] && heights[i] > heights[i+1])
      peaks.push({ time: times[i], h: heights[i], type: 'high' });
    else if (heights[i] < heights[i-1] && heights[i] < heights[i+1])
      peaks.push({ time: times[i], h: heights[i], type: 'low' });
  }
  return peaks;
}

function fmtTime(isoStr) { return isoStr.slice(11, 16); }

// ── 週間スコア生成 ─────────────────────────────────────────
function weeklyScores(weather, kerama) {
  const days     = weather.daily.time;
  const windMax  = weather.daily.wind_speed_10m_max;
  const wCode    = weather.daily.weathercode;
  const mTimes   = kerama.hourly.time;
  const mWaves   = kerama.hourly.wave_height;

  return days.map((dateStr, i) => {
    const dayWaves = mTimes
      .map((t, idx) => t.startsWith(dateStr) ? mWaves[idx] : null)
      .filter(v => v != null);
    const maxWave = dayWaves.length ? Math.max(...dayWaves) : 1.0;
    const score = calcScore({
      waveHeight: maxWave,
      windSpeed:  (windMax[i] ?? 10) / 3.6,
      weatherCode: wCode[i] ?? 0,
      swellPeriod: 8,
    });
    const icon = score >= 7 ? '✅' : score >= 4 ? '⚠️' : '❌';
    const date = new Date(dateStr + 'T00:00:00+09:00');
    const dayLabel = date.toLocaleDateString('ja-JP', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' });
    return { dayLabel, score, icon };
  });
}

// ── ポイント別コンディション欄を生成 ───────────────────────
function buildDivePointsSection(divePoints, weather) {
  if (!divePoints || !Array.isArray(divePoints)) return '';

  const nowStr = new Date().toLocaleString('sv', { timeZone: 'Asia/Tokyo' }).slice(0, 13);
  const windSpeed   = (weather.current.wind_speed_10m ?? 10) / 3.6;
  const weatherCode = weather.current.weathercode ?? 0;

  const lines = DIVE_POINTS.map((point, i) => {
    const hourly = divePoints[i]?.hourly;
    if (!hourly) return `🤿 ${point.name}:  データ取得失敗`;

    const idx    = (() => { const j = hourly.time.findIndex(t => t.startsWith(nowStr)); return j >= 0 ? j : 0; })();
    const wave   = hourly.wave_height?.[idx];
    const swellP = hourly.swell_wave_period?.[idx];
    const curV   = hourly.ocean_current_velocity?.[idx];   // km/h
    const curD   = hourly.ocean_current_direction?.[idx];

    const score = calcScore({
      waveHeight:  wave ?? 1.0,
      windSpeed,
      weatherCode,
      swellPeriod: swellP ?? 8,
    });
    const icon = score >= 7 ? '✅' : score >= 4 ? '⚠️' : '❌';

    const waveStr  = wave   != null ? `波${wave.toFixed(1)}m` : '波--';
    const swellStr = swellP != null ? `うねり${swellP.toFixed(0)}s` : 'うねり--';
    const curStr   = curV   != null ? `潮流${(curV / 3.6).toFixed(1)}m/s${curD != null ? '(' + degToCompass(curD) + ')' : ''}` : '潮流--';
    return `🤿 ${point.name}:  ${waveStr} ${swellStr} ${curStr}  ${score}/10 ${icon}`;
  });

  return `
━━━ ポイント別コンディション（優先度順） ━━━
${lines.join('\n')}
`;
}

// ── メール本文を生成 ───────────────────────────────────────
function buildEmailBody({ score, weather, naha, route, kerama, divePoints, warningsJson, todayStr, hIdx = 0 }) {
  const wCode    = weather.current.weathercode;
  const windKmh  = weather.current.wind_speed_10m.toFixed(0);
  const windDeg  = weather.current.wind_direction_10m;
  const windDir  = windDeg != null ? degToCompass(windDeg) : '';

  const nahaIdx    = (() => { const i = naha.hourly.time.findIndex(t => t.startsWith(new Date().toLocaleString('sv', { timeZone: 'Asia/Tokyo' }).slice(0, 13))); return i >= 0 ? i : 0; })();
  const routeIdx   = (() => { const i = route.hourly.time.findIndex(t => t.startsWith(new Date().toLocaleString('sv', { timeZone: 'Asia/Tokyo' }).slice(0, 13))); return i >= 0 ? i : 0; })();
  const nahaWave   = naha.hourly.wave_height?.[nahaIdx]?.toFixed(1) ?? '--';
  const routeWave  = route.hourly.wave_height?.[routeIdx]?.toFixed(1) ?? '--';
  const keramaWave = kerama.hourly.wave_height?.[hIdx]?.toFixed(1) ?? '--';
  const sst        = kerama.hourly.sea_surface_temperature?.[hIdx]?.toFixed(1) ?? '--';

  // 潮汐
  const peakTimes   = kerama.hourly.time;
  const peakHeights = kerama.hourly.sea_level_height_msl ?? [];
  const todayPeaks  = findPeaks(
    peakTimes.filter(t => t.startsWith(todayStr)),
    peakTimes.reduce((acc, t, i) => { if (t.startsWith(todayStr)) acc.push(peakHeights[i]); return acc; }, [])
  );
  const highs = todayPeaks.filter(p => p.type === 'high');
  const lows  = todayPeaks.filter(p => p.type === 'low');

  // 上げ潮・下げ潮の時間帯を連続するピークペアから算出
  const tPeriods = [];
  for (let i = 0; i < todayPeaks.length - 1; i++) {
    const from = todayPeaks[i];
    const to   = todayPeaks[i + 1];
    if (from.type === 'low' && to.type === 'high') {
      tPeriods.push({ type: 'rising',  from: fmtTime(from.time), to: fmtTime(to.time) });
    } else if (from.type === 'high' && to.type === 'low') {
      tPeriods.push({ type: 'falling', from: fmtTime(from.time), to: fmtTime(to.time) });
    }
  }
  const risingStr  = tPeriods.filter(p => p.type === 'rising') .map(p => `${p.from}→${p.to}`).join(' / ') || '--';
  const fallingStr = tPeriods.filter(p => p.type === 'falling').map(p => `${p.from}→${p.to}`).join(' / ') || '--';

  // 時刻別予報（7〜16時）
  const wTimes = weather.hourly.time;
  const wTemps = weather.hourly.temperature_2m;
  const wWinds = weather.hourly.wind_speed_10m;
  const wHDirs = weather.hourly.wind_direction_10m;
  const hourRows = wTimes.reduce((acc, t, i) => {
    if (!t.startsWith(todayStr)) return acc;
    const hr = parseInt(t.slice(11, 13));
    if (hr < 7 || hr > 16) return acc;
    const mIdx = kerama.hourly.time.indexOf(t);
    const wave = mIdx >= 0 ? kerama.hourly.wave_height[mIdx]?.toFixed(1) : '--';
    const dir  = wHDirs?.[i] != null ? degToCompass(wHDirs[i]) : '';
    acc.push(`  ${t.slice(11,16)}  ${wTemps[i]?.toFixed(0)}℃  風${wWinds[i]?.toFixed(0)}km/h(${dir})  波${wave}m`);
    return acc;
  }, []);

  // 週間スコア
  const weekly = weeklyScores(weather, kerama)
    .map(d => `  ${d.dayLabel}: ${d.score}/10 ${d.icon}`)
    .join('\n');

  const urlLine = APP_URL ? `\n詳細はアプリで: ${APP_URL}` : '';

  return `優くん、おはようございます！今日の慶良間コンディションです 🤿

━━━ 今日の出港判断 ━━━
コンディションスコア: ${score}/10
${scoreText(score)}
${buildWarningsSection(warningsJson)}
━━━ 3地点の状況 ━━━
📍 那覇港沖:  波${nahaWave}m / 風${windKmh}km/h ${windDir}
⛵ 航路中間:  波${routeWave}m
🤿 慶良間沖:  波${keramaWave}m / 海水温${sst}℃
${buildDivePointsSection(divePoints, weather)}
━━━ 今日の潮汐（慶良間） ━━━
🔼 満潮: ${highs.map(p => `${fmtTime(p.time)} (${p.h.toFixed(1)}m)`).join('  ') || '--'}
🔽 干潮: ${lows.map(p => `${fmtTime(p.time)} (${p.h.toFixed(1)}m)`).join('  ') || '--'}
🔼 上げ潮帯: ${risingStr}（干潮→満潮）
🔽 下げ潮帯: ${fallingStr}（満潮→干潮）

━━━ 時刻別予報（7:00〜16:00） ━━━
${hourRows.join('\n')}

━━━ 週間コンディション ━━━
${weekly}
${urlLine}
---


Don't forget anything! Have a safe and fun dive! 🤿🌊


このメールはGitHub Actionsで毎朝5時に自動送信されています。
`;
}

// ── メイン処理 ─────────────────────────────────────────────
async function main() {
  if (!GMAIL_USER || !GMAIL_PASSWORD || !TO_EMAIL) {
    console.error('環境変数 GMAIL_USER / GMAIL_APP_PASSWORD / TO_EMAIL を設定してください');
    process.exit(1);
  }

  console.log('📡 データ取得中...');
  const results = await Promise.allSettled([
    fetchWeather(),
    fetchMarine('naha'),
    fetchMarine('route'),
    fetchMarine('kerama'),
    fetchDivePoints(),
    fetchWarningsJma(),
  ]);
  const [weather, naha, route, kerama, divePoints, warningsJson] = results.map(r => r.status === 'fulfilled' ? r.value : null);
  if (!weather || !kerama) {
    console.error('⚠️ 必須データ（天気/慶良間）の取得に失敗しました。メール送信をスキップします。');
    process.exit(1);
  }

  const todayStr = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-').slice(0, 10);

  const nowStr = new Date().toLocaleString('sv', { timeZone: 'Asia/Tokyo' }).slice(0, 13);
  const hIdx = (() => { const i = kerama.hourly.time.findIndex(t => t.startsWith(nowStr)); return i >= 0 ? i : 0; })();
  const currentWave = kerama.hourly.wave_height?.[hIdx] ?? 1.0;
  const currentWind = weather.current.wind_speed_10m / 3.6;
  const score = calcScore({
    waveHeight:  currentWave,
    windSpeed:   currentWind,
    weatherCode: weather.current.weathercode ?? 0,
    swellPeriod: kerama.hourly.swell_wave_period?.[hIdx] ?? 8,
  });

  const body = buildEmailBody({ score, weather, naha, route, kerama, divePoints, warningsJson, todayStr, hIdx });

  // DRY_RUN=1 なら送信せずに本文を表示して終了（ローカルテスト用）
  if (process.env.DRY_RUN) {
    console.log(body);
    console.log(`(DRY_RUN: メール送信スキップ / スコア: ${score}/10)`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASSWORD },
  });

  const dateLabel = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
  });

  await transporter.sendMail({
    from: `"慶良間ダイビング気象" <${GMAIL_USER}>`,
    to: TO_EMAIL,
    subject: `🌊 今日の慶良間 コンディション ${score} out of 10 ／ ${dateLabel}`,
    text: body,
  });

  console.log(`✅ メール送信完了 → ${TO_EMAIL} (スコア: ${score}/10)`);
}

main().catch(err => { console.error('エラー:', err); process.exit(1); });
