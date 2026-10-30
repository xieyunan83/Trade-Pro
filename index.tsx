import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

declare global {
  interface Window {
    __TP_BOOT_MARK?: (phase?: string) => void;
    __TP_BOOT_FAIL?: (reason?: string) => void;
    __BW_SEED_DONE?: boolean;
    bwDesktop?: { reportBootOk?: () => void; openExternal?: (url: string) => void };
  }
}

/** 主 JS 已执行：取消 boot-timeout 误杀，避免慢网/客户端种子等待被当成卡死 */
window.__TP_BOOT_MARK?.('正在启动应用…');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** 桌面客户端：尽量等种子，但绝不为等种子挡住登录首屏 */
const waitDesktopSeed = (): Promise<void> => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (!/TradeCollabClient\/|BabyWorldClient\//i.test(ua)) return Promise.resolve();
  if (window.__BW_SEED_DONE) return Promise.resolve();
  window.__TP_BOOT_MARK?.('正在同步桌面配置…');
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    window.addEventListener('bw-seed-done', done, { once: true });
    // 首屏优先：最多等 300ms，超时照样挂载登录页
    window.setTimeout(done, 300);
  });
};

const mountApp = () => {
  try {
    sessionStorage.removeItem('tp_boot_reload_v1');
  } catch {
    /* ignore */
  }
  window.__TP_BOOT_MARK?.('正在渲染界面…');
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary label="应用">
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
    try {
      window.bwDesktop?.reportBootOk?.();
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.error('[boot] mount failed', e);
    window.__TP_BOOT_FAIL?.('mount-failed');
  }
};

void waitDesktopSeed().then(mountApp).catch(() => mountApp());
