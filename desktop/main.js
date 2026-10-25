/**
 * BabyWorld 桌面壳：无地址栏，加载 https://babyworld.ltd
 * 外链在系统浏览器打开；平台内导航仍在窗口内。
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');

const APP_ORIGIN = 'https://babyworld.ltd';
const START_URL = `${APP_ORIGIN}/`;

/** 允许在应用内打开的源（含子域） */
const isAppUrl = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return host === 'babyworld.ltd' || host.endsWith('.babyworld.ltd');
  } catch {
    return false;
  }
};

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'BabyWorld',
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 不暴露开发者工具入口（仍可用快捷键时生产可关掉）
      devTools: !app.isPackaged,
    },
  });

  // 无菜单栏（Windows/Linux）；macOS 保留极简应用菜单以便 Cmd+Q
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        {
          label: '编辑',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: '窗口',
          submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
        },
      ])
    );
  } else {
    Menu.setApplicationMenu(null);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // 标题固定为产品名，避免把页面 title 里可能出现的域名露出来
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle('BabyWorld');
  });

  mainWindow.loadURL(START_URL, {
    userAgent: mainWindow.webContents.getUserAgent().replace(/Electron\/\S+\s*/i, ''),
  });
}

app.whenReady().then(() => {
  // 略微伪装：去掉 Electron 标识，减少部分站点对内嵌壳的拦截
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (headers['User-Agent']) {
      headers['User-Agent'] = String(headers['User-Agent']).replace(/\s*Electron\/\S+/gi, '');
    }
    callback({ requestHeaders: headers });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
