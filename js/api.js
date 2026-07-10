import { LOCATIONS, DIVE_POINTS, NASA_API_KEY } from './config.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5分キャッシュ

function cacheKey(name) {
  const dateStr = new Date().toISOString().slice(0, 13); // 1時間単位
  return `diving_cache_${name}_${dateStr}`;
}

function fromCache(name) {
  try {
    const raw = sessionStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function toCache(name, data) {
  try {
    sessionStorage.setItem(cacheKey(name), JSON.stringify({ data, ts: Date.now() }));
  } catch { /* ストレージ制限でも無視 */ }
}

// NASA EPIC: 最新の地球衛星画像を取得
export async function fetchEpicImage() {
  const cached = fromCache('epic');
  if (cached) return cached;

  const res = await fetch(
    `https://api.nasa.gov/EPIC/api/natural?api_key=${NASA_API_KEY}`
  );
  if (!res.ok) throw new Error('NASA EPIC API エラー');
  const images = await res.json();
  if (!images.length) throw new Error('EPIC 画像なし');

  const img = images[0];
  const d = img.date.slice(0, 10).replace(/-/g, '/');
  const result = {
    url: `https://epic.gsfc.nasa.gov/archive/natural/${d}/jpg/${img.image}.jpg`,
    caption: img.caption,
    date: img.date,
  };
  toCache('epic', result);
  return result;
}

// Open-Meteo JMA: 那覇の天気予報（現在値 + 時刻別）
export async function fetchWeather() {
  const cached = fromCache('weather');
  if (cached) return cached;

  const { lat, lon } = LOCATIONS.naha;
  const url = new URL('https://api.open-meteo.com/v1/jma');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', 'temperature_2m,wind_speed_10m,wind_direction_10m,weathercode');
  url.searchParams.set('hourly', 'temperature_2m,wind_speed_10m,wind_direction_10m,weathercode,precipitation_probability');
  url.searchParams.set('daily', 'weathercode,temperature_2m_max,wind_speed_10m_max');
  url.searchParams.set('timezone', 'Asia/Tokyo');
  url.searchParams.set('forecast_days', '7');
  url.searchParams.set('wind_speed_unit', 'kmh');

  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo 天気 API エラー');
  const data = await res.json();
  toCache('weather', data);
  return data;
}

// Open-Meteo Marine: 各地点の海況（波高・うねり・潮汐）
export async function fetchMarine(locationKey) {
  const cacheKeyName = `marine_${locationKey}`;
  const cached = fromCache(cacheKeyName);
  if (cached) return cached;

  const { lat, lon } = LOCATIONS[locationKey];
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('hourly', [
    'wave_height',
    'wave_direction',
    'wave_period',
    'swell_wave_height',
    'swell_wave_direction',
    'swell_wave_period',
    'wind_wave_height',
    'sea_level_height_msl',
    'sea_surface_temperature',
  ].join(','));
  url.searchParams.set('timezone', 'Asia/Tokyo');
  url.searchParams.set('forecast_days', '7');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo Marine API エラー (${locationKey})`);
  const data = await res.json();
  toCache(cacheKeyName, data);
  return data;
}

// Open-Meteo Marine: 5ダイビングポイントを1回のマルチ座標リクエストで取得
// レスポンスはポイントごとの配列で返る（DIVE_POINTS と同じ並び）
export async function fetchDivePoints() {
  const cached = fromCache('divepoints');
  if (cached) return cached;

  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude',  DIVE_POINTS.map(p => p.lat).join(','));
  url.searchParams.set('longitude', DIVE_POINTS.map(p => p.lon).join(','));
  url.searchParams.set('hourly', [
    'wave_height',
    'swell_wave_height',
    'swell_wave_period',
    'swell_wave_direction',
    'ocean_current_velocity',
    'ocean_current_direction',
  ].join(','));
  url.searchParams.set('timezone', 'Asia/Tokyo');
  url.searchParams.set('forecast_days', '2');

  const res = await fetch(url);
  if (!res.ok) throw new Error('Open-Meteo Marine API エラー (dive points)');
  const data = await res.json();
  toCache('divepoints', data);
  return data;
}

// 気象庁: 沖縄本島地方の警報・注意報（無料・キー不要・CORS対応確認済み）
export async function fetchWarnings() {
  const cached = fromCache('warnings');
  if (cached) return cached;

  const res = await fetch('https://www.jma.go.jp/bosai/warning/data/warning/471000.json');
  if (!res.ok) throw new Error('気象庁 警報API エラー');
  const data = await res.json();
  toCache('warnings', data);
  return data;
}

// 3地点＋天気＋EPIC＋ダイビングポイント＋警報を並列取得
export async function fetchAll() {
  const [epicResult, weatherResult, nahaResult, routeResult, keramaResult, divePointsResult, warningsResult] =
    await Promise.allSettled([
      fetchEpicImage(),
      fetchWeather(),
      fetchMarine('naha'),
      fetchMarine('route'),
      fetchMarine('kerama'),
      fetchDivePoints(),
      fetchWarnings(),
    ]);

  return {
    epic:       epicResult.status       === 'fulfilled' ? epicResult.value       : null,
    weather:    weatherResult.status    === 'fulfilled' ? weatherResult.value    : null,
    naha:       nahaResult.status       === 'fulfilled' ? nahaResult.value       : null,
    route:      routeResult.status      === 'fulfilled' ? routeResult.value      : null,
    kerama:     keramaResult.status     === 'fulfilled' ? keramaResult.value     : null,
    divePoints: divePointsResult.status === 'fulfilled' ? divePointsResult.value : null,
    warnings:   warningsResult.status   === 'fulfilled' ? warningsResult.value   : null,
  };
}
