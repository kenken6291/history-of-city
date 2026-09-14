// ==== 地図：デフォルト中心（川崎市周辺） ====
const DEFAULT_MAP_CENTER = [35.5309, 139.7030];

// ==== 投稿フォームの場所選択地図 ====
let locationPickerMap, locationPickerMarker;

function initLocationPicker() {
  locationPickerMap = L.map('locationPicker').setView(DEFAULT_MAP_CENTER, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(locationPickerMap);

  locationPickerMap.on('click', (e) => {
    setPickedLocation(e.latlng.lat, e.latlng.lng);
  });
}

function setPickedLocation(lat, lng) {
  document.getElementById('latitudeInput').value = lat;
  document.getElementById('longitudeInput').value = lng;
  document.getElementById('pickedLocationText').textContent = `選択中: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (locationPickerMarker) {
    locationPickerMarker.setLatLng([lat, lng]);
  } else {
    locationPickerMarker = L.marker([lat, lng]).addTo(locationPickerMap);
  }
}

// ==== 投稿マップ（ギャラリー上部） ====
let photoMap;

function initPhotoMap() {
  photoMap = L.map('photoMap').setView(DEFAULT_MAP_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(photoMap);
}

function plotPhotoMarkers(photos) {
  const withLocation = photos.filter(p => p.latitude && p.longitude);
  if (withLocation.length === 0) return;

  withLocation.forEach(photo => {
    const marker = L.marker([Number(photo.latitude), Number(photo.longitude)]).addTo(photoMap);
    marker.bindPopup(`<strong>${escapeHtml(photo.locationName)}</strong><br><a href="#photo-${photo.photoId}">写真を見る</a>`);
  });

  const bounds = L.latLngBounds(withLocation.map(p => [Number(p.latitude), Number(p.longitude)]));
  photoMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}


function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==== 重ね合わせスライダーのDOM生成 ====
function buildCompareViewer(oldUrl, newUrl) {
  const wrap = document.createElement('div');
  wrap.className = 'compare-wrap';
  wrap.innerHTML = `
    <img class="layer-old" src="${oldUrl}" alt="昔の写真">
    <img class="layer-new" src="${newUrl}" alt="現在の写真">
    <span class="compare-label compare-label--old">昔</span>
    <span class="compare-label compare-label--new">今</span>
    <input type="range" class="compare-slider" min="0" max="100" value="50">
  `;
  const slider = wrap.querySelector('.compare-slider');
  const newLayer = wrap.querySelector('.layer-new');
  slider.addEventListener('input', () => {
    newLayer.style.clipPath = `inset(0 ${100 - slider.value}% 0 0)`;
  });
  return wrap;
}

// ==== ギャラリー読み込み ====
async function loadGallery() {
  const listEl = document.getElementById('galleryList');
  try {
    const res = await fetch(`${GAS_API_URL}?action=listPhotos`);
    const data = await res.json();
    if (!data.success || data.photos.length === 0) {
      listEl.innerHTML = '<p>まだ投稿がありません。最初の一枚を投稿してみましょう。</p>';
      return;
    }
    listEl.innerHTML = '';
    data.photos.forEach(photo => renderGalleryItem(listEl, photo));
    plotPhotoMarkers(data.photos);
  } catch (err) {
    listEl.innerHTML = '<p>読み込みに失敗しました。時間をおいて再度お試しください。</p>';
  }
}

function renderGalleryItem(container, photo) {
  const session = Session.get();
  const item = document.createElement('div');
  item.className = 'gallery-item';
  item.id = `photo-${photo.photoId}`;

  const heading = document.createElement('h3');
  heading.textContent = photo.locationName;
  heading.style.margin = '0 0 10px';
  item.appendChild(heading);

  item.appendChild(buildCompareViewer(photo.oldPhotoUrl, photo.newPhotoUrl));

  if (photo.userComment) {
    const userBox = document.createElement('div');
    userBox.className = 'caption-box';
    userBox.style.marginTop = '8px';
    userBox.innerHTML = `<div class="caption-heading">投稿者コメント</div>${escapeHtml(photo.userComment)}`;
    item.appendChild(userBox);
  }

  const meta = document.createElement('div');
  meta.className = 'gallery-item__meta';
  const dateStr = photo.createdAt ? new Date(photo.createdAt).toLocaleDateString('ja-JP') : '';
  meta.innerHTML = `<span>投稿者: ${escapeHtml(photo.nickname)}（${dateStr}）</span>`;

  if (session && session.email === photo.email) {
    const delBtn = document.createElement('button');
    delBtn.className = 'gallery-item__delete';
    delBtn.textContent = '削除する';
    delBtn.addEventListener('click', async () => {
      if (!confirm('この投稿を削除しますか？')) return;
      const res = await callApi('deletePhoto', { email: session.email, photoId: photo.photoId });
      if (res.success) item.remove();
    });
    meta.appendChild(delBtn);
  }
  item.appendChild(meta);

  container.appendChild(item);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ==== 投稿フォーム ====
document.addEventListener('DOMContentLoaded', () => {
  initLocationPicker();
  initPhotoMap();
  loadGallery();

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = Session.get();
    if (!session) {
      setMsg('uploadMsg', 'ログインしてから投稿してください', 'error');
      openModal('loginModal');
      return;
    }

    const locationName = document.getElementById('locationName').value.trim();
    const oldFile = document.getElementById('oldPhotoInput').files[0];
    const newFile = document.getElementById('newPhotoInput').files[0];
    const userComment = document.getElementById('userComment').value.trim();
    const latitude = document.getElementById('latitudeInput').value;
    const longitude = document.getElementById('longitudeInput').value;

    if (!oldFile || !newFile) {
      setMsg('uploadMsg', '昔の写真と現在の写真の両方を選択してください', 'error');
      return;
    }

    const submitBtn = document.getElementById('uploadSubmitBtn');
    submitBtn.disabled = true;
    setMsg('uploadMsg', 'アップロード中...', '');

    try {
      const [oldBase64, newBase64] = await Promise.all([fileToBase64(oldFile), fileToBase64(newFile)]);
      const res = await callApi('uploadPhoto', {
        email: session.email,
        locationName,
        oldPhotoBase64: oldBase64,
        newPhotoBase64: newBase64,
        userComment,
        latitude,
        longitude
      });
      if (res.success) {
        setMsg('uploadMsg', '投稿しました！', 'ok');
        document.getElementById('uploadForm').reset();
        document.getElementById('pickedLocationText').textContent = '未選択';
        if (locationPickerMarker) { locationPickerMap.removeLayer(locationPickerMarker); locationPickerMarker = null; }
        loadGallery();
      } else {
        setMsg('uploadMsg', res.message, 'error');
      }
    } catch (err) {
      setMsg('uploadMsg', '投稿に失敗しました', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
});
