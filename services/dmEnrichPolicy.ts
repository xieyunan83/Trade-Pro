/**
 * Phase B：库内优先 + 异步补全策略
 * - 打开报告先用已存 contacts，不立刻联网扫人
 * - 仅当缺邮箱或置信度低时，才建议入队后台补邮箱
 */
import type { DecisionMaker } from '../types';
import { normalizeEmail, fieldConfidencePercent } from './personIdentity';

const asStr = (v: unknown) => (v == null ? '' : String(v).trim());

/** 邮箱字段强度：已验证 > 风险 > 未验证 > 无效/无 */
export const emailFieldStrength = (dm: DecisionMaker | null | undefined): number => {
  if (!dm) return 0;
  const email = normalizeEmail(dm.emailGuess);
  if (!email) return 0;
  const status = asStr(dm.emailStatus).toLowerCase();
  const conf = typeof dm.confidence === 'number' ? dm.confidence : fieldConfidencePercent(dm, 'email');
  const confN = typeof conf === 'number' ? (conf > 1 ? conf / 100 : conf) : 0.4;
  if (dm.isVerified || status === 'valid') return 100 + confN * 10;
  if (status === 'risky') return 55 + confN * 10;
  if (status === 'invalid' || status === 'not_found') return 12 + confN * 5;
  return 35 + confN * 10;
};

/** 合并时择优邮箱相关字段：禁止未验证覆盖已验证 */
export const pickStrongerEmailFields = (
  prev: DecisionMaker,
  incoming: DecisionMaker
): Pick<
  DecisionMaker,
  'emailGuess' | 'emailSource' | 'emailStatus' | 'isVerified' | 'confidence'
> => {
  const sp = emailFieldStrength(prev);
  const si = emailFieldStrength(incoming);
  const winner = si > sp ? incoming : prev;
  const loser = si > sp ? prev : incoming;
  const email =
    normalizeEmail(winner.emailGuess) ||
    normalizeEmail(loser.emailGuess) ||
    asStr(winner.emailGuess) ||
    asStr(loser.emailGuess) ||
    undefined;

  // 任一侧已验证且邮箱相同 → 保持已验证；不同邮箱则跟 winner
  const sameEmail =
    !!normalizeEmail(prev.emailGuess) &&
    normalizeEmail(prev.emailGuess) === normalizeEmail(incoming.emailGuess);
  const isVerified = sameEmail
    ? !!(prev.isVerified || incoming.isVerified)
    : emailFieldStrength(winner) >= 100
      ? true
      : !!(winner.isVerified && normalizeEmail(winner.emailGuess) === normalizeEmail(email));

  const confidence = Math.max(Number(prev.confidence) || 0, Number(incoming.confidence) || 0) ||
    winner.confidence ||
    loser.confidence;

  return {
    emailGuess: email,
    emailSource: winner.emailSource || loser.emailSource,
    emailStatus: (isVerified ? winner.emailStatus || 'valid' : winner.emailStatus || loser.emailStatus) as
      | DecisionMaker['emailStatus'],
    isVerified: isVerified || (emailFieldStrength(winner) >= 100),
    confidence: confidence || undefined,
  };
};

const hasSearchHandle = (dm: DecisionMaker): boolean => {
  const name = asStr(dm.name);
  if (name && name !== '公开信息未找到' && name !== '手动联系人') return true;
  if (asStr(dm.firstName) || asStr(dm.lastName)) return true;
  if (asStr(dm.linkedin)) return true;
  return false;
};

/** 单人是否需要异步补邮箱 */
export const needsAsyncEmailEnrichment = (dm: DecisionMaker): boolean => {
  if (!hasSearchHandle(dm)) return false;
  const email = normalizeEmail(dm.emailGuess);
  const status = asStr(dm.emailStatus).toLowerCase();
  if (email && (dm.isVerified || status === 'valid')) return false;
  if (email) {
    const pct = fieldConfidencePercent(dm, 'email');
    if (typeof pct === 'number' && pct >= 75 && status !== 'risky' && status !== 'invalid') {
      return false;
    }
    if (status === 'invalid' || status === 'not_found' || status === 'risky') return true;
    if (typeof dm.confidence === 'number' && dm.confidence < 0.5) return true;
    if (status === 'unverified' || !status) return true;
    return !dm.isVerified;
  }
  return true;
};

/** 默认打开后 2 小时内不重复自动入队 */
export const DEFAULT_DM_FILL_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/**
 * 公司维度：库内已有联系人，且存在缺邮/低置信 → 需要异步补全。
 * 库内完全无人时不自动联网扫人（避免打开就烧积分）。
 */
export const companyNeedsAsyncDmFill = (
  dms: DecisionMaker[] | null | undefined,
  opts?: { lastSearchAt?: number | null; cooldownMs?: number; now?: number }
): boolean => {
  const list = dms || [];
  if (!list.length) return false;
  const now = opts?.now ?? Date.now();
  const cooldown = opts?.cooldownMs ?? DEFAULT_DM_FILL_COOLDOWN_MS;
  const last = opts?.lastSearchAt || 0;
  if (last > 0 && now - last < cooldown) return false;
  return list.some(needsAsyncEmailEnrichment);
};
