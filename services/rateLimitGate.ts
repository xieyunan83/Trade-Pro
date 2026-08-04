/**
 * 全局 API 限流门闩：并行任务共用冷却，避免 60s 倒计时结束后集体冲刺再次 429。
 */

type CooldownListener = (remainingSec: number) => void;

let cooldownUntil = 0;
const listeners = new Set<CooldownListener>();

const notify = () => {
  const rem = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  listeners.forEach((fn) => {
    try {
      fn(rem);
    } catch {
      /* ignore */
    }
  });
};

export const subscribeCooldown = (fn: CooldownListener): (() => void) => {
  listeners.add(fn);
  fn(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
  return () => listeners.delete(fn);
};

export const getCooldownRemainingSec = (): number =>
  Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));

/** 记录上游限流；多次叠加时取更晚的解锁时间 */
export const noteRateLimited = (retryAfterSec = 60) => {
  const sec = Math.min(Math.max(Math.floor(retryAfterSec) || 60, 15), 300);
  const until = Date.now() + sec * 1000;
  if (until > cooldownUntil) cooldownUntil = until;
  notify();
};

export const isRateLimitError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /429|rate\s*limit|quota exceeded|too many requests|请求过于频繁|Throttl/i.test(msg);
};

/** 若在冷却中则等待到解锁（带轻微抖动，避免惊群） */
export const waitForApiCooldown = async (shouldStop?: () => boolean): Promise<void> => {
  while (Date.now() < cooldownUntil) {
    if (shouldStop?.()) return;
    notify();
    const rem = cooldownUntil - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(200, rem))));
  }
  notify();
  // 解锁后错开 0–800ms，降低并行重试撞车
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 800)));
};

/**
 * 包装一次 API 调用：遇限流则退避重试。
 * @returns 结果；若 shouldStop 则抛出原错误或中止
 */
export const withRateLimitRetry = async <T,>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    shouldStop?: () => boolean;
    baseWaitSec?: number;
    onCooldown?: (sec: number) => void;
  } = {}
): Promise<T> => {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseWaitSec = opts.baseWaitSec ?? 45;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.shouldStop?.()) throw lastErr || new Error('已停止');
    await waitForApiCooldown(opts.shouldStop);
    if (opts.shouldStop?.()) throw lastErr || new Error('已停止');

    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e) || attempt >= maxAttempts) throw e;
      const waitSec = Math.min(baseWaitSec * attempt, 180);
      console.warn(`[rateLimit] attempt ${attempt}/${maxAttempts} hit limit, wait ${waitSec}s`);
      noteRateLimited(waitSec);
      opts.onCooldown?.(waitSec);
      await waitForApiCooldown(opts.shouldStop);
    }
  }
  throw lastErr;
};
