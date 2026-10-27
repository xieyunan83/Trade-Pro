import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

declare global {
  interface Window {
    __TP_BOOT_MARK?: (phase?: string) => void;
    __BW_SEED_DONE?: boolean;
  }
}

/** 主 JS 已执行：取消 boot-timeout 误杀，避免慢网/客户端种子等待被当成卡死 */
window.__TP_BOOT_MARK?.('正在启动应用…');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** 桌面客户端：等安装包种子写入 localStorage 后再挂载，避免空账号抢先登录 */
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
    // 种子应很快写入；过长等待只会让用户以为卡死
    window.setTimeout(done, 800);
  });
};

void waitDesktopSeed().then(() => {
  try {
    sessionStorage.removeItem('tp_boot_reload_v1');
  } catch {
    /* ignore */
  }
  window.__TP_BOOT_MARK?.('正在渲染界面…');
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary label="应用">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
