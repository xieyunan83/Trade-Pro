/**
 * 预加载：仅暴露打开外链 / 另存为等安全能力，不暴露 Node / 路径。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bwDesktop', {
  openExternal: (url) => {
    try {
      ipcRenderer.send('bw-open-external', String(url || ''));
    } catch {
      /* ignore */
    }
  },
  reportBootOk: () => {
    try {
      ipcRenderer.send('bw-boot-ok');
    } catch {
      /* ignore */
    }
  },
  /** 错误页「立即重试」：主进程重新走连接中 → 拉站 */
  retryBoot: () => {
    try {
      ipcRenderer.send('bw-boot-retry');
    } catch {
      /* ignore */
    }
  },
  /** 另存为：把 blob→base64 传来写盘（不阻塞主进程同步） */
  saveBytes: (payload) => {
    try {
      return ipcRenderer.invoke('bw-save-bytes', payload || {});
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e?.message || e) });
    }
  },
});

// 尽早标记桌面端，减少页面侧轮询/等待
try {
  window.addEventListener('DOMContentLoaded', () => {
    try {
      localStorage.setItem('trade_scout_desktop_client', '1');
    } catch {
      /* ignore */
    }
  });
} catch {
  /* ignore */
}
