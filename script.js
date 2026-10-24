const photoInput = document.getElementById('sake-photo');
const photoPreviews = document.getElementById('photo-previews');
const photoWarning = document.getElementById('photo-warning');
const photoError = document.getElementById('photo-error');
const nameInput = document.getElementById('sake-name');
const impressionInput = document.getElementById('sake-impression');
const dateInput = document.getElementById('drank-on');
const registerButton = document.getElementById('register-button');
const registrationResult = document.getElementById('registration-result');
const entryScreen = document.getElementById('entry-screen');
const recordsScreen = document.getElementById('records-screen');
const recordsList = document.getElementById('records-list');
const recordFilters = document.getElementById('record-filters');
const recordSearch = document.getElementById('record-search');
const recordOrderInput = document.getElementById('record-order');
let recordQuery = '';
let recordOrder = 'newest';
let cachedRecords = null;
const wishScreen = document.getElementById('wish-entry-screen');
const wishForm = document.getElementById('wish-form');
let wishName = document.getElementById('wish-name');
let wishMemo = document.getElementById('wish-memo');
const wishGroups = document.getElementById('wish-groups');
const firstWishGroup = wishGroups.firstElementChild;
const wishAddGroup = document.getElementById('wish-add-group');
const wishGroupLimit = document.getElementById('wish-group-limit');
let nextWishGroupKey = 1;
const wishSave = document.getElementById('wish-save');
const wishBack = document.getElementById('wish-back');
const wishResult = document.getElementById('wish-result');
const recordsSwitch = document.getElementById('show-records');
const wishlistSwitch = document.getElementById('show-wishlist');
let wishRoute = null;
let wishBaseline = null;
let failedWish = false;
let editingWish = null;
const listStatus = document.getElementById('list-status');
const saveNotice = document.getElementById('save-notice');
const toastTitle = document.getElementById('toast-title');
const toastDescription = document.getElementById('toast-description');
const toastIconPath = document.getElementById('toast-icon-path');
const backButton = document.getElementById('back-button');
const retryButton = document.getElementById('retry-list');
const entryHeading = document.getElementById('record-heading');
const appHeader = document.getElementById('app-header');
const deleteButton = document.getElementById('delete-record');
const deleteLabel = document.getElementById('delete-label');
const settingsScreen = document.getElementById('settings-screen');
const settingsBack = document.getElementById('settings-back');
const themeSelect = document.getElementById('theme-select');
const themeStatus = document.getElementById('theme-status');
themeSelect.value = window.sakeFogTheme.preference;
themeSelect.addEventListener('change', () => {
  const saved = window.sakeFogTheme.set(themeSelect.value);
  themeStatus.textContent = saved ? '' : 'テーマは変更されましたが、設定を保存できませんでした。次回起動時は保存済みの設定に戻る場合があります。';
});
window.addEventListener('themechange', () => {
  themeSelect.value = window.sakeFogTheme.preference;
});
const detailScreen = document.getElementById('detail-screen');
const detailBack = document.getElementById('detail-back');
const detailContent = document.getElementById('detail-content');
const detailStatus = document.getElementById('detail-status');
let detailPhotoUrl = null;
let detailPhotoViewer = null;
const backupButton = document.getElementById('create-backup');
const restoreButton = document.getElementById('restore-backup');
const restoreFile = document.getElementById('restore-file');
const settingsStatus = document.getElementById('settings-status');
const checkUpdateButton = document.getElementById('check-update');
const updateStatus = document.getElementById('update-status');
const supportsAppUpdates = 'serviceWorker' in navigator && window.isSecureContext;
let appRegistration = null;
let registrationPromise = null;
let isCheckingUpdate = false;
let observedUpdateWorker = null;
const watchedRegistrations = new WeakSet();
const watchedWorkers = new WeakSet();
const updateNotice = document.getElementById('update-notice');
const applyUpdateButton = document.getElementById('apply-update');
const deferUpdateButton = document.getElementById('defer-update');
const updateNoticeStatus = document.getElementById('update-notice-status');
const announcedUpdates = new WeakSet();
let noticeWorker = null;
let entryBaseline = null;
let isApplyingUpdate = false;
let expectedController = null;
let updatePort = null;
let updateTimer = null;
let updateRouteVersion = null;
let didReloadForUpdate = false;
let noticeReturnFocus = null;
let isBackupBusy = false;
const entryControls = [photoInput, nameInput, impressionInput, dateInput, registerButton, backButton, deleteButton];
let editingRecord = null;
let selectedPhotos = [];
const previewUrls = new Set();
let photoWarnings = [];
let isSaving = false;
let listRequestVersion = 0;
let previewVersion = 0;
const listPhotoUrls = new Set();
const listPhotoViewers = new Set();
let toastTimer = null;
let toastDismissTimer = null;
let toastVersion = 0;
// 履歴には画面情報と新規登録の初期名を保存する。写真・編集中の入力は保存しない。
let currentRoute = null;
let routeVersion = 0;
let returningToRecords = false;
let entryRoute = null;
let failedEntry = false;
let isRouteLoading = false;
let listNotice = null;

function makeRoute(screen, recordId, initialName) {
  return { app: 'sake-fog', version: 1, screen, recordId,
    list: currentRoute?.list || 'records',
    ...(initialName === undefined ? {} : { initialName }),
    key: `${Date.now()}-${Math.random()}` };
}

function isAppRoute(route) {
  return route?.app === 'sake-fog' && route.version === 1
    && typeof route.key === 'string'
    && (route.list === undefined || ['records', 'wishlist'].includes(route.list))
    && (!Object.hasOwn(route, 'initialName') || (route.screen === 'new' && route.recordId == null
      && typeof route.initialName === 'string' && route.initialName.trim() !== ''))
    && ['records', 'new', 'edit', 'settings', 'detail', 'wish-new', 'wish-edit'].includes(route.screen)
    && (!['edit', 'detail', 'wish-edit'].includes(route.screen) || (Number.isSafeInteger(route.recordId) && route.recordId > 0));
}

function isBusy() {
  return isSaving || isBackupBusy || isApplyingUpdate;
}

function syncControls() {
  const blocked = isBusy() || returningToRecords || isRouteLoading;
  entryControls.forEach((control) => { control.disabled = blocked; });
  wishGroups.querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = blocked; });
  wishAddGroup.disabled = blocked || currentRoute.screen !== 'wish-new' || wishGroups.children.length >= 20;
  photoInput.disabled = blocked || selectedPhotos.length >= 3;
  photoPreviews.querySelectorAll('.remove-photo-button').forEach((button) => { button.disabled = blocked; });
  [backupButton, restoreButton, restoreFile, settingsBack,
    recordSearch, recordOrderInput,
    recordsSwitch, wishlistSwitch, wishName, wishMemo, wishSave, wishBack,
    document.getElementById('add-record'), document.getElementById('open-settings'),
    ...recordsList.querySelectorAll('.edit-button, .record-open, .wish-delete, .wish-edit, .wish-create-record')].forEach((control) => {
    control.disabled = blocked;
  });
  // 詳細の読み込み中も戻れるようにする。
  detailBack.disabled = isBusy() || returningToRecords;
  wishBack.disabled = isBusy() || returningToRecords;
  document.querySelectorAll('.photo-navigation button, .photo-indicators button').forEach((button) => {
    button.disabled = blocked || button.dataset.edge === 'true';
  });
  syncUpdateButton();
}

function notifyList(message, error = false) {
  listNotice = { message, error };
  if (!recordsScreen.hidden) {
    listStatus.textContent = message;
    listStatus.classList.toggle('error-message', error);
  }
}

function navigate(screen, recordId, initialName) {
  if (isBusy() || returningToRecords || isRouteLoading || currentRoute.screen !== 'records') return;
  // 通常の「＋」での保存失敗後の再試行は、従来どおり同じ下書きを開く。
  // 名前を引き継いだ登録は、別の新規登録として扱う。
  const retryNew = screen === 'new' && initialName === undefined && failedEntry
    && entryRoute?.screen === 'new' && !Object.hasOwn(entryRoute, 'initialName');
  const retryWish = screen === 'wish-new' && failedWish && wishRoute?.screen === 'wish-new';
  const route = retryNew ? { ...entryRoute, list: currentRoute.list }
    : retryWish ? { ...wishRoute, list: currentRoute.list } : makeRoute(screen, recordId, initialName);
  if (!isAppRoute(route)) return;
  // キャンセル時に、失敗したフォームへ「進む」ための履歴を失わない。
  const discardNew = screen === 'new' && failedEntry && entryRoute?.key !== route.key;
  if (discardNew && !window.confirm('保存に失敗した入力が残っています。入力を破棄して別の登録画面を開きますか？')) return;
  history.pushState(route, '');
  if (discardNew) failedEntry = false;
  currentRoute = route;
  listNotice = null;
  renderRoute();
}

function returnToRecords() {
  // history.back()は非同期。同じ移動を二度要求しない。
  if (returningToRecords || currentRoute.screen === 'records'
    || history.state?.key !== currentRoute.key) return;
  returningToRecords = true;
  syncControls();
  history.back();
}

async function renderRoute(focus = true) {
  const version = ++routeVersion;
  const route = currentRoute;
  if (route.screen !== 'records') cachedRecords = null;
  isRouteLoading = false;
  if (route.screen === 'records') {
    if (!isBusy() && !failedWish) resetWish();
    if (!isBusy() && !failedEntry) {
      resetEntry();
      entryRoute = null;
    }
    await showRecords(focus);
  } else if (['wish-new', 'wish-edit'].includes(route.screen)) {
    const sameTarget = wishRoute?.screen === route.screen && wishRoute.recordId === route.recordId
      && (route.screen !== 'wish-new' || wishRoute.key === route.key);
    // 書き込み中の「進む」で別のフォームに入力状態を移さない。
    if (isSaving && !sameTarget) {
      returnToRecords();
      return;
    }
    if (failedWish && !sameTarget) {
      if (!window.confirm('保存に失敗した入力が残っています。入力を破棄して別の登録・編集画面を開きますか？')) {
        returnToRecords();
        return;
      }
      failedWish = false;
    }
    const retained = sameTarget && (wishRoute.key === route.key || failedWish || isSaving);
    if (retained) {
      openWish(editingWish, true);
      wishRoute = route;
    } else if (route.screen === 'wish-new') {
      openWish();
      wishRoute = route;
    } else {
      openWish();
      wishRoute = route;
      document.getElementById('wish-heading').textContent = '飲みたいお酒を編集';
      wishSave.textContent = '保存する';
      wishResult.textContent = '読み込んでいます…';
      isRouteLoading = true;
      syncControls();
      try {
        const item = await getWishlistItem(route.recordId);
        if (version !== routeVersion) return;
        if (!item) throw new Error('この飲みたいお酒は存在しません。');
        openWish(item);
        wishRoute = route;
      } catch (error) {
        if (version !== routeVersion) return;
        notifyList(`編集画面を開けませんでした。${error.message}`, true);
        returnToRecords();
      } finally {
        if (version === routeVersion) isRouteLoading = false;
      }
    }
  } else if (route.screen === 'detail') {
    await showDetail(route, version, focus);
  } else if (route.screen === 'settings') {
    // 処理中に「進む」で戻っても進捗・結果を消さない。
    showSettings(isBackupBusy);
  } else {
    const retained = entryRoute && (entryRoute.key === route.key || (failedEntry && route.screen !== 'new'
      && entryRoute.screen === route.screen && entryRoute.recordId === route.recordId));
    if (isSaving && !retained) {
      returnToRecords();
      return;
    }
    if (failedEntry && !retained) {
      if (!window.confirm('保存に失敗した入力が残っています。入力を破棄して別の登録・編集画面を開きますか？')) {
        returnToRecords();
        return;
      }
    }
    if (retained) {
      openEntry(editingRecord, true);
      entryRoute = route;
    } else if (route.screen === 'new') {
      openEntry();
      // 空の新規フォームを基準にし、引き継いだ名前も未保存として保護する。
      if (route.initialName !== undefined) nameInput.value = route.initialName;
      entryRoute = route;
    } else {
      isRouteLoading = true;
      // 古い編集内容を操作させず、IDから保存済みの最新記録を取得する。
      showRecords(false);
      syncControls();
      try {
        const records = await getRecords();
        if (version !== routeVersion) return;
        const record = records.find((item) => item.id === route.recordId);
        if (!record) throw new Error('この記録は存在しません。');
        openEntry(record);
        entryRoute = route;
      } catch (error) {
        if (version !== routeVersion) return;
        notifyList(`編集画面を開けませんでした。${error.message}`, true);
        returnToRecords();
      } finally {
        if (version === routeVersion) isRouteLoading = false;
      }
    }
  }
  if (version === routeVersion) syncControls();
}

function completeWrite(origin, type) {
  failedEntry = false;
  entryRoute = null;
  resetEntry();
  listNotice = null;
  showToast(type);
  // 先に端末の戻るで一覧へ移動していたら、追加で戻さない。
  // 一覧の再取得は、busy解除後のfinishOperationで行う。
  if (currentRoute.key === origin.key) returnToRecords();
}

function finishOperation() {
  syncControls();
  if (currentRoute.screen === 'records') renderRoute(false);
}

window.addEventListener('popstate', (event) => {
  if (isApplyingUpdate) stopUpdate('画面を移動したため更新を中止しました。もう一度確認してください。');
  returningToRecords = false;
  if (isAppRoute(event.state)) currentRoute = event.state;
  else {
    currentRoute = makeRoute('records');
    history.replaceState(currentRoute, '');
  }
  renderRoute();
});

const toastMessages = {
  'wish-updated': {
    title: '飲みたいお酒を更新しました',
    description: '変更内容を保存しました',
    icon: 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
  },
  'wish-created': {
    title: '飲みたいお酒を登録しました',
    description: '飲みたいリストに追加しました',
    icon: 'M5 12l4 4L19 6',
  },
  'wish-deleted': {
    title: '飲みたいお酒を削除しました',
    description: '飲みたいリストから削除しました',
    icon: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  },
  restored: {
    title: '記録を復元しました',
    description: 'バックアップの内容を読み込みました',
    icon: 'M5 12l4 4L19 6',
  },
  created: {
    title: '記録を登録しました',
    description: 'お酒の記録を保存しました',
    icon: 'M5 12l4 4L19 6',
  },
  updated: {
    title: '記録を更新しました',
    description: '変更内容を保存しました',
    icon: 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z',
  },
  deleted: {
    title: '記録を削除しました',
    description: '選択した記録を削除しました',
    icon: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  },
};

function hideToast() {
  ++toastVersion;
  clearTimeout(toastTimer);
  clearTimeout(toastDismissTimer);
  toastTimer = null;
  toastDismissTimer = null;
  saveNotice.hidden = true;
  saveNotice.classList.remove('is-leaving');
  toastTitle.textContent = '';
  toastDescription.textContent = '';
}

function showToast(type, count = 1) {
  const message = toastMessages[type];
  if (!message) return;
  hideToast();
  const version = toastVersion;
  // 連続通知でも登場アニメーションを最初から再生する。
  void saveNotice.offsetWidth;
  saveNotice.dataset.type = type;
  toastTitle.textContent = type === 'wish-created' && count > 1 ? `飲みたいお酒を${count}件登録しました` : message.title;
  toastDescription.textContent = message.description;
  toastIconPath.setAttribute('d', message.icon);
  saveNotice.hidden = false;
  toastTimer = setTimeout(() => {
    if (version !== toastVersion) return;
    saveNotice.classList.add('is-leaving');
    toastDismissTimer = setTimeout(() => {
      if (version === toastVersion) hideToast();
    }, 180);
  }, 3000);
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function drinkingDay(record) {
  // 既存データには書き込まず、登録日時の端末ローカル日付で補完する。
  if (record.drankOn) return record.drankOn;
  const date = new Date(record.createdAt);
  return Number.isNaN(date.getTime()) ? '' : localDate(date);
}

function clearRecordsList() {
  listPhotoViewers.forEach((viewer) => viewer.dispose());
  listPhotoViewers.clear();
  recordsList.replaceChildren();
  listPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
  listPhotoUrls.clear();
}

// 一覧と詳細で、写真位置・URL・入力操作を同じ処理にまとめる。
function createPhotoViewer(record, { list = false, onTap = null } = {}) {
  const photos = getRecordPhotos(record);
  const element = document.createElement('div');
  element.className = list ? 'record-media' : 'detail-photo';
  element.classList.toggle('has-multiple', photos.length > 1);
  const area = document.createElement('div');
  area.className = list ? 'record-photo' : 'detail-photo-image';
  const dots = document.createElement('div');
  dots.className = 'photo-indicators';
  dots.hidden = photos.length < 2;
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', `${record.name}の写真を選択`);
  const navigation = document.createElement('div');
  navigation.className = 'photo-navigation';
  navigation.hidden = list || photos.length < 2;
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const count = document.createElement('span');
  previous.type = next.type = 'button';
  previous.className = next.className = 'secondary-button';
  previous.textContent = '前へ';
  next.textContent = '次へ';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  navigation.append(previous, count, next);
  element.append(area, dots);
  if (!list) element.append(navigation);
  let position = 0;
  let url = null;
  let disposed = false;
  const canInteract = () => !disposed && !isBusy() && !returningToRecords && !isRouteLoading
    && !(list ? recordsScreen.hidden : detailScreen.hidden);
  const release = () => {
    if (!url) return;
    URL.revokeObjectURL(url);
    if (list) listPhotoUrls.delete(url);
    else if (detailPhotoUrl === url) detailPhotoUrl = null;
    url = null;
  };
  const render = () => {
    release();
    area.classList.remove('has-photo');
    area.textContent = '写真なし';
    dots.querySelectorAll('button').forEach((dot, index) => {
      if (index === position) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    count.textContent = `${position + 1} / ${photos.length}`;
    previous.dataset.edge = String(position === 0);
    next.dataset.edge = String(position === photos.length - 1);
    previous.disabled = position === 0 || isBusy();
    next.disabled = position === photos.length - 1 || isBusy();
    if (!photos.length) return;
    const image = document.createElement('img');
    url = URL.createObjectURL(photos[position]);
    const imageUrl = url;
    if (list) listPhotoUrls.add(url);
    else detailPhotoUrl = url;
    image.alt = `${record.name}の写真 ${position + 1} / ${photos.length}`;
    image.draggable = false;
    image.addEventListener('load', () => {
      if (!disposed && url === imageUrl) area.classList.add('has-photo');
    }, { once: true });
    image.addEventListener('error', () => {
      if (disposed || url !== imageUrl) return;
      area.classList.remove('has-photo');
      area.textContent = '写真を表示できません';
      release();
    }, { once: true });
    image.src = url;
    area.replaceChildren(image);
  };
  const select = (index) => {
    if (!canInteract()) return;
    const target = Math.max(0, Math.min(photos.length - 1, index));
    if (target === position || !photos.length) return;
    position = target;
    render();
  };
  photos.forEach((_, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'photo-dot';
    dot.setAttribute('aria-label', `${index + 1}枚目の写真を表示`);
    dot.addEventListener('click', () => select(index));
    dots.append(dot);
  });
  previous.addEventListener('click', () => select(position - 1));
  next.addEventListener('click', () => select(position + 1));
  const pointers = new Set();
  let gesture = null;
  let suppressedClick = null;
  area.addEventListener('pointerdown', (event) => {
    if (!canInteract()) return;
    // 新しい操作で、直前のスワイプに対するクリック抑止を解除する。
    suppressedClick = null;
    if (event.pointerType === 'mouse') return;
    pointers.add(event.pointerId);
    if (pointers.size > 1 || !event.isPrimary) {
      if (gesture) gesture.cancelled = true;
      return;
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, cancelled: false };
  });
  area.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (Math.abs(event.clientX - gesture.x) > 8 || Math.abs(event.clientY - gesture.y) > 8) gesture.moved = true;
  });
  area.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'mouse') return;
    pointers.delete(event.pointerId);
    if (gesture && event.pointerId === gesture.id) {
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (gesture.moved || gesture.cancelled || Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        suppressedClick = { id: event.pointerId, until: performance.now() + 700 };
      }
      if (!gesture.cancelled && Math.abs(dx) >= 30 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        select(position + (dx < 0 ? 1 : -1));
      }
      gesture = null;
    } else {
      suppressedClick = { id: event.pointerId, until: performance.now() + 700 };
    }
  });
  area.addEventListener('pointercancel', (event) => {
    if (event.pointerType === 'mouse') return;
    pointers.delete(event.pointerId);
    suppressedClick = { id: event.pointerId, until: performance.now() + 700 };
    if (gesture) gesture.cancelled = true;
    if (!pointers.size) gesture = null;
  });
  element.addEventListener('click', (event) => {
    if (event.detail !== 0 && suppressedClick && performance.now() <= suppressedClick.until
      && (event.pointerId === undefined || event.pointerId === suppressedClick.id)) {
      suppressedClick = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  area.addEventListener('click', () => { if (canInteract()) onTap?.(); });
  render();
  return { element, dispose() { disposed = true; gesture = null; pointers.clear(); release(); } };
}

function renderRecord(record) {
  const card = document.createElement('article');
  card.className = 'record-card';
  // 編集ボタンと兄弟のボタンにして、入れ子やクリックの伝播競合を避ける。
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'record-open';
  open.setAttribute('aria-label', `${record.name}の詳細を表示`);
  open.addEventListener('click', () => navigate('detail', record.id));
  card.append(open);
  const viewer = createPhotoViewer(record, { list: true, onTap: () => navigate('detail', record.id) });
  listPhotoViewers.add(viewer);
  const name = document.createElement('h3');
  name.textContent = record.name;
  const day = document.createElement('time');
  const date = drinkingDay(record);
  if (date) day.dateTime = date;
  day.textContent = `飲んだ日：${date ? date.replaceAll('-', '/') : '不明'}`;
  const info = document.createElement('div');
  info.className = 'record-info';
  info.append(name);
  if (typeof record.impression === 'string' && record.impression.trim() !== '') {
    const impression = document.createElement('p');
    impression.className = 'record-impression';
    impression.textContent = record.impression;
    info.append(impression);
  }
  info.append(day);
  card.append(viewer.element, info);
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary-button edit-button';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z');
  icon.append(path);
  edit.append(icon);
  edit.setAttribute('aria-label', `${record.name}を編集`);
  edit.addEventListener('click', () => navigate('edit', record.id));
  info.append(edit);
  return card;
}

function renderFilteredRecords() {
  if (cachedRecords === null || currentRoute.screen !== 'records' || currentRoute.list === 'wishlist') return;
  const query = recordQuery.trim().toLowerCase();
  const records = cachedRecords.filter((record) => !query
    || (typeof record.name === 'string' && record.name.toLowerCase().includes(query))
    || (typeof record.impression === 'string' && record.impression.toLowerCase().includes(query)));
  records.sort((a, b) => {
    const dayA = drinkingDay(a);
    const dayB = drinkingDay(b);
    if (!dayA && dayB) return 1;
    if (dayA && !dayB) return -1;
    return (recordOrder === 'oldest' ? dayA.localeCompare(dayB) : dayB.localeCompare(dayA)) || b.id - a.id;
  });
  clearRecordsList();
  const fragment = document.createDocumentFragment();
  records.forEach((record) => fragment.append(renderRecord(record)));
  recordsList.append(fragment);
  listStatus.classList.remove('error-message');
  listStatus.textContent = !cachedRecords.length ? 'まだ記録がありません'
    : records.length ? '' : '該当する記録はありません';
  syncControls();
}

recordSearch.addEventListener('input', () => {
  recordQuery = recordSearch.value;
  listNotice = null;
  renderFilteredRecords();
});
recordOrderInput.addEventListener('change', () => {
  recordOrder = recordOrderInput.value === 'oldest' ? 'oldest' : 'newest';
  recordOrderInput.value = recordOrder;
  listNotice = null;
  renderFilteredRecords();
});

async function showRecords(focus = true) {
  wishScreen.hidden = true;
  clearDetail();
  const version = ++listRequestVersion;
  cachedRecords = null;
  entryScreen.hidden = true;
  settingsScreen.hidden = true;
  recordsScreen.hidden = false;
  appHeader.hidden = false;
  document.body.classList.remove('entry-mode');
  clearPreview();
  clearRecordsList();
  listStatus.classList.remove('error-message');
  listStatus.textContent = '記録を読み込んでいます…';
  retryButton.hidden = true;
  const wishlist = currentRoute.list === 'wishlist';
  recordFilters.hidden = wishlist;
  recordSearch.value = recordQuery;
  recordOrderInput.value = recordOrder;
  recordsSwitch.setAttribute('aria-pressed', String(!wishlist));
  wishlistSwitch.setAttribute('aria-pressed', String(wishlist));
  document.getElementById('records-heading').textContent = wishlist ? '飲みたいお酒' : '記録一覧';
  document.getElementById('add-record').setAttribute('aria-label', wishlist ? '飲みたいお酒を登録する' : '新しいお酒を記録する');
  if (focus) document.getElementById('records-heading').focus();
  try {
    const records = await (wishlist ? getWishlist() : getRecords());
    if (version !== listRequestVersion) return;
    if (wishlist) {
      records.sort((a, b) => b.id - a.id);
      const fragment = document.createDocumentFragment();
      records.forEach((record) => fragment.append(renderWish(record)));
      recordsList.append(fragment);
      listStatus.textContent = records.length ? '' : '飲みたいお酒はまだありません。「＋」から登録できます。';
    } else {
      cachedRecords = records;
      renderFilteredRecords();
    }
    if (listNotice) notifyList(listNotice.message, listNotice.error);
    syncControls();
  } catch (error) {
    if (version !== listRequestVersion) return;
    clearRecordsList();
    listStatus.classList.add('error-message');
    listStatus.textContent = ['VersionError', 'DatabaseBlockedError'].includes(error.name) ? error.message
      : wishlist ? '飲みたいリストの取得に失敗しました。もう一度お試しください。' : '記録の取得に失敗しました。もう一度お試しください。';
    retryButton.hidden = false;
    console.error('記録の取得に失敗しました:', error);
  }
}

function switchList(list) {
  if (isBusy() || returningToRecords || isRouteLoading || currentRoute.screen !== 'records'
    || (currentRoute.list || 'records') === list) return;
  // 一覧の種類だけを更新し、履歴の段数は増やさない。
  currentRoute = { ...currentRoute, list };
  history.replaceState(currentRoute, '');
  listNotice = null;
  renderRoute(false);
}

recordsSwitch.addEventListener('click', () => switchList('records'));
wishlistSwitch.addEventListener('click', () => switchList('wishlist'));

function createGoogleSearchLink(name) {
  const url = new URL('https://www.google.com/search');
  url.searchParams.set('q', name);
  const link = document.createElement('a');
  link.className = 'google-search-link';
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `${name}をGoogle検索（新しいタブで開く）`);
  link.title = link.getAttribute('aria-label');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '10.5');
  circle.setAttribute('cy', '10.5');
  circle.setAttribute('r', '6.5');
  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  handle.setAttribute('d', 'M16 16l5 5');
  icon.append(circle, handle);
  link.append(icon);
  return link;
}

function renderWish(item) {
  const card = document.createElement('article');
  card.className = 'record-panel wish-card';
  const name = document.createElement('h3');
  name.textContent = item.name;
  card.append(name);
  if (typeof item.memo === 'string' && item.memo.trim() !== '') {
    const memo = document.createElement('p');
    memo.className = 'wish-memo';
    memo.textContent = item.memo;
    card.append(memo);
  }
  const actions = document.createElement('div');
  actions.className = 'wish-actions';
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'secondary-button wish-create-record';
  create.setAttribute('aria-label', `${item.name}の飲酒記録を作成`);
  create.title = create.getAttribute('aria-label');
  create.addEventListener('click', () => navigate('new', undefined, item.name));
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary-button wish-edit';
  edit.setAttribute('aria-label', `${item.name}を編集`);
  edit.title = edit.getAttribute('aria-label');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M15 5l4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z');
  icon.append(path);
  edit.append(icon);
  const createIcon = icon.cloneNode(true);
  createIcon.querySelector('path').setAttribute('d', 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12M7 7h4M7 11h2M14 17l-4 1 1-4 8-8 3 3-8 8M17 8l3 3');
  create.append(createIcon);
  edit.addEventListener('click', () => navigate('wish-edit', item.id));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary-button wish-delete';
  remove.setAttribute('aria-label', `${item.name}を飲みたいリストから削除`);
  remove.title = remove.getAttribute('aria-label');
  const removeIcon = icon.cloneNode(true);
  removeIcon.querySelector('path').setAttribute('d', 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7');
  remove.append(removeIcon);
  remove.addEventListener('click', async () => {
    if (isBusy() || returningToRecords || isRouteLoading || recordsScreen.hidden || currentRoute.list !== 'wishlist') return;
    if (!window.confirm(`「${item.name}」を飲みたいリストから削除しますか？`)) return;
    isSaving = true;
    syncControls();
    try {
      await deleteWishlistItem(item.id);
      listNotice = null;
      showToast('wish-deleted');
    } catch (error) {
      notifyList(`飲みたいお酒を削除できませんでした。${error.message}`, true);
    } finally {
      isSaving = false;
      finishOperation();
    }
  });
  actions.append(create, createGoogleSearchLink(item.name), remove, edit);
  card.append(actions);
  return card;
}

function wishValues() {
  return Array.from(wishGroups.children, (group) => ({
    name: group.querySelector('.wish-name-input').value,
    memo: group.querySelector('.wish-memo-input').value,
  }));
}

function refreshWishGroups() {
  const editing = currentRoute.screen === 'wish-edit';
  wishForm.classList.toggle('is-wish-edit', editing);
  Array.from(wishGroups.children).forEach((group, index) => {
    const name = group.querySelector('.wish-name-input');
    const memo = group.querySelector('.wish-memo-input');
    const error = group.querySelector('.wish-name-error');
    name.id = index === 0 ? 'wish-name' : `wish-name-${group.dataset.key}`;
    memo.id = index === 0 ? 'wish-memo' : `wish-memo-${group.dataset.key}`;
    error.id = `${name.id}-error`;
    name.setAttribute('aria-describedby', error.id);
    group.querySelector('.wish-name-label').htmlFor = name.id;
    group.querySelector('.wish-memo-label').htmlFor = memo.id;
    const title = group.querySelector('.wish-group-title');
    title.id = `wish-group-title-${group.dataset.key}`;
    title.textContent = `お酒${index + 1}`;
    group.setAttribute('aria-labelledby', title.id);
    group.querySelector('.wish-group-header').hidden = editing;
    const remove = group.querySelector('.wish-remove-group');
    remove.hidden = editing || wishGroups.children.length === 1;
    remove.setAttribute('aria-label', `お酒${index + 1}の入力欄を削除`);
  });
  wishName = wishGroups.querySelector('.wish-name-input');
  wishMemo = wishGroups.querySelector('.wish-memo-input');
  wishAddGroup.hidden = editing;
  wishGroupLimit.hidden = editing;
  wishGroupLimit.textContent = `${wishGroups.children.length}件入力中 / 最大20件まで${wishGroups.children.length >= 20 ? '（上限に達しました）' : ''}`;
  syncControls();
}

function focusWishName(input) {
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function resetWish() {
  editingWish = null;
  wishRoute = null;
  wishBaseline = null;
  wishGroups.replaceChildren(firstWishGroup);
  firstWishGroup.querySelector('.wish-name-input').value = '';
  firstWishGroup.querySelector('.wish-memo-input').value = '';
  firstWishGroup.querySelector('.wish-name-input').setCustomValidity('');
  firstWishGroup.querySelector('.wish-name-input').removeAttribute('aria-invalid');
  firstWishGroup.querySelector('.wish-name-error').hidden = true;
  refreshWishGroups();
  wishResult.textContent = '';
}

function openWish(item = null, preserve = false) {
  ++listRequestVersion;
  clearDetail();
  clearPreview();
  clearRecordsList();
  hideToast();
  if (!preserve) {
    resetWish();
    failedWish = false;
    editingWish = item;
    wishName.value = item?.name ?? '';
    wishMemo.value = item?.memo ?? '';
    wishBaseline = wishValues();
  }
  document.getElementById('wish-heading').textContent = editingWish ? '飲みたいお酒を編集' : '飲みたいお酒を登録';
  wishSave.textContent = isSaving ? '保存中…' : editingWish ? '保存する' : '登録する';
  entryScreen.hidden = true;
  settingsScreen.hidden = true;
  recordsScreen.hidden = true;
  appHeader.hidden = true;
  wishScreen.hidden = false;
  document.body.classList.add('entry-mode');
  document.getElementById('wish-heading').focus();
  window.scrollTo(0, 0);
}

wishBack.addEventListener('click', () => { if (!isBusy()) returnToRecords(); });
wishForm.addEventListener('input', (event) => {
  wishResult.textContent = '';
  if (event.target.matches('.wish-name-input')) {
    event.target.setCustomValidity('');
    event.target.removeAttribute('aria-invalid');
    event.target.closest('.wish-group').querySelector('.wish-name-error').hidden = true;
  }
});
wishAddGroup.addEventListener('click', () => {
  if (isBusy() || returningToRecords || isRouteLoading || wishScreen.hidden
    || currentRoute.screen !== 'wish-new' || wishGroups.children.length >= 20) return;
  const group = firstWishGroup.cloneNode(true);
  group.dataset.key = String(nextWishGroupKey++);
  group.querySelectorAll('input, textarea').forEach((input) => { input.value = ''; });
  group.querySelector('input').setCustomValidity('');
  group.querySelector('input').removeAttribute('aria-invalid');
  group.querySelector('.wish-name-error').hidden = true;
  wishGroups.append(group);
  wishResult.textContent = '';
  refreshWishGroups();
  focusWishName(group.querySelector('.wish-name-input'));
});
wishGroups.addEventListener('click', (event) => {
  const button = event.target.closest('.wish-remove-group');
  if (!button || isBusy() || returningToRecords || isRouteLoading || wishScreen.hidden
    || currentRoute.screen !== 'wish-new' || wishGroups.children.length <= 1) return;
  const group = button.closest('.wish-group');
  const name = group.querySelector('.wish-name-input').value;
  const memo = group.querySelector('.wish-memo-input').value;
  if ((name !== '' || memo !== '') && !window.confirm('このお酒の入力内容を削除しますか？')) return;
  const next = group.nextElementSibling || group.previousElementSibling;
  group.remove();
  wishResult.textContent = '';
  refreshWishGroups();
  focusWishName(next.querySelector('.wish-name-input'));
});
wishForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isBusy() || returningToRecords || isRouteLoading || wishScreen.hidden) return;
  let firstError = null;
  wishGroups.querySelectorAll('.wish-name-input').forEach((input) => {
    const message = input.value.trim() ? '' : 'お酒の名前を入力してください。';
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(!!message));
    const error = input.closest('.wish-group').querySelector('.wish-name-error');
    error.textContent = message;
    error.hidden = !message;
    if (message && !firstError) firstError = input;
  });
  if (firstError) { focusWishName(firstError); return; }
  const values = wishValues();
  const origin = currentRoute;
  const id = editingWish?.id;
  if (origin.screen === 'wish-edit' && id !== origin.recordId) return;
  isSaving = true;
  wishResult.textContent = '';
  wishSave.textContent = '保存中…';
  syncControls();
  try {
    if (id == null) await saveWishlistItems(values);
    else await saveWishlistItem(values[0], id);
    failedWish = false;
    resetWish();
    listNotice = null;
    showToast(id == null ? 'wish-created' : 'wish-updated', values.length);
    if (currentRoute.key === origin.key) returnToRecords();
  } catch (error) {
    failedWish = true;
    wishResult.textContent = `保存できませんでした。入力内容は保持されています。${error.message}`;
    notifyList(id == null ? '飲みたいお酒を登録できませんでした。「＋」から入力内容を確認して再試行できます。'
      : '飲みたいお酒を保存できませんでした。元の項目の編集ボタンから入力内容を確認して再試行できます。', true);
  } finally {
    isSaving = false;
    wishSave.textContent = editingWish ? '保存する' : '登録する';
    finishOperation();
  }
});

function clearDetail() {
  detailPhotoViewer?.dispose();
  detailPhotoViewer = null;
  detailScreen.hidden = true;
  detailContent.replaceChildren();
  detailContent.hidden = true;
  if (detailPhotoUrl) URL.revokeObjectURL(detailPhotoUrl);
  detailPhotoUrl = null;
}

async function showDetail(route, version, focus) {
  wishScreen.hidden = true;
  ++listRequestVersion;
  clearDetail();
  clearPreview();
  clearRecordsList();
  hideToast();
  entryScreen.hidden = true;
  settingsScreen.hidden = true;
  recordsScreen.hidden = true;
  appHeader.hidden = true;
  detailScreen.hidden = false;
  document.body.classList.remove('entry-mode');
  detailStatus.textContent = '記録を読み込んでいます…';
  isRouteLoading = true;
  syncControls();
  if (focus) document.getElementById('detail-heading').focus();
  window.scrollTo(0, 0);
  try {
    const records = await getRecords();
    if (version !== routeVersion) return;
    const record = records.find((item) => item.id === route.recordId);
    if (!record) throw new Error('この記録は存在しません。');
    detailPhotoViewer = createPhotoViewer(record);
    const photo = detailPhotoViewer.element;
    const name = document.createElement('h3');
    name.textContent = record.name;
    const nameRow = document.createElement('div');
    nameRow.className = 'detail-name-row';
    nameRow.append(name, createGoogleSearchLink(record.name));
    const day = document.createElement('time');
    const date = drinkingDay(record);
    if (date) day.dateTime = date;
    day.textContent = `飲んだ日：${date ? date.replaceAll('-', '/') : '不明'}`;
    detailContent.append(photo, nameRow, day);
    if (typeof record.impression === 'string' && record.impression.trim() !== '') {
      const impression = document.createElement('p');
      impression.className = 'detail-impression';
      impression.textContent = record.impression;
      detailContent.append(impression);
    }
    detailContent.hidden = false;
    detailStatus.textContent = '';
  } catch (error) {
    if (version !== routeVersion) return;
    notifyList(`詳細画面を開けませんでした。${error.message}`, true);
    returnToRecords();
  } finally {
    if (version === routeVersion) {
      isRouteLoading = false;
      syncControls();
    }
  }
}

detailBack.addEventListener('click', () => {
  if (!isBusy()) returnToRecords();
});

function clearPreview() {
  ++previewVersion;
  photoPreviews.replaceChildren();
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls.clear();
}

function showPreview() {
  clearPreview();
  const version = previewVersion;
  if (!selectedPhotos.length) photoPreviews.textContent = '写真なし';
  selectedPhotos.forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = 'photo-preview-item';
    const area = document.createElement('div');
    area.className = 'preview-area';
    const image = document.createElement('img');
    image.className = 'photo-preview';
    image.alt = `選択した写真${index + 1}`;
    const url = URL.createObjectURL(photo);
    previewUrls.add(url);
    image.addEventListener('error', () => {
      if (version !== previewVersion) return;
      area.textContent = '画像を表示できません';
      URL.revokeObjectURL(url);
      previewUrls.delete(url);
    }, { once: true });
    image.src = url;
    area.append(image);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary-button remove-photo-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `写真${index + 1}を削除`);
    remove.addEventListener('click', () => {
      if (isBusy() || returningToRecords || isRouteLoading || entryScreen.hidden || version !== previewVersion) return;
      selectedPhotos = selectedPhotos.filter((_, position) => position !== index);
      photoInput.value = '';
      photoError.textContent = '';
      registrationResult.textContent = '';
      showPreview();
      photoInput.focus();
    });
    const label = document.createElement('span');
    label.className = 'note';
    label.textContent = index === 0 ? '代表写真' : `写真${index + 1}`;
    item.append(area, remove, label);
    photoPreviews.append(item);
  });
  photoWarnings = photoWarnings.filter((photo) => selectedPhotos.includes(photo));
  photoWarning.textContent = photoWarnings.length ? '5MiBを超える写真が選択されています。保存できますが、保存容量とバックアップ容量が大きくなります。' : '';
  syncControls();
}

function resetEntry() {
  entryBaseline = null;
  editingRecord = null;
  selectedPhotos = [];
  photoWarnings = [];
  photoWarning.textContent = '';
  nameInput.value = '';
  nameInput.setCustomValidity('');
  impressionInput.value = '';
  dateInput.value = localDate();
  photoInput.value = '';
  photoError.textContent = '';
  registrationResult.textContent = '';
  registrationResult.classList.remove('is-error');
  clearPreview();
  deleteButton.hidden = true;
}

function openEntry(record = null, preserve = false) {
  wishScreen.hidden = true;
  clearDetail();
  ++listRequestVersion;
  if (!preserve) {
    resetEntry();
    failedEntry = false;
  }
  editingRecord = record;
  deleteButton.hidden = record == null;
  if (record && !preserve) {
    nameInput.value = record.name;
    impressionInput.value = record.impression || '';
    dateInput.value = drinkingDay(record) || localDate();
    selectedPhotos = getRecordPhotos(record);
  }
  if (!preserve) entryBaseline = entryValues();
  entryHeading.textContent = record ? 'お酒を編集する' : 'お酒を記録する';
  registerButton.textContent = isSaving ? '処理中…' : (record ? '保存する' : '登録する');
  hideToast();
  recordsScreen.hidden = true;
  settingsScreen.hidden = true;
  entryScreen.hidden = false;
  appHeader.hidden = true;
  document.body.classList.add('entry-mode');
  clearRecordsList();
  showPreview();
  entryHeading.focus();
  window.scrollTo(0, 0);
}

document.getElementById('add-record').addEventListener('click', () => navigate(currentRoute.list === 'wishlist' ? 'wish-new' : 'new'));
backButton.addEventListener('click', () => {
  if (!isBusy()) returnToRecords();
});
retryButton.addEventListener('click', () => showRecords(false));

photoInput.addEventListener('change', () => {
  if (isBusy() || returningToRecords || isRouteLoading || entryScreen.hidden) { photoInput.value = ''; return; }
  photoError.textContent = '';
  registrationResult.textContent = '';
  const files = Array.from(photoInput.files);
  photoInput.value = '';
  if (!files.length) return;
  if (selectedPhotos.length + files.length > 3) {
    photoError.textContent = `写真は最大3枚です。あと${3 - selectedPhotos.length}枚まで追加できます。`;
    return;
  }
  try {
    validateRecordPhotos([...selectedPhotos, ...files]);
  } catch (error) {
    photoError.textContent = error.message;
    return;
  }
  selectedPhotos = [...selectedPhotos, ...files];
  photoWarnings.push(...files.filter((photo) => photo.size > 5 * 1024 * 1024));
  showPreview();
});
nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
entryScreen.addEventListener('input', () => { registrationResult.textContent = ''; });

registerButton.addEventListener('click', async () => {
  if (isBusy() || returningToRecords || isRouteLoading || entryScreen.hidden) return;
  registrationResult.textContent = '';
  nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'お酒の名前を入力してください。');
  if (!nameInput.reportValidity() || !dateInput.reportValidity()) return;
  const values = {
    name: nameInput.value.trim(),
    impression: impressionInput.value,
    photo: selectedPhotos[0] ?? null,
    drankOn: dateInput.value,
  };
  // 写真変更のない旧記録には、空配列を追加するだけの書き換えをしない。
  const originalPhotos = editingRecord ? getRecordPhotos(editingRecord) : [];
  if (!editingRecord || Object.hasOwn(editingRecord, 'additionalPhotos') || !samePhotos(originalPhotos, selectedPhotos)) {
    values.additionalPhotos = selectedPhotos.slice(1);
  }
  const id = editingRecord?.id;
  const origin = currentRoute;
  isSaving = true;
  syncControls();
  registerButton.textContent = '保存中…';
  registrationResult.classList.remove('is-error');
  try {
    await saveRecord(values, id);
    completeWrite(origin, id == null ? 'created' : 'updated');
  } catch (error) {
    failedEntry = true;
    registrationResult.classList.add('is-error');
    registrationResult.textContent = ['VersionError', 'DatabaseBlockedError'].includes(error.name) ? error.message : '保存に失敗しました。入力内容は保持されています。もう一度お試しください。';
    notifyList(['VersionError', 'DatabaseBlockedError'].includes(error.name) ? error.message : '保存に失敗しました。入力内容は保持されています。＋または元の記録の編集から再試行できます。', true);
    console.error('記録の保存に失敗しました:', error);
  } finally {
    isSaving = false;
    registerButton.textContent = editingRecord ? '保存する' : '登録する';
    finishOperation();
  }
});

deleteButton.addEventListener('click', async () => {
  if (isBusy() || returningToRecords || isRouteLoading || entryScreen.hidden || editingRecord == null) return;
  const origin = currentRoute;
  const id = editingRecord.id;
  if (!window.confirm('この記録を削除しますか？この操作は取り消せません。')) return;
  if (isSaving || editingRecord?.id !== id) return;

  isSaving = true;
  syncControls();
  deleteLabel.textContent = '削除中…';
  registrationResult.textContent = '';
  registrationResult.classList.remove('is-error');
  try {
    await deleteRecord(id);
    completeWrite(origin, 'deleted');
  } catch (error) {
    failedEntry = true;
    registrationResult.classList.add('is-error');
    registrationResult.textContent = ['VersionError', 'DatabaseBlockedError'].includes(error.name) ? error.message : '削除に失敗しました。入力内容は保持されています。もう一度お試しください。';
    notifyList(['VersionError', 'DatabaseBlockedError'].includes(error.name) ? error.message : '削除に失敗しました。記録を確認し、もう一度お試しください。', true);
    console.error('記録の削除に失敗しました:', error);
  } finally {
    isSaving = false;
    deleteLabel.textContent = 'この記録を削除する';
    finishOperation();
  }
});

function showSettings(preserve = false) {
  wishScreen.hidden = true;
  clearDetail();
  ++listRequestVersion;
  hideToast();
  clearRecordsList();
  clearPreview();
  entryScreen.hidden = true;
  recordsScreen.hidden = true;
  settingsScreen.hidden = false;
  appHeader.hidden = true;
  document.body.classList.remove('entry-mode');
  if (!preserve) {
    settingsStatus.textContent = '';
    settingsStatus.classList.remove('error-message');
  }
  document.getElementById('settings-heading').focus();
  window.scrollTo(0, 0);
}

function setBackupBusy(busy) {
  isBackupBusy = busy;
  syncControls();
}

function syncUpdateButton() {
  // 更新確認は既存の保存・バックアップ処理をロックしない。
  checkUpdateButton.disabled = !supportsAppUpdates || isBusy() || returningToRecords
    || isCheckingUpdate || Boolean(appRegistration?.installing
      && !['redundant', 'activated'].includes(appRegistration.installing.state));
}

function entryValues() {
  return { name: nameInput.value, impression: impressionInput.value,
    date: dateInput.value, photos: selectedPhotos.slice() };
}

function samePhotos(left, right) {
  return left.length === right.length && left.every((photo, index) => photo === right[index]);
}

function updateBlockReason() {
  if (isSaving || isBackupBusy) return '保存・削除・バックアップ・復元の処理が終わってから更新してください。';
  if (isRouteLoading || returningToRecords
    || (isApplyingUpdate && updateRouteVersion !== routeVersion)) return '画面の移動が終わってから更新してください。';
  const values = entryValues();
  if (failedWish || (wishBaseline && JSON.stringify(wishValues()) !== JSON.stringify(wishBaseline))) {
    return '飲みたいお酒に未保存の変更があります。入力内容を保存してから更新してください。';
  }
  if (failedEntry || (entryBaseline && Object.keys(values).some((key) => key === 'photos'
    ? !samePhotos(values.photos, entryBaseline.photos) : values[key] !== entryBaseline[key]))) {
    return '未保存の変更があります。入力内容を保存してから更新してください。';
  }
  if (document.visibilityState !== 'visible') return 'アプリを表示してから更新してください。';
  return '';
}

function offerUpdate(worker, manual = false) {
  if (isApplyingUpdate || (!manual && announcedUpdates.has(worker))) return;
  announcedUpdates.add(worker);
  noticeWorker = worker;
  if (updateNotice.hidden) noticeReturnFocus = document.activeElement;
  updateNoticeStatus.textContent = '';
  updateNotice.hidden = false;
}

function stopUpdate(message) {
  clearTimeout(updateTimer);
  updatePort?.close();
  updatePort = null;
  expectedController = null;
  isApplyingUpdate = false;
  document.querySelector('main').inert = false;
  applyUpdateButton.disabled = false;
  deferUpdateButton.disabled = false;
  updateNoticeStatus.textContent = message;
  syncControls();
}

deferUpdateButton.addEventListener('click', () => {
  if (isApplyingUpdate) return;
  updateNotice.hidden = true;
  if (updateNotice.contains(document.activeElement) && noticeReturnFocus?.isConnected) noticeReturnFocus.focus();
});

applyUpdateButton.addEventListener('click', () => {
  if (isApplyingUpdate || updateNotice.hidden) return;
  const worker = appRegistration?.waiting;
  if (!worker || worker !== noticeWorker || worker.state !== 'installed' || !appRegistration.active) {
    updateNoticeStatus.textContent = '更新状態が変わりました。設定画面からもう一度確認してください。';
    return;
  }
  const reason = updateBlockReason();
  if (reason) { updateNoticeStatus.textContent = reason; return; }
  isApplyingUpdate = true;
  updateRouteVersion = routeVersion;
  expectedController = worker;
  document.querySelector('main').inert = true;
  applyUpdateButton.disabled = true;
  deferUpdateButton.disabled = true;
  syncControls();
  updateNoticeStatus.textContent = '安全に更新できるか確認しています…';
  const channel = new MessageChannel();
  updatePort = channel.port1;
  updatePort.onmessage = ({ data }) => {
    if (!isApplyingUpdate || expectedController !== worker) return;
    if (data?.type === 'UPDATE_BLOCKED') {
      stopUpdate(data.reason === 'other-clients'
        ? '別のアプリ画面が開いています。入力を保存し、アプリと関連タブをすべて閉じてから開き直してください。'
        : '安全性を確認できませんでした。入力を保存し、アプリと関連タブをすべて閉じてから開き直してください。');
    } else if (data?.type === 'UPDATE_CONFIRM') {
      const blocked = updateBlockReason();
      if (blocked || appRegistration.waiting !== worker) {
        stopUpdate(blocked || '更新状態が変わったため中止しました。もう一度確認してください。');
        return;
      }
      updateNoticeStatus.textContent = '更新しています…';
      updatePort.postMessage({ type: 'UPDATE_READY' });
    }
  };
  updateTimer = setTimeout(() => stopUpdate('更新の応答を確認できませんでした。入力を保存し、アプリと関連タブをすべて閉じてから開き直してください。'), 10000);
  try { worker.postMessage({ type: 'APPLY_UPDATE' }, [channel.port2]); }
  catch { stopUpdate('更新を開始できませんでした。設定画面からもう一度確認してください。'); }
});

if (supportsAppUpdates) navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!isApplyingUpdate || didReloadForUpdate || !expectedController
    || navigator.serviceWorker.controller !== expectedController) return;
  const reason = updateBlockReason();
  if (reason) { stopUpdate(reason); return; }
  didReloadForUpdate = true;
  clearTimeout(updateTimer);
  location.reload();
});

function setUpdateStatus(message, error = false) {
  updateStatus.textContent = message;
  updateStatus.classList.toggle('error-message', error);
  syncUpdateButton();
}

function showPendingUpdate(manual = false) {
  const waiting = appRegistration?.waiting;
  if (waiting && appRegistration.active && waiting !== appRegistration.active
    && waiting.state === 'installed') {
    setUpdateStatus('更新の準備ができました。入力内容を保存し、アプリと関連するタブをすべて閉じてから開き直してください。');
    offerUpdate(waiting, manual);
    return true;
  }
  const installing = appRegistration?.installing;
  if ((installing && !['redundant', 'activated'].includes(installing.state))
    || (waiting?.state === 'installed' && !appRegistration.active)) {
    setUpdateStatus(appRegistration.active
      ? '新しいバージョンを取得しています…' : 'アプリの初期準備をしています…');
    return true;
  }
  return false;
}

function observeAppRegistration(registration) {
  appRegistration = registration;
  const watchWorker = () => {
    const worker = registration.installing;
    if (!worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker);
    observedUpdateWorker = worker;
    const isUpdate = Boolean(registration.active && registration.active !== worker);
    const reflectState = () => {
      if (showPendingUpdate()) return;
      if (worker.state === 'redundant') {
        setUpdateStatus('更新を確認できませんでした。通信環境を確認して、もう一度お試しください。', true);
      } else if (worker.state === 'activated') {
        setUpdateStatus(isUpdate
          ? '更新状態が変わりました。入力内容を保存し、アプリを閉じてから開き直してください。'
          : 'アプリの初期準備が完了しました。');
      }
      syncUpdateButton();
    };
    worker.addEventListener('statechange', reflectState);
    reflectState();
  };
  if (!watchedRegistrations.has(registration)) {
    watchedRegistrations.add(registration);
    registration.addEventListener('updatefound', watchWorker);
  }
  watchWorker();
  showPendingUpdate();
  syncUpdateButton();
  return registration;
}

function registerServiceWorker() {
  if (!supportsAppUpdates) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker.register('./sw.js', {
      scope: './', updateViaCache: 'none',
    }).then(observeAppRegistration).catch((error) => {
      registrationPromise = null; // 通信が回復した後に再試行できるようにする。
      if (!showPendingUpdate()) {
        setUpdateStatus('更新を確認できませんでした。現在のアプリは引き続き利用できます。', true);
      }
      console.warn('Service Workerの登録に失敗しました:', error);
      return null;
    });
  }
  return registrationPromise;
}

checkUpdateButton.addEventListener('click', async () => {
  if (!supportsAppUpdates || isCheckingUpdate || isBusy() || returningToRecords || settingsScreen.hidden) return;
  isCheckingUpdate = true;
  syncUpdateButton();
  try {
    if (!appRegistration) {
      // 他の配置先のService Workerは利用せず、このアプリの登録だけを取得する。
      const existing = await navigator.serviceWorker.getRegistration('./');
      if (existing?.scope === new URL('./', location.href).href) observeAppRegistration(existing);
      else await registerServiceWorker();
    }
    if (!appRegistration || showPendingUpdate(true)) return;
    if (!navigator.onLine) throw new Error('Offline');
    setUpdateStatus('アップデートを確認しています…');
    const workerBeforeCheck = observedUpdateWorker;
    await appRegistration.update();
    if (showPendingUpdate(true)) return;
    // update()の完了はインストール・適用の完了を意味しない。
    if (observedUpdateWorker !== workerBeforeCheck) return;
    setUpdateStatus(appRegistration.active
      ? '新しいアップデートは見つかりませんでした。'
      : 'アプリの準備が完了していません。しばらくしてから、もう一度確認してください。');
  } catch (error) {
    if (!showPendingUpdate()) {
      setUpdateStatus('更新を確認できませんでした。通信環境を確認して、もう一度お試しください。現在のアプリは引き続き利用できます。', true);
    }
  } finally {
    isCheckingUpdate = false;
    syncUpdateButton();
  }
});

document.getElementById('open-settings').addEventListener('click', () => navigate('settings'));
settingsBack.addEventListener('click', () => {
  if (!isBusy()) returnToRecords();
});

backupButton.addEventListener('click', async () => {
  if (isBusy() || returningToRecords || settingsScreen.hidden) return;
  setBackupBusy(true);
  settingsStatus.classList.remove('error-message');
  settingsStatus.textContent = 'バックアップを作成しています…';
  let downloadUrl = null;
  try {
    const data = await getBackupData();
    let warning = '';
    const file = await createBackupFile(data, { onWarning: (message) => { warning = message; } });
    downloadUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `sake-fog-backup-${localDate()}.json`;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    settingsStatus.textContent = `飲酒記録${data.records.length}件・飲みたいお酒${data.wishlist.length}件のバックアップのダウンロードを開始しました。ファイルが保存されたことを確認してください。${warning ? ` ${warning}` : ''}`;
  } catch (error) {
    settingsStatus.classList.add('error-message');
    settingsStatus.textContent = `バックアップを作成できませんでした。${error.message}`;
    notifyList(settingsStatus.textContent, true);
  } finally {
    if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
    setBackupBusy(false);
    finishOperation();
  }
});

restoreButton.addEventListener('click', () => {
  if (isBusy() || returningToRecords || settingsScreen.hidden) return;
  restoreFile.value = '';
  restoreFile.click();
});

restoreFile.addEventListener('change', async () => {
  const file = restoreFile.files[0];
  if (!file || isBusy() || returningToRecords || settingsScreen.hidden) return;
  const origin = currentRoute;
  const originVersion = routeVersion;
  const canRestore = () => {
    if (originVersion === routeVersion) return true;
    settingsStatus.textContent = '画面を移動したため復元を中止しました。現在の記録は変更していません。';
    return false;
  };
  setBackupBusy(true);
  settingsStatus.classList.remove('error-message');
  settingsStatus.textContent = 'バックアップを検証しています…';
  let committed = false;
  try {
    const data = await readBackupFile(file);
    if (!canRestore()) return;
    const counts = await getBackupCounts();
    if (!canRestore()) return;
    const scope = data.formatVersion === 1
      ? `飲みたいリスト${counts.wishlist}件は保持します（旧形式1）。飲酒記録だけを置き換えます。`
      : `飲みたいお酒：現在${counts.wishlist}件 → 復元後${data.wishlist.length}件\n飲酒記録と飲みたいリストの両方を置き換えます。`;
    const message = `飲酒記録：現在${counts.records}件 → 復元後${data.records.length}件\n${scope}\n\nこの操作は取り消せません。復元しますか？`;
    if (!window.confirm(message)) {
      settingsStatus.textContent = '復元をキャンセルしました。現在の記録は変更していません。';
      return;
    }
    if (!canRestore()) return;
    settingsStatus.textContent = '記録を復元しています…';
    await replaceBackupData(data, counts);
    committed = true;
  } catch (error) {
    settingsStatus.classList.add('error-message');
    settingsStatus.textContent = `復元できませんでした。既存の記録は変更していません。${error.message}`;
    notifyList(settingsStatus.textContent, true);
  } finally {
    restoreFile.value = '';
    setBackupBusy(false);
    if (!committed) finishOperation();
  }
  if (committed) {
    completeWrite(origin, 'restored');
    finishOperation();
  }
});

// 再読み込みでは既存の履歴を再利用し、一覧の履歴を重複させない。
currentRoute = isAppRoute(history.state) ? history.state : makeRoute('records');
if (!isAppRoute(history.state)) history.replaceState(currentRoute, '');
renderRoute(false);

// 画面の初期化を待たせず、ページの読み込み完了後に登録する。
if (supportsAppUpdates) {
  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker, { once: true });
  }
} else {
  setUpdateStatus('この環境ではアップデート確認を利用できません。');
}
