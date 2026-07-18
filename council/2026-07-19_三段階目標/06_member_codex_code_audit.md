# 総合判定

**3/10 — 現状のまま安全用途の出港判断を信頼してはいけません。**  
データ欠損や警報取得失敗時に安全側へ倒れず、「出港OK」が出る経路があります。補助情報としても、必ず気象庁・海況予報との照合が必要です。

## 重大

1. [`js/api.js:153–173`](/Users/takashiinokuchi/kerama/js/api.js:153)、[`js/app.js:49–58`](/Users/takashiinokuchi/kerama/js/app.js:49)、[`js/score.js:32–36`](/Users/takashiinokuchi/kerama/js/score.js:32) / Open-Meteoが全滅しても `fetchAll()` は正常終了し、波1.0m・風10km/h・晴れ・うねり8秒という楽観的な既定値で計算されます。実計算は8点となり、画面には「✅ 出港OK」。さらに `calcScore({})` 単体では10点です / 必須入力が欠けた場合はスコアを計算せず、`判定不能・データ取得失敗` を赤色表示する。`?? 1.0`、`?? 0` などの安全判断用フォールバックを削除し、有限数かつ妥当範囲であることを検証する。

2. [`js/app.js:51–58`](/Users/takashiinokuchi/kerama/js/app.js:51)、[`notify/daily-brief.js:318–327`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:318) / 「今日の出港判断」と朝5時メールが、5時現在の慶良間波高・那覇風速だけで決まります。例えば5時に波0.5m、10時に3mへ悪化する予報でも、主表示とメール件名は10点・良好になります / 営業時間帯（例: 7～16時）の最大波高・最大風速、または時間別スコアの最低値を出港判断に使う。少なくとも「現在値」と「本日の出港判断」を分離する。

3. [`js/warnings.js:97–117`](/Users/takashiinokuchi/kerama/js/warnings.js:97) / 短期フィードに対象XMLがないと、長期フィードより先に `sessionStorage` の古いURLを無条件採用します。月曜のURLを記憶したタブで、水曜5時に開いた場合、火曜15時発表（短期フィードの約10時間外）の新しい波浪警報を無視して月曜の状態を表示し得ます / 安全情報ではメモURLを探索結果として信用しない。短期にない場合は必ず長期フィードから最新URLを決定し、メモは同じURLの本文キャッシュにだけ使う。

4. [`js/warnings.js:69–84`](/Users/takashiinokuchi/kerama/js/warnings.js:69)、[`js/warnings.js:128–139`](/Users/takashiinokuchi/kerama/js/warnings.js:128)、[`js/ui.js:170–177`](/Users/takashiinokuchi/kerama/js/ui.js:170)、[`notify/daily-brief.js:77–80`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:77) / 警報の「なし」「取得失敗」「古いJSON」「XMLの部分解析失敗」が安全に区別されません。例えばXMLの `<Item>` 解析が全件失敗しても空の `areas` を正常データとして返し、画面は空欄、メールは「警報欄そのものを省略」または「警報なし」になります。またXML経由は鮮度判定を完全に免除されます / 戻り値を `ok / none / stale / error` に分ける。監視対象自治体コードが1件も解析できなければ解析エラーにし、画面・メールとも「警報情報を確認できないため気象庁で要確認」と表示する。XMLフィード自体の更新時刻も検証する。

5. [`js/app.js:49–64`](/Users/takashiinokuchi/kerama/js/app.js:49)、[`js/ui.js:41–53`](/Users/takashiinokuchi/kerama/js/ui.js:41) / 警報はスコアや出港バナーと完全に独立しています。波浪警報・暴風警報が発表中でも、モデル値が穏やかなら「✅ 出港OK」と赤い警報チップが同時表示されます。メール件名も良好スコアのままです / 波浪・暴風系の特別警報／警報では必ず出港OKを抑止する。注意報を含めた扱いを運用ルールとして決め、同じ判定関数を画面とメールで共有する。

## 中

1. [`js/config.js:49–57`](/Users/takashiinokuchi/kerama/js/config.js:49)、[`js/score.js:46–52`](/Users/takashiinokuchi/kerama/js/score.js:46) / 他条件が最高の場合、波高2.50mは総合4点「要確認」ですが、2.5001mは安全キャップで2点になります。ごく小さな丸め差で判定が2段階飛びます / 運用境界が2.5mなら `waveHeight >= 2.5` を直接安全ルールに使う。2.5mを許容するなら、表示基準の「2.5m〜」との重複を直す。

2. [`js/score.js:114–119`](/Users/takashiinokuchi/kerama/js/score.js:114)、[`js/ui.js:121–144`](/Users/takashiinokuchi/kerama/js/ui.js:121) / 現在時刻が配列にない場合、無条件にインデックス0へ戻ります。時刻配列の欠落・ずれ・古い応答があると、深夜0時の値を「現在値」として表示します / 未一致は `-1` または `null` にし、スコア計算を停止する。対象時刻との差が1時間以内かも確認する。

3. [`js/api.js:34–162`](/Users/takashiinokuchi/kerama/js/api.js:34)、[`js/warnings.js:87–117`](/Users/takashiinokuchi/kerama/js/warnings.js:87) / 全フェッチにタイムアウトもリトライもありません。非必須のNASA取得が応答待ちになっただけでも `Promise.allSettled` 全体が完了せず、画面が読み込み中のままになります / 各 `fetch` に `AbortSignal.timeout()` を設定し、天気・海況・警報だけ1回再試行する。EPICは待たずに本体を先に描画する。

4. [`js/ui.js:198–231`](/Users/takashiinokuchi/kerama/js/ui.js:198)、[`notify/daily-brief.js:164–182`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:164) / 粟国・渡名喜を含む全ポイントの風と天気に那覇現在値を流用しています。那覇が弱風でも遠征先が強風なら、ポイントスコアが過大になります / 各ポイント座標の風予報を取得する。取得できない間は、遠征ポイントの総合点を出さず波・うねりだけ表示する。

5. [`notify/daily-brief.js:300–329`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:300) / `Promise.allSettled` で那覇または航路だけ失敗しても処理を続けますが、後で `naha.hourly` / `route.hourly` を直接参照してクラッシュし、メールが1通も届きません / 部分失敗は `--（取得失敗）` と明記して縮退メールを送る。メール送信そのものが失敗した場合は別経路で通知する。

6. [`js/ui.js:353–405`](/Users/takashiinokuchi/kerama/js/ui.js:353)、[`js/app.js:61–69`](/Users/takashiinokuchi/kerama/js/app.js:61) / Chart.js CDN障害時に `Chart is not defined` が発生し、潮汐以降の週間・時刻別描画が中断します。すでに表示済みの出港バナーだけが残る可能性もあります / `globalThis.Chart` を確認してグラフだけ取得失敗表示にし、他の描画を継続する。

7. [`notify/package.json:10`](/Users/takashiinokuchi/kerama/notify/package.json:10)、[`notify/package-lock.json:15`](/Users/takashiinokuchi/kerama/notify/package-lock.json:15) / Nodemailer 6.10.1に固定されています。7.0.11未満には、細工したメールアドレスで無限再帰を起こす高深刻度DoSが報告されています。通常の固定送信先では到達性は低いものの、`TEST_EMAIL` が `to` に入る経路があります。[NVD CVE-2025-14874](https://nvd.nist.gov/vuln/detail/CVE-2025-14874) / Nodemailer 8.0.9以上へ更新し、lockfileも更新する。

8. [`.github/workflows/deploy.yml:16–27`](/Users/takashiinokuchi/kerama/.github/workflows/deploy.yml:16) / `vercel@latest` を毎回取得し、そのCLIをVercel secrets付きで実行します。将来の破損版・侵害版を即時に取り込む構成です / 検証済みのVercel CLIバージョンを完全固定する。Actionsにも `permissions: contents: read` を明示し、可能ならアクションをコミットSHA固定する。現コードに直接のsecret出力は見当たりません。

9. [`.github/workflows/morning-brief.yml:3–6`](/Users/takashiinokuchi/kerama/.github/workflows/morning-brief.yml:3) / GitHub側には朝5時の `schedule` がなく、外部のcron-job.orgによるdispatchだけです。外部ジョブやトークンが停止すると、メールが無言で来なくなります / 外部ジョブの死活監視・失敗通知を追加するか、二重送信防止付きのGitHub scheduleを予備にする。

10. [`vercel.json:4–10`](/Users/takashiinokuchi/kerama/vercel.json:4)、[`index.html:165–171`](/Users/takashiinokuchi/kerama/index.html:165) / CSPとHSTSがなく、Windy iframeにも `sandbox` がありません。現時点でXML文字列を直接HTML化する経路はなく即時XSSは確認できませんが、第三者コンテンツ侵害時の防御が薄いです / Windyに必要最小限の `sandbox` を付け、CSPを `script-src`・`connect-src`・`img-src`・`frame-src` の許可先限定で追加する。Chart.jsはバージョン固定・SRI付きで、ここは適切です。

## 軽微

1. [`notify/daily-brief.js:293–296`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:293)、[`notify/daily-brief.js:331–335`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:331) / `DRY_RUN=1` でも先にGmail資格情報と宛先を必須チェックします。また `DRY_RUN=0` や `false` も文字列として真になり送信されません / `const dryRun = process.env.DRY_RUN === '1'` とし、資格情報チェックは非DRY_RUN時だけ行う。

2. [`js/app.js:17–39`](/Users/takashiinokuchi/kerama/js/app.js:17)、[`notify/daily-brief.js:104–158`](/Users/takashiinokuchi/kerama/notify/daily-brief.js:104) / 総合スコアは共有されていますが、内訳スコア・ラベル・週間判定・潮汐・座標が重複しています。しきい値変更時に画面の総合点と内訳、またはメール文言がずれる余地があります / `score.js` から内訳とラベルもexportし、メールも利用する。座標は `config.js` を参照する。

3. [`js/ui.js:180–183`](/Users/takashiinokuchi/kerama/js/ui.js:180)、[`js/ui.js:208–250`](/Users/takashiinokuchi/kerama/js/ui.js:208) / 現在の警報名・エリア名・ポイント名はすべて設定内の固定文字列なので、直ちに悪用できるXSS経路ではありません。ただし `innerHTML` 前提のため、将来XMLの名称をそのまま表示する変更が入ると危険になります / 外部データを含む表示は `createElement` と `textContent` に寄せる。

## テストを書くならまずこの3つ

1. **欠損・異常値テスト**  
   天気／海況の全失敗、片方だけ失敗、`null`、`undefined`、`NaN`、空配列、現在時刻不一致で、絶対に点数や「出港OK」が出ないこと。

2. **警報フェイルクローズテスト**  
   短期フィードなし＋古いメモ＋長期に新しい警報、XML部分解析失敗、古いXML、JSON stale、全取得失敗を与え、「警報なし」ではなく「確認不能」になること。波浪・暴風警報時は出港OKが抑止されること。

3. **朝5時から日中悪化する予報テスト**  
   5時は穏やか、10時以降は波3m・強風というデータで、画面とメールが同じ安全側判定になること。併せて2.50m／2.5001mの境界も固定する。