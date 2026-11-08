/**
 * 挂机执行模式：专供 admin 在本机进入业务页后「本次会话」确认开启。
 * - 夜间（22:00–08:00）：全量背调 + 重补全
 * - 白天：仅轻量补全
 *
 * 重要：挂机状态只活在 sessionStorage。禁止用 localStorage 跨登录继承，
 * 否则一进系统就自动开泵，用户「什么都没点」也会卡死。
 */
import { getUsablePoolKeys, listPoolKeys } from './apiKeyPool';
import { isQwenNightPromoWindow } from './qwenModelSchedule';

const LS_WORKER_LEGACY = 'trade_scout_worker_mode';
const SS_WORKER = 'trade_scout_worker_mode_session';
const SS_PROMPTED = 'trade_scout_worker_prompt_session';

export type WorkerModeStatus = {
  active: boolean;
  inNightWindow: boolean;
  qwenKeyCount: number;
  parallelSlots: number;
};

const listeners = new Set<(s: WorkerModeStatus) => void>();

/** 清掉历史「跨登录粘性挂机」，避免旧客户端一启动就跑队列 */
const scrubLegacyStickyWorker = () => {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(LS_WORKER_LEGACY) === '1') {
      localStorage.setItem(LS_WORKER_LEGACY, '0');
    }
  } catch {
    /* ignore */
  }
};

const readActive = (): boolean => {
  try {
    scrubLegacyStickyWorker();
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SS_WORKER) === '1';
  } catch {
    return false;
  }
};

export const getWorkerModeStatus = (): WorkerModeStatus => {
  const keys = getUsablePoolKeys('qwen');
  const n = keys.length || listPoolKeys('qwen').length;
  const active = readActive();
  const parallelSlots = active ? Math.min(2, Math.max(1, n || 1)) : 1;
  return {
    active,
    inNightWindow: isQwenNightPromoWindow(),
    qwenKeyCount: n,
    parallelSlots,
  };
};

const notify = () => {
  const snap = getWorkerModeStatus();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  });
};

export const subscribeWorkerMode = (fn: (s: WorkerModeStatus) => void): (() => void) => {
  listeners.add(fn);
  try {
    fn(getWorkerModeStatus());
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
};

export const isWorkerModeActive = (): boolean => readActive();

export const setWorkerModeActive = (active: boolean) => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SS_WORKER, active ? '1' : '0');
    }
    // 永久关掉旧粘性开关
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_WORKER_LEGACY, '0');
    }
  } catch {
    /* ignore */
  }
  notify();
};

/** 本会话是否已回答过挂机提示（避免进业务页反复弹） */
export const hasAnsweredWorkerPromptThisSession = (): boolean => {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SS_PROMPTED) === '1';
  } catch {
    return false;
  }
};

export const markWorkerPromptAnswered = () => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SS_PROMPTED, '1');
    }
  } catch {
    /* ignore */
  }
};

/** 挂机模式下：全量背调是否应在此刻执行（仅夜间优惠窗） */
export const shouldWorkerRunHeavyAnalysisNow = (): boolean => {
  if (!isWorkerModeActive()) return true; // 非挂机：沿用原手动/队列逻辑
  return isQwenNightPromoWindow();
};

/** 根据 Key 数量给出并行路数（最多 2，与双 Key 粘滞对齐） */
export const resolveWorkerParallelSlots = (): number => getWorkerModeStatus().parallelSlots;

export const describeWorkerSchedule = (): string => {
  const s = getWorkerModeStatus();
  if (!s.active) return '挂机未开启';
  if (s.inNightWindow) {
    return `挂机·夜间：背调并行×${s.parallelSlots}（Key ${s.qwenKeyCount}）+ 重补全`;
  }
  return `挂机·白天：轻量补全（品类匹配/邮箱入队）；背调待 22:00 后`;
};
