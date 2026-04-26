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

async function main() {
  const { epic, weather, naha, route, kerama } = await fetchAll();

  const currentWave  = kerama?.hourly.wave_height?.[0]       ?? 1.0;
  const currentWind  = (weather?.current?.wind_speed_10m ?? 10) / 3.6; // m/s
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

main().catch(err => {
  console.error('データ取得エラー:', err);
  document.getElementById('score-text').textContent =
    'データ取得に失敗しました。しばらくしてリロードしてください。';
});
