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

/**
 * 是否自动续跑背调队列。
 * 仅：显式 LS=1，或已确认开启的挂机模式。
 * 个人账号 / 未开挂机默认 false，避免进营销工具就抢跑卡死。
 */
export const shouldAutoResumeBatch = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem('trade_scout_auto_resume_batch') === '0') return false;
    if (localStorage.getItem('trade_scout_auto_resume_batch') === '1') return true;
    try {
      const { isWorkerModeActive } = require('./workerMode') as typeof import('./workerMode');
      return isWorkerModeActive();
    } catch {
      return false;
    }
  } catch {
    return false;
  }
};
