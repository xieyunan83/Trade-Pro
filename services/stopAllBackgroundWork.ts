/**
 * 一键停掉本机所有后台泵/队列，避免「停不了 / 登录又复活」。
 * 不改业务数据，只清任务态。
 */
import { abortAndClearDesignSignalQueue } from './designSignalQueue';
import { abortAndClearEnrichmentQueue } from './analysisEnrichmentQueue';
import { abortAndClearProductDigQueue } from './productDigQueue';
import { abortAndClearDmEmailSearchQueue } from './dmEmailSearchQueue';
import { abortAndClearNightUpgrade, stopNightSilentUpgrade } from './nightSilentUpgrade';

export const stopAllBackgroundWork = (opts?: { keepNightEnabled?: boolean }) => {
  const run = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.warn(`[stopAll] ${label}`, e);
    }
  };
  run('designSignal', abortAndClearDesignSignalQueue);
  run('enrichment', abortAndClearEnrichmentQueue);
  run('productDig', abortAndClearProductDigQueue);
  run('dmEmail', abortAndClearDmEmailSearchQueue);
  if (opts?.keepNightEnabled) {
    run('nightStop', stopNightSilentUpgrade);
  } else {
    run('nightAbort', abortAndClearNightUpgrade);
  }
};
