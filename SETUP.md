# 「私の街の歴史」セットアップ手順（v2.0.0）

## ファイル構成
```
index.html     画面
style.css      デザイン
config.js      ★設定（GASのURL・バージョン・更新履歴）
auth.js        会員機能・API呼び出し
app.js         投稿・地図・ギャラリー・バージョン表示
gas/Code.gs    GASバックエンド（GitHub Pagesには不要。GASエディタに貼り付け）
```

## v1 からの更新手順（既存環境）
1. **GAS**：Apps Script エディタの `Code.gs` を `gas/Code.gs` の内容に丸ごと置き換えて保存
2. 「デプロイ」→「デプロイを管理」→ 既存のデプロイを編集（鉛筆）→ バージョン「新バージョン」→「デプロイ」
   - この方法ならURLは変わりません。URLが変わった場合は `config.js` の `GAS_API_URL` を書き換え
3. **GitHub**：`index.html` `style.css` `config.js` `auth.js` `app.js` をアップロード（上書き）
4. リポジトリ直下の `gas/app.js` は古い重複ファイルなので削除してOK
5. 画面下部のバージョン表示が「v2.0.0 / API v2.0.0」になれば完了
   - 「API 旧版または未接続」と出る場合は、手順1〜2（GASの再デプロイ）ができていません

※ 既存の会員・投稿データはそのまま使えます。シートに不足している列
（Latitude / Longitude / OldYear / OldFileId / NewFileId / FailCount / LockedUntil）は自動で追加されます。
※ ログイン方式がトークン方式になったため、更新後は全員1回だけ再ログインが必要です。
※ v1で投稿した写真は緯度経度が保存されていなかったため、地図にはv2以降の投稿から表示されます。

## 新規セットアップ
### 1. Googleスプレッドシートを作成
- 新規スプレッドシートを作成し、IDを控える（URLの `/d/` と `/edit` の間）
- シートは空でOK（初回アクセス時に `Members` / `Photos` シートが自動生成されます）

### 2. Google Driveフォルダを作成
- 写真保存用のフォルダを作成し、IDを控える

### 3. GASプロジェクトを作成
1. スプレッドシートを開き「拡張機能」→「Apps Script」
2. `gas/Code.gs` の内容を貼り付け
3. 「プロジェクトの設定」→「スクリプト プロパティ」に登録：
   - `SPREADSHEET_ID`（手順1）
   - `DRIVE_FOLDER_ID`（手順2）
   - `PEPPER`（パスワードハッシュ・トークン署名用の任意の秘密文字列。後から変えると全員ログインできなくなるので注意）
4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
   - 実行するユーザー: 自分 ／ アクセスできるユーザー: 全員
5. 発行されたウェブアプリURLを控える

### 4. フロントエンドの設定
- `config.js` の `GAS_API_URL` を手順3のURLに書き換える

### 5. GitHub Pagesへ公開
- `index.html` `style.css` `config.js` `auth.js` `app.js` をリポジトリ直下へ
- Settings → Pages（Branch: main, フォルダ: / (root)）
- 公開URL: https://kenken6291.github.io/history-of-city/

## バージョンを上げるとき
1. `config.js` の `APP_VERSION` `RELEASE_DATE` `CHANGELOG` を更新
2. `index.html` の `?v=2.0.0`（4か所）を同じ番号にそろえる（ブラウザのキャッシュ対策）
3. GAS側を変えたときは `Code.gs` の `API_VERSION` も更新して再デプロイ

## 動作フロー
1. 会員登録（メール＋ニックネーム）→ 仮パスワードがメールで届く
2. ログイン → 初回は新しいパスワードに変更
3. 場所・年代・地図のピン・昔/今の写真を選ぶ（自動で縮小、投稿前にプレビュー）→ 投稿
4. 投稿マップ・みんなの投稿で「スライド／透かし」で見比べ
