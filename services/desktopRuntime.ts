/** 是否运行在外贸智慧协同桌面客户端内 */
export const isDesktopClient = (): boolean => {
  try {
    if (typeof navigator !== 'undefined' && /TradeCollabClient\/|BabyWorldClient\//i.test(navigator.userAgent)) {
      return true;
    }
    if (typeof localStorage !== 'undefined' && localStorage.getItem('trade_scout_desktop_client') === '1') {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
};

/** 仅挂机模式（或显式 LS=1）自动续跑背调；个人本机默认不抢队列 */
export const shouldAutoResumeBatch = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem('trade_scout_auto_resume_batch') === '0') return false;
    if (localStorage.getItem('trade_scout_auto_resume_batch') === '1') return true;
    try {
      const { isWorkerModeActive } = require('./workerMode') as typeof import('./workerMode');
      if (isWorkerModeActive()) return true;
    } catch {
      /* ignore */
    }
    // 兼容旧桌面：无挂机开关时仍可自动续跑
    return isDesktopClient() && localStorage.getItem('trade_scout_worker_mode') !== '0';
  } catch {
    return false;
  }
};
