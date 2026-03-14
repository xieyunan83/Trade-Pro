
import { HistoryItem, AutomationResult, KnowledgeFile } from '../types';

const DB_NAME = 'TradeScoutDB';
const DB_VERSION = 5;

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
