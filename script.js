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
    image.addEventListener('error', () => {
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
  if (record.updatedAt) {
    const updated = document.createElement('time');
    const timestamp = new Date(record.updatedAt);
    if (!Number.isNaN(timestamp.getTime())) {
      updated.dateTime = timestamp.toISOString();
      updated.textContent = `最終更新日時：${timestamp.toLocaleString('ja-JP')}`;
      updated.className = 'record-updated';
      info.append(updated);
    }
  }
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
  edit.addEventListener('click', () => openEntry(record));
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

function openEntry(record = null) {
  if (isSaving) return;
  ++listRequestVersion;
  resetEntry();
  editingRecord = record;
  deleteButton.hidden = record == null;
  if (record) {
    nameInput.value = record.name;
    impressionInput.value = record.impression || '';
    dateInput.value = drinkingDay(record) || localDate();
    selectedPhoto = record.photo || null;
  }
  entryHeading.textContent = record ? 'お酒を編集する' : 'お酒を記録する';
  registerButton.textContent = record ? '保存する' : '登録する';
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

document.getElementById('add-record').addEventListener('click', () => openEntry());
backButton.addEventListener('click', () => {
  if (isSaving) return;
  resetEntry();
  showRecords();
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
  if (isSaving) return;
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
  isSaving = true;
  entryControls.forEach((control) => { control.disabled = true; });
  registerButton.textContent = '保存中…';
  registrationResult.classList.remove('is-error');
  try {
    await saveRecord(values, id);
    resetEntry();
    showToast(id == null ? 'created' : 'updated');
    showRecords();
  } catch (error) {
    registrationResult.classList.add('is-error');
    registrationResult.textContent = '保存に失敗しました。入力内容は保持されています。もう一度お試しください。';
    console.error('記録の保存に失敗しました:', error);
  } finally {
    isSaving = false;
    entryControls.forEach((control) => { control.disabled = false; });
    registerButton.textContent = editingRecord ? '保存する' : '登録する';
  }
});

deleteButton.addEventListener('click', async () => {
  if (isSaving || editingRecord == null) return;
  const id = editingRecord.id;
  if (!window.confirm('この記録を削除しますか？この操作は取り消せません。')) return;
  if (isSaving || editingRecord?.id !== id) return;

  isSaving = true;
  entryControls.forEach((control) => { control.disabled = true; });
  deleteLabel.textContent = '削除中…';
  registrationResult.textContent = '';
  registrationResult.classList.remove('is-error');
  try {
    await deleteRecord(id);
    resetEntry();
    showToast('deleted');
    showRecords();
  } catch (error) {
    registrationResult.classList.add('is-error');
    registrationResult.textContent = '削除に失敗しました。入力内容は保持されています。もう一度お試しください。';
    console.error('記録の削除に失敗しました:', error);
  } finally {
    isSaving = false;
    entryControls.forEach((control) => { control.disabled = false; });
    deleteLabel.textContent = 'この記録を削除する';
  }
});

function showSettings() {
  if (isSaving || isBackupBusy) return;
  ++listRequestVersion;
  hideToast();
  clearRecordsList();
  clearPreview();
  entryScreen.hidden = true;
  recordsScreen.hidden = true;
  settingsScreen.hidden = false;
  appHeader.hidden = true;
  document.body.classList.remove('entry-mode');
  settingsStatus.textContent = '';
  settingsStatus.classList.remove('error-message');
  document.getElementById('settings-heading').focus();
  window.scrollTo(0, 0);
}

function setBackupBusy(busy) {
  isBackupBusy = busy;
  [backupButton, restoreButton, restoreFile, settingsBack].forEach((control) => {
    control.disabled = busy;
  });
}

document.getElementById('open-settings').addEventListener('click', showSettings);
settingsBack.addEventListener('click', () => {
  if (!isBackupBusy) showRecords();
});

backupButton.addEventListener('click', async () => {
  if (isBackupBusy) return;
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
  } finally {
    if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);
    setBackupBusy(false);
  }
});

restoreButton.addEventListener('click', () => {
  if (isBackupBusy) return;
  restoreFile.value = '';
  restoreFile.click();
});

restoreFile.addEventListener('change', async () => {
  const file = restoreFile.files[0];
  if (!file || isBackupBusy) return;
  setBackupBusy(true);
  settingsStatus.classList.remove('error-message');
  settingsStatus.textContent = 'バックアップを検証しています…';
  let committed = false;
  try {
    const records = await readBackupFile(file);
    const currentCount = await getRecordCount();
    const message = `現在の記録：${currentCount}件\n復元予定：${records.length}件\n\n現在の全記録を置き換えます。この操作は取り消せません。復元しますか？`;
    if (!window.confirm(message)) {
      settingsStatus.textContent = '復元をキャンセルしました。現在の記録は変更していません。';
      return;
    }
    settingsStatus.textContent = '記録を復元しています…';
    await replaceRecords(records, currentCount);
    committed = true;
  } catch (error) {
    settingsStatus.classList.add('error-message');
    settingsStatus.textContent = `復元できませんでした。既存の記録は変更していません。${error.message}`;
  } finally {
    restoreFile.value = '';
    setBackupBusy(false);
  }
  if (committed) {
    resetEntry();
    showToast('restored');
    showRecords();
  }
});

showRecords(false);

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
