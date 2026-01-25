
import { KnowledgeFile, User, HistoryItem, AutomationResult } from '../types';

const DB_NAME = 'TradeScoutDB';
const DB_VERSION = 4; // Bump version to force admin re-seed
const STORE_KB = 'knowledgeBase';
const STORE_USERS = 'users';
const STORE_HISTORY = 'history';
const STORE_AUTOMATION = 'automationQueue';

/**
 * Open or Initialize the Database
 */
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const tx = (e.target as IDBOpenDBRequest).transaction;
      
      // Store 1: Knowledge Base
      if (!db.objectStoreNames.contains(STORE_KB)) {
        db.createObjectStore(STORE_KB, { keyPath: 'id' });
      }

      // Store 2: Users
      let userStore;
      if (!db.objectStoreNames.contains(STORE_USERS)) {
        userStore = db.createObjectStore(STORE_USERS, { keyPath: 'username' });
      } else if (tx) {
        userStore = tx.objectStore(STORE_USERS);
      }

      // Always ensure admin exists during upgrade/init
      if (userStore) {
          userStore.put({ 
              username: 'admin', 
              password: '123456', 
              role: 'admin', 
              isFirstLogin: true,
              createdAt: Date.now()
          });
      }

      // Store 3: Analysis History
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        const historyStore = db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Store 4: Automation Queue
      if (!db.objectStoreNames.contains(STORE_AUTOMATION)) {
        db.createObjectStore(STORE_AUTOMATION, { keyPath: 'id' });
      }
    };
  });
};

// --- KNOWLEDGE BASE OPERATIONS ---

export const saveFileToDB = async (file: KnowledgeFile) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_KB, 'readwrite');
    const store = tx.objectStore(STORE_KB);
    const req = store.put(file);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const getAllFilesFromDB = async (): Promise<KnowledgeFile[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KB, 'readonly');
    const store = tx.objectStore(STORE_KB);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

export const deleteFileFromDB = async (id: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_KB, 'readwrite');
    const store = tx.objectStore(STORE_KB);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

export const clearDB = async () => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_KB, 'readwrite');
        const store = tx.objectStore(STORE_KB);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- USER OPERATIONS ---

export const getUser = async (username: string): Promise<User | undefined> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_USERS, 'readonly');
        const store = tx.objectStore(STORE_USERS);
        const req = store.get(username);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const getAllUsers = async (): Promise<User[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_USERS, 'readonly');
        const store = tx.objectStore(STORE_USERS);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
};

export const saveUser = async (user: User) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_USERS, 'readwrite');
        const store = tx.objectStore(STORE_USERS);
        const req = store.put(user);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const deleteUser = async (username: string) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_USERS, 'readwrite');
        const store = tx.objectStore(STORE_USERS);
        const req = store.delete(username);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

// --- HISTORY OPERATIONS ---

export const saveHistory = async (item: HistoryItem) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_HISTORY, 'readwrite');
        const store = tx.objectStore(STORE_HISTORY);
        const req = store.put(item);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const getHistory = async (): Promise<HistoryItem[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HISTORY, 'readonly');
        const store = tx.objectStore(STORE_HISTORY);
        const index = store.index('timestamp');
        const req = index.getAll(); 
        req.onsuccess = () => resolve(req.result.reverse()); 
        req.onerror = () => reject(req.error);
    });
};

// --- AUTOMATION QUEUE OPERATIONS (NEW) ---

export const saveAutomationTask = async (task: AutomationResult) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_AUTOMATION, 'readwrite');
        const store = tx.objectStore(STORE_AUTOMATION);
        const req = store.put(task);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};

export const getAutomationQueue = async (): Promise<AutomationResult[]> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_AUTOMATION, 'readonly');
        const store = tx.objectStore(STORE_AUTOMATION);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result); // Returns in insertion order usually, can sort later
        req.onerror = () => reject(req.error);
    });
};

export const deleteAutomationTask = async (id: string) => {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_AUTOMATION, 'readwrite');
        const store = tx.objectStore(STORE_AUTOMATION);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
};
