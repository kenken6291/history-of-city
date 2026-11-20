/**
 * 「私の街の歴史」会員機能・共通処理
 * 設定値は config.js（window.APP_CONFIG）から読み込みます。
 */
const CFG = window.APP_CONFIG || {};
const GAS_API_URL = CFG.GAS_API_URL;

// ==== ローカルセッション（トークン方式） ====
const Session = {
  get() {
    try {
      const raw = localStorage.getItem(CFG.SESSION_KEY);
      const s = raw ? JSON.parse(raw) : null;
      return s && s.token ? s : null;
    } catch (e) {
      return null;
    }
  },
  set(data) {
    try { localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(data)); } catch (e) { /* no-op */ }
  },
  clear() {
    try {
      localStorage.removeItem(CFG.SESSION_KEY);
      localStorage.removeItem('hoc_session'); // 旧バージョンのセッション
    } catch (e) { /* no-op */ }
  }
};

// ==== API呼び出し ====
async function callApi(action, params = {}, { auth = false } = {}) {
  if (!GAS_API_URL) return { success: false, message: 'config.js の GAS_API_URL が未設定です' };
  const body = { action, ...params };
  if (auth) {
    const s = Session.get();
    if (!s) return handleAuthError_({ success: false, authError: true, message: 'ログインしてください' });
    body.token = s.token;
  }
  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // プリフライト回避
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      return { success: false, message: '通信エラー：サーバーから予期しない応答がありました。GASのデプロイ設定をご確認ください。' };
    }
    if (json.authError) return handleAuthError_(json);
    return json;
  } catch (networkErr) {
    return { success: false, message: '通信エラー：ネットワーク接続をご確認ください。' };
  }
}

async function callGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params, _: Date.now() });
  const res = await fetch(`${GAS_API_URL}?${qs.toString()}`);
  return res.json();
}

function handleAuthError_(json) {
  Session.clear();
  refreshMemberBar();
  showToast('ログインの有効期限が切れました。もう一度ログインしてください。', 'error');
  openModal('loginModal');
  return json;
}

// ==== UIヘルパー ====
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.add('open');
  const first = el.querySelector('input:not([type=hidden]), button');
  if (first) setTimeout(() => first.focus(), 30);
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = 'modal-msg' + (type ? ' ' + type : '');
}

let toastTimer = null;
function showToast(text, type = '') {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = 'toast show' + (type ? ' toast--' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

async function withBusy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}

function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

// ==== 会員バー表示更新 ====
function refreshMemberBar() {
  const bar = document.getElementById('memberBar');
  const session = Session.get();
  bar.innerHTML = '';
  if (session) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'member-bar__me';
    btn.textContent = `${session.nickname} さん`;
    btn.addEventListener('click', openMyPage);
    bar.appendChild(btn);
  } else {
    const login = document.createElement('button');
    login.type = 'button';
    login.textContent = 'ログイン';
    login.addEventListener('click', () => openModal('loginModal'));
    const reg = document.createElement('button');
    reg.type = 'button';
    reg.textContent = '会員登録';
    reg.addEventListener('click', () => openModal('registerModal'));
    bar.append(login, reg);
  }
  const hint = document.getElementById('uploadLoginHint');
  if (hint) hint.hidden = !!session;
  document.dispatchEvent(new CustomEvent('session-changed'));
}

function openMyPage() {
  const session = Session.get();
  if (!session) return;
  document.getElementById('myNicknameInput').value = session.nickname;
  document.getElementById('myEmailText').textContent = `ログイン中：${session.email}`;
  setMsg('myPageMsg', '');
  openModal('myPageModal');
}

function onLoggedIn(res) {
  Session.set({ email: res.email, nickname: res.nickname, token: res.token });
  refreshMemberBar();
  showToast(`ようこそ、${res.nickname} さん`, 'ok');
}

// ==== イベント登録 ====
document.addEventListener('DOMContentLoaded', () => {
  // 旧セッション（トークンなし）は破棄
  if (localStorage.getItem('hoc_session')) localStorage.removeItem('hoc_session');
  refreshMemberBar();

  // ヘッダー半分クリックでスクロール
  document.querySelectorAll('[data-scroll-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.scrollTarget);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // パスワード表示/非表示切替
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? '隠す' : '表示';
    });
  });

  // モーダル：閉じるリンク・背景クリック・Escキー
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', () => closeModal(overlay.id)));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !overlay.hasAttribute('data-locked')) closeModal(overlay.id);
    });
    // Enterキーで送信
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
      const submit = overlay.querySelector(`[data-enter-for="${overlay.id}"]`);
      if (submit) { e.preventDefault(); submit.click(); }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.open:not([data-locked])').forEach(m => closeModal(m.id));
  });

  document.getElementById('toRegisterLink').addEventListener('click', () => { closeModal('loginModal'); openModal('registerModal'); });
  document.getElementById('toLoginLink').addEventListener('click', () => { closeModal('registerModal'); openModal('loginModal'); });
  document.getElementById('toReissueLink').addEventListener('click', () => {
    const email = document.getElementById('loginEmail').value.trim();
    if (email) document.getElementById('reissueEmail').value = email;
    closeModal('loginModal'); openModal('reissueModal');
  });

  // 会員登録
  const registerBtn = document.getElementById('registerSubmitBtn');
  registerBtn.addEventListener('click', () => withBusy(registerBtn, async () => {
    const email = document.getElementById('registerEmail').value.trim();
    const nickname = document.getElementById('registerNickname').value.trim();
    if (!email || !nickname) return setMsg('registerMsg', 'すべて入力してください', 'error');
    if (!isValidEmail(email)) return setMsg('registerMsg', 'メールアドレスの形式が正しくありません', 'error');
    setMsg('registerMsg', '送信中…');
    const res = await callApi('register', { email, nickname });
    setMsg('registerMsg', res.message, res.success ? 'ok' : 'error');
    if (res.success) document.getElementById('loginEmail').value = email;
  }));

  // ログイン
  const loginBtn = document.getElementById('loginSubmitBtn');
  loginBtn.addEventListener('click', () => withBusy(loginBtn, async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) return setMsg('loginMsg', 'メールアドレスとパスワードを入力してください', 'error');
    setMsg('loginMsg', 'ログイン中…');
    const res = await callApi('login', { email, password });
    if (!res.success) return setMsg('loginMsg', res.message, 'error');

    setMsg('loginMsg', '');
    document.getElementById('loginPassword').value = '';
    closeModal('loginModal');
    if (res.forceChange) {
      window.pendingLogin = res; // 仮パスワード用の一時トークンを保持
      setMsg('forceChangeMsg', '');
      openModal('forceChangeModal');
      return;
    }
    onLoggedIn(res);
  }));

  // 初回パスワード変更
  const forceBtn = document.getElementById('forceChangeSubmitBtn');
  forceBtn.addEventListener('click', () => withBusy(forceBtn, async () => {
    const newPassword = document.getElementById('newPasswordInput').value;
    const confirmPw = document.getElementById('newPasswordConfirm').value;
    if (newPassword.length < 6) return setMsg('forceChangeMsg', '6文字以上で入力してください', 'error');
    if (newPassword !== confirmPw) return setMsg('forceChangeMsg', '確認用パスワードが一致しません', 'error');
    const pending = window.pendingLogin;
    if (!pending) return setMsg('forceChangeMsg', 'もう一度ログインしてください', 'error');
    const res = await callApi('changePassword', { token: pending.token, newPassword });
    if (!res.success) return setMsg('forceChangeMsg', res.message, 'error');
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('newPasswordConfirm').value = '';
    window.pendingLogin = null;
    closeModal('forceChangeModal');
    onLoggedIn(res);
  }));

  // パスワード再発行
  const reissueBtn = document.getElementById('reissueSubmitBtn');
  reissueBtn.addEventListener('click', () => withBusy(reissueBtn, async () => {
    const email = document.getElementById('reissueEmail').value.trim();
    if (!isValidEmail(email)) return setMsg('reissueMsg', 'メールアドレスを正しく入力してください', 'error');
    setMsg('reissueMsg', '送信中…');
    const res = await callApi('reissuePassword', { email });
    setMsg('reissueMsg', res.message, res.success ? 'ok' : 'error');
  }));

  // ニックネーム変更
  const nickBtn = document.getElementById('nicknameSubmitBtn');
  nickBtn.addEventListener('click', () => withBusy(nickBtn, async () => {
    const session = Session.get();
    const newNickname = document.getElementById('myNicknameInput').value.trim();
    if (!newNickname) return setMsg('myPageMsg', 'ニックネームを入力してください', 'error');
    const res = await callApi('changeNickname', { newNickname }, { auth: true });
    if (res.success && session) {
      Session.set({ ...session, nickname: res.nickname || newNickname });
      refreshMemberBar();
      if (typeof loadGallery === 'function') loadGallery();
    }
    setMsg('myPageMsg', res.message, res.success ? 'ok' : 'error');
  }));

  // パスワード変更（マイページ）
  const pwBtn = document.getElementById('passwordChangeBtn');
  pwBtn.addEventListener('click', () => withBusy(pwBtn, async () => {
    const currentPassword = document.getElementById('curPasswordInput').value;
    const newPassword = document.getElementById('chgPasswordInput').value;
    if (!currentPassword) return setMsg('myPageMsg', '現在のパスワードを入力してください', 'error');
    if (newPassword.length < 6) return setMsg('myPageMsg', '新しいパスワードは6文字以上にしてください', 'error');
    const res = await callApi('changePassword', { currentPassword, newPassword }, { auth: true });
    if (res.success) {
      Session.set({ email: res.email, nickname: res.nickname, token: res.token });
      document.getElementById('curPasswordInput').value = '';
      document.getElementById('chgPasswordInput').value = '';
    }
    setMsg('myPageMsg', res.message, res.success ? 'ok' : 'error');
  }));

  // ログアウト
  document.getElementById('logoutBtn').addEventListener('click', () => {
    Session.clear();
    closeModal('myPageModal');
    refreshMemberBar();
    showToast('ログアウトしました');
  });

  // 退会
  const withdrawBtn = document.getElementById('withdrawBtn');
  withdrawBtn.addEventListener('click', () => withBusy(withdrawBtn, async () => {
    if (!confirm('本当に退会しますか？\n（投稿済みの写真は「退会済み」として残ります。消したい場合は先に削除してください）')) return;
    const res = await callApi('withdraw', {}, { auth: true });
    if (res.success) {
      Session.clear();
      closeModal('myPageModal');
      refreshMemberBar();
      showToast(res.message, 'ok');
      if (typeof loadGallery === 'function') loadGallery();
    } else {
      setMsg('myPageMsg', res.message, 'error');
    }
  }));
});
