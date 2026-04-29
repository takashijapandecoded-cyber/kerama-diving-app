import { fetchAll } from './api.js';
import { calcScore } from './score.js';
import { SCORE_THRESHOLDS } from './config.js';
import {
  renderHero,
  renderConditionCards,
  renderCalendar,
  renderTideChart,
  renderForecastTable,
  renderFooter,
  renderDataInfo,
  renderSatelliteImage,
} from './ui.js';

// 各要素の個別スコアを計算して内訳チップ用に返す
function calcSubScores({ waveHeight, windSpeed, weatherCode, swellPeriod }) {
  function fromTable(v, table) {
    for (const e of table) if (v <= e.max) return e.score;
    return 0;
  }
  function swellScore(p) {
    for (const e of SCORE_THRESHOLDS.swellPeriod) if (p >= e.min) return e.score;
    return 3;
  }
  function weatherScore(c) {
    if (c <= 1) return 10; if (c <= 3) return 9; if (c <= 49) return 7;
    if (c <= 59) return 5; if (c <= 69) return 4; if (c <= 79) return 3;
    if (c <= 82) return 4; if (c <= 84) return 3; if (c <= 94) return 6;
    return 0;
  }
  return {
    wave:    fromTable(waveHeight, SCORE_THRESHOLDS.wave),
    wind:    fromTable(windSpeed,  SCORE_THRESHOLDS.wind),
    weather: weatherScore(weatherCode),
    swell:   swellScore(swellPeriod),
  };
}

// データの「署名」を作る（APIの更新タイムスタンプで判定）
function dataSignature(weather, kerama) {
  const t1 = weather?.current?.time ?? '';
  const t2 = kerama?.hourly?.time?.[0] ?? '';
  // タイムスタンプが変わった＝新しいデータが来た
  return `${t1}_${t2}`;
}

function renderAll(epic, weather, naha, route, kerama) {
  const currentWave  = kerama?.hourly.wave_height?.[0]       ?? 1.0;
  const currentWind  = (weather?.current?.wind_speed_10m ?? 10) / 3.6;
  const currentCode  = weather?.current?.weathercode          ?? 0;
  const currentSwell = kerama?.hourly.swell_wave_period?.[0]  ?? 8;

  const score     = calcScore({ waveHeight: currentWave, windSpeed: currentWind, weatherCode: currentCode, swellPeriod: currentSwell });
  const subScores = calcSubScores({ waveHeight: currentWave, windSpeed: currentWind, weatherCode: currentCode, swellPeriod: currentSwell });
  subScores.temp  = weather?.current?.temperature_2m != null ? Math.round(weather.current.temperature_2m) : null;

  renderHero(epic, score, subScores);
  renderConditionCards(weather, naha, route, kerama);
  renderDataInfo(weather);
  renderTideChart(kerama);
  renderCalendar(weather, kerama);
  renderForecastTable(weather, kerama);
  renderFooter();
}

async function main() {
  const data = await fetchAll();
  let currentSig = dataSignature(data.weather, data.kerama);
  renderAll(data.epic, data.weather, data.naha, data.route, data.kerama);

  // 30分ごとに静かに新データを確認
  const updateBtn = document.getElementById('update-btn');
  let latestData  = data;

  setInterval(async () => {
    try {
      const fresh    = await fetchAll();
      const freshSig = dataSignature(fresh.weather, fresh.kerama);
      if (freshSig !== currentSig) {
        latestData = fresh;
        updateBtn.classList.remove('hidden'); // ぴこぴこ出現！
      }
    } catch { /* ネットエラーは無視 */ }
  }, 10 * 60 * 1000); // 10分ごとにチェック

  updateBtn.addEventListener('click', () => {
    currentSig = dataSignature(latestData.weather, latestData.kerama);
    renderAll(latestData.epic, latestData.weather, latestData.naha, latestData.route, latestData.kerama);
    updateBtn.classList.add('hidden');
  });
}

main().catch(err => {
  console.error('データ取得エラー:', err);
  document.getElementById('score-text').textContent =
    'データ取得に失敗しました。しばらくしてリロードしてください。';
});
