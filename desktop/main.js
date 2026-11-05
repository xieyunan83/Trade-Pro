/**
 * 外贸智慧协同桌面壳：加载 https://babyworld.ltd（线上升级不强制刷新已打开窗口）。
 * - 账号/配置以云端为准，安装包无需随升级重打
 * - 可选种子仅作首次空机兜底
 * - 禁止后台节流，最小化窗口时批量背调仍继续
 * - 弱网/连不上时展示本地错误页，避免「深蓝空白窗」
 */
const { app, BrowserWindow, shell, Menu, session, dialog, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { injectSeedIntoPage } = require('./lib/injectSeed');

const DEFAULT_ORIGIN = 'https://babyworld.ltd';

/** 允许用环境变量或 resources/app-origin.txt 覆盖（国内镜像等） */
const resolveAppOrigin = () => {
  const fromEnv = String(process.env.TRADE_APP_ORIGIN || process.env.BABYWORLD_ORIGIN || '')
    .trim()
    .replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  try {
    const candidates = [
      path.join(process.resourcesPath || '', 'app-origin.txt'),
      path.join(__dirname, 'resources', 'app-origin.txt'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        const t = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0].trim().replace(/\/$/, '');
        if (/^https?:\/\//i.test(t)) return t;
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ORIGIN;
};

const APP_ORIGIN = resolveAppOrigin();

/** 稳定 URL 走 Chromium 磁盘缓存（冷启动快）；仅上次启动失败才 bust */
const startUrl = (forceBust = false) => {
  if (forceBust) return `${APP_ORIGIN}/?_boot=${Date.now()}`;
  try {
    const failFlagPath = path.join(app.getPath('userData'), 'last-boot-failed');
    if (fs.existsSync(failFlagPath)) return `${APP_ORIGIN}/?_boot=${Date.now()}`;
  } catch {
    /* ignore */
  }
  return `${APP_ORIGIN}/`;
};

const isAppUrl = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'babyworld.ltd' || host.endsWith('.babyworld.ltd')) return true;
    try {
      const allowed = new URL(APP_ORIGIN).hostname.toLowerCase();
      if (host === allowed || host.endsWith(`.${allowed}`)) return true;
    } catch {
      /* ignore */
    }
    return false;
  } catch {
    return false;
  }
};

const bootErrorPath = () => {
  const packaged = path.join(__dirname, 'boot-error.html');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'boot-error.html');
};

let mainWindow = null;
let powerSaveId = null;
let loadWatchdog = null;
let bootOk = false;
let showingError = false;
/** 当前启动尝试次数（弱网自动重试） */
let bootAttempt = 0;
const MAX_BOOT_ATTEMPTS = 3;
/** 首次拉站超时（国内访问海外节点常需更久） */
const BOOT_LOAD_TIMEOUT_MS = 60_000;

const LS_FAIL_FLAG = 'trade_scout_desktop_last_boot_failed';

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
  if (choice === 1) {
    bootOk = false;
    showingError = false;
    mainWindow.loadURL(startUrl()).catch(() => showBootError('reload-failed'));
  }
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
            if (choice === 1) {
              bootOk = false;
              showingError = false;
              void session.defaultSession.clearCache().finally(() => {
                if (!mainWindow || mainWindow.isDestroyed()) return;
                mainWindow.webContents.reloadIgnoringCache();
              });
            }
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged
          ? [{ type: 'separator' }, { role: 'toggleDevTools' }]
          : [
              {
                label: '诊断工具',
                accelerator: 'CmdOrCtrl+Shift+I',
                click: () => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.openDevTools({ mode: 'detach' });
                  }
                },
              },
            ]),
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

function clearLoadWatchdog() {
  if (loadWatchdog) {
    clearTimeout(loadWatchdog);
    loadWatchdog = null;
  }
}

function armLoadWatchdog(ms = BOOT_LOAD_TIMEOUT_MS) {
  clearLoadWatchdog();
  loadWatchdog = setTimeout(() => {
    if (bootOk || showingError) return;
    if (bootAttempt < MAX_BOOT_ATTEMPTS) {
      console.warn('[boot] load timeout, retry', bootAttempt + 1);
      void loadAppShell({ retry: true });
      return;
    }
    showBootError('timeout', '加载超时：网络过慢或无法访问线上站点');
  }, ms);
}

function showBootError(reason, errMsg = '') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (showingError) return;
  showingError = true;
  clearLoadWatchdog();
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'last-boot-failed'), String(Date.now()));
  } catch {
    /* ignore */
  }
  try {
    mainWindow.webContents
      .executeJavaScript(
        `try{localStorage.setItem(${JSON.stringify(LS_FAIL_FLAG)},'1');}catch(e){}`,
        true
      )
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
  const q = new URLSearchParams({
    origin: APP_ORIGIN,
    reason: String(reason || 'network'),
    err: String(errMsg || '').slice(0, 180),
  });
  const file = bootErrorPath();
  void mainWindow
    .loadFile(file, { query: Object.fromEntries(q) })
    .catch(() => {
      const html = encodeURIComponent(
        `<!DOCTYPE html><meta charset="utf-8"/><title>无法连接</title>
         <body style="margin:0;background:#070b14;color:#e2e8f0;font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;text-align:center">
         <h1 style="margin:0;font-size:18px">无法打开登录界面</h1>
         <p style="color:#94a3b8;max-width:400px;line-height:1.5">请检查网络后重开客户端，或在浏览器打开 ${APP_ORIGIN}</p>
         <p style="font-size:11px;color:#64748b">${reason}: ${errMsg}</p></body>`
      );
      void mainWindow.loadURL(`data:text/html;charset=utf-8,${html}`);
    });
  if (!mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

/**
 * 直接拉线上站点，不再插「正在打开登录界面」过渡页（该页反而拉长感知等待）。
 * 窗口底色与登录页一致；HTML 到达后由站点内启动壳承接。
 * @param {{ retry?: boolean, forceBust?: boolean }} [opts]
 */
function loadAppShell(opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  bootOk = false;
  showingError = false;
  if (opts.retry) bootAttempt += 1;
  else bootAttempt = 1;

  const attempt = bootAttempt;
  armLoadWatchdog(BOOT_LOAD_TIMEOUT_MS);
  const baseUa = mainWindow.webContents.getUserAgent().replace(/Electron\/\S+\s*/i, '');
  // 仅明确要求或上次启动失败才 bust；自动重试尽量走磁盘缓存，国内弱网更快
  const forceBust = !!opts.forceBust && attempt === 1;
  mainWindow
    .loadURL(startUrl(forceBust), {
      userAgent: `${baseUa} TradeCollabClient/1.0 BabyWorldClient/1.0`,
    })
    .catch((e) => {
      if (bootAttempt < MAX_BOOT_ATTEMPTS) {
        void loadAppShell({ retry: true, forceBust: false });
      } else {
        showBootError('loadURL', e?.message || String(e));
      }
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: '外贸智慧协同',
    // 与登录页 .tp-login 底色一致；避免网页未绘制时出现「假死深蓝空窗」
    backgroundColor: '#070b14',
    show: false,
    // 默认最大化占满工作区（比排他全屏启动更快，仍可菜单切换全屏）
    fullscreenable: true,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // 最小化/失焦时也不降速，保证 Windows 背调工作站可持续跑队列
      backgroundThrottling: false,
      v8CacheOptions: 'code',
      enableBlinkFeatures: 'CSSBackdropFilter',
      // 打包后仍允许诊断（菜单打开），便于排查白屏
      devTools: true,
    },
  });

  buildMenu();

  // 尽快露脸：最大化占满屏，避免排他全屏切换卡顿
  const showSoon = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    try {
      if (!mainWindow.isMaximized()) mainWindow.maximize();
    } catch (e) {
      console.warn('[window] maximize failed', e);
    }
    mainWindow.show();
    mainWindow.focus();
  };
  // 尽快露窗：底色已对齐登录页，不再等过渡页
  mainWindow.once('ready-to-show', showSoon);
  setTimeout(showSoon, 80);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || url.startsWith('data:')) return;
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    // -3 = aborted（被新导航取消）
    if (code === -3) return;
    if (showingError && url && url.includes('boot-error')) return;
    // 弱网：自动重试，用尽次数再出错误页
    if (bootAttempt < MAX_BOOT_ATTEMPTS && !showingError) {
      console.warn('[boot] did-fail-load retry', code, desc);
      clearLoadWatchdog();
      void loadAppShell({ retry: true, forceBust: true });
      return;
    }
    showBootError(`fail:${code}`, desc || url || '');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    if (url.includes('boot-error') || url.startsWith('data:') || url.startsWith('file:')) {
      return;
    }
    if (!isAppUrl(url)) return;
    // 主文档已到即可视为登录壳可用（不必等 React reportBootOk，弱网下 JS 很慢会误报超时）
    showingError = false;
    bootOk = true;
    clearLoadWatchdog();
    try {
      const failFlagPath = path.join(app.getPath('userData'), 'last-boot-failed');
      if (fs.existsSync(failFlagPath)) fs.unlinkSync(failFlagPath);
    } catch {
      /* ignore */
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    showBootError('render-gone', details?.reason || '');
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

  loadAppShell();
}

ipcMain.on('bw-open-external', (_e, url) => {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u)) shell.openExternal(u).catch(() => {});
});

ipcMain.on('bw-boot-ok', () => {
  bootOk = true;
  showingError = false;
  clearLoadWatchdog();
  try {
    const failFlagPath = path.join(app.getPath('userData'), 'last-boot-failed');
    if (fs.existsSync(failFlagPath)) fs.unlinkSync(failFlagPath);
  } catch {
    /* ignore */
  }
});

ipcMain.on('bw-boot-retry', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showingError = false;
  bootOk = false;
  bootAttempt = 0;
  clearLoadWatchdog();
  void loadAppShell({ forceBust: true });
});

/**
 * 桌面端另存为：渲染进程把 blob→base64 传来，弹出系统保存对话框写入磁盘。
 * 解决 Windows 上 <a download> / blob URL 经常无反应的问题。不碰网页 IndexedDB 素材库。
 */
ipcMain.handle('bw-save-bytes', async (event, payload) => {
  try {
    const filename = String(payload?.filename || 'download.bin')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, 180);
    const base64 = String(payload?.base64 || '');
    if (!base64) return { ok: false, error: 'empty' };
    // 防误传超大文件撑爆 IPC（约 40MB 原始）
    if (base64.length > 56_000_000) return { ok: false, error: 'too-large' };

    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const defaultDir = app.getPath('downloads');
    const { canceled, filePath } = await dialog.showSaveDialog(win || undefined, {
      title: '保存文件',
      defaultPath: path.join(defaultDir, filename),
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: '视频', extensions: ['mp4', 'webm'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const buf = Buffer.from(base64, 'base64');
    await fs.promises.writeFile(filePath, buf);
    return { ok: true, filePath };
  } catch (e) {
    console.warn('[bw-save-bytes] failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
});

// 启动/交互性能：GPU 光栅化 + 禁止后台节流（须在 ready 前）
try {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
} catch {
  /* ignore */
}

app.whenReady().then(async () => {
  // Windows 工作站休眠/锁屏时杀网络会导致批量背调大面积 FAILED
  try {
    powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) {
    console.warn('[power] prevent-app-suspension failed', e);
  }
  // 显示防休眠会拖慢部分机器；仅 Windows 挂机场景需要
  if (process.platform === 'win32') {
    try {
      powerSaveBlocker.start('prevent-display-sleep');
    } catch (e) {
      console.warn('[power] prevent-display-sleep failed', e);
    }
  }

  const ses = session.defaultSession;

  // 兜底：任何触发的浏览器下载都落到「下载」目录，并给出完成提示
  ses.on('will-download', (_event, item) => {
    try {
      const name = item.getFilename() || `download-${Date.now()}`;
      const dest = path.join(app.getPath('downloads'), name);
      item.setSavePath(dest);
      item.once('done', (_e, state) => {
        if (state === 'completed') {
          console.log('[download] saved', dest);
        } else {
          console.warn('[download] ended', state, name);
        }
      });
    } catch (e) {
      console.warn('[download] will-download hook failed', e);
    }
  });

  /**
   * 不再每次启动都 clearCache：弱网下会逼着重下整站 → 长时间深蓝空白。
   * 仅当上次启动失败标记存在，或手动「强制刷新」时清理。
   */
  try {
    const failFlagPath = path.join(app.getPath('userData'), 'last-boot-failed');
    if (fs.existsSync(failFlagPath)) {
      await ses.clearCache().catch((e) => console.warn('[cache] clearCache failed', e));
      try {
        fs.unlinkSync(failFlagPath);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn('[cache] conditional clear skipped', e);
  }

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
