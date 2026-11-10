/**
 * 自动后台策略：默认全关。
 * 只有明确开启「挂机执行」后，才允许夜间补全 / 队列泵 / 登录后云同步等自动任务。
 */
import { isWorkerModeActive } from './workerMode';

/** 是否允许自动跑后台（非用户点击触发） */
export const isAutoBackgroundAllowed = (): boolean => {
  try {
    return isWorkerModeActive();
  } catch {
    return false;
  }
};
