import { calcScore, scoreLabel, calendarIcon, findTidePeaks, todayPeaks, tidePeriods, findCurrentHourIndex } from './score.js';
import { getWeatherIcon } from '../assets/weather-icons.js';
import { CALENDAR_THRESHOLD } from './config.js';

// SVGリングの円周（r=80）
const CIRCUMFERENCE = 2 * Math.PI * 80; // ≈ 502.65

// 風向（度数）→ 8方位ラベル
function degToCompass(deg) {
  const dirs = ['北','北東','東','南東','南','南西','西','北西'];
  return dirs[Math.round(deg / 45) % 8];
}

// 慶良間は本島の西: 東風は山が壁になり比較的穏やか
function windProtectionNote(deg) {
  if (deg >= 45 && deg <= 135)  return '🛡 東風 → 慶良間エリアは比較的穏やか';
  if (deg >= 225 && deg <= 315) return '💨 西風 → 慶良間に直接風が当たる';
  return null;
}

// ── ヒーロー・スコア ────────────────────────────────────────

export function renderHero(epic, score, subScores) {
  // 今日の日付
  const today = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
  document.getElementById('hero-date').textContent = today;

  // NASA EPIC 背景画像
  if (epic?.url) {
    document.getElementById('hero-bg').style.backgroundImage = `url('${epic.url}')`;
    document.getElementById('epic-caption').textContent =
      `🛰 NASAが撮影した地球（${epic.date?.slice(0, 10) ?? ''}）`;
  }

  if (score == null) return;
  const { text, color } = scoreLabel(score);

  // 出港判断バナー
  const banner = document.getElementById('go-nogo-banner');
  if (banner) {
    if (score >= 7) {
      banner.textContent = '✅ 出港OK';
      banner.className = 'banner-go';
    } else if (score >= 4) {
      banner.textContent = '⚠️ 要確認';
      banner.className = 'banner-caution';
    } else {
      banner.textContent = '🚫 出港困難';
      banner.className = 'banner-nogo';
    }
  }

  // SVG リングゲージ
  const ring = document.getElementById('score-ring-circle');
  const offset = CIRCUMFERENCE * (1 - score / 10);
  setRingGradient(score);
  setTimeout(() => { ring.style.strokeDashoffset = offset; }, 100);

  // リング中央の数字（カウントアップ）
  const numEl = document.getElementById('ring-num');
  animateCount(numEl, 0, score, 1200);

  // ラベル
  document.getElementById('score-text').textContent = text;

  // カード枠の色
  document.getElementById('score-container').style.borderColor = color;

  // 内訳チップ（スコアに応じて値の色を変える）
  if (subScores) {
    const scoreColor = s => s >= 8 ? '#22c55e' : s >= 6 ? '#84cc16' : s >= 4 ? '#f59e0b' : '#ef4444';
    for (const [key, score] of [['wave', subScores.wave], ['wind', subScores.wind], ['weather', subScores.weather], ['swell', subScores.swell]]) {
      const el = document.getElementById(`sub-${key}-val`);
      if (el) { el.textContent = score; el.style.color = scoreColor(score); el.style.fontWeight = '800'; }
    }
    const tempEl = document.getElementById('sub-temp-val');
    if (tempEl) tempEl.textContent = subScores.temp != null ? `${subScores.temp}℃` : '--';
  }
}

// スコアに応じてSVGグラデーションの色域を動的に変える
function setRingGradient(score) {
  const grad = document.getElementById('ring-grad');
  let start, end;
  if (score <= 2)      { start = '#7f1d1d'; end = '#ef4444'; }  // 深赤 → 赤
  else if (score <= 4) { start = '#ef4444'; end = '#f97316'; }  // 赤 → 橙
  else if (score <= 6) { start = '#f97316'; end = '#facc15'; }  // 橙 → 黄
  else if (score <= 8) { start = '#84cc16'; end = '#22c55e'; }  // 黄緑 → 緑
  else                 { start = '#22c55e'; end = '#0ea5e9'; }  // 緑 → 海青
  grad.innerHTML = `
    <stop offset="0%"   stop-color="${start}"/>
    <stop offset="100%" stop-color="${end}"/>
  `;
}

// 数字カウントアップアニメーション
function animateCount(el, from, to, duration) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * ease);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── 3地点カード ────────────────────────────────────────────

export function renderConditionCards(weather, naha, route, kerama) {
  const wCode   = weather?.current?.weathercode ?? 0;
  const wIcon   = getWeatherIcon(wCode);
  const windDir = weather?.current?.wind_direction_10m;
  const compass = windDir != null ? degToCompass(windDir) : '';

  // 那覇港 (天気データ + 那覇海況)
  const nahaIdx = naha ? findCurrentHourIndex(naha.hourly.time) : 0;
  setCardData('naha', {
    wave:    naha    ? `${naha.hourly.wave_height[nahaIdx].toFixed(1)} m` : '--',
    wind:    weather ? `${weather.current.wind_speed_10m.toFixed(0)} km/h ${compass}`.trim() : '--',
    weather: wIcon   ? `${wIcon.emoji} ${wIcon.label}` : '--',
  });

  // 航路中間
  const routeIdx = route ? findCurrentHourIndex(route.hourly.time) : 0;
  setCardData('route', {
    wave:    route   ? `${route.hourly.wave_height[routeIdx].toFixed(1)} m` : '--',
    wind:    weather ? `${weather.current.wind_speed_10m.toFixed(0)} km/h ${compass}`.trim() : '--',
    weather: wIcon   ? `${wIcon.emoji} ${wIcon.label}` : '--',
  });

  // 慶良間ダイブエリア
  const keramaIdx = kerama ? findCurrentHourIndex(kerama.hourly.time) : 0;
  const sst   = kerama?.hourly.sea_surface_temperature?.[keramaIdx];
  const swell = kerama?.hourly.swell_wave_period?.[keramaIdx];
  setCardData('kerama', {
    wave:  kerama    ? `${kerama.hourly.wave_height[keramaIdx].toFixed(1)} m` : '--',
    swell: swell != null ? `${swell.toFixed(0)} s` : '--',
    sst:   sst   != null ? `${sst.toFixed(1)} ℃` : '--',
  });

  // 風向アドバイス（慶良間への影響）
  const noteEl = document.getElementById('wind-advisory');
  if (noteEl) {
    const note = windDir != null ? windProtectionNote(windDir) : null;
    noteEl.textContent = note ?? '';
    noteEl.style.display = note ? '' : 'none';
  }

  // スケルトン解除
  ['naha', 'route', 'kerama'].forEach(id => {
    document.querySelector(`#card-${id} .card-body`)?.classList.remove('skeleton-loading');
  });
}

function setCardData(prefix, data) {
  for (const [key, val] of Object.entries(data)) {
    const el = document.getElementById(`${prefix}-${key}`);
    if (el) el.textContent = val;
  }
}

// ── 週間カレンダー ─────────────────────────────────────────

export function renderCalendar(weather, kerama) {
  const container = document.getElementById('calendar-grid');
  if (!weather?.daily || !kerama?.hourly) return;

  const times = weather.daily.time;          // ["2026-04-26", ...]
  const windArr  = weather.daily.wind_speed_10m_max;
  const wCodeArr = weather.daily.weathercode;
  const waveHourly = kerama.hourly.wave_height;
  const marineHours = kerama.hourly.time;

  const cells = times.map((dateStr, i) => {
    // その日の最大波高を marine hourly から取得
    const dayWaves = marineHours
      .map((t, idx) => t.startsWith(dateStr) ? waveHourly[idx] : null)
      .filter(v => v != null);
    const maxWave = dayWaves.length ? Math.max(...dayWaves) : 1.0;

    const score = calcScore({
      waveHeight:  maxWave,
      windSpeed:   (windArr[i] ?? 10) / 3.6, // km/h → m/s
      weatherCode: wCodeArr[i] ?? 0,
      swellPeriod: 8,
    });

    const icon = calendarIcon(score);
    const date = new Date(dateStr + 'T00:00:00+09:00');
    const dayLabel = date.toLocaleDateString('ja-JP', { weekday: 'short' });
    const dayNum   = date.getDate();

    return { dayLabel, dayNum, score, icon };
  });

  container.innerHTML = cells.map(c => `
    <div class="cal-cell ${calClass(c.score)}">
      <div class="cal-day">${c.dayLabel}</div>
      <div class="cal-num">${c.dayNum}</div>
      <div class="cal-score">${c.score}</div>
      <div class="cal-icon">${c.icon}</div>
    </div>
  `).join('');

  container.classList.remove('skeleton-loading');
}

function calClass(score) {
  if (score >= CALENDAR_THRESHOLD.good)    return 'cal-good';
  if (score >= CALENDAR_THRESHOLD.caution) return 'cal-caution';
  return 'cal-bad';
}

// ── 潮汐グラフ ─────────────────────────────────────────────

let tideChart = null;

export function renderTideChart(kerama) {
  if (!kerama?.hourly) return;

  const allTimes   = kerama.hourly.time;
  const allHeights = kerama.hourly.sea_level_height_msl;
  if (!allHeights) return;

  // 今日〜明日48時間分を抽出
  const todayStr = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');

  const indices = allTimes.reduce((acc, t, i) => {
    if (t >= todayStr.slice(0, 10)) acc.push(i);
    return acc;
  }, []).slice(0, 48);

  const labels  = indices.map(i => allTimes[i].slice(11, 16));   // HH:MM
  const heights = indices.map(i => allHeights[i]);

  // 満潮・干潮検出
  const peaks = findTidePeaks(
    indices.map(i => allTimes[i]),
    heights
  );

  // 今日の満潮・干潮を表示
  const tPeaks  = todayPeaks(peaks);
  const highs   = tPeaks.filter(p => p.type === 'high');
  const lows    = tPeaks.filter(p => p.type === 'low');
  const fmtTime = t => t.slice(11, 16);

  document.getElementById('tide-high').innerHTML =
    `🔼 満潮: ${highs.map(p => `<span>${fmtTime(p.time)} (${p.height.toFixed(1)}m)</span>`).join('  ') || '<span>--</span>'}`;
  document.getElementById('tide-low').innerHTML =
    `🔽 干潮: ${lows.map(p => `<span>${fmtTime(p.time)} (${p.height.toFixed(1)}m)</span>`).join('  ') || '<span>--</span>'}`;

  const periods    = tidePeriods(tPeaks);
  const risingStr  = periods.filter(p => p.type === 'rising') .map(p => `${p.from} → ${p.to}`).join('  /  ') || '--';
  const fallingStr = periods.filter(p => p.type === 'falling').map(p => `${p.from} → ${p.to}`).join('  /  ') || '--';
  document.getElementById('tide-best').innerHTML =
    `🔼 上げ潮帯: <span>${risingStr}</span><br>🔽 下げ潮帯: <span>${fallingStr}</span>`;

  // Chart.js グラフ
  const ctx = document.getElementById('tide-chart').getContext('2d');
  if (tideChart) tideChart.destroy();

  // ピーク注釈用データセット
  const pointStyles = heights.map((_, idx) => {
    const t = indices[idx];
    const match = peaks.find(p => p.time === allTimes[t]);
    return match ? (match.type === 'high' ? '▲' : '▽') : '';
  });

  tideChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '海面高度 (m)',
        data: heights,
        borderColor: '#00b4d8',
        backgroundColor: 'rgba(0,180,216,0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toFixed(2)} m`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: '#94a3b8',
            maxTicksLimit: 12,
            maxRotation: 0,
          },
          grid: { color: 'rgba(148,163,184,0.1)' },
        },
        y: {
          ticks: { color: '#94a3b8', callback: v => `${v.toFixed(1)}m` },
          grid: { color: 'rgba(148,163,184,0.1)' },
        },
      },
    },
  });
}

// ── 時刻別予報テーブル ──────────────────────────────────────

export function renderForecastTable(weather, kerama) {
  const tbody = document.getElementById('forecast-tbody');
  if (!weather?.hourly || !kerama?.hourly) return;

  const wTimes  = weather.hourly.time;
  const wTemps  = weather.hourly.temperature_2m;
  const wWinds  = weather.hourly.wind_speed_10m;
  const wDirs   = weather.hourly.wind_direction_10m;
  const wCodes  = weather.hourly.weathercode;
  const mTimes  = kerama.hourly.time;
  const mWaves  = kerama.hourly.wave_height;

  // 今日の日付を section title に反映
  const dateSpan = document.getElementById('forecast-date');
  if (dateSpan) {
    dateSpan.textContent = new Date().toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short',
    });
  }

  // 今日の7〜16時に絞る
  const todayStr = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-').slice(0, 10);

  const rows = wTimes.reduce((acc, t, i) => {
    if (!t.startsWith(todayStr)) return acc;
    const hour = parseInt(t.slice(11, 13));
    if (hour < 7 || hour > 16) return acc;

    // 対応する海況を取得
    const mIdx  = mTimes.indexOf(t);
    const wave  = mIdx >= 0 ? mWaves[mIdx] : null;
    const score = calcScore({
      waveHeight:  wave ?? 1.0,
      windSpeed:   (wWinds[i] ?? 10) / 3.6,
      weatherCode: wCodes[i] ?? 0,
      swellPeriod: 8,
    });
    const icon = getWeatherIcon(wCodes[i] ?? 0);
    const { color } = scoreLabel(score);

    const compass = wDirs?.[i] != null ? degToCompass(wDirs[i]) : '';
    acc.push({ time: t.slice(11, 16), icon, temp: wTemps[i], wind: wWinds[i], dir: compass, wave, score, color });
    return acc;
  }, []);

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="td-time">${r.time}</td>
      <td>${r.icon?.emoji ?? '--'}</td>
      <td>${r.temp?.toFixed(0) ?? '--'}℃</td>
      <td>${r.wind?.toFixed(0) ?? '--'} km/h<br><span class="wind-dir">${r.dir}</span></td>
      <td>${r.wave != null ? r.wave.toFixed(1) + ' m' : '--'}</td>
      <td><span class="score-chip" style="background:${r.color}">${r.score}</span></td>
    </tr>
  `).join('');

  tbody.classList.remove('skeleton-loading');
}

// ── フッター ────────────────────────────────────────────────

export function renderFooter() {
  const now = new Date().toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
  });
  document.getElementById('last-updated').textContent = `最終更新: ${now}`;
}

// ── データ時刻・ソース（Page 1） ────────────────────────────

export function renderDataInfo(weather) {
  const el = document.getElementById('data-info');
  if (!el) return;
  const t = weather?.current?.time;
  const timeStr = t
    ? new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) + ' JST'
    : '--';
  el.innerHTML = `📡 ${timeStr}時点 | JMA予報 · Marine API · NASA EPIC`;
}
