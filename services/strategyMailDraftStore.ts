/**
 * 开发策略生成的开发信草稿：跨模块可读，便于复制到邮件模板。
 */
import type { MailGroup } from '../types';

const LS_KEY = 'trade_scout_strategy_mail_draft_v1';

export type StrategyMailDraft = {
  companyName: string;
  website?: string;
  mailGroup: MailGroup;
  savedAt: number;
};

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

export const saveStrategyMailDraft = (draft: StrategyMailDraft): void => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(draft));
    window.dispatchEvent(new CustomEvent('tp-strategy-mail-draft', { detail: draft }));
  } catch {
    /* ignore */
  }
};

export const clearStrategyMailDraft = (): void => {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
};
