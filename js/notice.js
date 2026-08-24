// 一度きりのお知らせポップアップ。
//
// 仕様: JSTで DISPLAY_FROM〜DISPLAY_TO の期間だけ出す。×で閉じたら
// localStorage に記録して二度と出さん。期間を過ぎたら閉じてなくても出さん。
//
// 役目が終わったら、このファイルと app.js の import 1行、
// css/style.css の「お知らせポップアップ」ブロックを消せば跡形もなく撤去できる。
//
// 次に別のお知らせを出すときは NOTICE_ID を必ず変えること
// （同じIDのままやと、前回×を押した人には表示されん）。

const NOTICE_ID = 'wind-unit-ms-2026-08';

// 表示期間（JST・両端を含む）。アプリもメールもここだけを見る。
//
// 当初は 8/24 の1日だけやったが、8/25〜8/26 が台風18号の本番で優くんが
// 出港できず、アプリもメールも見とらん可能性が高いと判断して 8/31 まで延長した
// （2026-08-24）。×を押した人には localStorage の記録で二度と出んけん、
// 既に見た人には無害。
export const DISPLAY_FROM = '2026-08-24';
export const DISPLAY_TO   = '2026-08-31';

const STORAGE_KEY = `diving_notice_${NOTICE_ID}`;

// JSTの今日を 'YYYY-MM-DD' で得る（'sv'ロケールはISO形式を返す）
function todayJst() {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' });
}

// 表示期間の内側か。ISO形式('YYYY-MM-DD')は文字列比較で日付の前後をそのまま判定できる。
// 「明日だけ出して明後日には消す」が正しく効くかを固定値で検証したいので純関数に分けとる
export function isWithinWindow(dateStr, from = DISPLAY_FROM, to = DISPLAY_TO) {
  return dateStr >= from && dateStr <= to;
}

function alreadyDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false; // プライベートモード等で読めん場合は「未読」扱いで出す
  }
}

function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch { /* 保存できんでも閉じる動作は妨げない */ }
}

function close(root) {
  remember();
  root.classList.add('notice-closing');
  setTimeout(() => root.remove(), 200);
}

export function showNoticeIfDue() {
  if (!isWithinWindow(todayJst())) return;
  if (alreadyDismissed()) return;

  const root = document.createElement('div');
  root.id = 'notice-overlay';
  root.innerHTML = `
    <div id="notice-card" role="dialog" aria-modal="true" aria-labelledby="notice-title">
      <button id="notice-close" type="button" aria-label="閉じる">✕</button>
      <div id="notice-title">💨 風速の表示を m/s に変更</div>
      <p>
        これまで <b>km/h</b> で表示していた風速を、気象庁や船舶で標準的に使われる
        <b>m/s</b> に変更しました。「📖 基準」ページの判定基準と同じ単位になります。
      </p>
      <div class="notice-conv">
        <div><span>これまで</span><b>18 km/h</b></div>
        <div class="notice-arrow">→</div>
        <div><span>これから</span><b>5.0 m/s</b></div>
      </div>
      <p class="notice-sub">数値の見た目が変わるだけで、スコアの計算方法は変わっていません。</p>
      <button id="notice-ok" type="button">確認しました</button>
    </div>
  `;

  document.body.appendChild(root);

  root.querySelector('#notice-close').addEventListener('click', () => close(root));
  root.querySelector('#notice-ok').addEventListener('click', () => close(root));
  // 背景をタップしても閉じる（カード内のタップでは閉じない）
  root.addEventListener('click', e => { if (e.target === root) close(root); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(root); document.removeEventListener('keydown', onEsc); }
  });
}
