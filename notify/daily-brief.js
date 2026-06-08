import nodemailer from 'nodemailer';

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

// ── 風向変換 ───────────────────────────────────────────────
function degToCompass(deg) {
  const dirs = ['北','北東','東','南東','南','南西','西','北西'];
  return dirs[Math.round(deg / 45) % 8];
}

// ── スコア計算（score.js と同じロジック） ──────────────────
function calcScore({ waveHeight, windSpeed, weatherCode, swellPeriod }) {
  const waveScore = waveHeight < 0.5 ? 10 : waveHeight < 1.0 ? 8 :
                    waveHeight < 1.5 ? 6  : waveHeight < 2.0 ? 4 :
                    waveHeight < 2.5 ? 2  : 0;
  const windScore = windSpeed < 5  ? 10 : windSpeed < 10 ? 8 :
                    windSpeed < 15 ? 6  : windSpeed < 20 ? 3 :
                    windSpeed < 25 ? 1  : 0;
  function scoreWeatherCode(code) {
    if (code <= 1)  return 10;  // 快晴
    if (code <= 2)  return 9;   // 晴れ
    if (code <= 3)  return 7;   // 曇り
    if (code === 45 || code === 48) return 5;  // 霧
    if (code >= 51 && code <= 55)   return 7;  // 霧雨
    if (code >= 61 && code <= 65)   return 5;  // 雨
    if (code >= 71 && code <= 77)   return 3;  // 雪・みぞれ
    if (code >= 80 && code <= 82)   return 4;  // にわか雨（弱〜中）
    if (code >= 83 && code <= 84)   return 3;  // にわか雨（強）
    if (code >= 85 && code <= 86)   return 2;  // 雪のにわか雨
    if (code >= 95) return 0;   // 雷雨
    return 6;                   // その他
  }
  const wScore    = scoreWeatherCode(weatherCode);
  const sScore    = swellPeriod >= 10 ? 10 : swellPeriod >= 8 ? 7 :
                    swellPeriod >= 6  ? 5  : 3;
  const raw = waveScore * 0.4 + windScore * 0.35 + wScore * 0.15 + sScore * 0.10;
  return Math.round(Math.min(10, Math.max(1, raw)));
}

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

// ── メール本文を生成 ───────────────────────────────────────
function buildEmailBody({ score, weather, naha, route, kerama, todayStr, hIdx = 0 }) {
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

━━━ 3地点の状況 ━━━
📍 那覇港沖:  波${nahaWave}m / 風${windKmh}km/h ${windDir}
⛵ 航路中間:  波${routeWave}m
🤿 慶良間沖:  波${keramaWave}m / 海水温${sst}℃

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
  const [weather, naha, route, kerama] = await Promise.all([
    fetchWeather(),
    fetchMarine('naha'),
    fetchMarine('route'),
    fetchMarine('kerama'),
  ]);

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

  const body = buildEmailBody({ score, weather, naha, route, kerama, todayStr, hIdx });

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
