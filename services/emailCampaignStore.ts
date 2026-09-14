/**
 * 邮件营销本地持久化（模板 / 任务 / 阿里云配置）
 */
import type { AliyunConfig, EmailTask, EmailTemplate } from '../types';

const KEY = 'trade_scout_email_campaign_v1';

export type EmailCampaignStore = {
  config: AliyunConfig | null;
  templates: EmailTemplate[];
  tasks: EmailTask[];
  updatedAt: number;
};

const empty = (): EmailCampaignStore => ({
  config: null,
  templates: [],
  tasks: [],
  updatedAt: Date.now(),
});

export const loadEmailCampaignStore = (): EmailCampaignStore => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as EmailCampaignStore;
    return {
      config: parsed.config || null,
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return empty();
  }
};

export const saveEmailCampaignStore = (store: Partial<EmailCampaignStore>): EmailCampaignStore => {
  const prev = loadEmailCampaignStore();
  const next: EmailCampaignStore = {
    config: store.config !== undefined ? store.config : prev.config,
    templates: store.templates !== undefined ? store.templates : prev.templates,
    tasks: store.tasks !== undefined ? store.tasks : prev.tasks,
    updatedAt: Date.now(),
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
};
