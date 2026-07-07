// 3地点の座標
export const LOCATIONS = {
  naha: {
    name: '那覇港沖',
    lat: 26.21,
    lon: 127.67,
  },
  route: {
    name: '航路中間',
    lat: 26.18,
    lon: 127.45,
  },
  kerama: {
    name: '慶良間沖',
    lat: 26.20,
    lon: 127.31,
  },
};

// ダイビングポイント（優くん優先度順）
// 座標はおおよその位置。Marine APIの格子は約5kmなので数百m単位の精度は不要
// TODO: 優くんに実際のピン位置を確認してもらい必要なら微調整
export const DIVE_POINTS = [
  { key: 'shimosone', name: '下曽根',         lat: 26.06, lon: 127.24, note: '久場島南・外洋' },
  { key: 'uchizan',   name: 'ウチザン礁',     lat: 26.25, lon: 127.40, note: '前島〜渡嘉敷間・流れ強め' },
  { key: 'kuroshima', name: '黒島北',         lat: 26.24, lon: 127.33, note: 'ツインロック' },
  { key: 'triangle',  name: 'トライアングル', lat: 26.10, lon: 127.21, note: '上級・ドリフト' },
  { key: 'aguni',     name: '粟国（筆ん崎）', lat: 26.57, lon: 127.21, note: '遠征・ギンガメ' },
];

// NASA EPIC API キー（無料のDEMO_KEYを使用）
// DEMO_KEYは日40回の制限あり。本番では https://api.nasa.gov で無料APIキーを取得してGitHub Secretsに設定推奨
export const NASA_API_KEY = 'DEMO_KEY';

// スコア計算のしきい値
export const SCORE_THRESHOLDS = {
  wave: [
    { max: 0.5,  score: 10 },
    { max: 1.0,  score: 8 },
    { max: 1.5,  score: 6 },
    { max: 2.0,  score: 4 },
    { max: 2.5,  score: 2 },
    { max: Infinity, score: 0 },
  ],
  wind: [
    { max: 5,   score: 10 },
    { max: 10,  score: 8 },
    { max: 15,  score: 6 },
    { max: 20,  score: 3 },
    { max: 25,  score: 1 },
    { max: Infinity, score: 0 },
  ],
  swellPeriod: [
    { min: 10, score: 10 },
    { min: 8,  score: 7 },
    { min: 6,  score: 5 },
    { min: 0,  score: 3 },
  ],
};

// スコアの重み（合計 = 1.0）
export const SCORE_WEIGHTS = {
  wave: 0.40,
  wind: 0.35,
  weather: 0.15,
  swellPeriod: 0.10,
};

// 週間カレンダー用: スコアしきい値
export const CALENDAR_THRESHOLD = {
  good: 7,    // 7以上 → ✅
  caution: 4, // 4〜6 → ⚠
  // 3以下 → ❌
};
