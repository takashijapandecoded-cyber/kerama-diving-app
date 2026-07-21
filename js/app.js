import { fetchAll } from './api.js';
import { calcScore, calcSubScores, warningScoreCap, findCurrentHourIndex } from './score.js';
import { parseWarnings } from './warnings.js';
import {
  renderHero,
  renderConditionCards,
  renderDivePoints,
  renderWarningChips,
  renderCalendar,
  renderTideChart,
  renderForecastTable,
  renderFooter,
  renderDataInfo,
} from './ui.js';

// データの「署名」を作る（APIの更新タイムスタンプで判定）
function dataSignature(weather, kerama, warningsJson) {
  const t1 = weather?.current?.time ?? '';
  const t2 = kerama?.hourly?.time?.[0] ?? '';
  // 警報の発表時刻も署名に含める（2026-07-21）:
  // 天気・海況が変わらんまま警報だけ新しく発表された場合、以前は署名が変わらず
  // 「🔄予報更新」ボタンが出んかった（開きっぱなしのタブで最大1時間、警報の反映が遅れる）。
  // 安全に直結するデータやけん取りこぼさない
  const t3 = warningsJson?.reportDatetime ?? '';
  // タイムスタンプが変わった＝新しいデータが来た
  return `${t1}_${t2}_${t3}`;
}

function renderAll(epic, weather, naha, route, kerama, divePoints, warningsJson) {
  const warnings = parseWarnings(warningsJson);

  // フェイルセーフ（2026-07-19 評議会 裁可項目1）:
  // 欠損を「良好」な値で埋めない。波・風が取れんときは calcScore が null（判定不能）を返し、
  // renderHero が灰色の「判定不能」を表示する。現在時刻がデータに無い（＝古い・凍結）場合も同じ扱い
  const hIdx         = findCurrentHourIndex(kerama?.hourly?.time ?? []);
  const currentWave  = hIdx >= 0 ? kerama.hourly.wave_height?.[hIdx] : undefined;
  const currentSwell = hIdx >= 0 ? kerama.hourly.swell_wave_period?.[hIdx] : undefined;
  const currentWind  = weather?.current?.wind_speed_10m != null ? weather.current.wind_speed_10m / 3.6 : undefined;
  const currentCode  = weather?.current?.weathercode;

  const inputs    = { waveHeight: currentWave, windSpeed: currentWind, weatherCode: currentCode, swellPeriod: currentSwell };
  const rawScore  = calcScore(inputs);
  // 気象庁の警報・注意報が発表中はスコアに上限（官の警報を自作スコアが黙殺しない）
  const cap       = warningScoreCap(warnings);
  const score     = rawScore == null ? null : Math.min(rawScore, cap);
  const subScores = calcSubScores(inputs);
  subScores.temp  = weather?.current?.temperature_2m != null ? Math.round(weather.current.temperature_2m) : null;

  renderHero(epic, score, subScores, { capped: rawScore != null && cap < rawScore });
  renderWarningChips(warnings);
  renderConditionCards(weather, naha, route, kerama);
  renderDivePoints(divePoints, weather, warnings);
  renderDataInfo(weather);
  renderTideChart(kerama);
  renderCalendar(weather, kerama);
  renderForecastTable(weather, kerama, warnings);
  renderFooter(weather);
}

async function main() {
  // 日付はAPIを待たずに即座に表示
  const heroDate = document.getElementById('hero-date');
  if (heroDate) {
    heroDate.textContent = new Date().toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
    });
  }

  // ?debug=nodata で全データ欠損時の画面（判定不能表示）を再現できる（動作確認用）
  const data = new URLSearchParams(location.search).get('debug') === 'nodata'
    ? { epic: null, weather: null, naha: null, route: null, kerama: null, divePoints: null, warnings: null }
    : await fetchAll();
  let currentSig = dataSignature(data.weather, data.kerama, data.warnings);
  renderAll(data.epic, data.weather, data.naha, data.route, data.kerama, data.divePoints, data.warnings);

  const updateBtn = document.getElementById('update-btn');
  let latestData  = data;
  let lastChecked = Date.now();

  // 新データを確認して、変化あればボタンを出す
  async function checkForUpdate() {
    try {
      const fresh    = await fetchAll();
      const freshSig = dataSignature(fresh.weather, fresh.kerama, fresh.warnings);
      if (freshSig !== currentSig) {
        latestData = fresh;
        updateBtn.classList.remove('hidden'); // ぴこぴこ出現！
      }
      lastChecked = Date.now();
    } catch { /* ネットエラーは無視 */ }
  }

  // 10分ごとにバックグラウンドでチェック
  setInterval(checkForUpdate, 10 * 60 * 1000);

  // モバイル対応: 画面に戻ってきたとき（スリープ復帰・アプリ切り替え後）も即チェック
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // 最後のチェックから5分以上経っていれば再チェック
      if (Date.now() - lastChecked > 5 * 60 * 1000) {
        checkForUpdate();
      }
    }
  });

  updateBtn.addEventListener('click', () => {
    currentSig = dataSignature(latestData.weather, latestData.kerama, latestData.warnings);
    renderAll(latestData.epic, latestData.weather, latestData.naha, latestData.route, latestData.kerama, latestData.divePoints, latestData.warnings);
    updateBtn.classList.add('hidden');
  });
}

main().catch(err => {
  console.error('データ取得エラー:', err);
  document.getElementById('score-text').textContent =
    'データ取得に失敗しました。しばらくしてリロードしてください。';
});
