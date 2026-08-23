import { calcScore, scoreLabel, calendarIcon, findTidePeaks, todayPeaks, tidePeriods, findCurrentHourIndex, warningScoreCap } from './score.js';
import { getWeatherIcon } from '../assets/weather-icons.js';
import { CALENDAR_THRESHOLD, DIVE_POINTS } from './config.js';

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

export function renderHero(epic, score, subScores, { capped = false } = {}) {
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

  const { text, color } = scoreLabel(score);
  const banner  = document.getElementById('go-nogo-banner');
  const capNote = document.getElementById('score-cap-note');

  // フェイルセーフ表示: データが無い・古いときは緑を出さず「判定不能」を明示
  // （2026-07-19 評議会 裁可項目1。以前は欠損を良好値で埋めて出港OKが出とった）
  if (score == null) {
    if (banner) {
      banner.textContent = '⚠️ 判定不能 — データ取得失敗';
      banner.className = 'banner-nodata';
      document.body.classList.add('banner-visible');
    }
    document.getElementById('score-text').textContent =
      'データを取得できません。気象庁の発表と現地の海況で判断してください。';
    document.getElementById('score-container').style.borderColor = color;
    if (capNote) capNote.textContent = '';
    return;
  }

  // 出港判断バナー
  if (banner) {
    if (score >= 7) {
      banner.textContent = '✅ 出港OK（要現地確認）';
      banner.className = 'banner-go';
    } else if (score >= 4) {
      banner.textContent = '⚠️ 要確認';
      banner.className = 'banner-caution';
    } else {
      banner.textContent = '🚫 出港困難';
      banner.className = 'banner-nogo';
    }
    // バナー表示時にナビを押し下げる
    document.body.classList.add('banner-visible');
  }

  // 警報による上限適用中はその旨を明示
  if (capNote) {
    capNote.textContent = capped ? '⚠️ 警報・注意報の発表中のため、スコアに上限を適用しています' : '';
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

  // 内訳チップ（スコアに応じて値の色を変える。欠損は -- のまま）
  if (subScores) {
    const scoreColor = s => s >= 8 ? '#22c55e' : s >= 6 ? '#84cc16' : s >= 4 ? '#f59e0b' : '#ef4444';
    for (const [key, val] of [['wave', subScores.wave], ['wind', subScores.wind], ['weather', subScores.weather], ['swell', subScores.swell]]) {
      const el = document.getElementById(`sub-${key}-val`);
      if (el) {
        el.textContent = val ?? '--';
        el.style.color = val != null ? scoreColor(val) : 'var(--muted)';
        el.style.fontWeight = '800';
      }
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
  const wCode   = weather?.current?.weathercode;
  const wIcon   = wCode != null ? getWeatherIcon(wCode) : null; // 欠損時に「快晴」と出さない
  const windDir = weather?.current?.wind_direction_10m;
  const compass = windDir != null ? degToCompass(windDir) : '';

  // 現在時刻がデータに無い（idx=-1、古い・凍結）場合は値を出さず -- にする
  // 那覇港 (天気データ + 那覇海況)
  const nahaIdx = naha ? findCurrentHourIndex(naha.hourly.time) : -1;
  setCardData('naha', {
    wave:    naha && nahaIdx >= 0 ? `${naha.hourly.wave_height[nahaIdx].toFixed(1)} m` : '--',
    wind:    weather?.current?.wind_speed_10m != null ? `${weather.current.wind_speed_10m.toFixed(1)} m/s ${compass}`.trim() : '--',
    weather: wIcon   ? `${wIcon.emoji} ${wIcon.label}` : '--',
  });

  // 航路中間
  const routeIdx = route ? findCurrentHourIndex(route.hourly.time) : -1;
  setCardData('route', {
    wave:    route && routeIdx >= 0 ? `${route.hourly.wave_height[routeIdx].toFixed(1)} m` : '--',
    wind:    weather?.current?.wind_speed_10m != null ? `${weather.current.wind_speed_10m.toFixed(1)} m/s ${compass}`.trim() : '--',
    weather: wIcon   ? `${wIcon.emoji} ${wIcon.label}` : '--',
  });

  // 慶良間ダイブエリア
  const keramaIdx = kerama ? findCurrentHourIndex(kerama.hourly.time) : -1;
  const sst   = keramaIdx >= 0 ? kerama.hourly.sea_surface_temperature?.[keramaIdx] : null;
  const swell = keramaIdx >= 0 ? kerama.hourly.swell_wave_period?.[keramaIdx] : null;
  setCardData('kerama', {
    wave:  kerama && keramaIdx >= 0 ? `${kerama.hourly.wave_height[keramaIdx].toFixed(1)} m` : '--',
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

// ── 警報・注意報チップ（今日ページ） ────────────────────────

// 台風のチップ。警報チップと同じ行に折り返して並ぶので、平常時に増える高さはゼロ。
// 警報と同じく4状態を出し分ける（取得失敗 / 台風なし / 影響なし / 確率あり）
function typhoonChips(result) {
  if (!result) return '';
  if (result.status === 'unavailable') {
    return '<span class="warn-chip warn-unavailable">🌀 台風情報を取得できません</span>';
  }
  const list = result.typhoons ?? [];
  if (!list.length) return '<span class="warn-chip warn-none">🌀 台風なし</span>';

  const primary = result.primary;
  const label = tcShort;
  if (!primary) {
    // 全部0% = 今日の判断に効かん。名前を並べず件数にまとめる
    const head = `<span class="warn-chip warn-tc">🌀 ${label(list[0])} 影響なし</span>`;
    const rest = list.length > 1
      ? `<span class="warn-chip warn-tc">ほか${list.length - 1}つ 影響なし</span>` : '';
    return head + rest;
  }
  const pct  = primary.probabilitySummary?.max ?? 0;
  const rest = list.length > 1
    ? `<span class="warn-chip warn-tc">ほか${list.length - 1}つ 影響なし</span>` : '';
  return `<span class="warn-chip warn-warning">🌀 ${label(primary)} 暴風域 ${pct}%</span>${rest}`;
}

export function renderWarningChips(warnings, typhoonResult = null) {
  const box = document.getElementById('warning-chips');
  if (!box) return;
  const tc = typhoonChips(typhoonResult);

  // 4状態を明示: 取得失敗・更新停止・発表なし・発表あり。
  // 「何も出さない」は取得失敗と平穏の区別がつかんため廃止（2026-07-19 評議会）
  if (!warnings) {
    box.innerHTML = '<span class="warn-chip warn-unavailable">⚠️ 警報情報を取得できません — 気象庁で確認を</span>' + tc;
    return;
  }
  if (warnings.stale) {
    box.innerHTML = '<span class="warn-chip warn-unavailable">⚠️ 警報データが更新停止中 — 気象庁で確認を</span>' + tc;
    return;
  }
  const items = warnings.items;
  if (!items.length) {
    box.innerHTML = '<span class="warn-chip warn-none">✅ 警報・注意報なし</span>' + tc;
    return;
  }

  box.innerHTML = items.map(w => {
    const area = w.allAreas ? '' : `<span class="warn-area">・${w.areaLabels.join('・')}</span>`;
    return `<span class="warn-chip warn-${w.level}">${w.emoji} ${w.name}${area}</span>`;
  }).join('') + tc;
}

// ── ポイント別コンディション（海況ページ） ──────────────────

export function renderDivePoints(divePoints, weather, warnings) {
  const container = document.getElementById('dive-points');
  if (!container) return;

  // 警報情報が取れとらん場合はポイント一覧の上に明示（無警報と区別する）
  const warnNotice = (!warnings || warnings.stale)
    ? '<div class="dp-warn-unavailable">⚠️ 警報情報を取得できません（気象庁で確認を）</div>'
    : '';

  if (!divePoints || !Array.isArray(divePoints)) {
    container.classList.remove('skeleton-loading');
    container.innerHTML = warnNotice + '<div class="dive-point-error">-- ポイント別データの取得に失敗しました --</div>';
    return;
  }

  // 風・天気は地域共通（那覇の現在値）、波・うねりはポイント別。欠損は埋めず判定不能に落とす
  const windSpeed   = weather?.current?.wind_speed_10m;  // m/s（APIで指定済み）
  const weatherCode = weather?.current?.weathercode;

  const rows = DIVE_POINTS.map((point, i) => {
    // このポイントのエリアに出とる警報・注意報（深刻度順ソート済みなので先頭が最重要）
    const pointWarns = warnings?.items?.filter(w => w.areaKeys.includes(point.warnKey)) ?? [];
    const worst      = pointWarns[0];
    const rowClass   = worst ? ` has-warn-${worst.level}` : '';
    // 警報名を全部小さく表示（絵文字だけだと種類が分からんため）
    const warnLabels = pointWarns.length
      ? `<div class="dp-warns">${pointWarns.map(w => `<span class="dp-warn-label lvl-${w.level}">${w.emoji}${w.name}</span>`).join('')}</div>`
      : '';

    const hourly = divePoints[i]?.hourly;
    if (!hourly) {
      return `<div class="dive-point-row${rowClass}">
        <div class="dp-name"><div class="dp-title">${point.name}</div><div class="dp-note">${point.note}</div>${warnLabels}</div>
        <div class="dp-error">-- 取得失敗</div>
      </div>`;
    }

    const hIdx    = findCurrentHourIndex(hourly.time ?? []);
    const wave    = hIdx >= 0 ? hourly.wave_height?.[hIdx] : undefined;
    const swellP  = hIdx >= 0 ? hourly.swell_wave_period?.[hIdx] : undefined;
    const swellD  = hIdx >= 0 ? hourly.swell_wave_direction?.[hIdx] : undefined;
    // Marine APIは current_velocity_unit を無視して常に km/h を返すため、ここだけ変換が要る
    const curV    = hIdx >= 0 ? hourly.ocean_current_velocity?.[hIdx] : undefined;   // km/h
    const curD    = hIdx >= 0 ? hourly.ocean_current_direction?.[hIdx] : undefined;

    const rawScore = calcScore({ waveHeight: wave, windSpeed, weatherCode, swellPeriod: swellP });
    // このポイントのエリアに出とる警報で上限（総合スコアと同じルール）
    const score = rawScore == null ? null : Math.min(rawScore, warningScoreCap({ items: pointWarns }));
    const { color } = scoreLabel(score);

    return `<div class="dive-point-row${rowClass}">
      <div class="dp-name">
        <div class="dp-title">${point.name}</div>
        <div class="dp-note">${point.note}</div>
        ${warnLabels}
      </div>
      <div class="dp-metrics">
        <div class="dp-metric"><span class="dp-label">波</span><span class="dp-val">${wave != null ? wave.toFixed(1) + 'm' : '--'}</span></div>
        <div class="dp-metric"><span class="dp-label">うねり</span><span class="dp-val">${swellP != null ? swellP.toFixed(0) + 's' : '--'}${swellD != null ? ' ' + degToCompass(swellD) : ''}</span></div>
        <div class="dp-metric"><span class="dp-label">潮流</span><span class="dp-val">${curV != null ? (curV / 3.6).toFixed(1) + 'm/s' : '--'}${curD != null ? ' ' + degToCompass(curD) : ''}</span></div>
      </div>
      <span class="score-chip" style="background:${color}">${score ?? '--'}</span>
    </div>`;
  });

  container.innerHTML = warnNotice + rows.join('');
  container.classList.remove('skeleton-loading');
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
    // その日の最大波高を marine hourly から取得（データが無い日は判定不能）
    const dayWaves = marineHours
      .map((t, idx) => t.startsWith(dateStr) ? waveHourly[idx] : null)
      .filter(v => v != null);
    const maxWave = dayWaves.length ? Math.max(...dayWaves) : undefined;

    const score = calcScore({
      waveHeight:  maxWave,
      windSpeed:   windArr[i],  // m/s（APIで指定済み）
      weatherCode: wCodeArr[i],
      swellPeriod: 8,
    });

    const icon = calendarIcon(score);
    const date = new Date(dateStr + 'T00:00:00+09:00');
    const dayLabel = date.toLocaleDateString('ja-JP', { weekday: 'short' });
    const dayNum   = date.getDate();

    return { dayLabel, dayNum, score, icon };
  });

  container.innerHTML = cells.map(c => `
    <div class="cal-cell ${c.score == null ? 'cal-na' : calClass(c.score)}">
      <div class="cal-day">${c.dayLabel}</div>
      <div class="cal-num">${c.dayNum}</div>
      <div class="cal-score">${c.score ?? '--'}</div>
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

  // Chart.js（CDN）が読めんかった場合はグラフだけ諦める（満干潮の数値は上で表示済み。
  // ここで例外を出すと後続の週間・時刻別の描画まで全部止まるため）
  if (typeof Chart === 'undefined') return;

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

export function renderForecastTable(weather, kerama, warnings) {
  const tbody = document.getElementById('forecast-tbody');
  if (!weather?.hourly || !kerama?.hourly) return;

  // 今日の発表中警報による上限（総合スコアと同じルール）
  const cap = warningScoreCap(warnings);

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

    // 対応する海況を取得（欠損は埋めず判定不能に落とす）
    const mIdx  = mTimes.indexOf(t);
    const wave  = mIdx >= 0 ? mWaves[mIdx] : undefined;
    const rawScore = calcScore({
      waveHeight:  wave,
      windSpeed:   wWinds[i],  // m/s（APIで指定済み）
      weatherCode: wCodes[i],
      swellPeriod: 8,
    });
    const score = rawScore == null ? null : Math.min(rawScore, cap);
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
      <td>${r.wind?.toFixed(1) ?? '--'} m/s<br><span class="wind-dir">${r.dir}</span></td>
      <td>${r.wave != null ? r.wave.toFixed(1) + ' m' : '--'}</td>
      <td><span class="score-chip" style="background:${r.color}">${r.score ?? '--'}</span></td>
    </tr>
  `).join('');

  tbody.classList.remove('skeleton-loading');
}

// ── フッター ────────────────────────────────────────────────

// フッターにはデータ側の時刻を出す。以前は描画した瞬間の時計を「最終更新」と
// 表示しとったため、古いデータでも常に新鮮に見えとった（2026-07-19 評議会 裁可項目1）
export function renderFooter(weather) {
  const t = weather?.current?.time;
  const str = t
    ? new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) + ' JST'
    : '--';
  document.getElementById('last-updated').textContent = `データ時刻: ${str}（予報の基準時刻）`;
}

// ── データ時刻・ソース（Page 1） ────────────────────────────

export function renderDataInfo(weather) {
  const el = document.getElementById('data-info');
  if (!el) return;
  const t = weather?.current?.time;
  const timeStr = t
    ? new Date(t).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) + ' JST'
    : '--';
  el.innerHTML = `📡 ${timeStr}時点 | JMA予報 · Marine API · 気象庁警報 · NASA EPIC`;
}

// ── 台風カード（2026-08-24 追加）────────────────────────────
// 置き場所は #warning-chips の直下・#score-container の上。
// 台風はスコアが下がる「原因」なので、結果（スコア）より先に読ませる。

const KERAMA_LL = { lat: 26.20, lon: 127.31 };
// 発表からこれ以上経っとったら「情報が古い」と明示する
const TC_STALE_MS = 6 * 60 * 60 * 1000;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 気象庁の typhoonNumber は「2618」＝2026年の第18号。そのまま出すと「台風2618号」になる。
// 熱帯低気圧には番号が付かん（'d' などが入る）ので、その場合は階級名だけにする
function tcTitle(t) {
  const num = /^\d{4}$/.test(t?.number ?? '') ? Number(String(t.number).slice(2)) : null;
  const head = num ? `台風${num}号` : (t?.category ?? '熱帯低気圧');
  return t?.name ? `${head} ${t.name}` : head;
}
function tcShort(t) {
  const num = /^\d{4}$/.test(t?.number ?? '') ? Number(String(t.number).slice(2)) : null;
  return num ? `台風${num}号` : (t?.category ?? '熱帯低気圧');
}

function tcDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' });
}

// 確率に応じた既存カレンダーのクラス（緑・黄・赤・判定不能）
function tcCellClass(pct) {
  if (pct == null) return 'cal-na';
  if (pct >= 50) return 'cal-bad';
  if (pct > 0)   return 'cal-caution';
  return 'cal-good';
}
function tcPctColor(pct) {
  if (pct == null) return 'var(--muted)';
  if (pct >= 50) return '#f87171';
  if (pct > 0)   return 'var(--caution)';
  return 'var(--go)';
}

// 予報進路の図を組み立てる。
// 緯度経度をそのまま置き、距離の縦横比を合わせるので、円の大きさは実際の半径どおりになる。
// 固定値を焼き込まず毎回計算するのは、台風ごとに位置も半径も変わるため。
function buildTyphoonMap(typhoon) {
  const blocks = [typhoon.analysis, ...typhoon.forecasts].filter(Boolean);
  if (blocks.length < 2) return '';

  const KM_PER_DEG_LAT = 111.13;
  const kmPerDegLon = 111.32 * Math.cos(KERAMA_LL.lat * Math.PI / 180);

  // 円がはみ出さんよう、半径ぶん余裕を持たせて範囲を決める。
  // 暴風域と予報円の大きい方で測る（終盤は暴風域が消えて予報円だけが大きくなる）
  const lons = [KERAMA_LL.lon], lats = [KERAMA_LL.lat];
  for (const b of blocks) {
    const rKm = Math.max(b.stormRadiusKm ?? 0, b.probabilityCircleKm ?? 0, 0);
    lons.push(b.lon - rKm / kmPerDegLon, b.lon + rKm / kmPerDegLon);
    lats.push(b.lat - rKm / KM_PER_DEG_LAT, b.lat + rKm / KM_PER_DEG_LAT);
  }
  const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const latMin = Math.min(...lats), latMax = Math.max(...lats);

  const W = 320, PAD = 14;
  const sx = (W - PAD * 2) / Math.max(lonMax - lonMin, 0.01);        // px / 度(経度)
  const sy = sx * (KM_PER_DEG_LAT / kmPerDegLon);                     // 距離として正しい縦横比
  const H = Math.round((latMax - latMin) * sy + PAD * 2);
  const px = lon => PAD + (lon - lonMin) * sx;
  const py = lat => PAD + (latMax - lat) * sy;
  const pxPerKm = sx / kmPerDegLon;

  const storm = blocks
    .filter(b => b.stormRadiusKm)
    .map(b => `<circle cx="${px(b.lon).toFixed(1)}" cy="${py(b.lat).toFixed(1)}" r="${(b.stormRadiusKm * pxPerKm).toFixed(1)}"/>`)
    .join('');
  // 予報円＝予報位置のばらつき。描かんと進路が確定しとるように見える
  const probCircle = blocks
    .filter(b => b.probabilityCircleKm)
    .map(b => `<circle cx="${px(b.lon).toFixed(1)}" cy="${py(b.lat).toFixed(1)}" r="${(b.probabilityCircleKm * pxPerKm).toFixed(1)}"/>`)
    .join('');
  const line = blocks.map(b => `${px(b.lon).toFixed(1)},${py(b.lat).toFixed(1)}`).join(' ');
  const dots = blocks
    .map(b => `<circle cx="${px(b.lon).toFixed(1)}" cy="${py(b.lat).toFixed(1)}" r="${b.isAnalysis ? 4 : 3.4}"/>`)
    .join('');

  const kx = px(KERAMA_LL.lon), ky = py(KERAMA_LL.lat);

  return `
    <svg class="tc-map" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="${esc(typhoon.name ?? '台風')}の予報進路。円は暴風域、破線の円は予報位置のばらつき、×印が慶良間諸島。">
      <g fill="none" stroke="rgba(148,163,184,0.7)" stroke-width="1" stroke-dasharray="3 3">${probCircle}</g>
      <g fill="rgba(239,68,68,0.16)" stroke="rgba(239,68,68,0.55)" stroke-width="1.1">${storm}</g>
      <polyline points="${line}" fill="none" stroke="#e2e8f0" stroke-width="1.8" stroke-dasharray="6 5" opacity=".85"/>
      <g fill="#ef4444">${dots}</g>
      <g stroke="#00b4d8" stroke-width="2.6" stroke-linecap="round">
        <line x1="${(kx - 5).toFixed(1)}" y1="${(ky - 5).toFixed(1)}" x2="${(kx + 5).toFixed(1)}" y2="${(ky + 5).toFixed(1)}"/>
        <line x1="${(kx + 5).toFixed(1)}" y1="${(ky - 5).toFixed(1)}" x2="${(kx - 5).toFixed(1)}" y2="${(ky + 5).toFixed(1)}"/>
      </g>
      <text x="${kx.toFixed(1)}" y="${(ky + 18).toFixed(1)}" fill="#00b4d8" font-size="11.5" font-weight="700" text-anchor="middle">慶良間</text>
    </svg>`;
}

function buildTyphoonDetail(typhoon) {
  const a = typhoon.analysis;
  const rows = [];
  if (a?.stormRadiusKm) rows.push(['暴風域', `半径 ${a.stormRadiusKm}km`]);
  if (a?.pressure)      rows.push(['中心気圧', `${a.pressure} hPa`]);
  if (a?.course)        rows.push(['進行', `${esc(a.course)}へ`]);

  const track = [typhoon.analysis, ...typhoon.forecasts].filter(Boolean).map(b => {
    const t = b.validTime ? new Date(b.validTime).toLocaleString('ja-JP',
      { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit' }) : '--';
    const hot = b.insideStorm === true;
    return `<div class="card-row${hot ? ' tc-row-hot' : ''}">
      <span class="label">${esc(t)}${hot ? ' 内側' : ''}</span>
      <span class="value">${b.distanceKm}km${b.windMs != null ? ` ／ ${b.windMs}m/s` : ''}</span>
    </div>`;
  }).join('');

  return `
    <details class="tc-more">
      <summary><span class="lb-o">進路と接近の推移を見る</span><span class="lb-c">閉じる</span><span class="arw">▾</span></summary>
      ${rows.length ? `<div class="tc-sec">いまの台風</div>${rows.map(([k, v]) =>
        `<div class="card-row"><span class="label">${esc(k)}</span><span class="value">${esc(v)}</span></div>`).join('')}` : ''}
      <div class="tc-sec">どこから来るか</div>
      ${buildTyphoonMap(typhoon)}
      <div class="tc-legend">
        <span><i class="st"></i>暴風域</span>
        <span><i class="pc"></i>予報円（位置のばらつき）</span>
        <span><i class="kr"></i>慶良間</span>
      </div>
      <div class="tc-foot">緯度・経度をそのまま置いた図。距離の縦横比を合わせてあるので、円の大きさは実際の半径どおり。</div>
      <div class="tc-sec">どれくらいで来るか</div>
      ${track}
      <div class="tc-foot">「内側」は、その時刻に慶良間が暴風域の半径の内側に入る見込みであることを示す。</div>
    </details>`;
}

// typhoons: fetchTyphoons() の戻り値 / outlook: dailyOutlook() の戻り値
export function renderTyphoon(result, outlook) {
  const box = document.getElementById('typhoon-card');
  if (!box) return;

  const typhoon = result?.primary;
  if (!typhoon) { box.innerHTML = ''; return; }

  const issued = typhoon.issued ? new Date(typhoon.issued) : null;
  const stale = issued ? Date.now() - issued.getTime() > TC_STALE_MS : false;

  const cells = (outlook ?? []).map(d => `
    <div class="cal-cell ${tcCellClass(d.percent)}${d.isToday ? ' is-today' : ''}">
      <div class="cal-day">${d.isToday ? '今日' : ''} ${esc(d.weekday)}</div>
      <div class="cal-num">${d.dayNum}</div>
      <div class="cal-score" style="color:${tcPctColor(d.percent)}">${d.percent == null ? '—' : d.percent + '%'}</div>
      <div class="cal-icon">${d.waveMax == null ? '波 —' : '波 ' + d.waveMax.toFixed(1) + 'm'}</div>
    </div>`).join('');

  // 50%を最初に超える日 ＝ 段取りを決める日
  const hit = (outlook ?? []).find(d => d.percent != null && d.percent >= 50);
  const maxPct = typhoon.probabilitySummary?.max ?? 0;
  const nearest = [typhoon.analysis, ...typhoon.forecasts]
    .filter(Boolean).reduce((m, b) => (m == null || b.distanceKm < m.distanceKm ? b : m), null);

  const lead = hit
    ? `${tcDayLabel(hit.date)}までに暴風域に入る確率 ${hit.percent}%`
    : `4日先までに暴風域に入る確率 最大 ${maxPct}%`;
  const nearestLine = nearest && !nearest.isAnalysis
    ? `<br>最も近づくのは ${esc(new Date(nearest.validTime).toLocaleString('ja-JP',
        { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' }))}・${nearest.distanceKm}km`
    : '';

  const a = typhoon.analysis;
  const sub = [
    a ? `慶良間まで ${a.distanceKm}km` : null,
    a?.course ? `${esc(a.course)}へ` : null,
    a?.windMs != null ? `最大風速 ${a.windMs}m/s` : null,
  ].filter(Boolean).join(' ／ ');

  box.innerHTML = `
    <div class="tc-card ${stale ? 'lvl-stale' : 'lvl-danger'}">
      <div class="tc-head">
        <div>
          <div class="card-title">🌀 ${esc(tcTitle(typhoon))}</div>
          <div class="card-subtitle">${sub}</div>
        </div>
        <span class="score-chip" style="background:${maxPct >= 50 ? 'var(--danger)' : 'var(--caution)'}">${maxPct}%</span>
      </div>
      <div class="tc-grid">${cells}</div>
      <div class="tc-grid-cap">上段＝その日までに暴風域に入る確率（慶良間・粟国諸島）／ 下段＝慶良間沖の最大波高</div>
      <div class="tc-note ${maxPct >= 50 ? 'hot' : ''}">${lead}${nearestLine}</div>
      ${buildTyphoonDetail(typhoon)}
      ${stale ? '<div class="tc-note">⚠️ 気象庁の発表から時間が経っています。最新は気象庁でご確認ください。</div>' : ''}
      <div class="tc-src">気象庁 ${issued ? esc(issued.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : '--'} 発表</div>
    </div>`;
}
