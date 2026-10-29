/**
 * 建站项目 HTML 本机双备份：IndexedDB 存正文，避免 localStorage 配额导致「网站突然消失」。
 * 元数据仍在 creativeStudioStore；此处只存大字段 html。
 */

const DB_NAME = 'trade_pro_site_vault_v1';
const DB_VER = 1;
const STORE = 'sites';

export type SiteVaultRow = {
  id: string;
  html: string;
  updatedAt: number;
  title?: string;
};

const isBrowser = () => typeof indexedDB !== 'undefined';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打开站点库失败'));
  });

const idbReq = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('站点库操作失败'));
  });

/** 写入 / 覆盖站点 HTML 快照 */
export const putSiteHtml = async (
  id: string,
  html: string,
  title?: string
): Promise<void> => {
  if (!isBrowser() || !id || !html) return;
  const db = await openDb();
  try {
    const row: SiteVaultRow = { id, html, updatedAt: Date.now(), title };
    const tx = db.transaction(STORE, 'readwrite');
    await idbReq(tx.objectStore(STORE).put(row));
  } finally {
    db.close();
  }
  // 二级兜底：session 级小缓存（刷新同会话可回退）
  try {
    sessionStorage.setItem(`site_html_bak_${id}`, html.slice(0, 400_000));
  } catch {
    /* quota */
  }
};

export const getSiteHtml = async (id: string): Promise<string | null> => {
  if (!isBrowser() || !id) return null;
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const row = (await idbReq(tx.objectStore(STORE).get(id))) as SiteVaultRow | undefined;
      if (row?.html) return row.html;
    } finally {
      db.close();
    }
  } catch {
    /* fall through */
  }
  try {
    return sessionStorage.getItem(`site_html_bak_${id}`);
  } catch {
    return null;
  }
};

export const deleteSiteHtml = async (id: string): Promise<void> => {
  if (!isBrowser() || !id) return;
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await idbReq(tx.objectStore(STORE).delete(id));
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.removeItem(`site_html_bak_${id}`);
  } catch {
    /* ignore */
  }
};
