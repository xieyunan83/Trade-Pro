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
  try {
    // 跨标签 / 同机其它页共享冷却，减轻惊群
    void import('./loadGovernor').then((m) => m.publishSharedCooldown(until));
  } catch {
    /* ignore */
  }
};

export const isRateLimitError = (err: unknown): boolean => {
  const msg = String((err as any)?.message || err || '');
  return /429|rate\s*limit|quota exceeded|too many requests|请求过于频繁|Throttl/i.test(msg);
};

/** 批量背调可重试：限流 + 超时 + 网络抖动 + 模型偶发坏 JSON */
export const isTransientAnalysisError = (err: unknown): boolean => {
  if (isRateLimitError(err)) return true;
  const msg = String((err as any)?.message || err || '');
  return /timeout|超时|Failed to fetch|NetworkError|network|ECONNRESET|ENOTFOUND|HTTP 500|500:|502|503|504|546|aborted|AbortError|未返回有效 JSON|Structure mismatch|Empty response|空响应|CONNECTION_FAILED|Connection Failed|qwen proxy crashed|资源不足|FUNCTION_INVOCATION|model_not_found|ModelNotFound|不支持该模型|模型不存在/i.test(
    msg
  );
};

export const shortErrorMessage = (err: unknown, max = 180): string => {
  let msg = String((err as any)?.message || err || '未知错误').replace(/\s+/g, ' ').trim();
  if (/model_not_found|ModelNotFound|不支持该模型|模型不存在|qwen3\.8-max/i.test(msg)) {
    msg = `模型不可用（请确认 Token Plan 已开通对应型号；夜间若自动切到 qwen3.8-flash 失败应已回退 qwen3.7-plus）：${msg}`;
  }
  return msg.length > max ? `${msg.slice(0, max)}…` : msg;
};

/** 若在冷却中则等待到解锁（带轻微抖动，避免惊群） */
export const waitForApiCooldown = async (shouldStop?: () => boolean): Promise<void> => {
  const sharedUntil = (): number => {
    try {
      // 同步读，避免循环 import 初始化问题
      if (typeof localStorage === 'undefined') return 0;
      return Number(localStorage.getItem('trade_scout_shared_cooldown_until') || 0) || 0;
    } catch {
      return 0;
    }
  };
  while (true) {
    const until = Math.max(cooldownUntil, sharedUntil());
    if (Date.now() >= until) break;
    if (until > cooldownUntil) cooldownUntil = until;
    if (shouldStop?.()) return;
    notify();
    const rem = until - Date.now();
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
    /** 默认仅重试限流；批量背调可开 transient 覆盖超时/网络/坏 JSON */
    retryTransient?: boolean;
  } = {}
): Promise<T> => {
  const maxAttempts = opts.maxAttempts ?? 4;
  const baseWaitSec = opts.baseWaitSec ?? 45;
  const retryTransient = opts.retryTransient === true;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.shouldStop?.()) throw lastErr || new Error('已停止');
    await waitForApiCooldown(opts.shouldStop);
    if (opts.shouldStop?.()) throw lastErr || new Error('已停止');

    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = retryTransient ? isTransientAnalysisError(e) : isRateLimitError(e);
      if (!retryable || attempt >= maxAttempts) throw e;
      const waitSec = isRateLimitError(e)
        ? Math.min(baseWaitSec * attempt, 180)
        : Math.min(8 * attempt, 40);
      console.warn(
        `[rateLimit] attempt ${attempt}/${maxAttempts} transient, wait ${waitSec}s`,
        shortErrorMessage(e, 80)
      );
      if (isRateLimitError(e)) noteRateLimited(waitSec);
      opts.onCooldown?.(waitSec);
      if (isRateLimitError(e)) await waitForApiCooldown(opts.shouldStop);
      else await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastErr;
};
