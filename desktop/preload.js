/**
 * 预加载：仅暴露打开外链等安全能力，不暴露 Node / 路径。
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
});
