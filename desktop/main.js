/**
 * 外贸智慧协同桌面壳：加载 https://babyworld.ltd（线上升级不强制刷新已打开窗口）。
 * - 账号/配置以云端为准，安装包无需随升级重打
 * - 可选种子仅作首次空机兜底
 * - 禁止后台节流，最小化窗口时批量背调仍继续
 */
const { app, BrowserWindow, shell, Menu, session, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const { injectSeedIntoPage } = require('./lib/injectSeed');

const APP_ORIGIN = 'https://babyworld.ltd';
/** 每次启动带时间戳，避免发版后仍用旧 HTML 指向已删除的 JS（白屏） */
const START_URL = `${APP_ORIGIN}/?_boot=${Date.now()}`;

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
let powerSaveId = null;

const confirmReload = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['取消', '仍然刷新'],
    defaultId: 0,
    cancelId: 0,
    title: '确认刷新',
    message: '刷新会中断正在进行的批量背调。',
    detail:
      'GitHub/线上升级不会自动刷新本窗口。请保持本窗口打开，背调即可继续。仅在需要立即加载新版本时再刷新。',
  });
  if (choice === 1) mainWindow.webContents.reload();
};

function buildMenu() {
  const reloadItem = {
    label: '刷新页面（会中断背调）…',
    accelerator: 'CmdOrCtrl+R',
    click: () => confirmReload(),
  };
  const template = [
    ...(process.platform === 'darwin'
      ? [
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
        ]
      : []),
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
      label: '查看',
      submenu: [
        reloadItem,
        {
          label: '强制刷新（清缓存，会中断背调）…',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const choice = dialog.showMessageBoxSync(mainWindow, {
              type: 'warning',
              buttons: ['取消', '强制刷新'],
              defaultId: 0,
              cancelId: 0,
              title: '强制刷新',
              message: '将清空缓存并重新加载，批量背调会停止。确定吗？',
            });
            if (choice === 1) mainWindow.webContents.reloadIgnoringCache();
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '外贸智慧协同',
    backgroundColor: '#0f172a',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // 最小化/失焦时也不降速，保证 Windows 背调工作站可持续跑队列
      backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });

  buildMenu();

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

  // 拦截 F5（菜单已接管 Cmd/Ctrl+R）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') {
      event.preventDefault();
      confirmReload();
    }
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle('外贸智慧协同');
  });

  mainWindow.on('close', (e) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['取消', '退出'],
      defaultId: 0,
      cancelId: 0,
      title: '退出客户端',
      message: '确定退出「外贸智慧协同」？',
      detail: '若正在批量背调，退出后本机队列会暂停，需重新打开并登录后才会继续。',
    });
    if (choice !== 1) e.preventDefault();
  });

  mainWindow.webContents.on('dom-ready', () => {
    void injectSeedIntoPage(mainWindow.webContents).catch((err) =>
      console.error('[seed] inject failed', err)
    );
    // 标记桌面工作站，供网页侧自动续跑背调等逻辑
    void mainWindow.webContents
      .executeJavaScript(
        `try{localStorage.setItem('trade_scout_desktop_client','1');localStorage.setItem('trade_scout_auto_resume_batch','1');}catch(e){}`,
        true
      )
      .catch(() => undefined);
  });

  const baseUa = mainWindow.webContents.getUserAgent().replace(/Electron\/\S+\s*/i, '');
  mainWindow.loadURL(START_URL, {
    userAgent: `${baseUa} TradeCollabClient/1.0 BabyWorldClient/1.0`,
  });
}

app.whenReady().then(() => {
  // Windows 工作站休眠/锁屏时杀网络会导致批量背调大面积 FAILED
  try {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) {
    console.warn('[power] prevent-app-suspension failed', e);
  }
  try {
    powerSaveBlocker.start('prevent-display-sleep');
  } catch (e) {
    console.warn('[power] prevent-display-sleep failed', e);
  }

  const ses = session.defaultSession;
  // 发版后旧缓存 HTML 会指向已删除的 hashed JS → 白屏；启动时清 HTTP 缓存
  void ses.clearCache().catch((e) => console.warn('[cache] clearCache failed', e));
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (headers['User-Agent']) {
      let ua = String(headers['User-Agent'])
        .replace(/\s*Electron\/\S+/gi, '')
        .replace(/\s*BabyWorldClient\/\S+/gi, '')
        .replace(/\s*TradeCollabClient\/\S+/gi, '');
      ua = `${ua} TradeCollabClient/1.0 BabyWorldClient/1.0`;
      headers['User-Agent'] = ua;
    }
    callback({ requestHeaders: headers });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (powerSaveId != null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId);
    powerSaveId = null;
  }
  if (process.platform !== 'darwin') app.quit();
});
