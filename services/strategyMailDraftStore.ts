/**
 * 开发信草稿：当前稿 + 历史存档，跨模块（策略 / 匹配 / 邮件）共用。
 */
import type { MailGroup } from '../types';

const LS_KEY = 'trade_scout_strategy_mail_draft_v1';
const LS_HISTORY = 'trade_scout_strategy_mail_history_v1';

export type StrategyMailDraft = {
  id?: string;
  companyName: string;
  website?: string;
  mailGroup: MailGroup;
  savedAt: number;
  /** 关联产品名 / 投放包 */
  productName?: string;
  packId?: string;
  campaignId?: string;
  source?: 'strategy' | 'gtm_match' | 'manual';
};

export const STRATEGY_MAIL_EVENT = 'tp-strategy-mail-draft';

const newDraftId = () =>
  `smd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const loadStrategyMailDraft = (): StrategyMailDraft | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StrategyMailDraft;
    if (!p?.mailGroup || !p.savedAt) return null;
    return p;
  } catch {
    return null;
  }
};

export const loadStrategyMailDraftHistory = (): StrategyMailDraft[] => {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as StrategyMailDraft[]).slice(0, 60) : [];
  } catch {
    return [];
  }
};

const pushHistory = (draft: StrategyMailDraft) => {
  const prev = loadStrategyMailDraftHistory().filter((d) => {
    if (draft.id && d.id === draft.id) return false;
    // 同公司 + 同产品 近重复覆盖
    return !(
      d.companyName === draft.companyName &&
      (d.productName || '') === (draft.productName || '') &&
      Math.abs((d.savedAt || 0) - draft.savedAt) < 3_000
    );
  });
  localStorage.setItem(LS_HISTORY, JSON.stringify([draft, ...prev].slice(0, 60)));
};

export const saveStrategyMailDraft = (draft: StrategyMailDraft): StrategyMailDraft => {
  const next: StrategyMailDraft = {
    ...draft,
    id: draft.id || newDraftId(),
    savedAt: draft.savedAt || Date.now(),
    source: draft.source || 'strategy',
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    pushHistory(next);
    window.dispatchEvent(new CustomEvent(STRATEGY_MAIL_EVENT, { detail: next }));
  } catch {
    /* ignore */
  }
  return next;
};

/** 批量写入匹配产生的多组开发信 */
export const saveStrategyMailDraftsFromPack = (
  items: Array<{
    companyName: string;
    website?: string;
    mailGroup: MailGroup;
    productName?: string;
    packId?: string;
    campaignId?: string;
  }>
): StrategyMailDraft[] => {
  const saved: StrategyMailDraft[] = [];
  for (const item of items) {
    if (!item.mailGroup?.email1 && !item.mailGroup?.subject1) continue;
    saved.push(
      saveStrategyMailDraft({
        companyName: item.companyName,
        website: item.website,
        mailGroup: item.mailGroup,
        productName: item.productName,
        packId: item.packId,
        campaignId: item.campaignId,
        savedAt: Date.now(),
        source: 'gtm_match',
      })
    );
  }
  return saved;
};

export const clearStrategyMailDraft = (): void => {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
};
