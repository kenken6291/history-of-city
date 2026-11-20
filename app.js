/**
 * 「私の街の歴史」写真投稿・地図・ギャラリー
 */
const DEFAULT_MAP_CENTER = CFG.DEFAULT_MAP_CENTER || [35.5309, 139.7030];
const DEFAULT_MAP_ZOOM = CFG.DEFAULT_MAP_ZOOM || 13;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; OpenStreetMap contributors';

let allPhotos = [];
let preparedImages = { old: null, new: null }; // 縮小済みdataURL

// ==== 共通 ====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ==== 投稿フォームの場所選択地図 ====
let locationPickerMap, locationPickerMarker;

const hasLeaflet = () => typeof window.L !== 'undefined';

function initLocationPicker() {
  if (!hasLeaflet()) {
    document.getElementById('locationPicker').innerHTML = '<p class="empty">地図を読み込めませんでした（場所の選択なしでも投稿できます）</p>';
    return;
  }
  locationPickerMap = L.map('locationPicker').setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(locationPickerMap);
  locationPickerMap.on('click', (e) => setPickedLocation(e.latlng.lat, e.latlng.lng));
}

function setPickedLocation(lat, lng, pan = false) {
  document.getElementById('latitudeInput').value = lat.toFixed(6);
  document.getElementById('longitudeInput').value = lng.toFixed(6);
  document.getElementById('pickedLocationText').textContent = `選択中：${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('clearLocationBtn').hidden = false;

  if (!locationPickerMap) return;
  if (locationPickerMarker) {
    locationPickerMarker.setLatLng([lat, lng]);
  } else {
    locationPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(locationPickerMap);
    locationPickerMarker.on('dragend', () => {
      const p = locationPickerMarker.getLatLng();
      setPickedLocation(p.lat, p.lng);
    });
  }
  if (pan) locationPickerMap.setView([lat, lng], Math.max(locationPickerMap.getZoom(), 16));
}

function clearPickedLocation() {
  document.getElementById('latitudeInput').value = '';
  document.getElementById('longitudeInput').value = '';
  document.getElementById('pickedLocationText').textContent = '未選択';
  document.getElementById('clearLocationBtn').hidden = true;
  if (locationPickerMarker) {
    locationPickerMap.removeLayer(locationPickerMarker);
    locationPickerMarker = null;
  }
}

async function searchPlace() {
  const q = document.getElementById('placeSearchInput').value.trim();
  if (!q) return;
  const btn = document.getElementById('placeSearchBtn');
  await withBusy(btn, async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const list = await res.json();
      if (!list.length) return showToast('場所が見つかりませんでした', 'error');
      setPickedLocation(Number(list[0].lat), Number(list[0].lon), true);
      const nameInput = document.getElementById('locationName');
      if (!nameInput.value.trim()) nameInput.value = q;
    } catch (e) {
      showToast('検索に失敗しました', 'error');
    }
  });
}

function useMyLocation() {
  if (!navigator.geolocation) return showToast('この端末では現在地を取得できません', 'error');
  const btn = document.getElementById('myLocationBtn');
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => { btn.disabled = false; setPickedLocation(pos.coords.latitude, pos.coords.longitude, true); },
    () => { btn.disabled = false; showToast('現在地を取得できませんでした', 'error'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ==== 投稿マップ ====
let photoMap, photoMarkersLayer;
const markerById = {};

function initPhotoMap() {
  if (!hasLeaflet()) {
    document.getElementById('photoMap').innerHTML = '<p class="empty">地図を読み込めませんでした</p>';
    return;
  }
  photoMap = L.map('photoMap').setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM - 1);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(photoMap);
  photoMarkersLayer = L.layerGroup().addTo(photoMap);

  // ポップアップ内「写真を見る」
  photoMap.on('popupopen', (e) => {
    const link = e.popup.getElement().querySelector('[data-goto]');
    if (link) link.addEventListener('click', (ev) => { ev.preventDefault(); scrollToPhoto(link.dataset.goto); });
  });
}

function hasLatLng(p) {
  const lat = Number(p.latitude), lng = Number(p.longitude);
  return p.latitude !== '' && p.longitude !== '' && isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
}

function plotPhotoMarkers(photos) {
  if (!photoMap) return;
  photoMarkersLayer.clearLayers();
  Object.keys(markerById).forEach(k => delete markerById[k]);

  const withLocation = photos.filter(hasLatLng);
  withLocation.forEach(photo => {
    const marker = L.marker([Number(photo.latitude), Number(photo.longitude)]);
    marker.bindPopup(`
      <div class="map-popup">
        <img src="${escapeHtml(thumbUrl(photo.oldPhotoUrl, 240))}" alt="" referrerpolicy="no-referrer">
        <strong>${escapeHtml(photo.locationName)}</strong>
        ${photo.oldYear ? `<span>${escapeHtml(photo.oldYear)}</span>` : ''}
        <a href="#photo-${escapeHtml(photo.photoId)}" data-goto="${escapeHtml(photo.photoId)}">写真を見る ↓</a>
      </div>`);
    photoMarkersLayer.addLayer(marker);
    markerById[photo.photoId] = marker;
  });

  if (withLocation.length) {
    const bounds = L.latLngBounds(withLocation.map(p => [Number(p.latitude), Number(p.longitude)]));
    photoMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }
}

function showOnMap(photoId) {
  const marker = markerById[photoId];
  if (!marker || !photoMap) return;
  document.getElementById('mapSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => {
    photoMap.setView(marker.getLatLng(), 16);
    marker.openPopup();
  }, 350);
}

function scrollToPhoto(photoId) {
  const el = document.getElementById(`photo-${photoId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// Driveサムネイルのサイズ変更
function thumbUrl(url, size) {
  if (!url) return '';
  return /drive\.google\.com\/thumbnail/.test(url) ? url.replace(/sz=w\d+/, `sz=w${size}`) : url;
}

// ==== 画像の縮小（向き補正込み） ====
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function compressImage(file) {
  const max = CFG.IMAGE_MAX_SIZE || 1600;
  const quality = CFG.IMAGE_QUALITY || 0.85;
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    source = await loadImageElement(file); // 古いブラウザ向け
  }
  const w = source.width, h = source.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvas.toDataURL('image/jpeg', quality);
}

async function handleFileSelect(kind) {
  const input = document.getElementById(kind === 'old' ? 'oldPhotoInput' : 'newPhotoInput');
  const thumb = document.getElementById(kind === 'old' ? 'oldThumb' : 'newThumb');
  const hint = document.getElementById(kind === 'old' ? 'oldHint' : 'newHint');
  const file = input.files[0];
  preparedImages[kind] = null;
  if (!file) {
    thumb.hidden = true;
    updatePreview();
    return;
  }
  hint.textContent = '読み込み中…';
  try {
    const dataUrl = await compressImage(file);
    preparedImages[kind] = dataUrl;
    thumb.src = dataUrl;
    thumb.hidden = false;
    hint.textContent = `${file.name}（${Math.round(dataUrl.length * 0.75 / 1024)}KBに縮小）`;
  } catch (e) {
    input.value = '';
    thumb.hidden = true;
    hint.textContent = 'この画像は読み込めませんでした（HEIC形式などはJPEGに変換してください）';
  }
  updatePreview();
}

function updatePreview() {
  const box = document.getElementById('previewBox');
  const holder = document.getElementById('previewViewer');
  holder.innerHTML = '';
  if (preparedImages.old && preparedImages.new) {
    const year = document.getElementById('oldYear').value.trim();
    holder.appendChild(buildCompareViewer(preparedImages.old, preparedImages.new, { oldYear: year, eager: true }));
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

// ==== 重ね合わせビューア ====
function buildCompareViewer(oldUrl, newUrl, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'compare';
  const loading = opts.eager ? 'eager' : 'lazy';
  const oldLabel = opts.oldYear ? `昔（${escapeHtml(opts.oldYear)}）` : '昔';
  wrap.innerHTML = `
    <div class="compare-wrap" data-mode="slide">
      <img class="layer-old" src="${escapeHtml(oldUrl)}" alt="昔の写真" loading="${loading}" referrerpolicy="no-referrer">
      <img class="layer-new" src="${escapeHtml(newUrl)}" alt="現在の写真" loading="${loading}" referrerpolicy="no-referrer">
      <div class="compare-handle" aria-hidden="true"><span class="compare-knob">◀▶</span></div>
      <span class="compare-label compare-label--old">${oldLabel}</span>
      <span class="compare-label compare-label--new">今</span>
      <input type="range" class="compare-slider" min="0" max="100" value="50" aria-label="昔と今の見比べ位置">
    </div>
    <div class="compare-controls">
      <div class="seg" role="group" aria-label="見比べ方">
        <button type="button" class="seg__btn is-active" data-mode="slide">スライド</button>
        <button type="button" class="seg__btn" data-mode="fade">透かし</button>
      </div>
      <div class="compare-quick">
        <button type="button" class="link-btn" data-jump="0">昔だけ</button>
        <button type="button" class="link-btn" data-jump="100">今だけ</button>
        <button type="button" class="link-btn" data-fullscreen>全画面</button>
      </div>
    </div>`;

  const stage = wrap.querySelector('.compare-wrap');
  const slider = wrap.querySelector('.compare-slider');
  const newLayer = wrap.querySelector('.layer-new');
  const handle = wrap.querySelector('.compare-handle');

  const apply = () => {
    const v = Number(slider.value);
    if (stage.dataset.mode === 'slide') {
      newLayer.style.clipPath = `inset(0 0 0 ${v}%)`;
      newLayer.style.opacity = 1;
      handle.style.left = `${v}%`;
    } else {
      newLayer.style.clipPath = 'none';
      newLayer.style.opacity = v / 100;
    }
  };
  slider.addEventListener('input', apply);

  wrap.querySelectorAll('.seg__btn').forEach(b => b.addEventListener('click', () => {
    stage.dataset.mode = b.dataset.mode;
    wrap.querySelectorAll('.seg__btn').forEach(x => x.classList.toggle('is-active', x === b));
    apply();
  }));
  wrap.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    const target = Number(b.dataset.jump);
    // スライドモードでは右側が「今」なので、昔だけ＝100、今だけ＝0
    slider.value = stage.dataset.mode === 'slide' ? 100 - target : target;
    apply();
  }));
  wrap.querySelector('[data-fullscreen]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
    else showToast('この端末では全画面表示に対応していません');
  });

  // 画像が読めないとき
  wrap.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
    stage.classList.add('is-broken');
  }, { once: true }));

  apply();
  return wrap;
}

// ==== ギャラリー ====
async function loadGallery() {
  const listEl = document.getElementById('galleryList');
  try {
    const session = Session.get();
    const params = session ? { token: session.token } : {};
    const data = await callGet('listPhotos', params);
    if (!data.success) throw new Error(data.message);
    allPhotos = data.photos || [];
    renderGallery();
  } catch (err) {
    listEl.innerHTML = '<p class="empty">読み込みに失敗しました。時間をおいて「再読み込み」を押してください。</p>';
    document.getElementById('galleryCount').textContent = '';
  }
}

function getFilteredPhotos() {
  const q = document.getElementById('gallerySearch').value.trim().toLowerCase();
  const sort = document.getElementById('gallerySort').value;
  let list = allPhotos.filter(p => !q || [p.locationName, p.userComment, p.nickname, p.oldYear]
    .some(v => String(v || '').toLowerCase().includes(q)));
  const t = (p) => new Date(p.createdAt).getTime() || 0;
  if (sort === 'new') list.sort((a, b) => t(b) - t(a));
  else if (sort === 'old') list.sort((a, b) => t(a) - t(b));
  else if (sort === 'place') list.sort((a, b) => String(a.locationName).localeCompare(String(b.locationName), 'ja'));
  return list;
}

function renderGallery() {
  const listEl = document.getElementById('galleryList');
  const list = getFilteredPhotos();
  document.getElementById('galleryCount').textContent =
    allPhotos.length ? `${list.length} / ${allPhotos.length} 件` : '';
  plotPhotoMarkers(list);

  if (!allPhotos.length) {
    listEl.innerHTML = '<p class="empty">まだ投稿がありません。最初の一枚を投稿してみましょう。</p>';
    return;
  }
  if (!list.length) {
    listEl.innerHTML = '<p class="empty">条件に合う投稿がありません。</p>';
    return;
  }
  listEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  list.forEach(photo => frag.appendChild(renderGalleryItem(photo)));
  listEl.appendChild(frag);

  // URLの #photo-xxx に対応
  const hash = location.hash.match(/^#photo-(.+)$/);
  if (hash) setTimeout(() => scrollToPhoto(decodeURIComponent(hash[1])), 200);
}

function renderGalleryItem(photo) {
  const item = document.createElement('article');
  item.className = 'gallery-item';
  item.id = `photo-${photo.photoId}`;

  const head = document.createElement('div');
  head.className = 'gallery-item__head';
  head.innerHTML = `
    <h3>${escapeHtml(photo.locationName)}</h3>
    ${photo.oldYear ? `<span class="year-chip">${escapeHtml(photo.oldYear)} → 現在</span>` : ''}`;
  item.appendChild(head);

  item.appendChild(buildCompareViewer(photo.oldPhotoUrl, photo.newPhotoUrl, { oldYear: photo.oldYear }));

  if (photo.userComment) {
    const box = document.createElement('div');
    box.className = 'caption-box';
    box.innerHTML = `<div class="caption-heading">投稿者コメント</div>${escapeHtml(photo.userComment)}`;
    item.appendChild(box);
  }

  const meta = document.createElement('div');
  meta.className = 'gallery-item__meta';
  const who = document.createElement('span');
  who.textContent = `投稿者：${photo.nickname}（${formatDate(photo.createdAt)}）`;
  meta.appendChild(who);

  const actions = document.createElement('span');
  actions.className = 'gallery-item__actions';
  if (hasLatLng(photo)) {
    const mapBtn = document.createElement('button');
    mapBtn.type = 'button';
    mapBtn.className = 'link-btn';
    mapBtn.textContent = '地図で見る';
    mapBtn.addEventListener('click', () => showOnMap(photo.photoId));
    actions.appendChild(mapBtn);
  }
  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'link-btn';
  shareBtn.textContent = 'リンクをコピー';
  shareBtn.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#photo-${photo.photoId}`;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: `${photo.locationName} - 私の街の歴史`, url });
      } else {
        await navigator.clipboard.writeText(url);
        showToast('リンクをコピーしました', 'ok');
      }
    } catch (e) { /* キャンセル */ }
  });
  actions.appendChild(shareBtn);

  if (photo.mine) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'link-btn link-btn--danger';
    delBtn.textContent = '削除する';
    delBtn.addEventListener('click', () => withBusy(delBtn, async () => {
      if (!confirm(`「${photo.locationName}」の投稿を削除しますか？`)) return;
      const res = await callApi('deletePhoto', { photoId: photo.photoId }, { auth: true });
      if (res.success) {
        showToast('削除しました', 'ok');
        loadGallery();
      } else {
        showToast(res.message, 'error');
      }
    }));
    actions.appendChild(delBtn);
  }
  meta.appendChild(actions);
  item.appendChild(meta);
  return item;
}

// ==== バージョン情報 ====
let apiVersion = null;

async function loadApiVersion() {
  const el = document.getElementById('footerApiVersion');
  try {
    const res = await callGet('version');
    apiVersion = res && res.apiVersion ? res.apiVersion : null;
  } catch (e) {
    apiVersion = null;
  }
  if (apiVersion) {
    const mismatch = apiVersion.split('.')[0] !== String(CFG.APP_VERSION).split('.')[0];
    el.textContent = `API v${apiVersion}`;
    el.classList.toggle('is-warn', mismatch);
    if (mismatch) el.title = 'サーバー（GAS）のバージョンが古い可能性があります。Code.gs を更新して再デプロイしてください。';
  } else {
    el.textContent = 'API 旧版または未接続';
    el.classList.add('is-warn');
  }
}

function openVersionModal() {
  document.getElementById('verApp').textContent = `v${CFG.APP_VERSION}`;
  document.getElementById('verDate').textContent = CFG.RELEASE_DATE || '-';
  document.getElementById('verApi').textContent = apiVersion ? `v${apiVersion}` : '取得できませんでした（Code.gs が旧版の可能性）';
  const list = document.getElementById('changelogList');
  list.innerHTML = (CFG.CHANGELOG || []).map(entry => `
    <div class="changelog__entry">
      <p class="changelog__ver">v${escapeHtml(entry.version)} <span>${escapeHtml(entry.date)}</span></p>
      <ul>${entry.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    </div>`).join('');
  openModal('versionModal');
}

// ==== 投稿フォーム ====
function resetUploadForm() {
  document.getElementById('uploadForm').reset();
  preparedImages = { old: null, new: null };
  ['old', 'new'].forEach(k => { document.getElementById(`${k}Thumb`).hidden = true; });
  document.getElementById('oldHint').textContent = 'タップして選択';
  document.getElementById('newHint').textContent = '同じ場所・同じ角度で撮影';
  clearPickedLocation();
  updatePreview();
}

async function submitUpload(e) {
  e.preventDefault();
  const session = Session.get();
  if (!session) {
    setMsg('uploadMsg', 'ログインしてから投稿してください', 'error');
    openModal('loginModal');
    return;
  }

  const locationName = document.getElementById('locationName').value.trim();
  if (!locationName) {
    setMsg('uploadMsg', '場所の名前を入力してください', 'error');
    document.getElementById('locationName').focus();
    return;
  }
  if (!preparedImages.old || !preparedImages.new) {
    setMsg('uploadMsg', '昔の写真と現在の写真の両方を選択してください', 'error');
    return;
  }
  const latitude = document.getElementById('latitudeInput').value;
  if (!latitude && !confirm('撮影場所が地図で選ばれていません。このまま投稿しますか？\n（投稿マップには表示されません）')) return;

  const submitBtn = document.getElementById('uploadSubmitBtn');
  await withBusy(submitBtn, async () => {
    setMsg('uploadMsg', 'アップロード中…（数秒〜数十秒かかります）');
    const res = await callApi('uploadPhoto', {
      locationName,
      oldYear: document.getElementById('oldYear').value.trim(),
      oldPhotoBase64: preparedImages.old,
      newPhotoBase64: preparedImages.new,
      userComment: document.getElementById('userComment').value.trim(),
      latitude,
      longitude: document.getElementById('longitudeInput').value
    }, { auth: true });

    if (res.success) {
      setMsg('uploadMsg', '投稿しました！', 'ok');
      showToast('投稿しました！', 'ok');
      resetUploadForm();
      await loadGallery();
      scrollToPhoto(res.photoId);
    } else {
      setMsg('uploadMsg', res.message || '投稿に失敗しました', 'error');
    }
  });
}

// ==== 起動 ====
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('footerVersion').textContent = `v${CFG.APP_VERSION || '-'}`;
  document.getElementById('versionBtn').addEventListener('click', openVersionModal);

  initLocationPicker();
  initPhotoMap();
  loadGallery();
  loadApiVersion();

  document.getElementById('oldPhotoInput').addEventListener('change', () => handleFileSelect('old'));
  document.getElementById('newPhotoInput').addEventListener('change', () => handleFileSelect('new'));
  document.getElementById('oldYear').addEventListener('change', updatePreview);
  document.getElementById('uploadForm').addEventListener('submit', submitUpload);

  document.getElementById('placeSearchBtn').addEventListener('click', searchPlace);
  document.getElementById('placeSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); searchPlace(); }
  });
  document.getElementById('myLocationBtn').addEventListener('click', useMyLocation);
  document.getElementById('clearLocationBtn').addEventListener('click', clearPickedLocation);

  let searchTimer;
  document.getElementById('gallerySearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGallery, 200);
  });
  document.getElementById('gallerySort').addEventListener('change', renderGallery);
  document.getElementById('galleryReloadBtn').addEventListener('click', loadGallery);

  // ログイン状態が変わったら「削除」ボタンの表示を更新
  let galleryReady = false;
  document.addEventListener('session-changed', () => { if (galleryReady) loadGallery(); });
  galleryReady = true;
});
