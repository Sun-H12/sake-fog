// IndexedDBへのアクセス。画面操作は呼び出し元で行う。
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sakeLogDB', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('records')) {
        request.result.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      }
      // 既存のrecordsには触れず、新しいストアだけを追加する。
      if (!request.result.objectStoreNames.contains('wishlist')) {
        request.result.createObjectStore('wishlist', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => {
      if (request.error?.name === 'VersionError') {
        const error = new Error('アプリの更新が必要です。未保存の入力を控え、アプリと関連タブを閉じて最新版を開き直してください。データの削除は不要です。');
        error.name = 'VersionError';
        reject(error);
      } else reject(request.error);
    };
    request.onblocked = () => {
      const error = new Error('DB更新を待っています。未保存の入力を控え、ほかのアプリ画面・タブを閉じて、もう一度お試しください。');
      error.name = 'DatabaseBlockedError';
      reject(error);
      request.onsuccess = () => request.result.close();
    };
  });
}

async function getRecords() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readonly');
      const request = transaction.objectStore('records').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('取得が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('取得に失敗しました。'));
    });
  } finally {
    database.close();
  }
}

// 読み取り時は旧記録を書き換えず、追加写真の省略を空配列として扱う。
function getRecordPhotos(record) {
  const additional = record.additionalPhotos === undefined ? [] : record.additionalPhotos;
  if (!Array.isArray(additional) || additional.length > 2 || (record.photo == null && additional.length)) {
    throw new Error('写真の構成が無効です。代表写真と追加写真を確認してください。');
  }
  const photos = record.photo == null ? [] : [record.photo, ...additional];
  validateRecordPhotos(photos);
  return photos;
}

function validateRecordPhotos(photos) {
  if (!Array.isArray(photos) || photos.length > 3 || new Set(photos).size !== photos.length
    || Array.from(photos).some((photo) => !(photo instanceof Blob) || !photo.size
      || !/^image\/[a-z0-9!#$&^_.+\-]+$/i.test(photo.type))) {
    throw new Error('写真は最大3枚です。空の写真・無効な画像データ・同じBlobの重複は保存できません。');
  }
}

// 削除・追加後の順序から代表写真を決める。元の記録・Blobは変更しない。
function recordWithPhotos(record, photos) {
  validateRecordPhotos(photos);
  return { ...record, photo: photos[0] ?? null, additionalPhotos: photos.slice(1) };
}

function removeRecordPhoto(record, index) {
  const photos = getRecordPhotos(record);
  if (!Number.isInteger(index) || index < 0 || index >= photos.length) throw new Error('削除対象の写真が無効です。');
  return recordWithPhotos(record, photos.filter((_, position) => position !== index));
}

function getRecordPhotoWarnings(record) {
  return getRecordPhotos(record).flatMap((photo, index) => photo.size > 5 * 1024 * 1024
    ? [`写真${index + 1}は5MiBを超えます。保存できますが、保存容量とバックアップ容量が大きくなります。`] : []);
}

async function saveRecord(values, id) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      let failure = null;
      transaction.oncomplete = () => resolve();
      const saveError = () => (failure || transaction.error)?.name === 'QuotaExceededError'
        ? new Error('保存容量が不足しています。既存の記録と写真は変更していません。入力内容を保持したまま再試行できます。')
        : failure || transaction.error || new Error('保存に失敗しました。');
      transaction.onabort = () => reject(saveError());
      transaction.onerror = (event) => { failure ||= event.target.error || transaction.error; };
      const write = (record) => {
        try {
          if (Object.hasOwn(record, 'additionalPhotos')) {
            if (!Array.isArray(record.additionalPhotos)) throw new Error('追加写真の配列が無効です。');
            // 旧UIで代表写真だけを削除した場合も、追加写真を失わず繰り上げる。
            record = recordWithPhotos(record, record.photo == null
              ? record.additionalPhotos : [record.photo, ...record.additionalPhotos]);
          } else validateRecordPhotos(record.photo == null ? [] : [record.photo]);
          if (id == null) store.add(record);
          else store.put(record);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      if (id == null) {
        write({ ...values, createdAt: new Date().toISOString() });
      } else {
        // 同じトランザクションで存在確認し、ID・登録日時・既存の追加項目を保持する。
        const request = store.get(id);
        request.onsuccess = () => {
          if (!request.result) {
            transaction.abort();
            return;
          }
          write({ ...request.result, ...values, updatedAt: new Date().toISOString() });
        };
      }
    });
  } finally {
    database.close();
  }
}

async function deleteRecord(id) {
  // キーのない削除や、編集中の対象以外の削除を防ぐ。
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('削除対象のIDが無効です。');
  }
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('削除が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('削除に失敗しました。'));
      transaction.objectStore('records').delete(id);
    });
  } finally {
    database.close();
  }
}

async function getRecordCount() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readonly');
      const request = transaction.objectStore('records').count();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('現在の件数を取得できません。'));
      transaction.onerror = () => reject(transaction.error || new Error('現在の件数を取得できません。'));
    });
  } finally {
    database.close();
  }
}

async function replaceRecords(records, expectedCount) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      let failure = null;
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure || transaction.error || new Error('復元が中断されました。'));
      transaction.onerror = (event) => {
        // リクエストのエラーはIndexedDBが自動でトランザクションを中止する。
        // 明示的なabort後にもこのイベントが届くため、再度abortしない。
        failure ||= event.target.error || transaction.error || new Error('復元に失敗しました。');
      };
      const count = store.count();
      count.onsuccess = () => {
        try {
          if (count.result !== expectedCount) throw new Error('確認後に記録件数が変わりました。もう一度復元してください。');
          store.clear();
          records.forEach((record) => store.put(record));
        } catch (error) {
          failure = error;
          // 同期例外では自動中止されないため、この経路でだけabortする。
          try {
            transaction.abort();
          } catch {
            // すでに終了済みでも、元の復元エラーを伝えて二次例外を防ぐ。
            reject(failure);
          }
        }
      };
    });
  } finally {
    database.close();
  }
}

// 飲みたい項目は飲酒記録とは独立して保存する。
async function saveWishlistItem(values, id) {
  if (typeof values?.name !== 'string' || !values.name.trim()
    || (values.memo !== undefined && typeof values.memo !== 'string')) {
    throw new Error('飲みたいお酒の名前またはメモが無効です。');
  }
  if (id != null && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('編集対象のIDが無効です。');
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('wishlist', 'readwrite');
      const store = transaction.objectStore('wishlist');
      let resultId = id;
      let failure = null;
      transaction.oncomplete = () => resolve(resultId);
      transaction.onabort = () => reject(failure || transaction.error || new Error('保存が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('保存に失敗しました。'));
      const changes = { name: values.name.trim(), memo: values.memo ?? '' };
      if (id == null) {
        const request = store.add({ ...changes, createdAt: new Date().toISOString() });
        request.onsuccess = () => { resultId = request.result; };
      } else {
        const request = store.get(id);
        request.onsuccess = () => {
          if (!request.result) {
            failure = new Error('この飲みたいお酒は存在しません。削除された可能性があります。');
            transaction.abort();
            return;
          }
          store.put({ ...request.result, ...changes });
        };
      }
    });
  } finally { database.close(); }
}

// 新規登録専用。全件の検証後に一つのトランザクションで追加する。
async function saveWishlistItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
    throw new Error('飲みたいお酒は1〜20件で登録してください。');
  }
  const values = Array.from(items, (item) => {
    if (typeof item?.name !== 'string' || !item.name.trim()
      || (item.memo !== undefined && typeof item.memo !== 'string')) {
      throw new Error('飲みたいお酒の名前またはメモが無効です。');
    }
    return { name: item.name.trim(), memo: item.memo ?? '', createdAt: new Date().toISOString() };
  });
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('wishlist', 'readwrite');
      const store = transaction.objectStore('wishlist');
      const ids = [];
      let failure = null;
      transaction.oncomplete = () => resolve(ids);
      transaction.onabort = () => reject(failure || transaction.error || new Error('登録が中断されました。すべての入力を保持しています。'));
      transaction.onerror = (event) => { failure ||= event.target.error || transaction.error; };
      try {
        values.forEach((value, index) => {
          const request = store.add(value);
          request.onsuccess = () => { ids[index] = request.result; };
        });
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    });
  } finally { database.close(); }
}

async function getWishlistItem(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('編集対象のIDが無効です。');
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('wishlist', 'readonly');
      const request = transaction.objectStore('wishlist').get(id);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('取得が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('取得に失敗しました。'));
    });
  } finally { database.close(); }
}

async function getWishlist() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('wishlist', 'readonly');
      const request = transaction.objectStore('wishlist').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('取得が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('取得に失敗しました。'));
    });
  } finally { database.close(); }
}

async function deleteWishlistItem(id) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('削除対象のIDが無効です。');
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('wishlist', 'readwrite');
      transaction.objectStore('wishlist').delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('削除が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('削除に失敗しました。'));
    });
  } finally { database.close(); }
}

// 両ストアを同じ時点の状態として取得する。
async function getBackupData() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(['records', 'wishlist'], 'readonly');
      const records = transaction.objectStore('records').getAll();
      const wishlist = transaction.objectStore('wishlist').getAll();
      transaction.oncomplete = () => resolve({ records: records.result, wishlist: wishlist.result });
      transaction.onabort = () => reject(transaction.error || new Error('取得が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('取得に失敗しました。'));
    });
  } finally { database.close(); }
}

async function getBackupCounts() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(['records', 'wishlist'], 'readonly');
      const records = transaction.objectStore('records').count();
      const wishlist = transaction.objectStore('wishlist').count();
      transaction.oncomplete = () => resolve({ records: records.result, wishlist: wishlist.result });
      transaction.onabort = () => reject(transaction.error || new Error('件数の取得が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('件数の取得に失敗しました。'));
    });
  } finally { database.close(); }
}

async function replaceBackupData(data, expectedCounts) {
  if (![1, 2, 3].includes(data?.formatVersion) || !Array.isArray(data.records)
    || (data.formatVersion !== 1 && !Array.isArray(data.wishlist))) {
    throw new Error('復元データの形式が無効です。');
  }
  data.records.forEach((record) => {
    if (data.formatVersion === 3 && !Array.isArray(record.additionalPhotos)) throw new Error('追加写真の配列が無効です。');
    getRecordPhotos(record);
  });
  // 旧形式にwishlistがないことは、空のリストを意味しない。
  if (data.formatVersion === 1) return replaceRecords(data.records, expectedCounts.records);
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(['records', 'wishlist'], 'readwrite');
      const records = transaction.objectStore('records');
      const wishlist = transaction.objectStore('wishlist');
      const recordCount = records.count();
      const wishCount = wishlist.count();
      let ready = 0;
      let failure = null;
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure || transaction.error || new Error('復元が中断されました。'));
      transaction.onerror = (event) => { failure ||= event.target.error || transaction.error; };
      const replace = () => {
        if (++ready !== 2) return;
        try {
          if (recordCount.result !== expectedCounts.records || wishCount.result !== expectedCounts.wishlist) {
            throw new Error('確認後に件数が変わりました。もう一度復元してください。');
          }
          records.clear();
          wishlist.clear();
          data.records.forEach((record) => records.put(record));
          data.wishlist.forEach((item) => wishlist.put(item));
        } catch (error) {
          failure = error;
          try { transaction.abort(); } catch { reject(error); }
        }
      };
      recordCount.onsuccess = replace;
      wishCount.onsuccess = replace;
    });
  } finally { database.close(); }
}
