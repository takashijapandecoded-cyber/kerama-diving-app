// 気象庁 警報・注意報の解析（ブラウザ・Node共用の純粋ロジック）
import { WARNING_AREAS } from './config.js';

// 気象庁標準の警報・注意報コード表
export const WARNING_CODES = {
  // 特別警報
  '32': { name: '暴風雪特別警報', emoji: '🌨️', level: 'emergency' },
  '33': { name: '大雨特別警報',   emoji: '☔', level: 'emergency' },
  '35': { name: '暴風特別警報',   emoji: '🌀', level: 'emergency' },
  '36': { name: '大雪特別警報',   emoji: '❄️', level: 'emergency' },
  '37': { name: '波浪特別警報',   emoji: '🌊', level: 'emergency' },
  '38': { name: '高潮特別警報',   emoji: '📈', level: 'emergency' },
  // 警報
  '02': { name: '暴風雪警報', emoji: '🌨️', level: 'warning' },
  '03': { name: '大雨警報',   emoji: '☔', level: 'warning' },
  '04': { name: '洪水警報',   emoji: '🏞️', level: 'warning' },
  '05': { name: '暴風警報',   emoji: '🌀', level: 'warning' },
  '06': { name: '大雪警報',   emoji: '❄️', level: 'warning' },
  '07': { name: '波浪警報',   emoji: '🌊', level: 'warning' },
  '08': { name: '高潮警報',   emoji: '📈', level: 'warning' },
  // 注意報
  '10': { name: '大雨注意報', emoji: '☔', level: 'advisory' },
  '12': { name: '大雪注意報', emoji: '❄️', level: 'advisory' },
  '13': { name: '風雪注意報', emoji: '🌨️', level: 'advisory' },
  '14': { name: '雷注意報',   emoji: '⚡', level: 'advisory' },
  '15': { name: '強風注意報', emoji: '💨', level: 'advisory' },
  '16': { name: '波浪注意報', emoji: '🌊', level: 'advisory' },
  '18': { name: '洪水注意報', emoji: '🏞️', level: 'advisory' },
  '19': { name: '高潮注意報', emoji: '📈', level: 'advisory' },
  '20': { name: '濃霧注意報', emoji: '🌫️', level: 'advisory' },
  '21': { name: '乾燥注意報', emoji: '🍂', level: 'advisory' },
  '23': { name: '低温注意報', emoji: '🥶', level: 'advisory' },
};

const LEVEL_ORDER = { emergency: 0, warning: 1, advisory: 2 };

// 「解除」や「発表警報・注意報はなし」は無効。発表・継続のみ有効
const ACTIVE_STATUS = new Set(['発表', '継続', '特別警報から警報', '特別警報から注意報', '警報から注意報']);

// ── 防災情報XML（正式配信ルート）からの取得 ─────────────────
// bosai JSON が2026/7に配信停止した際の乗り換え先。
// Atomフィード → 最新の沖縄気象台 VPWW54（気象警報・注意報 H27形式）→ bosai JSON互換に変換

const XML_FEED_URL      = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';   // 直近約10時間
const XML_FEED_LONG_URL = 'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml'; // 直近約1週間（約3MB）

// フェッチのタイムアウト（応答待ちで画面全体が固まるのを防ぐ）
const FETCH_TIMEOUT_MS = 10 * 1000;
function timeoutSignal() { try { return AbortSignal.timeout?.(FETCH_TIMEOUT_MS); } catch { return undefined; } }

// 平穏な日は短期フィードに警報エントリが無い（発表が無い＝平穏）ため、
// 長期フィードで確定したXMLのURLを時刻つきで覚えておき、3MBの再取得を減らす。
// 記憶を信用してええのは「短期フィードが生きとって沖縄エントリが無い」かつ
// 「確定から6時間以内」のときだけ: それより新しい発表があれば必ず短期フィード
// （約10時間分）に載るため、この条件下では記憶＝最新が保証される。
// 無条件に記憶を優先すると新しい警報を見逃す（2026-07-19 評議会 裁可項目8）
const MEMO_KEY = 'diving_warnings_xml_url_v2';
const MEMO_TRUST_MS = 6 * 60 * 60 * 1000;
function memoGet() {
  try { return JSON.parse(globalThis.sessionStorage?.getItem(MEMO_KEY)); } catch { return null; }
}
function memoSet(url) {
  try { globalThis.sessionStorage?.setItem(MEMO_KEY, JSON.stringify({ url, at: Date.now() })); } catch { /* 無視 */ }
}

// フィード自体の生存確認: 全国分のフィードは平常時でも数分おきに更新されるため、
// <updated> が6時間以上古ければ配信側の停止とみなす（bosai凍結の教訓。
// 「平穏で新発表が無い」と「配信が死んで届かん」を区別するための仕組み）
const FEED_ALIVE_MS = 6 * 60 * 60 * 1000;
export function feedIsAlive(feedText, now = Date.now()) {
  const m = feedText.match(/<updated>([^<]+)<\/updated>/);
  const t = m ? new Date(m[1]).getTime() : NaN;
  return Number.isFinite(t) && now - t <= FEED_ALIVE_MS;
}

// フィードから最新の沖縄警報XML（VPWW54_471000）のURLを返す（フィードは新しい順）
export function pickLatestWarningXmlUrl(feedText) {
  const m = feedText.match(/href="(https:\/\/www\.data\.jma\.go\.jp\/[^"]*_VPWW54_471000\.xml)"/);
  return m ? m[1] : null;
}

// VPWW54 XML を bosai JSON 互換の形 { reportDatetime, areaTypes } に変換
// （parseWarnings・鮮度ガードをそのまま再利用するため）
export function xmlToWarningJson(xmlText) {
  const dtMatch = xmlText.match(/<ReportDateTime>([^<]+)<\/ReportDateTime>/);
  if (!dtMatch) return null;

  // 市町村単位のブロックだけを対象にする（他に地域まとめ・時系列ブロックがある）
  const blockMatch = xmlText.match(/<Warning type="気象警報・注意報（市町村等）">([\s\S]*?)<\/Warning>/);
  if (!blockMatch) return null;

  const areas = [];
  for (const item of blockMatch[1].match(/<Item>[\s\S]*?<\/Item>/g) ?? []) {
    const areaCode = item.match(/<Area>[\s\S]*?<Code>(\d+)<\/Code>/)?.[1];
    if (!areaCode) continue;
    const warnings = [];
    for (const kind of item.match(/<Kind>[\s\S]*?<\/Kind>/g) ?? []) {
      const code   = kind.match(/<Code>(\d+)<\/Code>/)?.[1];
      const status = kind.match(/<Status>([^<]+)<\/Status>/)?.[1];
      if (code && status) warnings.push({ code, status });
    }
    areas.push({ code: areaCode, warnings });
  }

  // via: 'xml' … フィード経由の取得であることの印。
  // フィードでは「新しい発表が無い＝前回発表が今も有効」なので、鮮度ガードを適用しない
  return { reportDatetime: dtMatch[1], areaTypes: [{ areas }], via: 'xml' };
}

async function fetchAndConvert(url) {
  const xmlRes = await fetch(url, { signal: timeoutSignal() });
  if (!xmlRes.ok) throw new Error('気象庁警報XML取得エラー');
  const json = xmlToWarningJson(await xmlRes.text());
  if (!json) throw new Error('気象庁警報XMLの解析に失敗');
  return json;
}

// フィード→XML→変換 の一連の取得（ブラウザ・Node共用）
// 短期フィード → (無ければ) 信用期間内の記憶URL → 長期フィード の順で探す
export async function fetchWarningsViaXml() {
  const feedRes = await fetch(XML_FEED_URL, { signal: timeoutSignal() });
  if (!feedRes.ok) throw new Error('気象庁XMLフィード取得エラー');
  const feedText = await feedRes.text();
  if (!feedIsAlive(feedText)) throw new Error('気象庁XMLフィードが更新停止中');
  const url = pickLatestWarningXmlUrl(feedText);
  if (url) {
    memoSet(url);
    return fetchAndConvert(url);
  }

  // 短期フィードに無い＝直近10時間発表なし（平穏）。
  // 信用期間内の記憶URLがあれば最新が保証される（上記コメント参照）
  const memo = memoGet();
  if (memo?.url && Date.now() - memo.at < MEMO_TRUST_MS) {
    try { return await fetchAndConvert(memo.url); } catch { /* 消えた場合は長期へ */ }
  }

  const longRes = await fetch(XML_FEED_LONG_URL, { signal: timeoutSignal() });
  if (!longRes.ok) throw new Error('気象庁XML長期フィード取得エラー');
  const longUrl = pickLatestWarningXmlUrl(await longRes.text());
  if (!longUrl) throw new Error('沖縄の警報XMLがフィードに見つかりません');
  memoSet(longUrl);
  return fetchAndConvert(longUrl);
}

// 鮮度ガード: 発表時刻がこれより古いデータは「配信停止中」とみなして表示しない
// （2026/7に bosai JSON の配信が6週間止まる事象が実際に発生。古い警報での誤誘導を防ぐ）
const STALE_MS = 48 * 60 * 60 * 1000; // 48時間

// 気象庁の警報JSONから、監視エリア（WARNING_AREAS）の発表中警報・注意報を集約
// 戻り値: { items: [...], reportDatetime, stale }
//   - stale: true なら発表時刻が古すぎる（items は空にして返す）
// json が不正なら null（呼び出し側は表示スキップ）
export function parseWarnings(json, now = Date.now()) {
  if (!json?.areaTypes) return null;

  const reportDatetime = json.reportDatetime ?? null;
  // 鮮度ガードは bosai JSON（配信停止歴あり）にのみ適用。
  // XMLフィード経由は「新しい発表が無い＝前回発表が現在も有効」という公式仕様のため古くても信頼できる
  if (json.via !== 'xml') {
    const reportTime = reportDatetime ? new Date(reportDatetime).getTime() : NaN;
    if (!Number.isFinite(reportTime) || now - reportTime > STALE_MS) {
      return { items: [], reportDatetime, stale: true };
    }
  }

  // 自治体コード → エリアキーの逆引き表
  const codeToArea = {};
  for (const [key, area] of Object.entries(WARNING_AREAS)) {
    for (const c of area.codes) codeToArea[c] = key;
  }

  // 警報コードごとに該当エリアを収集
  const byWarning = new Map();
  for (const at of json.areaTypes) {
    for (const area of at.areas ?? []) {
      const areaKey = codeToArea[area.code];
      if (!areaKey) continue;
      for (const w of area.warnings ?? []) {
        if (!w.code || !ACTIVE_STATUS.has(w.status)) continue;
        if (!byWarning.has(w.code)) byWarning.set(w.code, new Set());
        byWarning.get(w.code).add(areaKey);
      }
    }
  }

  const totalAreas = Object.keys(WARNING_AREAS).length;
  const items = [...byWarning.entries()].map(([code, areaKeySet]) => {
    // 未知コードでも壊れないよう汎用ラベルにフォールバック
    const info = WARNING_CODES[code] ?? { name: '気象情報', emoji: 'ℹ️', level: 'advisory' };
    const areaKeys = [...areaKeySet];
    return {
      code,
      ...info,
      areaKeys,
      areaLabels: areaKeys.map(k => WARNING_AREAS[k].label),
      allAreas: areaKeys.length === totalAreas,
    };
  });

  // 深刻度順（特別警報 → 警報 → 注意報）
  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.code.localeCompare(b.code));

  return { items, reportDatetime, stale: false };
}
