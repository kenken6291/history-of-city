/**
 * 「私の街の歴史」設定ファイル
 * ------------------------------------------------------------
 * GASを再デプロイしてURLが変わったら、ここの GAS_API_URL だけ書き換えればOK。
 * バージョンを上げるときは APP_VERSION / RELEASE_DATE / CHANGELOG を更新し、
 * index.html の各 <script>/<link> の ?v= も同じ番号にそろえるとキャッシュが確実に切り替わります。
 */
window.APP_CONFIG = {
  APP_NAME: '私の街の歴史',
  APP_VERSION: '2.0.0',
  RELEASE_DATE: '2026-11-21',

  // デプロイしたGASウェブアプリのURL（末尾 /exec）
  GAS_API_URL: 'https://script.google.com/macros/s/AKfycbwUQZXv3UUIiEf3yK8Mch1CcmeCiaDYsNT286P7UJSqqq1IhHwU1nLj-JN5esD-a7fPOg/exec',

  // 地図の初期表示（川崎市周辺）
  DEFAULT_MAP_CENTER: [35.5309, 139.7030],
  DEFAULT_MAP_ZOOM: 13,

  // 投稿画像の自動縮小（長辺px・JPEG画質）
  IMAGE_MAX_SIZE: 1600,
  IMAGE_QUALITY: 0.85,

  // localStorage のキー
  SESSION_KEY: 'hoc_session_v2',

  // バージョン情報モーダルに表示する更新履歴（新しい順）
  CHANGELOG: [
    {
      version: '2.0.0',
      date: '2026-11-21',
      items: [
        'GASのURLを config.js にまとめました',
        'バージョン情報の表示を追加しました（画面下部）',
        '投稿マップに場所のピンが出ない不具合を直しました',
        '「昔の写真の年代」を入力できるようにしました',
        '写真は投稿前に自動で縮小し、投稿前にプレビューで見比べられます',
        '住所・地名検索と現在地ボタンで場所を選びやすくしました',
        '見比べ方を「スライド」と「透かし」から選べ、全画面表示もできます',
        'みんなの投稿を検索・並べ替えできるようにしました',
        'ログイン情報の扱いを安全にしました（他人による削除・変更を防止）',
        'マイページからパスワードを変更できるようにしました'
      ]
    },
    {
      version: '1.x',
      date: '2026-09',
      items: [
        '会員登録・ログイン、写真ペアの投稿とスライダー比較、投稿マップ'
      ]
    }
  ]
};
