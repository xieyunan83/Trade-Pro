import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

/** 桌面客户端：等安装包种子写入 localStorage 后再挂载，避免空账号抢先登录 */
const waitDesktopSeed = (): Promise<void> => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (!/TradeCollabClient\/|BabyWorldClient\//i.test(ua)) return Promise.resolve();
  if ((window as any).__BW_SEED_DONE) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    window.addEventListener('bw-seed-done', done, { once: true });
    window.setTimeout(done, 2500);
  });
};

void waitDesktopSeed().then(() => {
  try {
    sessionStorage.removeItem('tp_boot_reload_v1');
  } catch {
    /* ignore */
  }
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary label="应用">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
});
