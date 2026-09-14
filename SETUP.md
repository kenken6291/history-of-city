# 「私の街の歴史」セットアップ手順

## 1. Googleスプレッドシートを作成
- 新規スプレッドシートを作成し、そのIDを控える（URLの `/d/` と `/edit` の間の文字列）
- シートは空でOK（初回アクセス時に `Members` / `Photos` シートが自動生成されます）

## 2. Google Driveフォルダを作成
- 写真保存用のフォルダを作成し、そのIDを控える

## 3. GASプロジェクトを作成
1. スプレッドシートを開き、「拡張機能」→「Apps Script」
2. `gas/Code.gs` の内容を貼り付け
3. 「プロジェクトの設定」→「スクリプト プロパティ」に以下を登録：
   - `SPREADSHEET_ID`（手順1）
   - `DRIVE_FOLDER_ID`（手順2）
   - `PEPPER`（パスワードハッシュ化用の任意の秘密文字列）
4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
   - 実行するユーザー: 自分
   - アクセスできるユーザー: 全員
5. 発行されたウェブアプリURLを控える

## 4. フロントエンドの設定
- `auth.js` の `GAS_API_URL` を手順3のURLに書き換える

## 5. GitHub Pagesへ公開
```
git init
git add index.html style.css auth.js app.js
git commit -m "私の街の歴史：初回公開"
git remote add origin https://github.com/kenken6291/history-of-city.git
git push -u origin main
```
- リポジトリの Settings → Pages で公開設定（Branch: main, フォルダ: / (root)）
- 公開URL: https://kenken6291.github.io/history-of-city/

## 動作フロー
1. 会員登録（メール＋ニックネーム）→ 仮パスワードがメール送信される
2. ログイン → 初回は強制的にパスワード変更
3. 昔の写真・現在の写真をアップロード → Driveに保存
4. トップページのギャラリーでスライダーによる重ね合わせ表示
