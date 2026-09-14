/**
 * 「私の街の歴史」写真重ね合わせサイト - GASバックエンド
 * ------------------------------------------------------
 * 構成:
 *   - スプレッドシート「Members」シート: 会員情報
 *   - スプレッドシート「Photos」シート  : 投稿された昔/現在写真ペアの記録
 *   - Google Drive フォルダ           : 実写真ファイル（昔写真・現在写真）
 *   - Gemini API                      : 昔写真と現在写真を比較し変化コメントを自動生成
 *
 * デプロイ: ウェブアプリとして公開（実行:自分／アクセス:全員）
 * doPost の action で処理を振り分けるシンプルなJSON APIです。
 */

// ==== 設定値（スクリプトプロパティから読み込み） ====
// 「プロジェクトの設定」→「スクリプト プロパティ」に以下を登録しておくこと:
//   SPREADSHEET_ID, DRIVE_FOLDER_ID, GEMINI_API_KEY, PEPPER
function getProp_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`スクリプトプロパティ「${key}」が未設定です`);
  return value;
}
const SPREADSHEET_ID = () => getProp_('SPREADSHEET_ID');
const DRIVE_FOLDER_ID = () => getProp_('DRIVE_FOLDER_ID');
const GEMINI_API_KEY = () => getProp_('GEMINI_API_KEY');
const PEPPER = () => getProp_('PEPPER');
const GEMINI_MODEL = 'gemini-2.0-flash';
const MEMBERS_SHEET = 'Members';
const PHOTOS_SHEET = 'Photos';

// ==== エントリーポイント ====

function doPost(e) {
  let result;
  try {
    const params = JSON.parse(e.postData.contents);
    const action = params.action;

    switch (action) {
      case 'register':      result = registerMember(params); break;
      case 'login':         result = loginMember(params); break;
      case 'changePassword':result = changePassword(params); break;
      case 'reissuePassword':result = reissuePassword(params); break;
      case 'changeNickname':result = changeNickname(params); break;
      case 'withdraw':      result = withdrawMember(params); break;
      case 'uploadPhoto':   result = uploadPhotoPair(params); break;
      case 'deletePhoto':   result = deletePhoto(params); break;
      default:
        result = { success: false, message: '不明なactionです: ' + action };
    }
  } catch (err) {
    result = { success: false, message: 'サーバーエラー: ' + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = e.parameter.action;
  let result;
  try {
    if (action === 'listPhotos') {
      result = listPhotos();
    } else {
      result = { success: false, message: '不明なactionです: ' + action };
    }
  } catch (err) {
    result = { success: false, message: 'サーバーエラー: ' + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==== 会員機能（いつものパターン） ====

function getSheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID());
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === MEMBERS_SHEET) {
      sheet.appendRow(['Email', 'Nickname', 'PasswordHash', 'ForceChange', 'Status', 'CreatedAt']);
    } else if (name === PHOTOS_SHEET) {
      sheet.appendRow(['PhotoId', 'Email', 'Nickname', 'LocationName', 'OldPhotoUrl', 'NewPhotoUrl', 'Caption', 'UserComment', 'CreatedAt']);
    }
  }
  return sheet;
}

function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + PEPPER());
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function generateTempPassword_() {
  return Math.random().toString(36).slice(-8);
}

function findMemberRow_(sheet, email) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) return { rowIndex: i + 1, row: data[i] };
  }
  return null;
}

function registerMember(params) {
  const email = params.email;
  const nickname = params.nickname;
  if (!email || !nickname) return { success: false, message: 'メールアドレスとニックネームは必須です' };

  const sheet = getSheet_(MEMBERS_SHEET);
  if (findMemberRow_(sheet, email)) {
    return { success: false, message: 'このメールアドレスは既に登録されています' };
  }

  const tempPassword = generateTempPassword_();
  sheet.appendRow([email, nickname, hashPassword_(tempPassword), true, 'active', new Date()]);

  try {
    MailApp.sendEmail({
      to: email,
      subject: '【私の街の歴史】仮パスワードのお知らせ',
      body: `${nickname} 様\n\n会員登録ありがとうございます。\n仮パスワード: ${tempPassword}\n\n初回ログイン後、必ずパスワードを変更してください。`
    });
  } catch (err) {
    // メール送信失敗時も登録自体は成功として扱う
  }

  return { success: true, message: '登録が完了しました。メールで仮パスワードを送信しました。' };
}

function loginMember(params) {
  const sheet = getSheet_(MEMBERS_SHEET);
  const found = findMemberRow_(sheet, params.email);
  if (!found) return { success: false, message: 'メールアドレスまたはパスワードが違います' };

  const [email, nickname, passwordHash, forceChange, status] = found.row;
  if (status !== 'active') return { success: false, message: 'このアカウントは無効です' };
  if (hashPassword_(params.password) !== passwordHash) {
    return { success: false, message: 'メールアドレスまたはパスワードが違います' };
  }

  return {
    success: true,
    email: email,
    nickname: nickname,
    forceChange: forceChange === true || forceChange === 'TRUE'
  };
}

function changePassword(params) {
  const sheet = getSheet_(MEMBERS_SHEET);
  const found = findMemberRow_(sheet, params.email);
  if (!found) return { success: false, message: '会員が見つかりません' };

  sheet.getRange(found.rowIndex, 3).setValue(hashPassword_(params.newPassword));
  sheet.getRange(found.rowIndex, 4).setValue(false);
  return { success: true, message: 'パスワードを変更しました' };
}

function reissuePassword(params) {
  const sheet = getSheet_(MEMBERS_SHEET);
  const found = findMemberRow_(sheet, params.email);
  if (!found) return { success: false, message: '会員が見つかりません' };

  const tempPassword = generateTempPassword_();
  sheet.getRange(found.rowIndex, 3).setValue(hashPassword_(tempPassword));
  sheet.getRange(found.rowIndex, 4).setValue(true);

  try {
    MailApp.sendEmail({
      to: params.email,
      subject: '【私の街の歴史】仮パスワード再発行',
      body: `仮パスワードを再発行しました: ${tempPassword}\n\nログイン後、必ずパスワードを変更してください。`
    });
  } catch (err) {
    // no-op
  }
  return { success: true, message: '仮パスワードを再発行しました。メールをご確認ください。' };
}

function changeNickname(params) {
  const sheet = getSheet_(MEMBERS_SHEET);
  const found = findMemberRow_(sheet, params.email);
  if (!found) return { success: false, message: '会員が見つかりません' };

  sheet.getRange(found.rowIndex, 2).setValue(params.newNickname);
  return { success: true, message: 'ニックネームを変更しました' };
}

function withdrawMember(params) {
  const sheet = getSheet_(MEMBERS_SHEET);
  const found = findMemberRow_(sheet, params.email);
  if (!found) return { success: false, message: '会員が見つかりません' };

  sheet.getRange(found.rowIndex, 5).setValue('withdrawn');
  return { success: true, message: '退会処理が完了しました' };
}

// ==== 写真重ね合わせ機能 ====

function uploadPhotoPair(params) {
  const memberSheet = getSheet_(MEMBERS_SHEET);
  const memberFound = findMemberRow_(memberSheet, params.email);
  if (!memberFound) return { success: false, message: '会員が見つかりません' };
  const nickname = memberFound.row[1];

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID());
  const photoId = Utilities.getUuid();

  const oldFile = saveBase64Image_(folder, params.oldPhotoBase64, `${photoId}_old.jpg`);
  const newFile = saveBase64Image_(folder, params.newPhotoBase64, `${photoId}_new.jpg`);
  oldFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const oldPhotoUrl = `https://drive.google.com/uc?export=view&id=${oldFile.getId()}`;
  const newPhotoUrl = `https://drive.google.com/uc?export=view&id=${newFile.getId()}`;

  const caption = generateCaptionWithGemini_(params.oldPhotoBase64, params.newPhotoBase64, params.locationName);

  const photoSheet = getSheet_(PHOTOS_SHEET);
  photoSheet.appendRow([
    photoId, params.email, nickname, params.locationName,
    oldPhotoUrl, newPhotoUrl, caption, params.userComment || '', new Date()
  ]);

  return {
    success: true,
    photoId: photoId,
    oldPhotoUrl: oldPhotoUrl,
    newPhotoUrl: newPhotoUrl,
    caption: caption
  };
}

function saveBase64Image_(folder, base64Data, filename) {
  const clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const blob = Utilities.newBlob(Utilities.base64Decode(clean), 'image/jpeg', filename);
  return folder.createFile(blob);
}

function generateCaptionWithGemini_(oldBase64, newBase64, locationName) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY()}`;
    const cleanOld = oldBase64.replace(/^data:image\/\w+;base64,/, '');
    const cleanNew = newBase64.replace(/^data:image\/\w+;base64,/, '');

    const payload = {
      contents: [{
        parts: [
          { text: `これは「${locationName}」の昔の写真と現在の写真です。何がどう変わったかを、日本語で1〜2文の親しみやすいキャプションとして書いてください。断定しすぎず、観察できる変化を中心に述べてください。` },
          { inline_data: { mime_type: 'image/jpeg', data: cleanOld } },
          { inline_data: { mime_type: 'image/jpeg', data: cleanNew } }
        ]
      }]
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const json = JSON.parse(response.getContentText());
    const text = json.candidates && json.candidates[0] && json.candidates[0].content
      ? json.candidates[0].content.parts[0].text
      : '';
    return text || '変化のコメントを生成できませんでした。';
  } catch (err) {
    return '変化のコメントを生成できませんでした。';
  }
}

function listPhotos() {
  const sheet = getSheet_(PHOTOS_SHEET);
  const data = sheet.getDataRange().getValues();
  const photos = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    photos.push({
      photoId: row[0], email: row[1], nickname: row[2], locationName: row[3],
      oldPhotoUrl: row[4], newPhotoUrl: row[5], caption: row[6], userComment: row[7],
      createdAt: row[8]
    });
  }
  photos.reverse();
  return { success: true, photos: photos };
}

function deletePhoto(params) {
  const sheet = getSheet_(PHOTOS_SHEET);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === params.photoId) {
      if (data[i][1] !== params.email) {
        return { success: false, message: '削除権限がありません' };
      }
      sheet.deleteRow(i + 1);
      return { success: true, message: '削除しました' };
    }
  }
  return { success: false, message: '写真が見つかりません' };
}
