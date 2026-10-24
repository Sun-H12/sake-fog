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

async function saveRecord(values, id) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('保存が中断されました。'));
      transaction.onerror = () => reject(transaction.error || new Error('保存に失敗しました。'));
      if (id == null) {
        store.add({ ...values, createdAt: new Date().toISOString() });
      } else {
        // 同じトランザクションで存在確認し、ID・登録日時・既存の追加項目を保持する。
        const request = store.get(id);
        request.onsuccess = () => {
          if (!request.result) {
            transaction.abort();
            return;
          }
          store.put({ ...request.result, ...values, updatedAt: new Date().toISOString() });
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
  if (![1, 2].includes(data?.formatVersion) || !Array.isArray(data.records)
    || (data.formatVersion === 2 && !Array.isArray(data.wishlist))) {
    throw new Error('復元データの形式が無効です。');
  }
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
