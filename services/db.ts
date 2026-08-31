
import { HistoryItem, AutomationResult, KnowledgeFile, DiscoveryArchiveItem, CustomerProductProfile } from '../types';

const DB_NAME = 'TradeScoutDB';
const DB_VERSION = 7;
const DISCOVERY_LS_KEY = 'trade_scout_discovery_archives';

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('automation')) {
        db.createObjectStore('automation', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('discovery')) {
        db.createObjectStore('discovery', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('product_profiles')) {
        db.createObjectStore('product_profiles', { keyPath: 'id' });
      }
    };
  });
};

export const saveHistory = async (item: HistoryItem): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('history', 'readwrite');
    const store = transaction.objectStore('history');
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getHistory = async (): Promise<HistoryItem[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('history', 'readonly');
    const store = transaction.objectStore('history');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a: any, b: any) => b.timestamp - a.timestamp));
    request.onerror = () => reject(request.error);
  });
};

export const deleteHistoryItem = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('history', 'readwrite');
    const store = transaction.objectStore('history');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearAllHistory = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('history', 'readwrite');
    const store = transaction.objectStore('history');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const saveAutomationTask = async (task: AutomationResult): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('automation', 'readwrite');
    const store = transaction.objectStore('automation');
    const request = store.put(task);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAutomationQueue = async (): Promise<AutomationResult[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('automation', 'readonly');
    const store = transaction.objectStore('automation');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const deleteAutomationTask = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('automation', 'readwrite');
    const store = transaction.objectStore('automation');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearAutomationQueue = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('automation', 'readwrite');
    const store = transaction.objectStore('automation');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearCompletedAutomationTasks = async (): Promise<number> => {
  const all = await getAutomationQueue();
  const completed = all.filter((t) => t.status === 'completed');
  for (const t of completed) {
    await deleteAutomationTask(t.id);
  }
  return completed.length;
};

export const saveDiscoveryArchive = async (item: DiscoveryArchiveItem): Promise<void> => {
  try {
    const db = await initDB();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('discovery', 'readwrite');
      const store = transaction.objectStore('discovery');
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // IndexedDB 升级失败时回退 localStorage
    const list = getDiscoveryArchivesFromLS();
    const next = [item, ...list.filter((x) => x.id !== item.id)].slice(0, 200);
    localStorage.setItem(DISCOVERY_LS_KEY, JSON.stringify(next));
  }
};

export const getDiscoveryArchives = async (): Promise<DiscoveryArchiveItem[]> => {
  try {
    const db = await initDB();
    const fromDb: DiscoveryArchiveItem[] = await new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains('discovery')) {
        resolve([]);
        return;
      }
      const transaction = db.transaction('discovery', 'readonly');
      const store = transaction.objectStore('discovery');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const fromLs = getDiscoveryArchivesFromLS();
    const map = new Map<string, DiscoveryArchiveItem>();
    [...fromDb, ...fromLs].forEach((i) => map.set(i.id, i));
    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return getDiscoveryArchivesFromLS();
  }
};

export const deleteDiscoveryArchive = async (id: string): Promise<void> => {
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('discovery')) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('discovery', 'readwrite');
        const store = transaction.objectStore('discovery');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  } catch {
    /* ignore */
  }
  const next = getDiscoveryArchivesFromLS().filter((x) => x.id !== id);
  localStorage.setItem(DISCOVERY_LS_KEY, JSON.stringify(next));
};

const getDiscoveryArchivesFromLS = (): DiscoveryArchiveItem[] => {
  try {
    const raw = localStorage.getItem(DISCOVERY_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveFileToDB = async (file: KnowledgeFile): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    const request = store.put(file);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getAllFilesFromDB = async (): Promise<KnowledgeFile[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readonly');
    const store = transaction.objectStore('files');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const deleteFileFromDB = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ==================== 客户产品画像库 ====================

export const saveProductProfile = async (profile: CustomerProductProfile): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('product_profiles')) {
      reject(new Error('product_profiles store missing — refresh to upgrade DB'));
      return;
    }
    const transaction = db.transaction('product_profiles', 'readwrite');
    const store = transaction.objectStore('product_profiles');
    const request = store.put(profile);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const saveProductProfilesBulk = async (profiles: CustomerProductProfile[]): Promise<void> => {
  if (!profiles.length) return;
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('product_profiles')) {
      reject(new Error('product_profiles store missing'));
      return;
    }
    const transaction = db.transaction('product_profiles', 'readwrite');
    const store = transaction.objectStore('product_profiles');
    for (const p of profiles) store.put(p);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const getProductProfiles = async (): Promise<CustomerProductProfile[]> => {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains('product_profiles')) {
        resolve([]);
        return;
      }
      const transaction = db.transaction('product_profiles', 'readonly');
      const store = transaction.objectStore('product_profiles');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
};

export const deleteProductProfile = async (id: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains('product_profiles')) {
      resolve();
      return;
    }
    const transaction = db.transaction('product_profiles', 'readwrite');
    const store = transaction.objectStore('product_profiles');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
