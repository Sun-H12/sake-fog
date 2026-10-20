// IndexedDBへのアクセス。画面操作は呼び出し元で行う。
function openDatabase() {
  return new Promise((resolve, reject) => {
    // 追加項目は同じストアに保存できるため、既存のバージョンとデータを維持する。
    const request = indexedDB.open('sakeLogDB', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('records')) {
        request.result.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      reject(new Error('ほかのタブを閉じて、もう一度お試しください。'));
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
