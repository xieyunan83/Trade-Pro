/**
 * 夜间静默升级：上海时区 22:00–08:00，对旧客户补齐「新功能带来的缺口」
 *（公司联系人补全 / 决策人邮箱 / 品类 / 背调补全）。白天自动停泵，不抢交互流量。
 * 登录挂机即可，无需用户下指令。
 *
 * 邮箱：千问只猜候选，必须专业接口校验后才写入（见 emailPatternGuess）。
 */
import type { Client, DecisionMaker, HistoryItem } from '../types';
import { isQwenNightPromoWindow } from './qwenModelSchedule';
import { locateLinkedInEmployees } from './linkedinEmployeeLocator';
import { enrichDecisionMakersTitleAndWhatsApp } from './decisionMakerWebEnrich';
import {
  buildHistoryLookupIndex,
  findHistoryForClient,
} from '../utils/crmHistory';
import { resolveCrmClientIntel } from '../utils/companyIntelStatus';
import { hasRichProductCatalog } from './productCatalog';

/** 功能缺口版本：新能力上线时 +1，旧客户会重新进入夜间队列 */
/** v6：存量 CRM 全站产品/价格带/关键词打标（仅重跑 catalog_match） */
export const NIGHT_UPGRADE_SCHEMA_VERSION = 6;

export type NightGapKind =
  | 'linkedin_locate'
  | 'dm_email'
  | 'product_dig'
  | 'enrichment'
  | 'catalog_match';

export type NightUpgradeJob = {
  id: string;
  clientId: string;
  clientName: string;
  domain: string;
  kind: NightGapKind;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  note?: string;
};

type ClientProgress = {
  version: number;
  done: NightGapKind[];
  lastAt: number;
};

type PersistedState = {
  enabled: boolean;
  schemaVersion: number;
  lastScanAt: number;
  clientProgress: Record<string, ClientProgress>;
  jobs: NightUpgradeJob[];
};

export type NightUpgradeStatus = {
  enabled: boolean;
  inWindow: boolean;
  schemaVersion: number;
  queued: number;
  running: number;
  completedTonight: number;
  failedTonight: number;
  current?: NightUpgradeJob | null;
  lastScanAt: number;
};

type Handlers = {
  getClients: () => Client[];
  getHistory: () => HistoryItem[];
  canDm: () => boolean;
  canProduct: () => boolean;
  canEnrich: () => boolean;
  /** 公司联系人补全完成 → App 持久化 */
  onLinkedInDone: (payload: {
    client: Client;
    decisionMakers: DecisionMaker[];
    historyId?: string;
  }) => void | Promise<void>;
  /** 入队决策人邮箱深挖（含猜验链路） */
  enqueueDm: (client: Client, history?: HistoryItem) => boolean;
  /** 入队品类深挖 */
  enqueueProduct: (client: Client) => boolean;
  /** 入队背调补全 */
  enqueueEnrichment: (client: Client) => boolean;
  /** 全品类匹配平台类目 + 产品库（夜间静默） */
  runCatalogMatch?: (client: Client, history?: HistoryItem) => Promise<{ note: string } | null>;
};

const LS_KEY = 'trade_scout_night_silent_upgrade_v1';
const TICK_MS = 45_000;
const JOB_GAP_MS = 8_000;
const MAX_JOBS_PER_NIGHT = 200;
const MAX_PER_SCAN = 60;
/** 本地品类匹配无烧 Token，每轮可连跑多条 */
const CATALOG_MATCH_BURST = 25;

let handlers: Handlers | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let pumping = false;
let shouldStop = false;
let state: PersistedState = {
  enabled: true,
  schemaVersion: NIGHT_UPGRADE_SCHEMA_VERSION,
  lastScanAt: 0,
  clientProgress: {},
  jobs: [],
};
const listeners = new Set<(s: NightUpgradeStatus) => void>();

const loadState = (): PersistedState => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return state;
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled !== false,
      schemaVersion: NIGHT_UPGRADE_SCHEMA_VERSION,
      lastScanAt: Number(parsed.lastScanAt) || 0,
      clientProgress:
        parsed.clientProgress && typeof parsed.clientProgress === 'object'
          ? parsed.clientProgress
          : {},
      jobs: Array.isArray(parsed.jobs)
        ? parsed.jobs
            .map((j: any) => ({
              ...j,
              status: j.status === 'running' ? 'queued' : j.status,
            }))
            .filter((j: NightUpgradeJob) => j.id && j.clientId)
            .slice(-400)
        : [],
    };
  } catch {
    return state;
  }
};

const saveState = () => {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        ...state,
        jobs: state.jobs.slice(-400).map((j) => ({
          ...j,
          status: j.status === 'running' ? 'queued' : j.status,
        })),
      })
    );
  } catch (e) {
    console.warn('[night-upgrade] persist failed', e);
  }
};

const notify = () => {
  saveState();
  const snap = getNightUpgradeStatus();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch (e) {
      console.error('[night-upgrade] listener', e);
    }
  });
};

export const subscribeNightUpgrade = (fn: (s: NightUpgradeStatus) => void): (() => void) => {
  listeners.add(fn);
  try {
    fn(getNightUpgradeStatus());
  } catch {
    /* ignore */
  }
  return () => listeners.delete(fn);
};

export const getNightUpgradeStatus = (): NightUpgradeStatus => {
  const tonightStart = Date.now() - 14 * 60 * 60 * 1000;
  const completedTonight = state.jobs.filter(
    (j) => j.status === 'completed' && (j.finishedAt || 0) >= tonightStart
  ).length;
  const failedTonight = state.jobs.filter(
    (j) => j.status === 'failed' && (j.finishedAt || 0) >= tonightStart
  ).length;
  return {
    enabled: state.enabled,
    inWindow: isQwenNightPromoWindow(),
    schemaVersion: NIGHT_UPGRADE_SCHEMA_VERSION,
    queued: state.jobs.filter((j) => j.status === 'queued').length,
    running: state.jobs.filter((j) => j.status === 'running').length,
    completedTonight,
    failedTonight,
    current: state.jobs.find((j) => j.status === 'running') || null,
    lastScanAt: state.lastScanAt,
  };
};

export const setNightSilentUpgradeEnabled = (enabled: boolean) => {
  state.enabled = enabled;
  notify();
  if (enabled) void pumpNightUpgrade();
};

const progressOf = (clientId: string): ClientProgress => {
  const p = state.clientProgress[clientId];
  if (!p) return { version: NIGHT_UPGRADE_SCHEMA_VERSION, done: [], lastAt: 0 };
  if (p.version < NIGHT_UPGRADE_SCHEMA_VERSION) {
    // v6：只强制重做 catalog_match（全站产品/价格/关键词打标），其它缺口保留
    return {
      version: NIGHT_UPGRADE_SCHEMA_VERSION,
      done: (p.done || []).filter((k) => k !== 'catalog_match'),
      lastAt: p.lastAt || 0,
    };
  }
  return p;
};

const markDone = (clientId: string, kind: NightGapKind) => {
  const prev = progressOf(clientId);
  const done = [...new Set([...prev.done, kind])];
  state.clientProgress[clientId] = {
    version: NIGHT_UPGRADE_SCHEMA_VERSION,
    done,
    lastAt: Date.now(),
  };
};

/** 评估单家客户相对当前平台能力的缺口 */
export const assessClientNightGaps = (
  client: Client,
  history: HistoryItem[],
  caps: { canDm: boolean; canProduct: boolean; canEnrich: boolean }
): NightGapKind[] => {
  const index = buildHistoryLookupIndex(history);
  const intel = resolveCrmClientIntel(client, index);
  const hist = intel.historyItem || findHistoryForClient(client, history);
  const dms = hist?.data?.decisionMakers || client.contacts || [];
  const hasLi = dms.some((d) => /linkedin\.com\/in\//i.test(d.linkedin || ''));
  const hasVerifiedEmail = dms.some(
    (d) => d.emailGuess?.includes('@') && (d.isVerified || (d.emailStatus || '').toLowerCase() === 'valid')
  );
  const hasAnyEmail = dms.some((d) => d.emailGuess?.includes('@'));
  const hasNamedContact = dms.some((d) => {
    const n = (d.name || '').trim();
    return n && !/公开信息未找到|未知|待补充/i.test(n);
  });
  const needsTitleOrWhatsApp = dms.some((d) => {
    const n = (d.name || '').trim();
    if (!n || /公开信息未找到|未知|待补充/i.test(n)) return false;
    const weakTitle =
      !(d.title || '').trim() || /待确认|待补充|Employee|Staff|Company Contact/i.test(d.title || '');
    const noWa = !(d.whatsapp || '').trim() && !(d.phone || '').trim();
    return weakTitle || noWa;
  });
  const domain = (client.website || hist?.domain || '').trim();
  const gaps: NightGapKind[] = [];
  const done = new Set(progressOf(client.id).done);

  // 1) 公司联系人：缺主页/姓名，或已有人对齐但缺具体职位/WhatsApp
  if (
    !done.has('linkedin_locate') &&
    domain.includes('.') &&
    (intel.hasBg || !!hist) &&
    ((!hasLi && !hasNamedContact) || ((hasLi || hasNamedContact) && needsTitleOrWhatsApp))
  ) {
    gaps.push('linkedin_locate');
  }

  // 2) 决策人邮箱：有人名/主页但缺已验证邮箱（用户也可手动点搜；夜间静默补）
  if (
    caps.canDm &&
    !done.has('dm_email') &&
    domain.includes('.') &&
    (hasNamedContact || hasLi) &&
    !hasVerifiedEmail
  ) {
    gaps.push('dm_email');
  } else if (
    caps.canDm &&
    !done.has('dm_email') &&
    domain.includes('.') &&
    intel.hasBg &&
    !hasAnyEmail &&
    !intel.hasDm
  ) {
    gaps.push('dm_email');
  }

  // 3) 品类
  if (
    caps.canProduct &&
    !done.has('product_dig') &&
    intel.hasBg &&
    !intel.hasProduct &&
    !hasRichProductCatalog(hist?.data)
  ) {
    gaps.push('product_dig');
  }

  // 4) 背调补全（有背调但缺产品或设计信号类结构化信息时）
  if (
    caps.canEnrich &&
    !done.has('enrichment') &&
    intel.hasBg &&
    hist?.data &&
    (!intel.hasProduct || !(hist.data as any).decisionModel)
  ) {
    gaps.push('enrichment');
  }

  // 5) 全品类 vs 平台产品/阿里类目匹配（有背调或 CRM 品类/关键词即可）
  if (
    !done.has('catalog_match') &&
    (intel.hasBg ||
      !!hist?.data ||
      !!(client.productType || '').trim() ||
      !!(client.searchKeyword || '').trim() ||
      (client.searchedKeywords || []).length > 0)
  ) {
    gaps.push('catalog_match');
  }

  return gaps;
};

const scanAndEnqueue = () => {
  if (!handlers) return;
  const clients = handlers.getClients() || [];
  const history = handlers.getHistory() || [];
  const caps = {
    canDm: handlers.canDm(),
    canProduct: handlers.canProduct(),
    canEnrich: handlers.canEnrich(),
  };
  state.lastScanAt = Date.now();

  const tonightStart = Date.now() - 14 * 60 * 60 * 1000;
  const doneTonight = state.jobs.filter(
    (j) =>
      (j.status === 'completed' || j.status === 'failed') &&
      (j.finishedAt || 0) >= tonightStart
  ).length;
  if (doneTonight >= MAX_JOBS_PER_NIGHT) return;

  const existingKeys = new Set(
    state.jobs
      .filter((j) => j.status === 'queued' || j.status === 'running')
      .map((j) => `${j.clientId}:${j.kind}`)
  );

  let added = 0;
  // 优先：缺公司联系人 / 缺邮箱 的客户
  const scored = clients
    .map((c) => {
      const gaps = assessClientNightGaps(c, history, caps);
      return { c, gaps };
    })
    .filter((x) => x.gaps.length)
    .sort((a, b) => {
      const score = (g: NightGapKind[]) =>
        (g.includes('linkedin_locate') ? 8 : 0) +
        (g.includes('dm_email') ? 6 : 0) +
        (g.includes('catalog_match') ? 5 : 0) +
        (g.includes('product_dig') ? 3 : 0) +
        (g.includes('enrichment') ? 2 : 0);
      return score(b.gaps) - score(a.gaps);
    });

  for (const { c, gaps } of scored) {
    if (added >= MAX_PER_SCAN) break;
    const kind = gaps[0];
    const key = `${c.id}:${kind}`;
    if (existingKeys.has(key)) continue;
    const domain = (c.website || '').replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
    state.jobs.push({
      id: `nu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      clientId: c.id,
      clientName: c.name || domain || c.id,
      domain,
      kind,
      status: 'queued',
      createdAt: Date.now(),
    });
    existingKeys.add(key);
    added += 1;
  }
  if (added) notify();
};

const runOneJob = async (job: NightUpgradeJob) => {
  if (!handlers) return;
  const clients = handlers.getClients();
  const client = clients.find((c) => c.id === job.clientId);
  if (!client) {
    job.status = 'skipped';
    job.error = '客户已不存在';
    job.finishedAt = Date.now();
    return;
  }
  const history = handlers.getHistory();
  const hist = findHistoryForClient(client, history);

  job.status = 'running';
  job.startedAt = Date.now();
  notify();

  try {
    if (job.kind === 'linkedin_locate') {
      const { withHeavyJob } = await import('./loadGovernor');
      const existing = hist?.data?.decisionMakers || client.contacts || [];
      const domain = client.website || hist?.domain || '';
      await withHeavyJob('ai', async () => {
        const located = await locateLinkedInEmployees({
          domain,
          companyName: client.name,
          productKeyword: client.searchKeyword || hist?.keyword,
          country: client.country || hist?.country,
          existing,
          maxQueries: 3,
        });
        const enriched = await enrichDecisionMakersTitleAndWhatsApp({
          domain,
          companyName: client.name,
          decisionMakers: located.decisionMakers,
          limit: 8,
        });
        await handlers!.onLinkedInDone({
          client,
          decisionMakers: enriched,
          historyId: hist?.id,
        });
        const waN = enriched.filter((d) => (d.whatsapp || '').trim()).length;
        job.note = `联系人 +${located.stats.added}${waN ? ` · WhatsApp ${waN}` : ''}`;
      });
      markDone(client.id, 'linkedin_locate');
      job.status = 'completed';
    } else if (job.kind === 'dm_email') {
      const ok = handlers.enqueueDm(client, hist);
      if (!ok) {
        job.status = 'skipped';
        job.error = '未能加入邮箱深挖队列';
      } else {
        markDone(client.id, 'dm_email');
        job.status = 'completed';
        job.note = '已交邮箱深挖队列';
      }
    } else if (job.kind === 'product_dig') {
      const ok = handlers.enqueueProduct(client);
      if (!ok) {
        job.status = 'skipped';
        job.error = '未能加入品类深挖';
      } else {
        markDone(client.id, 'product_dig');
        job.status = 'completed';
        job.note = '已交品类深挖队列';
      }
    } else if (job.kind === 'enrichment') {
      const ok = handlers.enqueueEnrichment(client);
      if (!ok) {
        job.status = 'skipped';
        job.error = '未能加入背调补全';
      } else {
        markDone(client.id, 'enrichment');
        job.status = 'completed';
        job.note = '已交背调补全队列';
      }
    } else if (job.kind === 'catalog_match') {
      if (!handlers.runCatalogMatch) {
        job.status = 'skipped';
        job.error = '未挂载品类匹配';
      } else {
        const res = await handlers.runCatalogMatch(client, hist);
        if (!res) {
          job.status = 'skipped';
          job.error = '无可匹配品类信号';
        } else {
          markDone(client.id, 'catalog_match');
          job.status = 'completed';
          job.note = res.note;
        }
      }
    }
  } catch (e: any) {
    job.status = 'failed';
    job.error = e?.message || String(e);
  }
  job.finishedAt = Date.now();
  notify();
};

export const pumpNightUpgrade = async () => {
  if (pumping || shouldStop) return;
  if (!state.enabled || !handlers) return;
  if (!isQwenNightPromoWindow()) {
    // 白天：清空 running 标记，保留 queued 等到晚上
    let changed = false;
    for (const j of state.jobs) {
      if (j.status === 'running') {
        j.status = 'queued';
        j.startedAt = undefined;
        changed = true;
      }
    }
    if (changed) notify();
    return;
  }

  pumping = true;
  try {
    // 每晚窗口内定期扫缺口
    if (Date.now() - (state.lastScanAt || 0) > 8 * 60 * 1000) {
      scanAndEnqueue();
    }

    // 本地品类匹配不烧 Token：优先连跑一批，与批量背调并行不抢 Key
    let catalogBurst = state.jobs
      .filter((j) => j.status === 'queued' && j.kind === 'catalog_match')
      .slice(0, CATALOG_MATCH_BURST);
    if (!catalogBurst.length) {
      scanAndEnqueue();
      catalogBurst = state.jobs
        .filter((j) => j.status === 'queued' && j.kind === 'catalog_match')
        .slice(0, CATALOG_MATCH_BURST);
    }
    if (catalogBurst.length) {
      for (const job of catalogBurst) {
        if (shouldStop) break;
        await runOneJob(job);
      }
      await new Promise((r) => setTimeout(r, 400));
      return;
    }

    // 与批量背调双轨：共享冷却 / AI 槽位，避免同一 Key 撞限流
    const { getHeavyJobCount, getSharedCooldownUntil, waitForLocalAiSlot } = await import(
      './loadGovernor'
    );
    if (Date.now() < getSharedCooldownUntil()) {
      return;
    }
    // 批量背调占用 AI 时先让出；软上限 1，给挂机批量留槽
    await waitForLocalAiSlot(() => shouldStop, 1);
    if (shouldStop) return;

    const next = state.jobs.find((j) => j.status === 'queued');
    if (!next) {
      scanAndEnqueue();
    }
    const job = state.jobs.find((j) => j.status === 'queued');
    if (job) {
      await runOneJob(job);
      const busy = getHeavyJobCount('ai') > 0 || getHeavyJobCount('automation') > 0;
      const gap = busy ? JOB_GAP_MS * 2.5 : JOB_GAP_MS;
      await new Promise((r) => setTimeout(r, gap));
    }
  } finally {
    pumping = false;
  }
};

export const startNightSilentUpgrade = (h: Handlers) => {
  handlers = h;
  state = loadState();
  state.schemaVersion = NIGHT_UPGRADE_SCHEMA_VERSION;
  shouldStop = false;
  notify();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    void pumpNightUpgrade();
  }, TICK_MS);
  // 启动后若已在夜间窗口，稍延迟再扫，避免登录高峰抢资源
  window.setTimeout(() => void pumpNightUpgrade(), 12_000);
};

export const stopNightSilentUpgrade = () => {
  shouldStop = true;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  handlers = null;
};

export const describeNightSilentUpgrade = (): string =>
  `夜间静默升级（上海 22:00–08:00）· schema v${NIGHT_UPGRADE_SCHEMA_VERSION} · 联系人 / 邮箱 / 品类深挖 / 背调补全 / 全品类产品匹配 · 与批量背调双轨错峰`;
