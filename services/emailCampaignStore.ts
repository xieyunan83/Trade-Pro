/**
 * 邮件营销本地持久化：任务/模板按归属过滤；配置按登录用户隔离。
 */
import type { AliyunConfig, EmailTask, EmailTemplate, User, Department } from '../types';
import { mergeAliyunConfigWithEnv } from './aliyunEmailEnv';
import { canViewOwnedRecord, filterOwnedRecords } from './permissions';

const TASKS_KEY = 'trade_scout_email_campaign_v1';
const configKey = (username: string) =>
  `trade_scout_email_config_v1_${(username || 'anon').trim().toLowerCase()}`;

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

const readRawBundle = (): { templates: EmailTemplate[]; tasks: EmailTask[]; updatedAt: number } => {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (!raw) return { templates: [], tasks: [], updatedAt: Date.now() };
    const j = JSON.parse(raw) as EmailCampaignStore;
    return {
      templates: Array.isArray(j.templates) ? j.templates : [],
      tasks: Array.isArray(j.tasks) ? j.tasks : [],
      updatedAt: j.updatedAt || Date.now(),
    };
  } catch {
    return { templates: [], tasks: [], updatedAt: Date.now() };
  }
};

const writeRawBundle = (templates: EmailTemplate[], tasks: EmailTask[]) => {
  localStorage.setItem(
    TASKS_KEY,
    JSON.stringify({
      templates,
      tasks,
      updatedAt: Date.now(),
      // 兼容旧结构：不再把 config 写进共享包
      config: null,
    })
  );
};

const loadUserConfig = (username: string): AliyunConfig | null => {
  try {
    const raw = localStorage.getItem(configKey(username));
    if (!raw) {
      // 迁移：旧全局 config
      const legacy = readRawBundle() as any;
      const old = (JSON.parse(localStorage.getItem(TASKS_KEY) || '{}') as EmailCampaignStore).config;
      return old || null;
    }
    return JSON.parse(raw) as AliyunConfig;
  } catch {
    return null;
  }
};

const saveUserConfig = (username: string, config: AliyunConfig | null) => {
  if (!username.trim()) return;
  if (!config) {
    localStorage.removeItem(configKey(username));
    return;
  }
  localStorage.setItem(configKey(username), JSON.stringify(config));
};

/** 推断旧任务归属：优先 client 拥有人，否则不可见（交给 canViewOwnedRecord） */
export const enrichTaskOwnershipFromCrm = (
  task: EmailTask,
  crmClients: { id: string; ownerUsername?: string; departmentId?: string; name?: string }[]
): EmailTask => {
  if ((task.ownerUsername || '').trim() || (task.departmentId || '').trim()) return task;
  const byId = task.clientId ? crmClients.find((c) => c.id === task.clientId) : undefined;
  if (byId) {
    return {
      ...task,
      ownerUsername: byId.ownerUsername,
      departmentId: byId.departmentId,
    };
  }
  const name = (task.companyName || '').trim().toLowerCase();
  if (name) {
    const byName = crmClients.find((c) => (c.name || '').trim().toLowerCase() === name);
    if (byName) {
      return {
        ...task,
        ownerUsername: byName.ownerUsername,
        departmentId: byName.departmentId,
        clientId: task.clientId || byName.id,
      };
    }
  }
  return task;
};

export const loadEmailCampaignStoreForUser = (
  viewer: User,
  allUsers: User[],
  departments: Department[],
  crmClients: { id: string; ownerUsername?: string; departmentId?: string; name?: string }[] = []
): EmailCampaignStore => {
  const raw = readRawBundle();
  const tasksEnriched = raw.tasks.map((t) => enrichTaskOwnershipFromCrm(t, crmClients));
  const templatesEnriched = raw.templates.map((t) => ({
    ...t,
    ownerUsername: t.ownerUsername,
    departmentId: t.departmentId,
  }));
  const tasks = filterOwnedRecords(viewer, tasksEnriched, allUsers, departments);
  // 模板：无归属的视为共享给总管/管理员；员工/主管只看自己或本部门的
  const templates = templatesEnriched.filter((t) => {
    if (!(t.ownerUsername || '').trim() && !(t.departmentId || '').trim()) {
      // 旧共享模板：仅本人部门主管及以上可见会太严；改为「无归属模板仅创建者不可考 → 仅 admin/director」
      return canViewOwnedRecord(viewer, t, allUsers, departments);
    }
    return canViewOwnedRecord(viewer, t, allUsers, departments);
  });
  const savedConfig = loadUserConfig(viewer.username);
  // 兼容：若用户尚无独立 config，尝试读旧全局
  let legacyConfig: AliyunConfig | null = null;
  try {
    const j = JSON.parse(localStorage.getItem(TASKS_KEY) || '{}') as EmailCampaignStore;
    legacyConfig = j.config || null;
  } catch {
    /* ignore */
  }
  const merged = mergeAliyunConfigWithEnv(savedConfig || legacyConfig);
  return {
    config: merged,
    templates,
    tasks,
    updatedAt: raw.updatedAt,
  };
};

/**
 * 保存时：保留当前用户不可见的他人任务/模板，只更新自己可见的那一份。
 */
export const saveEmailCampaignStoreForUser = (
  viewer: User,
  allUsers: User[],
  departments: Department[],
  patch: Partial<EmailCampaignStore>,
  crmClients: { id: string; ownerUsername?: string; departmentId?: string; name?: string }[] = []
): EmailCampaignStore => {
  const raw = readRawBundle();
  const othersTasks = raw.tasks.filter(
    (t) =>
      !canViewOwnedRecord(
        viewer,
        enrichTaskOwnershipFromCrm(t, crmClients),
        allUsers,
        departments
      )
  );
  const othersTemplates = raw.templates.filter(
    (t) => !canViewOwnedRecord(viewer, t, allUsers, departments)
  );

  const nextTasks = patch.tasks !== undefined ? [...othersTasks, ...patch.tasks] : raw.tasks;
  const nextTemplates =
    patch.templates !== undefined ? [...othersTemplates, ...patch.templates] : raw.templates;

  writeRawBundle(nextTemplates, nextTasks);

  if (patch.config !== undefined) {
    saveUserConfig(viewer.username, patch.config);
  }

  return loadEmailCampaignStoreForUser(viewer, allUsers, departments, crmClients);
};

/** @deprecated 请用 loadEmailCampaignStoreForUser */
export const loadEmailCampaignStore = (): EmailCampaignStore => {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
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
    return { ...parsed, config: mergeAliyunConfigWithEnv(parsed.config) };
  } catch {
    return { ...empty(), config: mergeAliyunConfigWithEnv(null) };
  }
};

/** @deprecated 请用 saveEmailCampaignStoreForUser */
export const saveEmailCampaignStore = (store: Partial<EmailCampaignStore>): EmailCampaignStore => {
  const prev = loadEmailCampaignStore();
  const next: EmailCampaignStore = {
    config: store.config !== undefined ? store.config : prev.config,
    templates: store.templates !== undefined ? store.templates : prev.templates,
    tasks: store.tasks !== undefined ? store.tasks : prev.tasks,
    updatedAt: Date.now(),
  };
  localStorage.setItem(TASKS_KEY, JSON.stringify(next));
  return next;
};
