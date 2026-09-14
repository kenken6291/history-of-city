/* =========================================================
   「私の街の歴史」写真重ね合わせツール - Code.gs（GASバックエンド）

   このアプリの写真比較そのものは引き続き端末内（ブラウザ）だけで完結します。
   このバックエンドは「会員登録・ログイン」機能のためだけに使います
   （メールアドレス・ニックネーム・パスワードハッシュの管理のみ）。

   構成：
     1. 設定・定数
     2. 共通ユーティリティ（シート操作・レスポンス生成）
     3. 認証まわり（登録・ログイン・パスワード変更/再発行・退会）
     4. セッション管理（CacheService）
     5. エントリーポイント（doGet / doPost）

   事前準備（スクリプトのプロパティに設定）：
     - SPREADSHEET_ID … データ保存用スプレッドシートのID（未設定ならこのGASに紐づくシートを使用）
     - PEPPER          … パスワードハッシュ化用の固定文字列（任意の長い文字列でOK）

   デプロイ：
     「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
     アクセスできるユーザー：全員
     発行されたURLをフロント側 auth.js の API_BASE_URL に設定する
   ========================================================= */

/* =========================================================
   1. 設定・定数
   ========================================================= */
var MEMBER_HEADERS = ['id', 'email', 'nickname', 'passwordHash', 'salt', 'isTempPassword', 'failedAttempts', 'lockUntil', 'createdAt'];
var SESSION_TTL_SEC = 21600; // 6時間（CacheServiceの上限）
var LOCK_THRESHOLD = 5;      // 何回失敗でロックするか
var LOCK_MINUTES = 15;       // ロック時間（分）
var FORGOT_PASSWORD_INTERVAL_SEC = 300; // パスワード再発行：同一メールアドレスへの間隔（秒）

/* 指定キーが直近interval秒以内に使われていなければtrueを返し使用済みにする。
   使われていれば（＝制限時間内）falseを返す。MailApp等の連打防止に使う。 */
function checkAndSetRateLimit_(key, intervalSec) {
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return false;
  cache.put(key, '1', intervalSec);
  return true;
}

/* =========================================================
   2. 共通ユーティリティ
   ========================================================= */
function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function rowToObject_(headers, rowArray) {
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = rowArray[i]; });
  return obj;
}

function ok_(data) {
  var body = Object.assign({ ok: true }, data || {});
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function ng_(message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message })).setMimeType(ContentService.MimeType.JSON);
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* =========================================================
   3. 認証まわり
   ========================================================= */
function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function generateTempPassword_() {
  // 紛らわしい文字（0/O, 1/l/I等）を除いた文字セット
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var pass = '';
  for (var i = 0; i < 8; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

function hashPassword_(password, salt) {
  var pepper = PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt + pepper, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var v = (b < 0) ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function findMemberRow_(email) {
  var sheet = getSheet_('Members', MEMBER_HEADERS);
  var data = sheet.getDataRange().getValues();
  var lower = String(email).toLowerCase();
  for (var i = 1; i < data.length; i++) {
    var row = rowToObject_(MEMBER_HEADERS, data[i]);
    if (String(row.email).toLowerCase() === lower) {
      return { row: row, index: i - 1 }; // index は「ヘッダーを除いた」0始まりの行番号
    }
  }
  return null;
}

function findMemberById_(memberId) {
  var sheet = getSheet_('Members', MEMBER_HEADERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var row = rowToObject_(MEMBER_HEADERS, data[i]);
    if (row.id === memberId) return { row: row, index: i - 1 };
  }
  return null;
}

function appendMemberRow_(member) {
  var sheet = getSheet_('Members', MEMBER_HEADERS);
  sheet.appendRow(MEMBER_HEADERS.map(function (h) { return member[h]; }));
}

function updateMemberRow_(index, updates) {
  var sheet = getSheet_('Members', MEMBER_HEADERS);
  var sheetRow = index + 2; // ヘッダー行 + 1始まり
  Object.keys(updates).forEach(function (key) {
    var col = MEMBER_HEADERS.indexOf(key) + 1;
    if (col > 0) sheet.getRange(sheetRow, col).setValue(updates[key]);
  });
}

function handleRegister_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  var nickname = String(body.nickname || '').trim();
  if (!isValidEmail_(email)) return ng_('正しいメールアドレスを入力してください');
  if (!nickname) return ng_('ニックネームを入力してください');
  if (findMemberRow_(email)) return ng_('このメールアドレスは既に登録されています');

  var tempPassword = generateTempPassword_();
  var salt = generateSalt_();
  var member = {
    id: Utilities.getUuid(),
    email: email,
    nickname: nickname,
    passwordHash: hashPassword_(tempPassword, salt),
    salt: salt,
    isTempPassword: 'true',
    failedAttempts: 0,
    lockUntil: '',
    createdAt: new Date().toISOString()
  };
  appendMemberRow_(member);

  try {
    MailApp.sendEmail({
      to: email,
      subject: '【「私の街の歴史」写真重ね合わせツール】仮パスワードのお知らせ',
      body: nickname + ' 様\n\n' +
        '「私の街の歴史」写真重ね合わせツールにご登録いただきありがとうございます。\n' +
        '以下の仮パスワードでログインし、初回ログイン時に新しいパスワードを設定してください。\n\n' +
        '仮パスワード：' + tempPassword + '\n\n' +
        '※このメールに心当たりがない場合は破棄してください。'
    });
  } catch (err) {
    // メール送信に失敗しても登録自体は完了させる
  }

  return ok_({ message: '登録しました。ご入力いただいたメールアドレスに仮パスワードを送信しました。' });
}

function handleLogin_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  var password = String(body.password || '');
  if (!email || !password) return ng_('メールアドレスとパスワードを入力してください');

  var found = findMemberRow_(email);
  if (!found) return ng_('メールアドレスまたはパスワードが違います');
  var row = found.row;

  var now = Date.now();
  if (row.lockUntil && Number(row.lockUntil) > now) {
    var remainMin = Math.ceil((Number(row.lockUntil) - now) / 60000);
    return ng_('ログイン試行回数が上限に達しました。' + remainMin + '分後に再度お試しください');
  }

  var hash = hashPassword_(password, row.salt);
  if (hash !== row.passwordHash) {
    var attempts = Number(row.failedAttempts || 0) + 1;
    var updates = { failedAttempts: attempts };
    if (attempts >= LOCK_THRESHOLD) {
      updates.lockUntil = now + LOCK_MINUTES * 60 * 1000;
      updates.failedAttempts = 0;
    }
    updateMemberRow_(found.index, updates);
    return ng_('メールアドレスまたはパスワードが違います');
  }

  updateMemberRow_(found.index, { failedAttempts: 0, lockUntil: '' });

  var token = createSession_(row.id);
  return ok_({
    token: token,
    member: {
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      requiresPasswordChange: String(row.isTempPassword) === 'true'
    }
  });
}

function handleChangePassword_(body) {
  var auth = authenticate_(body.token);
  if (!auth) return ng_('ログインが必要です');
  var newPassword = String(body.newPassword || '');
  if (newPassword.length < 8) return ng_('パスワードは8文字以上にしてください');

  var salt = generateSalt_();
  updateMemberRow_(auth.index, {
    passwordHash: hashPassword_(newPassword, salt),
    salt: salt,
    isTempPassword: 'false'
  });
  return ok_({ message: 'パスワードを変更しました' });
}

function handleForgotPassword_(body) {
  var email = String(body.email || '').trim().toLowerCase();
  if (!isValidEmail_(email)) return ng_('正しいメールアドレスを入力してください');

  // レート制限：同一メールアドレスへの再発行リクエストは一定時間に1回まで。
  // 存在チェックより前に判定することで、メールアドレスの存在有無が
  // レスポンスの違いから漏れないようにする。
  if (!checkAndSetRateLimit_('pwreset_' + email, FORGOT_PASSWORD_INTERVAL_SEC)) {
    return ng_('パスワード再発行のリクエストは' + (FORGOT_PASSWORD_INTERVAL_SEC / 60) + '分に1回までです。少し時間をおいて再度お試しください');
  }

  var found = findMemberRow_(email);
  // メールアドレスの存在有無を外部から判別できないよう、常に同じメッセージを返す
  if (!found) {
    return ok_({ message: 'ご登録のメールアドレスであれば、仮パスワードを送信しました' });
  }
  var tempPassword = generateTempPassword_();
  var salt = generateSalt_();
  updateMemberRow_(found.index, {
    passwordHash: hashPassword_(tempPassword, salt),
    salt: salt,
    isTempPassword: 'true',
    failedAttempts: 0,
    lockUntil: ''
  });
  try {
    MailApp.sendEmail({
      to: email,
      subject: '【「私の街の歴史」写真重ね合わせツール】仮パスワード再発行のお知らせ',
      body: found.row.nickname + ' 様\n\n' +
        'パスワード再発行のご依頼を受け付けました。\n' +
        '以下の仮パスワードでログインし、新しいパスワードを設定してください。\n\n' +
        '仮パスワード：' + tempPassword
    });
  } catch (err) {}
  return ok_({ message: 'ご登録のメールアドレスであれば、仮パスワードを送信しました' });
}

function handleUpdateNickname_(body) {
  var auth = authenticate_(body.token);
  if (!auth) return ng_('ログインが必要です');
  var nickname = String(body.nickname || '').trim();
  if (!nickname) return ng_('ニックネームを入力してください');
  updateMemberRow_(auth.index, { nickname: nickname });
  return ok_({ message: 'ニックネームを変更しました', nickname: nickname });
}

function handleLogout_(body) {
  if (body.token) CacheService.getScriptCache().remove('session_' + body.token);
  return ok_({ message: 'ログアウトしました' });
}

function handleWithdraw_(body) {
  var auth = authenticate_(body.token);
  if (!auth) return ng_('ログインが必要です');

  var memberSheet = getSheet_('Members', MEMBER_HEADERS);
  memberSheet.deleteRow(auth.index + 2);
  CacheService.getScriptCache().remove('session_' + body.token);
  return ok_({ message: '退会処理が完了しました。ご利用ありがとうございました。' });
}

/* =========================================================
   4. セッション管理（CacheService）
   ========================================================= */
function createSession_(memberId) {
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('session_' + token, memberId, SESSION_TTL_SEC);
  return token;
}

function authenticate_(token) {
  if (!token) return null;
  var memberId = CacheService.getScriptCache().get('session_' + token);
  if (!memberId) return null;
  return findMemberById_(memberId);
}

/* =========================================================
   5. エントリーポイント
   ========================================================= */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '「私の街の歴史」写真重ね合わせツール API' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    switch (body.action) {
      case 'register':       return handleRegister_(body);
      case 'login':           return handleLogin_(body);
      case 'changePassword':  return handleChangePassword_(body);
      case 'forgotPassword':  return handleForgotPassword_(body);
      case 'updateNickname':  return handleUpdateNickname_(body);
      case 'logout':           return handleLogout_(body);
      case 'withdraw':        return handleWithdraw_(body);
      default:                 return ng_('不明なactionです: ' + body.action);
    }
  } catch (err) {
    return ng_(err.message || String(err));
  }
}
