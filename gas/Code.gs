/**
 * 「私の街の歴史」写真重ね合わせサイト - GASバックエンド v2.0.0
 * ------------------------------------------------------------
 * 構成:
 *   - スプレッドシート「Members」: 会員情報
 *   - スプレッドシート「Photos」 : 投稿された昔/現在写真ペア
 *   - Google Drive フォルダ      : 写真ファイル
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *   SPREADSHEET_ID, DRIVE_FOLDER_ID, PEPPER   ※v1から変更なし
 *
 * v2の主な変更:
 *   - ログイン時にトークンを発行し、投稿・削除・会員情報変更はトークンで本人確認
 *   - 緯度経度・昔の写真の年代を保存（既存シートには列を自動追加）
 *   - 一覧APIで投稿者メールアドレスを返さない（自分の投稿は mine:true）
 *   - ログイン5回失敗で15分ロック、削除時にDriveの写真もゴミ箱へ
 *   - action=version でAPIバージョンを返す
 *
 * デプロイ: ウェブアプリ（実行:自分／アクセス:全員）
 *   ※コード更新後は「デプロイを管理」→ 既存デプロイを編集 →「新バージョン」で
 *     URLを変えずに更新できます。
 */

const API_VERSION = '2.0.0';

function getProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`スクリプトプロパティ「${key}」が未設定です`);
  return value;
}
const SPREADSHEET_ID = () => getProp_('SPREADSHEET_ID');
const DRIVE_FOLDER_ID = () => getProp_('DRIVE_FOLDER_ID');
const PEPPER = () => getProp_('PEPPER');

const MEMBERS_SHEET = 'Members';
const PHOTOS_SHEET = 'Photos';
const MEMBER_HEADERS = ['Email', 'Nickname', 'PasswordHash', 'ForceChange', 'Status', 'CreatedAt', 'FailCount', 'LockedUntil'];
const PHOTO_HEADERS = ['PhotoId', 'Email', 'Nickname', 'LocationName', 'OldPhotoUrl', 'NewPhotoUrl', 'Caption', 'UserComment', 'CreatedAt',
                       'Latitude', 'Longitude', 'OldYear', 'OldFileId', 'NewFileId'];

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const TEMP_TOKEN_TTL_MS = 30 * 60 * 1000;      // 仮パスワードログイン時は30分
const MAX_FAIL = 5;
const LOCK_MINUTES = 15;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// ==== エントリーポイント ====

function doPost(e) {
  let result;
  try {
    const params = JSON.parse(e.postData.contents);
    switch (params.action) {
      case 'register':        result = registerMember(params); break;
      case 'login':           result = loginMember(params); break;
      case 'changePassword':  result = changePassword(params); break;
      case 'reissuePassword': result = reissuePassword(params); break;
      case 'changeNickname':  result = changeNickname(params); break;
      case 'withdraw':        result = withdrawMember(params); break;
      case 'uploadPhoto':     result = uploadPhotoPair(params); break;
      case 'deletePhoto':     result = deletePhoto(params); break;
      case 'version':         result = versionInfo_(); break;
      default:
        result = { success: false, message: '不明なactionです: ' + params.action };
    }
  } catch (err) {
    result = errorResult_(err);
  }
  return json_(result);
}

function doGet(e) {
  let result;
  try {
    const action = e.parameter.action;
    if (action === 'listPhotos')   result = listPhotos(e.parameter.token);
    else if (action === 'version') result = versionInfo_();
    else result = { success: false, message: '不明なactionです: ' + action };
  } catch (err) {
    result = errorResult_(err);
  }
  return json_(result);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function versionInfo_() {
  return { success: true, apiVersion: API_VERSION, serverTime: new Date().toISOString() };
}

function AuthError_(message) {
  const err = new Error(message || 'ログインしてください');
  err.isAuth = true;
  return err;
}

function errorResult_(err) {
  if (err && err.isAuth) return { success: false, authError: true, message: err.message };
  return { success: false, message: 'サーバーエラー: ' + (err && err.message ? err.message : err) };
}

// ==== シート操作（列名ベース・不足列は自動追加） ====

function getTable_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID());
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = headers.filter(h => current.indexOf(h) === -1);
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    current = current.concat(missing);
  }
  const col = {};
  current.forEach((h, i) => { if (h) col[h] = i; });
  return { sheet, col, width: current.length };
}

function readRows_(table) {
  const { sheet, width } = table;
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, width).getValues();
}

function setCell_(table, rowIndex, header, value) {
  table.sheet.getRange(rowIndex, table.col[header] + 1).setValue(value);
}

function buildRow_(table, obj) {
  const row = new Array(table.width).fill('');
  Object.keys(obj).forEach(k => { if (k in table.col) row[table.col[k]] = obj[k]; });
  return row;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ==== パスワード・トークン ====

function normEmail_(email) { return String(email || '').trim().toLowerCase(); }

function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + PEPPER(), Utilities.Charset.UTF_8);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function generateTempPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[(bytes[i] + 256) % chars.length];
  return s;
}

function b64url_(bytesOrString) {
  const encoded = typeof bytesOrString === 'string'
    ? Utilities.base64EncodeWebSafe(bytesOrString, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(bytesOrString);
  return encoded.replace(/=+$/, '');
}
function b64urlDecode_(s) {
  let t = String(s);
  while (t.length % 4) t += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(t)).getDataAsString('UTF-8');
}
function sign_(text) {
  return b64url_(Utilities.computeHmacSha256Signature(text, PEPPER(), Utilities.Charset.UTF_8));
}

// パスワードハッシュの一部を署名に含める → パスワード変更で古いトークンは無効になる
function issueToken_(email, passwordHash, ttl) {
  const payload = `${email}|${Date.now() + (ttl || TOKEN_TTL_MS)}`;
  return `${b64url_(payload)}.${sign_(payload + '|' + String(passwordHash).slice(0, 16))}`;
}

function findMember_(table, email) {
  const target = normEmail_(email);
  if (!target) return null;
  const rows = readRows_(table);
  for (let i = 0; i < rows.length; i++) {
    if (normEmail_(rows[i][table.col.Email]) === target) {
      return { rowIndex: i + 2, row: rows[i], get: (h) => rows[i][table.col[h]] };
    }
  }
  return null;
}

/** トークンを検証して会員を返す（失敗時は AuthError） */
function authMember_(token, members) {
  if (!token || String(token).indexOf('.') === -1) throw AuthError_();
  const [p, sig] = String(token).split('.');
  let payload;
  try { payload = b64urlDecode_(p); } catch (e) { throw AuthError_(); }
  const [email, exp] = payload.split('|');
  if (!email || !exp || Date.now() > Number(exp)) throw AuthError_('ログインの有効期限が切れました');
  const table = members || getTable_(MEMBERS_SHEET, MEMBER_HEADERS);
  const m = findMember_(table, email);
  if (!m || m.get('Status') !== 'active') throw AuthError_();
  if (sign_(payload + '|' + String(m.get('PasswordHash')).slice(0, 16)) !== sig) throw AuthError_();
  return { table, member: m, email: normEmail_(m.get('Email')) };
}

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

// ==== 会員機能 ====

function registerMember(params) {
  const email = normEmail_(params.email);
  const nickname = String(params.nickname || '').trim().slice(0, 20);
  if (!email || !nickname) return { success: false, message: 'メールアドレスとニックネームは必須です' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'メールアドレスの形式が正しくありません' };

  return withLock_(() => {
    const table = getTable_(MEMBERS_SHEET, MEMBER_HEADERS);
    const exists = findMember_(table, email);
    if (exists && exists.get('Status') === 'active') {
      return { success: false, message: 'このメールアドレスは既に登録されています' };
    }
    const tempPassword = generateTempPassword_();
    const values = {
      Email: email, Nickname: nickname, PasswordHash: hashPassword_(tempPassword),
      ForceChange: true, Status: 'active', CreatedAt: new Date(), FailCount: 0, LockedUntil: ''
    };
    if (exists) {
      // 退会済みアドレスの再登録
      table.sheet.getRange(exists.rowIndex, 1, 1, table.width).setValues([buildRow_(table, values)]);
    } else {
      table.sheet.appendRow(buildRow_(table, values));
    }

    try {
      MailApp.sendEmail({
        to: email,
        subject: '【私の街の歴史】仮パスワードのお知らせ',
        body: `${nickname} 様\n\n会員登録ありがとうございます。\n仮パスワード: ${tempPassword}\n\n初回ログイン後、新しいパスワードに変更してください。\nhttps://kenken6291.github.io/history-of-city/`
      });
    } catch (err) {
      return { success: true, message: '登録しましたが、メール送信に失敗しました。管理者にお問い合わせください。' };
    }
    return { success: true, message: '登録が完了しました。メールで仮パスワードを送信しました。' };
  });
}

function loginMember(params) {
  const table = getTable_(MEMBERS_SHEET, MEMBER_HEADERS);
  const m = findMember_(table, params.email);
  const ng = { success: false, message: 'メールアドレスまたはパスワードが違います' };
  if (!m || m.get('Status') !== 'active') return ng;

  const lockedUntil = m.get('LockedUntil') ? new Date(m.get('LockedUntil')).getTime() : 0;
  if (lockedUntil && Date.now() < lockedUntil) {
    const min = Math.ceil((lockedUntil - Date.now()) / 60000);
    return { success: false, message: `ログインに続けて失敗したため、あと${min}分ほどロックされています` };
  }

  if (hashPassword_(String(params.password || '')) !== m.get('PasswordHash')) {
    const fail = (Number(m.get('FailCount')) || 0) + 1;
    if (fail >= MAX_FAIL) {
      setCell_(table, m.rowIndex, 'FailCount', 0);
      setCell_(table, m.rowIndex, 'LockedUntil', new Date(Date.now() + LOCK_MINUTES * 60000));
      return { success: false, message: `${MAX_FAIL}回失敗したため${LOCK_MINUTES}分間ロックしました` };
    }
    setCell_(table, m.rowIndex, 'FailCount', fail);
    return ng;
  }

  if (Number(m.get('FailCount')) || m.get('LockedUntil')) {
    setCell_(table, m.rowIndex, 'FailCount', 0);
    setCell_(table, m.rowIndex, 'LockedUntil', '');
  }
  const forceChange = isTrue_(m.get('ForceChange'));
  const email = normEmail_(m.get('Email'));
  return {
    success: true,
    email: email,
    nickname: m.get('Nickname'),
    forceChange: forceChange,
    token: issueToken_(email, m.get('PasswordHash'), forceChange ? TEMP_TOKEN_TTL_MS : TOKEN_TTL_MS)
  };
}

function changePassword(params) {
  const { table, member, email } = authMember_(params.token);
  const newPassword = String(params.newPassword || '');
  if (newPassword.length < 6) return { success: false, message: 'パスワードは6文字以上にしてください' };

  // 通常の変更は現在のパスワードも確認（初回強制変更時は不要）
  if (!isTrue_(member.get('ForceChange'))) {
    if (hashPassword_(String(params.currentPassword || '')) !== member.get('PasswordHash')) {
      return { success: false, message: '現在のパスワードが違います' };
    }
  }
  const newHash = hashPassword_(newPassword);
  setCell_(table, member.rowIndex, 'PasswordHash', newHash);
  setCell_(table, member.rowIndex, 'ForceChange', false);
  return {
    success: true,
    message: 'パスワードを変更しました',
    email: email,
    nickname: member.get('Nickname'),
    token: issueToken_(email, newHash)
  };
}

function reissuePassword(params) {
  const generic = { success: true, message: 'ご登録のメールアドレスであれば、仮パスワードを送信しました。メールをご確認ください。' };
  const table = getTable_(MEMBERS_SHEET, MEMBER_HEADERS);
  const m = findMember_(table, params.email);
  if (!m || m.get('Status') !== 'active') return generic;

  const tempPassword = generateTempPassword_();
  setCell_(table, m.rowIndex, 'PasswordHash', hashPassword_(tempPassword));
  setCell_(table, m.rowIndex, 'ForceChange', true);
  setCell_(table, m.rowIndex, 'FailCount', 0);
  setCell_(table, m.rowIndex, 'LockedUntil', '');
  try {
    MailApp.sendEmail({
      to: normEmail_(m.get('Email')),
      subject: '【私の街の歴史】仮パスワード再発行',
      body: `仮パスワードを再発行しました: ${tempPassword}\n\nログイン後、新しいパスワードに変更してください。\nhttps://kenken6291.github.io/history-of-city/`
    });
  } catch (err) { /* no-op */ }
  return generic;
}

function changeNickname(params) {
  const { table, member } = authMember_(params.token);
  const nickname = String(params.newNickname || '').trim().slice(0, 20);
  if (!nickname) return { success: false, message: 'ニックネームを入力してください' };
  setCell_(table, member.rowIndex, 'Nickname', nickname);
  return { success: true, message: 'ニックネームを変更しました', nickname: nickname };
}

function withdrawMember(params) {
  const { table, member } = authMember_(params.token);
  setCell_(table, member.rowIndex, 'Status', 'withdrawn');
  return { success: true, message: '退会処理が完了しました。ご利用ありがとうございました。' };
}

// ==== 写真重ね合わせ機能 ====

function uploadPhotoPair(params) {
  const { member, email } = authMember_(params.token);
  const locationName = String(params.locationName || '').trim().slice(0, 60);
  if (!locationName) return { success: false, message: '場所の名前を入力してください' };
  if (!params.oldPhotoBase64 || !params.newPhotoBase64) return { success: false, message: '写真が2枚そろっていません' };

  let lat = '', lng = '';
  if (params.latitude !== '' && params.latitude != null && params.longitude !== '' && params.longitude != null) {
    const la = Number(params.latitude), ln = Number(params.longitude);
    if (isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) { lat = la; lng = ln; }
  }

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID());
  const photoId = Utilities.getUuid();
  const oldFile = saveBase64Image_(folder, params.oldPhotoBase64, `${photoId}_old`);
  const newFile = saveBase64Image_(folder, params.newPhotoBase64, `${photoId}_new`);
  [oldFile, newFile].forEach(f => f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW));

  const oldPhotoUrl = `https://drive.google.com/thumbnail?id=${oldFile.getId()}&sz=w2000`;
  const newPhotoUrl = `https://drive.google.com/thumbnail?id=${newFile.getId()}&sz=w2000`;

  withLock_(() => {
    const table = getTable_(PHOTOS_SHEET, PHOTO_HEADERS);
    table.sheet.appendRow(buildRow_(table, {
      PhotoId: photoId, Email: email, Nickname: member.get('Nickname'), LocationName: locationName,
      OldPhotoUrl: oldPhotoUrl, NewPhotoUrl: newPhotoUrl, Caption: '',
      UserComment: String(params.userComment || '').slice(0, 500), CreatedAt: new Date(),
      Latitude: lat, Longitude: lng, OldYear: String(params.oldYear || '').trim().slice(0, 30),
      OldFileId: oldFile.getId(), NewFileId: newFile.getId()
    }));
  });

  return { success: true, photoId, oldPhotoUrl, newPhotoUrl };
}

function saveBase64Image_(folder, dataUrl, baseName) {
  const m = String(dataUrl).match(/^data:(image\/[\w.+-]+);base64,(.*)$/);
  const mime = m ? m[1] : 'image/jpeg';
  const bytes = Utilities.base64Decode(m ? m[2] : String(dataUrl));
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('画像サイズが大きすぎます');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return folder.createFile(Utilities.newBlob(bytes, mime, `${baseName}.${ext}`));
}

function listPhotos(token) {
  // ログイン中なら自分の投稿に mine:true を付ける（メールアドレスは返さない）
  let me = '';
  const members = getTable_(MEMBERS_SHEET, MEMBER_HEADERS);
  if (token) {
    try { me = authMember_(token, members).email; } catch (e) { me = ''; }
  }
  const nickByEmail = {};
  readRows_(members).forEach(r => {
    const em = normEmail_(r[members.col.Email]);
    nickByEmail[em] = r[members.col.Status] === 'active' ? r[members.col.Nickname] : '（退会済み）';
  });

  const table = getTable_(PHOTOS_SHEET, PHOTO_HEADERS);
  const c = table.col;
  const photos = readRows_(table).filter(r => r[c.PhotoId]).map(r => {
    const em = normEmail_(r[c.Email]);
    const created = r[c.CreatedAt];
    return {
      photoId: r[c.PhotoId],
      nickname: nickByEmail[em] || r[c.Nickname] || '',
      locationName: r[c.LocationName],
      oldPhotoUrl: r[c.OldPhotoUrl],
      newPhotoUrl: r[c.NewPhotoUrl],
      userComment: r[c.UserComment],
      oldYear: r[c.OldYear] || '',
      latitude: r[c.Latitude],
      longitude: r[c.Longitude],
      createdAt: created instanceof Date ? created.toISOString() : created,
      mine: !!me && em === me
    };
  });
  photos.reverse();
  return { success: true, photos: photos, apiVersion: API_VERSION };
}

function deletePhoto(params) {
  const { email } = authMember_(params.token);
  return withLock_(() => {
    const table = getTable_(PHOTOS_SHEET, PHOTO_HEADERS);
    const c = table.col;
    const rows = readRows_(table);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][c.PhotoId] !== params.photoId) continue;
      if (normEmail_(rows[i][c.Email]) !== email) return { success: false, message: '削除権限がありません' };

      // Driveの写真もゴミ箱へ（旧データはURLからIDを取り出す）
      [[c.OldFileId, c.OldPhotoUrl], [c.NewFileId, c.NewPhotoUrl]].forEach(([idCol, urlCol]) => {
        let id = rows[i][idCol];
        if (!id) {
          const mm = String(rows[i][urlCol] || '').match(/[?&]id=([\w-]+)/);
          id = mm ? mm[1] : '';
        }
        if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* no-op */ } }
      });
      table.sheet.deleteRow(i + 2);
      return { success: true, message: '削除しました' };
    }
    return { success: false, message: '写真が見つかりません' };
  });
}
