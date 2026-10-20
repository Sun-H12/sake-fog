// バックアップ形式の作成・検証・写真変換。DBへの書き込みはdb.jsが担当する。
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function isValidDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  return Boolean(match && isValidDay(match[1]) && +match[2] < 24 && +match[3] < 60 && +match[4] < 60
    && (match[5] === 'Z' || (+match[6] < 24 && +match[7] < 60)) && Number.isFinite(Date.parse(value)));
}

function validateRecord(record, ids) {
  if (!isPlainObject(record) || !Number.isSafeInteger(record.id) || record.id <= 0 || ids.has(record.id)) {
    throw new Error('記録のIDが無効、または重複しています。');
  }
  ids.add(record.id);
  if (typeof record.name !== 'string' || !record.name.trim() || typeof record.impression !== 'string'
    || !Object.hasOwn(record, 'photo') || !isValidTimestamp(record.createdAt)) {
    throw new Error(`ID ${record.id}：必須項目または登録日時が無効です。`);
  }
  // 旧記録のdrankOnは追加・補完せず、存在する項目だけ検証する。
  if (Object.hasOwn(record, 'drankOn') && !isValidDay(record.drankOn)) {
    throw new Error(`ID ${record.id}：飲んだ日が無効です。`);
  }
  if (Object.hasOwn(record, 'updatedAt') && !isValidTimestamp(record.updatedAt)) {
    throw new Error(`ID ${record.id}：最終更新日時が無効です。`);
  }
}

function assertJsonValue(value) {
  // JSON化で黙って失われる値は、欠落したバックアップを作る代わりにエラーにする。
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    value.forEach(assertJsonValue);
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(assertJsonValue);
    return;
  }
  throw new Error('JSONで保持できない追加データが含まれています。バックアップは作成していません。');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('写真の読み取りに失敗しました。'));
    reader.onabort = () => reject(new Error('写真の読み取りが中断されました。'));
    reader.readAsDataURL(blob);
  });
}

function photoFromBackup(photo) {
  if (photo === null) return null;
  if (!isPlainObject(photo) || typeof photo.mimeType !== 'string'
    || !/^image\/[a-z0-9!#$&^_.+\-]+$/i.test(photo.mimeType)
    || typeof photo.base64 !== 'string' || photo.base64.length === 0
    || photo.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(photo.base64)) {
    throw new Error('写真のMIMEタイプまたはBase64データが無効です。');
  }
  const binary = atob(photo.base64);
  if (btoa(binary) !== photo.base64) throw new Error('写真のBase64データが不正です。');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: photo.mimeType });
}

async function createBackupFile(records) {
  const converted = [];
  const ids = new Set();
  let estimatedBytes = 0;
  for (const record of records) {
    validateRecord(record, ids);
    const { photo, ...metadata } = record;
    assertJsonValue(metadata);
    if (photo !== null && (!(photo instanceof Blob) || !photo.type.startsWith('image/') || !photo.size)) {
      throw new Error(`ID ${record.id}：写真データが無効です。`);
    }
    estimatedBytes += new Blob([JSON.stringify(metadata)]).size + (photo ? 4 * Math.ceil(photo.size / 3) : 0);
    if (estimatedBytes > MAX_BACKUP_BYTES) throw new Error('バックアップが50MBを超えます。今回は作成できません。');
    converted.push({
      ...metadata,
      photo: photo === null ? null : { mimeType: photo.type, base64: await blobToBase64(photo) },
    });
  }
  const backup = { format: 'sake-fog-backup', formatVersion: 1, createdAt: new Date().toISOString(), records: converted };
  const file = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (file.size > MAX_BACKUP_BYTES) throw new Error('バックアップが50MBを超えます。今回は作成できません。');
  return file;
}

async function readBackupFile(file) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('ファイルが大きすぎます。50MB以下のバックアップを選択してください。');
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('JSONファイルを読み取れません。正しいバックアップを選択してください。');
  }
  if (!isPlainObject(backup) || backup.format !== 'sake-fog-backup' || backup.formatVersion !== 1
    || !isValidTimestamp(backup.createdAt) || !Array.isArray(backup.records)) {
    throw new Error('バックアップの形式・バージョン・作成日時が無効です。');
  }
  const ids = new Set();
  // 全件の検証・写真変換が完了するまで、DBへの書き込みは行わない。
  return backup.records.map((record) => {
    validateRecord(record, ids);
    return { ...record, photo: photoFromBackup(record.photo) };
  });
}
