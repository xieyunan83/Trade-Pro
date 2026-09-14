/**
 * 邮件营销本地持久化（模板 / 任务 / 阿里云配置）
 */
import type { AliyunConfig, EmailTask, EmailTemplate } from '../types';
import { mergeAliyunConfigWithEnv } from './aliyunEmailEnv';

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
    let parsed: EmailCampaignStore = empty();
    if (raw) {
      const j = JSON.parse(raw) as EmailCampaignStore;
      parsed = {
        config: j.config || null,
        templates: Array.isArray(j.templates) ? j.templates : [],
        tasks: Array.isArray(j.tasks) ? j.tasks : [],
        updatedAt: j.updatedAt || Date.now(),
      };
    }
    const merged = mergeAliyunConfigWithEnv(parsed.config);
    return { ...parsed, config: merged };
  } catch {
    return { ...empty(), config: mergeAliyunConfigWithEnv(null) };
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
