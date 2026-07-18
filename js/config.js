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
  { key: 'shimosone', name: '下曽根',         lat: 26.06, lon: 127.24, note: '久場島南・外洋',           warnKey: 'kerama' },
  { key: 'uchizan',   name: 'ウチザン礁',     lat: 26.25, lon: 127.40, note: '前島〜渡嘉敷間・流れ強め', warnKey: 'kerama' },
  { key: 'kuroshima', name: '黒島北',         lat: 26.24, lon: 127.33, note: 'ツインロック',             warnKey: 'kerama' },
  { key: 'triangle',  name: 'トライアングル', lat: 26.055, lon: 127.575, note: '本島南・糸満沖',         warnKey: 'itoman' },
  { key: 'aguni',     name: '粟国（筆ん崎）', lat: 26.57, lon: 127.21, note: '遠征・ギンガメ',           warnKey: 'aguni' },
  { key: 'tonaki',    name: '渡名喜',         lat: 26.37, lon: 127.14, note: '遠征・慶良間北西',         warnKey: 'tonaki' },
  { key: 'sugarhill', name: 'シュガーヒル',   lat: 26.26, lon: 127.57, note: 'チービシ・砂の丘',         warnKey: 'kerama' },
  { key: 'kuefu',     name: 'クエフ北',       lat: 26.25, lon: 127.59, note: 'チービシ・近場',           warnKey: 'kerama' },
];

// 気象庁 警報・注意報の監視対象エリア（市町村コード）
// チービシ（ナガンヌ・クエフ）は行政上は渡嘉敷村のため kerama に含む
export const WARNING_AREAS = {
  naha:   { codes: ['4720100'], label: '那覇' },
  kerama: { codes: ['4735300', '4735400'], label: '慶良間' }, // 渡嘉敷村＋座間味村
  itoman: { codes: ['4721000'], label: '糸満' },              // トライアングル
  aguni:  { codes: ['4734800'], label: '粟国' },
  tonaki: { codes: ['4735000'], label: '渡名喜' },
};

// 警報スコア連動（2026-07-19 評議会 裁可項目1）
// 海に関わる警報・注意報の発表中は、モデル値が穏やかでもスコアに上限を掛ける
// （気象庁の公式警報を自作スコアが黙殺しない構造にするため）
export const SEA_WARNING_CODES = new Set([
  '02', '05', '07', '08', // 暴風雪・暴風・波浪・高潮 警報
  '15', '16', '19',       // 強風・波浪・高潮 注意報
]);
export const WARNING_SCORE_CAPS = {
  emergency: 1, // 特別警報（全種）: キャンセル推奨まで
  warning:   3, // 海関連の警報: 出港困難まで
  advisory:  6, // 海関連の注意報: 要確認まで（出港OKは出さない）
};

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

// 波高ペナルティ係数（優くんの体感に合わせて調整するレバー）
// 加重平均が波高スコアを超えた分に掛ける減点率:
//   0.0 = 旧方式（加重平均のみ・甘い）
//   0.5 = 中間（現在の設定）
//   1.0 = 完全キャップ（総合は波高スコアが天井・辛い）
export const WAVE_PENALTY_FACTOR = 0.5;

// 週間カレンダー用: スコアしきい値
export const CALENDAR_THRESHOLD = {
  good: 7,    // 7以上 → ✅
  caution: 4, // 4〜6 → ⚠
  // 3以下 → ❌
};
