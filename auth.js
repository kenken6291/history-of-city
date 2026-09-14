// ==== 設定 ====
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwUQZXv3UUIiEf3yK8Mch1CcmeCiaDYsNT286P7UJSqqq1IhHwU1nLj-JN5esD-a7fPOg/exec'; // デプロイしたGASウェブアプリのURL

// ==== ローカルセッション ====
const Session = {
  get() {
    const raw = localStorage.getItem('hoc_session');
    return raw ? JSON.parse(raw) : null;
  },
  set(data) {
    localStorage.setItem('hoc_session', JSON.stringify(data));
  },
  clear() {
    localStorage.removeItem('hoc_session');
  }
};

// ==== API呼び出し ====
async function callApi(action, params) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...params })
  });
  return res.json();
}

// ==== モーダル制御 ====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function setMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'modal-msg' + (type ? ' ' + type : '');
}

// ==== 会員バー表示更新 ====
function refreshMemberBar() {
  const bar = document.getElementById('memberBar');
  const session = Session.get();
  if (session) {
    bar.innerHTML = `<span id="myPageOpenBtn">${session.nickname} さん</span>`;
    document.getElementById('myPageOpenBtn').addEventListener('click', () => {
      document.getElementById('myNicknameInput').value = session.nickname;
      openModal('myPageModal');
    });
  } else {
    bar.innerHTML = `<span id="loginOpenBtn">ログイン</span><span id="registerOpenBtn">会員登録</span>`;
    bindTopBarLinks();
  }
}

function bindTopBarLinks() {
  const loginBtn = document.getElementById('loginOpenBtn');
  const registerBtn = document.getElementById('registerOpenBtn');
  if (loginBtn) loginBtn.addEventListener('click', () => openModal('loginModal'));
  if (registerBtn) registerBtn.addEventListener('click', () => openModal('registerModal'));
}

// ==== イベント登録 ====
document.addEventListener('DOMContentLoaded', () => {
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

  document.getElementById('closeLoginLink').addEventListener('click', () => closeModal('loginModal'));
  document.getElementById('closeRegisterLink').addEventListener('click', () => closeModal('registerModal'));
  document.getElementById('closeReissueLink').addEventListener('click', () => closeModal('reissueModal'));
  document.getElementById('closeMyPageLink').addEventListener('click', () => closeModal('myPageModal'));

  document.getElementById('toRegisterLink').addEventListener('click', () => {
    closeModal('loginModal'); openModal('registerModal');
  });
  document.getElementById('toReissueLink').addEventListener('click', () => {
    closeModal('loginModal'); openModal('reissueModal');
  });

  // 会員登録
  document.getElementById('registerSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('registerEmail').value.trim();
    const nickname = document.getElementById('registerNickname').value.trim();
    if (!email || !nickname) { setMsg('registerMsg', 'すべて入力してください', 'error'); return; }
    setMsg('registerMsg', '送信中...', '');
    const res = await callApi('register', { email, nickname });
    setMsg('registerMsg', res.message, res.success ? 'ok' : 'error');
  });

  // ログイン
  document.getElementById('loginSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    setMsg('loginMsg', 'ログイン中...', '');
    const res = await callApi('login', { email, password });
    if (!res.success) { setMsg('loginMsg', res.message, 'error'); return; }

    if (res.forceChange) {
      closeModal('loginModal');
      window.pendingEmail = email;
      openModal('forceChangeModal');
      return;
    }
    Session.set({ email: res.email, nickname: res.nickname });
    closeModal('loginModal');
    refreshMemberBar();
  });

  // 初回パスワード変更
  document.getElementById('forceChangeSubmitBtn').addEventListener('click', async () => {
    const newPassword = document.getElementById('newPasswordInput').value;
    if (newPassword.length < 4) { setMsg('forceChangeMsg', '4文字以上で入力してください', 'error'); return; }
    const res = await callApi('changePassword', { email: window.pendingEmail, newPassword });
    if (!res.success) { setMsg('forceChangeMsg', res.message, 'error'); return; }
    setMsg('forceChangeMsg', 'パスワードを変更しました', 'ok');
    setTimeout(() => {
      closeModal('forceChangeModal');
      Session.set({ email: window.pendingEmail, nickname: window.pendingEmail });
      refreshMemberBar();
    }, 800);
  });

  // パスワード再発行
  document.getElementById('reissueSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('reissueEmail').value.trim();
    setMsg('reissueMsg', '送信中...', '');
    const res = await callApi('reissuePassword', { email });
    setMsg('reissueMsg', res.message, res.success ? 'ok' : 'error');
  });

  // ニックネーム変更
  document.getElementById('nicknameSubmitBtn').addEventListener('click', async () => {
    const session = Session.get();
    const newNickname = document.getElementById('myNicknameInput').value.trim();
    const res = await callApi('changeNickname', { email: session.email, newNickname });
    if (res.success) {
      Session.set({ email: session.email, nickname: newNickname });
      refreshMemberBar();
    }
    setMsg('myPageMsg', res.message, res.success ? 'ok' : 'error');
  });

  // ログアウト
  document.getElementById('logoutBtn').addEventListener('click', () => {
    Session.clear();
    closeModal('myPageModal');
    refreshMemberBar();
  });

  // 退会
  document.getElementById('withdrawBtn').addEventListener('click', async () => {
    const session = Session.get();
    if (!confirm('本当に退会しますか？')) return;
    const res = await callApi('withdraw', { email: session.email });
    if (res.success) {
      Session.clear();
      closeModal('myPageModal');
      refreshMemberBar();
    }
    setMsg('myPageMsg', res.message, res.success ? 'ok' : 'error');
  });
});
