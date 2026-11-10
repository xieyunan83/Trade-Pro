/**
 * 前台交互守护：窗口最小化 / 切到别的 App 再回来时，
 * Chromium 会一口气补跑被节流的定时器与 React 更新，侧栏点击常被饿死。
 * 后台暂停重任务通知；回前台先让导航可点，再短暂延迟恢复泵。
 * 用户正在点选/打字/滚动时同样拉长冷静期，避免登录同步与队列泵饿死操作。
 */

type Listener = (foreground: boolean) => void;

let foreground = typeof document === 'undefined' ? true : document.visibilityState !== 'hidden';
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
/** 回前台 / 用户交互后额外冷静期，期间重任务应让路给点击 */
let calmUntil = 0;
/** 创作模块演示/操作时硬挂起：登录同步、队列泵一律让路 */
let heavySuspended = false;
const listeners = new Set<Listener>();

const emit = () => {
  listeners.forEach((fn) => {
    try {
      fn(foreground);
    } catch {
      /* ignore */
    }
  });
};

const recoverNavPointer = () => {
  if (typeof document === 'undefined') return;
  try {
    document.querySelectorAll<HTMLElement>('[data-tp-nav-dock], .tp-sidebar.tp-sphere-rail').forEach((el) => {
      el.style.pointerEvents = 'auto';
      el.style.zIndex = '9999';
    });
    // 清掉可能残留的全屏挡板（冷却层除外）
    document.body.style.pointerEvents = '';
  } catch {
    /* ignore */
  }
};

const scheduleCalmEnd = () => {
  if (resumeTimer) clearTimeout(resumeTimer);
  if (!Number.isFinite(calmUntil)) return;
  const delay = Math.max(50, calmUntil - Date.now() + 40);
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    if (Date.now() >= calmUntil) {
      calmUntil = 0;
      emit();
    } else if (Number.isFinite(calmUntil)) {
      // 期间又被更长冷静续期了，按剩余时间再挂一次
      scheduleCalmEnd();
    }
  }, delay);
};

export const isAppForeground = (): boolean => foreground;

const isInputPendingNow = (): boolean => {
  try {
    const sched = (
      navigator as Navigator & {
        scheduling?: { isInputPending?: (opts?: { includeContinuous?: boolean }) => boolean };
      }
    ).scheduling;
    if (typeof sched?.isInputPending === 'function') {
      return !!sched.isInputPending({ includeContinuous: true });
    }
  } catch {
    /* ignore */
  }
  return false;
};

/** 重任务泵应在后台、冷静期、创作挂起、或浏览器已积压输入时让路 */
export const shouldDeferHeavyWork = (): boolean => {
  if (heavySuspended) return true;
  if (!foreground) return true;
  if (Date.now() < calmUntil) return true;
  return isInputPendingNow();
};

/** 进入平面/3D/视频等创作页时打开；离开后关闭。演示录屏务必挂起。 */
export const setHeavyWorkSuspended = (suspended: boolean) => {
  if (heavySuspended === suspended) return;
  heavySuspended = suspended;
  if (suspended) {
    calmUntil = Math.max(calmUntil, Date.now() + 60_000);
    recoverNavPointer();
  } else {
    noteUserActivity(2_000);
  }
  emit();
};

export const isHeavyWorkSuspended = (): boolean => heavySuspended;

/**
 * 用户正在操作时调用：只拉长冷静期，不立刻 emit（避免冲刷大列表）。
 * 连续点击会不断续期，直到停手后再恢复后台泵。
 */
export const noteUserActivity = (ms = 3600) => {
  const until = Date.now() + ms;
  calmUntil = Math.max(calmUntil, until);
  recoverNavPointer();
  scheduleCalmEnd();
};

export const subscribeForeground = (fn: Listener): (() => void) => {
  listeners.add(fn);
  try {
    fn(foreground);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
};

export const markAppBackground = () => {
  if (!foreground) return;
  foreground = false;
  calmUntil = Number.POSITIVE_INFINITY;
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  emit();
};

export const markAppForeground = (opts?: { calmMs?: number }) => {
  const calmMs = opts?.calmMs ?? 2200;
  foreground = true;
  calmUntil = Date.now() + calmMs;
  recoverNavPointer();
  // 双 rAF：等一帧布局后再强调可点
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      recoverNavPointer();
      requestAnimationFrame(recoverNavPointer);
    });
  }
  scheduleCalmEnd();
  emit();
};

/** 用户点侧栏时立刻让路：只拉长冷静期，禁止立刻 emit（否则会冲刷积压的大列表） */
export const preferNavInteraction = (ms = 1200) => {
  noteUserActivity(ms);
};

/** 在 App / LoginBoot 挂一次即可 */
export const installForegroundGuard = (): (() => void) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined;
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') markAppBackground();
    else markAppForeground();
  };
  const onPageHide = () => markAppBackground();
  const onPageShow = () => markAppForeground();
  const onBlur = () => {
    // Electron 最小化有时只 blur 不改 visibility
    if (document.visibilityState === 'hidden') markAppBackground();
    else {
      // 失焦但仍可见：短冷静，避免切窗瞬间被泵抢走
      noteUserActivity(800);
    }
  };
  const onFocus = () => markAppForeground({ calmMs: 1600 });
  const onDesktopFocus = () => markAppForeground({ calmMs: 2000 });
  const onDesktopBlur = () => markAppBackground();

  const onActivity = () => noteUserActivity(3600);
  const activityOpts: AddEventListenerOptions = { capture: true, passive: true };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('tp-desktop-focus', onDesktopFocus as EventListener);
  window.addEventListener('tp-desktop-blur', onDesktopBlur as EventListener);
  // 任意操作都让路：登录后一分钟内的云同步 / 队列泵最容易饿死点击
  document.addEventListener('pointerdown', onActivity, activityOpts);
  document.addEventListener('keydown', onActivity, activityOpts);
  document.addEventListener('wheel', onActivity, activityOpts);
  document.addEventListener('touchstart', onActivity, activityOpts);

  // 启动时按当前可见性校正；首屏也给一段冷静，避免刚进站就被同步堵死
  if (document.visibilityState === 'hidden') markAppBackground();
  else {
    recoverNavPointer();
    noteUserActivity(4800);
  }

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('tp-desktop-focus', onDesktopFocus as EventListener);
    window.removeEventListener('tp-desktop-blur', onDesktopBlur as EventListener);
    document.removeEventListener('pointerdown', onActivity, activityOpts);
    document.removeEventListener('keydown', onActivity, activityOpts);
    document.removeEventListener('wheel', onActivity, activityOpts);
    document.removeEventListener('touchstart', onActivity, activityOpts);
    if (resumeTimer) clearTimeout(resumeTimer);
  };
};
