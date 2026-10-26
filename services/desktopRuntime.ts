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

/** 桌面端默认自动续跑未完成背调队列（可设 localStorage trade_scout_auto_resume_batch=0 关闭） */
export const shouldAutoResumeBatch = (): boolean => {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (localStorage.getItem('trade_scout_auto_resume_batch') === '0') return false;
    if (localStorage.getItem('trade_scout_auto_resume_batch') === '1') return true;
    return isDesktopClient();
  } catch {
    return false;
  }
};
