import React from 'react';
import ReactDOM from 'react-dom/client';
import { LoginBoot } from './LoginBoot';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

declare global {
  interface Window {
    __TP_BOOT_MARK?: (phase?: string) => void;
    __TP_BOOT_FAIL?: (reason?: string) => void;
    __BW_SEED_DONE?: boolean;
    bwDesktop?: {
      reportBootOk?: () => void;
      openExternal?: (url: string) => void;
      retryBoot?: () => void;
      hardRefresh?: () => void;
      saveBytes?: (payload: {
        filename: string;
        base64: string;
        mime?: string;
      }) => Promise<{ ok?: boolean; canceled?: boolean; filePath?: string; error?: string }>;
    };
  }
}

/** 主 JS 已执行：立刻取消 boot-timeout */
window.__TP_BOOT_MARK?.();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** 桌面种子最多等 50ms，超时也立刻挂登录，绝不卡在启动壳 */
const waitDesktopSeed = (): Promise<void> => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (!/TradeCollabClient\/|BabyWorldClient\//i.test(ua)) return Promise.resolve();
  if (window.__BW_SEED_DONE) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    window.addEventListener('bw-seed-done', done, { once: true });
    window.setTimeout(done, 50);
  });
};

let mounted = false;
const mountApp = () => {
  if (mounted) return;
  mounted = true;
  try {
    sessionStorage.removeItem('tp_boot_reload_v1');
  } catch {
    /* ignore */
  }
  window.__TP_BOOT_MARK?.();
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary label="应用">
          <LoginBoot />
        </ErrorBoundary>
      </React.StrictMode>
    );
    try {
      window.bwDesktop?.reportBootOk?.();
    } catch {
      /* ignore */
    }
  } catch (e) {
    mounted = false;
    console.error('[boot] mount failed', e);
    window.__TP_BOOT_FAIL?.('mount-failed');
  }
};

// 尽快挂载；种子最多短等，超时也进登录
void waitDesktopSeed().then(mountApp).catch(() => mountApp());
