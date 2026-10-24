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

function validateWishlistItem(item, ids) {
  if (!isPlainObject(item) || !Number.isSafeInteger(item.id) || item.id <= 0 || ids.has(item.id)
    || typeof item.name !== 'string' || !item.name.trim()
    || (Object.hasOwn(item, 'memo') && typeof item.memo !== 'string') || !isValidTimestamp(item.createdAt)) {
    throw new Error('飲みたいリストのID・名前・メモ・登録日時が無効、またはIDが重複しています。');
  }
  ids.add(item.id);
  assertJsonValue(item);
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

async function createBackupFile({ records, wishlist }, { onWarning = () => {} } = {}) {
  if (!Array.isArray(records) || !Array.isArray(wishlist)) throw new Error('バックアップ対象の一覧が無効です。');
  const converted = [];
  const ids = new Set();
  let photoBytes = 0;
  for (const record of records) {
    validateRecord(record, ids);
    const { photo, additionalPhotos, ...metadata } = record;
    assertJsonValue(metadata);
    const photos = getRecordPhotos(record);
    const placeholder = (image) => {
      photoBytes += 4 * Math.ceil(image.size / 3);
      return { mimeType: image.type, base64: '' };
    };
    converted.push({
      ...metadata,
      photo: photos.length ? placeholder(photos[0]) : null,
      additionalPhotos: photos.slice(1).map(placeholder),
    });
  }
  const wishIds = new Set();
  wishlist.forEach((item) => validateWishlistItem(item, wishIds));
  const backup = { format: 'sake-fog-backup', formatVersion: 3, createdAt: new Date().toISOString(), records: converted, wishlist };
  // Base64の文字数とメタデータから出力サイズを計算し、巨大な変換の前に拒否する。
  const expectedBytes = new Blob([JSON.stringify(backup)]).size + photoBytes;
  if (expectedBytes > MAX_BACKUP_BYTES) {
    throw new Error('バックアップが50MiBを超えるため作成できません。既存データは変更していません。不完全なファイルは出力していません。');
  }
  for (let index = 0; index < records.length; index++) {
    const photos = getRecordPhotos(records[index]);
    const targets = converted[index].photo === null ? [] : [converted[index].photo, ...converted[index].additionalPhotos];
    for (let position = 0; position < photos.length; position++) {
      targets[position].base64 = await blobToBase64(photos[position]);
    }
  }
  const file = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (file.size > MAX_BACKUP_BYTES) throw new Error('バックアップが50MiBを超えるため作成できません。不完全なファイルは出力していません。');
  if (file.size >= MAX_BACKUP_BYTES * 0.9) onWarning('バックアップが45MiB以上になり、50MiBの上限に近づいています。');
  return file;
}

async function readBackupFile(file) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('ファイルが大きすぎます。50MiB以下のバックアップを選択してください。');
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('JSONファイルを読み取れません。正しいバックアップを選択してください。');
  }
  if (!isPlainObject(backup) || backup.format !== 'sake-fog-backup' || ![1, 2, 3].includes(backup.formatVersion)
    || !isValidTimestamp(backup.createdAt) || !Array.isArray(backup.records)
    || (backup.formatVersion !== 1 && !Array.isArray(backup.wishlist))) {
    throw new Error('バックアップの形式・バージョン・作成日時が無効です。');
  }
  const ids = new Set();
  // 全件の検証・写真変換が完了するまで、DBへの書き込みは行わない。
  const records = backup.records.map((record) => {
    validateRecord(record, ids);
    assertJsonValue(record);
    if (backup.formatVersion === 3) {
      if (!Array.isArray(record.additionalPhotos) || record.additionalPhotos.length > 2) {
        throw new Error('追加写真の配列が無効です。写真は代表写真を含め最大3枚です。');
      }
      const result = { ...record, photo: photoFromBackup(record.photo),
        additionalPhotos: record.additionalPhotos.map((photo) => {
          if (photo === null) throw new Error('追加写真に空の写真が含まれています。');
          return photoFromBackup(photo);
        }) };
      getRecordPhotos(result);
      return result;
    }
    // 旧形式に追加写真が紛れていたら、黙って失う代わりに拒否する。
    if (Object.hasOwn(record, 'additionalPhotos')
      && (!Array.isArray(record.additionalPhotos) || record.additionalPhotos.length)) {
      throw new Error('追加写真を含むバックアップには形式3が必要です。');
    }
    return { ...record, photo: photoFromBackup(record.photo) };
  });
  if (backup.formatVersion === 1) return { formatVersion: 1, records };
  const wishIds = new Set();
  const wishlist = backup.wishlist.map((item) => {
    validateWishlistItem(item, wishIds);
    return { ...item };
  });
  return { formatVersion: backup.formatVersion, records, wishlist };
}
