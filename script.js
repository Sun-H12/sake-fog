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
const backupButton = document.getElementById('create-backup');
const restoreButton = document.getElementById('restore-backup');
const restoreFile = document.getElementById('restore-file');
const settingsStatus = document.getElementById('settings-status');
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
    && ['records', 'new', 'edit', 'settings'].includes(route.screen)
    && (route.screen !== 'edit' || (Number.isSafeInteger(route.recordId) && route.recordId > 0));
}

function isBusy() {
  return isSaving || isBackupBusy;
}

function syncControls() {
  const blocked = isBusy() || returningToRecords || isRouteLoading;
  entryControls.forEach((control) => { control.disabled = blocked; });
  [backupButton, restoreButton, restoreFile, settingsBack,
    document.getElementById('add-record'), document.getElementById('open-settings'),
    ...recordsList.querySelectorAll('.edit-button')].forEach((control) => {
    control.disabled = blocked;
  });
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
  const impression = document.createElement('p');
  impression.className = 'record-impression';
  impression.textContent = record.impression || '感想なし';
  const day = document.createElement('time');
  const date = drinkingDay(record);
  if (date) day.dateTime = date;
  day.textContent = `飲んだ日：${date ? date.replaceAll('-', '/') : '不明'}`;
  const info = document.createElement('div');
  info.className = 'record-info';
  info.append(name, impression, day);
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
if ('serviceWorker' in navigator && window.isSecureContext) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
      .catch((error) => console.warn('Service Workerの登録に失敗しました:', error));
  };
  if (document.readyState === 'complete') {
    registerServiceWorker();
  } else {
    window.addEventListener('load', registerServiceWorker, { once: true });
  }
}
