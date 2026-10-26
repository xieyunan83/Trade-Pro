/**
 * 外贸智慧协同桌面壳：无地址栏，加载 https://babyworld.ltd
 * 安装包内加密种子在首次打开时写入 localStorage（换电脑也能登录/带配置）。
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');
const { injectSeedIntoPage } = require('./lib/injectSeed');

const APP_ORIGIN = 'https://babyworld.ltd';
const START_URL = `${APP_ORIGIN}/`;

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
    title: '外贸智慧协同',
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

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
    if (isAppUrl(url)) return { action: 'allow' };
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle('外贸智慧协同');
  });

  // 尽早注入种子，赶在业务脚本读 localStorage 之前
  mainWindow.webContents.on('dom-ready', () => {
    void injectSeedIntoPage(mainWindow.webContents).catch((e) =>
      console.error('[seed] inject failed', e)
    );
  });

  const baseUa = mainWindow.webContents.getUserAgent().replace(/Electron\/\S+\s*/i, '');
  mainWindow.loadURL(START_URL, {
    userAgent: `${baseUa} TradeCollabClient/1.0`,
  });
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (headers['User-Agent']) {
      headers['User-Agent'] = String(headers['User-Agent'])
        .replace(/\s*Electron\/\S+/gi, '')
        .replace(/\s*BabyWorldClient\/\S+/gi, '')
        .replace(/\s*TradeCollabClient\/\S+/gi, '');
      if (!/TradeCollabClient\//.test(headers['User-Agent'])) {
        headers['User-Agent'] = `${headers['User-Agent']} TradeCollabClient/1.0`;
      }
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
