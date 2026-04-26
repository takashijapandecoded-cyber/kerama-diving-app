// WMO天気コード → 絵文字＋日本語ラベル
export const WEATHER_CODES = {
  0:  { emoji: '☀️',  label: '快晴' },
  1:  { emoji: '🌤️',  label: '晴れ' },
  2:  { emoji: '⛅',  label: '晴れ時々曇り' },
  3:  { emoji: '☁️',  label: '曇り' },
  45: { emoji: '🌫️',  label: '霧' },
  48: { emoji: '🌫️',  label: '霧氷' },
  51: { emoji: '🌦️',  label: '霧雨（弱）' },
  53: { emoji: '🌦️',  label: '霧雨' },
  55: { emoji: '🌧️',  label: '霧雨（強）' },
  61: { emoji: '🌧️',  label: '雨（弱）' },
  63: { emoji: '🌧️',  label: '雨' },
  65: { emoji: '🌧️',  label: '雨（強）' },
  71: { emoji: '🌨️',  label: '雪（弱）' },
  73: { emoji: '🌨️',  label: '雪' },
  75: { emoji: '❄️',  label: '雪（強）' },
  80: { emoji: '🌦️',  label: 'にわか雨（弱）' },
  81: { emoji: '🌧️',  label: 'にわか雨' },
  82: { emoji: '🌧️',  label: 'にわか雨（強）' },
  95: { emoji: '⛈️',  label: '雷雨' },
  96: { emoji: '⛈️',  label: '雷雨＋ひょう' },
  99: { emoji: '⛈️',  label: '激しい雷雨' },
};

export function getWeatherIcon(code) {
  // 完全一致を先に探す
  if (WEATHER_CODES[code]) return WEATHER_CODES[code];
  // 範囲で探す
  if (code <= 3)  return WEATHER_CODES[code] ?? WEATHER_CODES[3];
  if (code <= 49) return WEATHER_CODES[45];
  if (code <= 55) return WEATHER_CODES[53];
  if (code <= 65) return WEATHER_CODES[63];
  if (code <= 75) return WEATHER_CODES[73];
  if (code <= 82) return WEATHER_CODES[81];
  return WEATHER_CODES[95];
}
