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
  /** 另存为：把 base64 写到用户选择的路径（Windows 下载用） */
  saveBytes: (payload) => {
    try {
      return ipcRenderer.invoke('bw-save-bytes', payload || {});
    } catch (e) {
      return Promise.resolve({ ok: false, error: String(e?.message || e) });
    }
  },
});
