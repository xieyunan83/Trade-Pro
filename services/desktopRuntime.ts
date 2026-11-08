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
 * 是否允许「登录后隐式」自动续跑背调队列。
 * 一律 false：禁止 LS 开关或粘性挂机导致进站即抢跑卡死。
 * 挂机续跑只走 App 里用户点确认后的 kickWorkerTaskResume。
 */
export const shouldAutoResumeBatch = (): boolean => false;
