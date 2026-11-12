/**
 * 用户操作日志 · 按日汇总（本地、按账号隔离）
 * 每日首次打开看板时固化当日 digest；运行中可追加事件并刷新计数。
 */
import { getDailyUsagePublic } from './limitService';
import { loadQuotes } from './quoteTypes';
import { loadCatalogSkus } from './productCatalogTypes';
import type { EmailTask, HistoryItem } from '../types';

export type OpsActionKind =
  | 'search'
  | 'analysis'
  | 'decision_maker'
  | 'design'
  | 'quote'
  | 'email_ok'
  | 'email_fail'
  | 'crm'
  | 'catalog'
  | 'other';

export type OpsEvent = {
  id: string;
  at: number;
  kind: OpsActionKind;
  label: string;
  ok?: boolean;
  meta?: string;
};

export type OpsDailyMetrics = {
  search: number;
  analysis: number;
  decisionMakers: number;
  designs: number;
  quotes: number;
  emailOk: number;
  emailFail: number;
  crmAdds: number;
  catalogWrites: number;
  /** 0–100 综合活跃分 */
  score: number;
};

export type OpsDailyDigest = {
  date: string; // YYYY-MM-DD
  username: string;
  metrics: OpsDailyMetrics;
  events: OpsEvent[];
  commentary: string;
  nextActions: string[];
  builtAt: number;
  /** 当日是否已「日更」固化过（跨日会重建） */
  dailyLocked: boolean;
};

const eventsKey = (u: string) => `trade_scout_ops_events_v1:${u}`;
const digestKey = (u: string) => `trade_scout_ops_digest_v1:${u}`;

const todayYmd = () => new Date().toISOString().slice(0, 10);

const dayStartMs = (ymd: string) => new Date(`${ymd}T00:00:00`).getTime();
const dayEndMs = (ymd: string) => dayStartMs(ymd) + 24 * 60 * 60 * 1000;

const scopeUser = (username?: string) =>
  (username || 'local').trim().toLowerCase() || 'local';

const loadEvents = (username: string): OpsEvent[] => {
  try {
    const raw = localStorage.getItem(eventsKey(scopeUser(username)));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveEvents = (username: string, events: OpsEvent[]) => {
  // 只保留近 14 天，避免撑爆 localStorage
  const cut = Date.now() - 14 * 24 * 3600_000;
  const trimmed = events.filter((e) => e.at >= cut).slice(-800);
  localStorage.setItem(eventsKey(scopeUser(username)), JSON.stringify(trimmed));
};

export const trackOpsEvent = (
  username: string | undefined,
  kind: OpsActionKind,
  label: string,
  opts?: { ok?: boolean; meta?: string; count?: number }
) => {
  const u = scopeUser(username);
  const n = Math.max(1, opts?.count || 1);
  const events = loadEvents(u);
  for (let i = 0; i < n; i += 1) {
    events.push({
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${i}`,
      at: Date.now(),
      kind,
      label,
      ok: opts?.ok,
      meta: opts?.meta,
    });
  }
  saveEvents(u, events);
  // 使当日 digest 失效，下次读取时重建（仍属「日更」数据源，非每秒刷新 UI）
  try {
    const dig = localStorage.getItem(digestKey(u));
    if (dig) {
      const d = JSON.parse(dig) as OpsDailyDigest;
      if (d.date === todayYmd()) {
        d.dailyLocked = false;
        localStorage.setItem(digestKey(u), JSON.stringify(d));
      }
    }
  } catch {
    /* ignore */
  }
};

const countEvents = (events: OpsEvent[], kind: OpsActionKind, ymd: string) => {
  const a = dayStartMs(ymd);
  const b = dayEndMs(ymd);
  return events.filter((e) => e.kind === kind && e.at >= a && e.at < b).length;
};

type DeriveInput = {
  username: string;
  history?: HistoryItem[];
};

const deriveMetrics = (
  username: string,
  ymd: string,
  events: OpsEvent[],
  input: DeriveInput
): OpsDailyMetrics => {
  const usage = getDailyUsagePublic();
  const usageOk = usage.date === ymd;
  const a = dayStartMs(ymd);
  const b = dayEndMs(ymd);

  const histToday = (input.history || []).filter((h) => {
    if (h.timestamp < a || h.timestamp >= b) return false;
    if (h.ownerUsername && h.ownerUsername !== username) return false;
    return true;
  });

  let decisionMakers = 0;
  for (const h of histToday) {
    decisionMakers += h.data?.decisionMakers?.length || 0;
  }

  const quotes = loadQuotes().filter(
    (q) =>
      q.createdAt >= a &&
      q.createdAt < b &&
      (!q.ownerUsername || q.ownerUsername === username)
  ).length;

  const skus = loadCatalogSkus({ ensureTaxonomy: false });
  const catalogWrites = skus.filter(
    (s) =>
      s.updatedAt >= a &&
      s.updatedAt < b &&
      (!s.ownerUsername || s.ownerUsername === username)
  ).length;
  const designs = skus.filter(
    (s) =>
      s.updatedAt >= a &&
      s.updatedAt < b &&
      (s.source === 'ai_redesign' || (s.images || []).length > 0) &&
      (!s.ownerUsername || s.ownerUsername === username)
  ).length;

  let emailOk = 0;
  let emailFail = 0;
  try {
    const raw = localStorage.getItem('trade_scout_email_campaign_v1');
    const tasks = (raw ? JSON.parse(raw)?.tasks : []) as EmailTask[];
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        const ts = t.sentAt || 0;
        if (ts < a || ts >= b) continue;
        if (t.ownerUsername && t.ownerUsername.toLowerCase() !== username) continue;
        if (t.status === 'success') emailOk += 1;
        else if (t.status === 'failed') emailFail += 1;
      }
    }
  } catch {
    /* ignore */
  }

  const search = Math.max(
    usageOk ? usage.searchCount : 0,
    countEvents(events, 'search', ymd)
  );
  const analysis = Math.max(
    usageOk ? usage.analysisCount : 0,
    histToday.length,
    countEvents(events, 'analysis', ymd)
  );

  const metrics: OpsDailyMetrics = {
    search,
    analysis,
    decisionMakers: Math.max(decisionMakers, countEvents(events, 'decision_maker', ymd)),
    designs: Math.max(designs, countEvents(events, 'design', ymd)),
    quotes: Math.max(quotes, countEvents(events, 'quote', ymd)),
    emailOk: Math.max(emailOk, countEvents(events, 'email_ok', ymd)),
    emailFail: Math.max(emailFail, countEvents(events, 'email_fail', ymd)),
    crmAdds: countEvents(events, 'crm', ymd),
    catalogWrites: Math.max(catalogWrites, countEvents(events, 'catalog', ymd)),
    score: 0,
  };

  metrics.score = Math.min(
    100,
    Math.round(
      metrics.search * 2 +
        metrics.analysis * 8 +
        Math.min(metrics.decisionMakers, 40) * 0.5 +
        metrics.designs * 3 +
        metrics.quotes * 6 +
        metrics.emailOk * 4 +
        metrics.emailFail * 1 +
        metrics.crmAdds * 2 +
        metrics.catalogWrites * 1.5
    )
  );
  return metrics;
};

export const buildOpsCommentary = (
  m: OpsDailyMetrics
): { commentary: string; nextActions: string[] } => {
  const actions: string[] = [];
  const bits: string[] = [];

  if (m.score >= 70) {
    bits.push('今日节奏饱满，获客—背调—触达链条已跑通，保持这个密度即可形成复利。');
  } else if (m.score >= 35) {
    bits.push('今日有实质产出，但链路尚未闭环；把「背调完成」尽快落到报价或触达，转化会更明显。');
  } else if (m.search + m.analysis + m.quotes + m.emailOk === 0) {
    bits.push('今日尚未留下业务动作。建议先完成一轮客户搜索，再挑 3–5 家高质量线索做背调。');
  } else {
    bits.push('今日动作偏少或偏碎片。外贸开发讲究「少量精挖」：搜准 → 背透 → 触达，比空转点击更有价值。');
  }

  if (m.search > 0 && m.analysis === 0) {
    bits.push('已有搜索但未做背调，线索价值尚未验证。');
    actions.push('从今日搜索结果中选出 3 家，完成背调并查看决策人。');
  }
  if (m.analysis > 0 && m.decisionMakers === 0) {
    bits.push('背调已完成，但决策人尚未沉淀，后续触达缺少抓手。');
    actions.push('打开已完成报告，核对决策人邮箱并加入触达名单。');
  }
  if (m.analysis > 0 && m.emailOk + m.quotes === 0) {
    bits.push('有背调产出却未报价/发信，容易停在「只看不做」。');
    actions.push('对重点客户生成一版报价，或试发一封开发信。');
  }
  if (m.emailFail > m.emailOk && m.emailFail > 0) {
    bits.push(`发信失败 ${m.emailFail} 次偏高，需优先清理无效地址并核对发信配置。`);
    actions.push('到邮件营销查看失败原因，清理无效地址后再群发。');
  }
  if (m.catalogWrites === 0 && m.quotes === 0) {
    actions.push('补充/核对产品库货号与出厂价，方便一键出报价单。');
  }
  if (m.designs === 0 && m.score < 50) {
    actions.push('若样品视觉不足，可用设计模块出 1–2 款主推图，提升报价单观感。');
  }
  if (!actions.length) {
    actions.push('挑选今日最高分背调客户，跟进一次触达并记录结果。');
    actions.push('复盘失败发信/空搜关键词，调整明日目标国家或品类。');
  }

  return { commentary: bits.join(' '), nextActions: actions.slice(0, 4) };
};

const recentEvents = (events: OpsEvent[], ymd: string): OpsEvent[] => {
  const a = dayStartMs(ymd);
  const b = dayEndMs(ymd);
  return events
    .filter((e) => e.at >= a && e.at < b)
    .sort((x, y) => y.at - x.at)
    .slice(0, 40);
};

/** 获取（或按日重建）当日操作 digest */
export const getOpsDailyDigest = (
  username: string | undefined,
  input: DeriveInput = { username: username || 'local' }
): OpsDailyDigest => {
  const u = scopeUser(username);
  const ymd = todayYmd();
  try {
    const raw = localStorage.getItem(digestKey(u));
    if (raw) {
      const cached = JSON.parse(raw) as OpsDailyDigest;
      // 跨日 → 重建；同日且已锁定 → 直接用（日更一次）
      if (cached.date === ymd && cached.dailyLocked) {
        return cached;
      }
      // 同日未锁定：允许用最新派生数据刷新，然后在首次看板停留后锁定
      if (cached.date === ymd && !cached.dailyLocked) {
        const events = loadEvents(u);
        const metrics = deriveMetrics(u, ymd, events, { ...input, username: u });
        const { commentary, nextActions } = buildOpsCommentary(metrics);
        const digest: OpsDailyDigest = {
          date: ymd,
          username: u,
          metrics,
          events: recentEvents(events, ymd),
          commentary,
          nextActions,
          builtAt: Date.now(),
          dailyLocked: true,
        };
        localStorage.setItem(digestKey(u), JSON.stringify(digest));
        return digest;
      }
    }
  } catch {
    /* rebuild */
  }

  const events = loadEvents(u);
  const metrics = deriveMetrics(u, ymd, events, { ...input, username: u });
  const { commentary, nextActions } = buildOpsCommentary(metrics);
  const digest: OpsDailyDigest = {
    date: ymd,
    username: u,
    metrics,
    events: recentEvents(events, ymd),
    commentary,
    nextActions,
    builtAt: Date.now(),
    dailyLocked: true,
  };
  localStorage.setItem(digestKey(u), JSON.stringify(digest));
  return digest;
};

/** 强制按当前数据重建当日 digest（手动刷新用；仍算当日一版） */
export const refreshOpsDailyDigest = (
  username: string | undefined,
  input: DeriveInput = { username: username || 'local' }
): OpsDailyDigest => {
  const u = scopeUser(username);
  try {
    localStorage.removeItem(digestKey(u));
  } catch {
    /* ignore */
  }
  return getOpsDailyDigest(u, input);
};
