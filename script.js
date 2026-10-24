const photoInput = document.getElementById('sake-photo');
const photoPreview = document.getElementById('photo-preview');
const photoError = document.getElementById('photo-error');
const nameInput = document.getElementById('sake-name');
const impressionInput = document.getElementById('sake-impression');
const dateInput = document.getElementById('drank-on');
const registerButton = document.getElementById('register-button');
const registrationResult = document.getElementById('registration-result');
const entryScreen = document.getElementById('entry-screen');
const recordsScreen = document.getElementById('records-screen');
const recordsList = document.getElementById('records-list');
const listStatus = document.getElementById('list-status');
const saveNotice = document.getElementById('save-notice');
const toastTitle = document.getElementById('toast-title');
const toastDescription = document.getElementById('toast-description');
const toastIconPath = document.getElementById('toast-icon-path');
const backButton = document.getElementById('back-button');
const removePhotoButton = document.getElementById('remove-photo');
const retryButton = document.getElementById('retry-list');
const entryHeading = document.getElementById('record-heading');
const appHeader = document.getElementById('app-header');
const photoPlaceholder = document.getElementById('photo-placeholder');
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
const entryControls = [photoInput, nameInput, impressionInput, dateInput, registerButton, removePhotoButton, backButton, deleteButton];
let editingRecord = null;
let selectedPhoto = null;
let previewUrl = null;
let isSaving = false;
let listRequestVersion = 0;
let previewVersion = 0;
const listPhotoUrls = new Set();
let toastTimer = null;
let toastDismissTimer = null;
let toastVersion = 0;
// 履歴には画面名とIDだけを保存する。写真・入力内容は保存しない。
let currentRoute = null;
let routeVersion = 0;
let returningToRecords = false;
let entryRoute = null;
let failedEntry = false;
let isRouteLoading = false;
let listNotice = null;

function makeRoute(screen, recordId) {
  return { app: 'sake-fog', version: 1, screen, recordId,
    key: `${Date.now()}-${Math.random()}` };
}

function isAppRoute(route) {
  return route?.app === 'sake-fog' && route.version === 1
    && typeof route.key === 'string'
    && ['records', 'new', 'edit', 'settings', 'detail'].includes(route.screen)
    && (!['edit', 'detail'].includes(route.screen) || (Number.isSafeInteger(route.recordId) && route.recordId > 0));
}

function isBusy() {
  return isSaving || isBackupBusy || isApplyingUpdate;
}

function syncControls() {
  const blocked = isBusy() || returningToRecords || isRouteLoading;
  entryControls.forEach((control) => { control.disabled = blocked; });
  [backupButton, restoreButton, restoreFile, settingsBack,
    document.getElementById('add-record'), document.getElementById('open-settings'),
    ...recordsList.querySelectorAll('.edit-button, .record-open')].forEach((control) => {
    control.disabled = blocked;
  });
  // 詳細の読み込み中も戻れるようにする。
  detailBack.disabled = isBusy() || returningToRecords;
  syncUpdateButton();
}

function notifyList(message, error = false) {
  listNotice = { message, error };
  if (!recordsScreen.hidden) {
    listStatus.textContent = message;
    listStatus.classList.toggle('error-message', error);
  }
}

function navigate(screen, recordId) {
  if (isBusy() || returningToRecords || isRouteLoading || currentRoute.screen !== 'records') return;
  const route = makeRoute(screen, recordId);
  if (!isAppRoute(route)) return;
  history.pushState(route, '');
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
  isRouteLoading = false;
  if (route.screen === 'records') {
    if (!isBusy() && !failedEntry) {
      resetEntry();
      entryRoute = null;
    }
    await showRecords(focus);
  } else if (route.screen === 'detail') {
    await showDetail(route, version, focus);
  } else if (route.screen === 'settings') {
    // 処理中に「進む」で戻っても進捗・結果を消さない。
    showSettings(isBackupBusy);
  } else {
    const retained = entryRoute && (entryRoute.key === route.key || (failedEntry
      && entryRoute.screen === route.screen && entryRoute.recordId === route.recordId));
    if (retained) {
      openEntry(editingRecord, true);
      entryRoute = route;
    } else if (route.screen === 'new') {
      openEntry();
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

function showToast(type) {
  const message = toastMessages[type];
  if (!message) return;
  hideToast();
  const version = toastVersion;
  // 連続通知でも登場アニメーションを最初から再生する。
  void saveNotice.offsetWidth;
  saveNotice.dataset.type = type;
  toastTitle.textContent = message.title;
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
  recordsList.replaceChildren();
  listPhotoUrls.forEach((url) => URL.revokeObjectURL(url));
  listPhotoUrls.clear();
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
  const photo = document.createElement('div');
  photo.className = 'record-photo';
  photo.textContent = '写真なし';
  if (record.photo instanceof Blob && record.photo.type.startsWith('image/')) {
    const image = document.createElement('img');
    const url = URL.createObjectURL(record.photo);
    listPhotoUrls.add(url);
    image.alt = `${record.name}の写真`;
    image.addEventListener('load', () => {
      photo.classList.add('has-photo');
    }, { once: true });
    image.addEventListener('error', () => {
      photo.classList.remove('has-photo');
      photo.textContent = '写真を表示できません';
      URL.revokeObjectURL(url);
      listPhotoUrls.delete(url);
    }, { once: true });
    image.src = url;
    photo.replaceChildren(image);
  }
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
  card.append(photo, info);
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

async function showRecords(focus = true) {
  clearDetail();
  const version = ++listRequestVersion;
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
  if (focus) document.getElementById('records-heading').focus();
  try {
    const records = await getRecords();
    if (version !== listRequestVersion) return;
    records.sort((a, b) => drinkingDay(b).localeCompare(drinkingDay(a)) || b.id - a.id);
    const fragment = document.createDocumentFragment();
    records.forEach((record) => fragment.append(renderRecord(record)));
    recordsList.append(fragment);
    listStatus.textContent = records.length ? '' : 'まだ記録がありません';
    if (listNotice) notifyList(listNotice.message, listNotice.error);
    syncControls();
  } catch (error) {
    if (version !== listRequestVersion) return;
    clearRecordsList();
    listStatus.classList.add('error-message');
    listStatus.textContent = '記録の取得に失敗しました。もう一度お試しください。';
    retryButton.hidden = false;
    console.error('記録の取得に失敗しました:', error);
  }
}

function clearDetail() {
  detailScreen.hidden = true;
  detailContent.replaceChildren();
  detailContent.hidden = true;
  if (detailPhotoUrl) URL.revokeObjectURL(detailPhotoUrl);
  detailPhotoUrl = null;
}

async function showDetail(route, version, focus) {
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
    const photo = document.createElement('div');
    photo.className = 'detail-photo';
    photo.textContent = '写真なし';
    if (record.photo instanceof Blob && record.photo.type.startsWith('image/')) {
      const image = document.createElement('img');
      const url = URL.createObjectURL(record.photo);
      detailPhotoUrl = url;
      image.alt = `${record.name}の写真`;
      image.addEventListener('error', () => {
        if (detailPhotoUrl !== url) return;
        photo.textContent = '写真を表示できません';
        URL.revokeObjectURL(url);
        detailPhotoUrl = null;
      }, { once: true });
      image.src = url;
      photo.replaceChildren(image);
    }
    const name = document.createElement('h3');
    name.textContent = record.name;
    const day = document.createElement('time');
    const date = drinkingDay(record);
    if (date) day.dateTime = date;
    day.textContent = `飲んだ日：${date ? date.replaceAll('-', '/') : '不明'}`;
    detailContent.append(photo, name, day);
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
  photoPreview.hidden = true;
  photoPlaceholder.hidden = false;
  photoPreview.onload = null;
  photoPreview.onerror = null;
  photoPreview.removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function showPreview() {
  clearPreview();
  removePhotoButton.hidden = !selectedPhoto;
  if (!selectedPhoto) return;
  const version = previewVersion;
  previewUrl = URL.createObjectURL(selectedPhoto);
  photoPreview.onload = () => {
    if (version === previewVersion) {
      photoPreview.hidden = false;
      photoPlaceholder.hidden = true;
    }
  };
  photoPreview.onerror = () => {
    if (version !== previewVersion) return;
    clearPreview();
    // 表示できない既存写真も、ユーザーが削除・変更しない限り保持する。
    photoError.textContent = '画像を表示できません。必要に応じて変更または削除してください。';
  };
  photoPreview.src = previewUrl;
}

function resetEntry() {
  entryBaseline = null;
  editingRecord = null;
  selectedPhoto = null;
  nameInput.value = '';
  nameInput.setCustomValidity('');
  impressionInput.value = '';
  dateInput.value = localDate();
  photoInput.value = '';
  photoError.textContent = '';
  registrationResult.textContent = '';
  registrationResult.classList.remove('is-error');
  clearPreview();
  removePhotoButton.hidden = true;
  deleteButton.hidden = true;
}

function openEntry(record = null, preserve = false) {
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
    selectedPhoto = record.photo || null;
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

document.getElementById('add-record').addEventListener('click', () => navigate('new'));
backButton.addEventListener('click', () => {
  if (!isBusy()) returnToRecords();
});
retryButton.addEventListener('click', () => showRecords(false));

photoInput.addEventListener('change', () => {
  photoError.textContent = '';
  registrationResult.textContent = '';
  const file = photoInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    photoError.textContent = '画像ファイルを選択してください。';
    photoInput.value = '';
    return;
  }
  selectedPhoto = file.slice(0, file.size, file.type);
  showPreview();
});
removePhotoButton.addEventListener('click', () => {
  selectedPhoto = null;
  photoInput.value = '';
  photoError.textContent = '';
  registrationResult.textContent = '';
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
    photo: selectedPhoto,
    drankOn: dateInput.value,
  };
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
    registrationResult.textContent = '保存に失敗しました。入力内容は保持されています。もう一度お試しください。';
    notifyList('保存に失敗しました。入力内容は保持されています。＋または元の記録の編集から再試行できます。', true);
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
    registrationResult.textContent = '削除に失敗しました。入力内容は保持されています。もう一度お試しください。';
    notifyList('削除に失敗しました。記録を確認し、もう一度お試しください。', true);
    console.error('記録の削除に失敗しました:', error);
  } finally {
    isSaving = false;
    deleteLabel.textContent = 'この記録を削除する';
    finishOperation();
  }
});

function showSettings(preserve = false) {
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
    date: dateInput.value, photo: selectedPhoto };
}

function updateBlockReason() {
  if (isSaving || isBackupBusy) return '保存・削除・バックアップ・復元の処理が終わってから更新してください。';
  if (isRouteLoading || returningToRecords
    || (isApplyingUpdate && updateRouteVersion !== routeVersion)) return '画面の移動が終わってから更新してください。';
  const values = entryValues();
  if (failedEntry || (entryBaseline && Object.keys(values).some((key) => values[key] !== entryBaseline[key]))) {
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
    const records = await getRecords();
    const file = await createBackupFile(records);
    downloadUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `sake-fog-backup-${localDate()}.json`;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    settingsStatus.textContent = `${records.length}件のバックアップのダウンロードを開始しました。ファイルが保存されたことを確認してください。`;
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
    const records = await readBackupFile(file);
    if (!canRestore()) return;
    const currentCount = await getRecordCount();
    if (!canRestore()) return;
    const message = `現在の記録：${currentCount}件\n復元予定：${records.length}件\n\n現在の全記録を置き換えます。この操作は取り消せません。復元しますか？`;
    if (!window.confirm(message)) {
      settingsStatus.textContent = '復元をキャンセルしました。現在の記録は変更していません。';
      return;
    }
    if (!canRestore()) return;
    settingsStatus.textContent = '記録を復元しています…';
    await replaceRecords(records, currentCount);
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
