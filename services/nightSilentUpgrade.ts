/**
 * 夜间静默升级：上海时区 22:00–08:00，对旧客户补齐「新功能带来的缺口」
 *（LinkedIn 联系人占位 + WhatsApp / 品类 / 背调补全）。白天自动停泵，不抢交互流量。
 * 登录挂机即可，无需用户下指令。
 *
 * 付费邮箱（Anymail）禁止夜间/后台自动跑；须用户手动确认搜索。
 * 有 WhatsApp 的联系人视为有效联系人，不因缺邮箱再烧分。
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
import { isWorkerModeActive } from './workerMode';

/** 功能缺口版本：新能力上线时 +1，旧客户会重新进入夜间队列 */
/** v6：存量 CRM 全站产品/价格带/关键词打标（仅重跑 catalog_match） */
export const NIGHT_UPGRADE_SCHEMA_VERSION = 6;

export type NightGapKind =
  | 'linkedin_locate'
  | 'dm_email'
  | 'product_dig'
  | 'enrichment'
  | 'catalog_match';

/** 白天：几乎不烧对话 Token 的轻缺口（不含付费邮箱） */
const DAY_LIGHT_KINDS: NightGapKind[] = ['catalog_match'];
/** 夜间：重补全（吃优惠时段）；不含 dm_email，避免偷偷烧 Anymail */
const NIGHT_HEAVY_KINDS: NightGapKind[] = [
  'linkedin_locate',
  'product_dig',
  'enrichment',
  'catalog_match',
];

const kindsAllowedNow = (): Set<NightGapKind> => {
  // 非挂机：保持原行为（夜间窗内啥都能跑；窗外泵会停）
  if (!isWorkerModeActive()) {
    return new Set(NIGHT_HEAVY_KINDS);
  }
  return new Set(isQwenNightPromoWindow() ? NIGHT_HEAVY_KINDS : DAY_LIGHT_KINDS);
};

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
/** 泵间隔：过长会把整晚吞吐卡死在「空转等待」 */
const TICK_MS = 12_000;
/** 重任务间隙；轻任务（仅入队）几乎不等 */
const JOB_GAP_MS = 2_500;
/**
 * 每晚完成上限（含失败）。旧值 200 会把整晚卡死；
 * 本地 catalog_match 几乎不烧 Token，允许更高；真正烧 Token 的仍受 Key/限流约束。
 */
const MAX_JOBS_PER_NIGHT = 2_500;
const MAX_PER_SCAN = 150;
/** 本地品类匹配无烧 Token，每轮可连跑多条 */
const CATALOG_MATCH_BURST = 80;
/** 仅入队、几乎瞬时的缺口种类（真正干活在各自队列） */
const LIGHT_ENQUEUE_KINDS: NightGapKind[] = ['product_dig', 'enrichment'];
const LIGHT_BURST = 12;
/** 每轮最多跑几条 LinkedIn/WhatsApp 重补全（仍串行，避免撞限流） */
const HEAVY_PER_TICK = 1;

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

let notifyTimer: ReturnType<typeof setTimeout> | null = null;
const flushNotify = () => {
  notifyTimer = null;
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
/** 状态变更合并通知，避免每条 job 都整包 stringify LS */
const notify = () => {
  if (notifyTimer) return;
  notifyTimer = setTimeout(flushNotify, 400);
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
    // 挂机白天也在跑轻量，角标视为「在窗」
    inWindow: isQwenNightPromoWindow() || isWorkerModeActive(),
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

  // 2) 决策人邮箱：不再自动入队。缺邮箱但有 WhatsApp/LinkedIn 已足够占位；
  //    邮箱须用户在决策人页手动确认后再搜（付费）。

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

  const allowed = kindsAllowedNow();
  for (const { c, gaps } of scored) {
    if (added >= MAX_PER_SCAN) break;
    const filtered = gaps.filter((g) => allowed.has(g));
    if (!filtered.length) continue;
    // 本地 catalog_match 几乎免费：与最高优先级重缺口一并入队，避免永远被 LinkedIn 堵死
    const kindsToAdd: NightGapKind[] = [];
    if (filtered.includes('catalog_match')) kindsToAdd.push('catalog_match');
    const primary = filtered.find((g) => g !== 'catalog_match');
    if (primary) kindsToAdd.push(primary);
    if (!kindsToAdd.length && filtered[0]) kindsToAdd.push(filtered[0]);

    const domain = (c.website || '').replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
    for (const kind of kindsToAdd) {
      if (added >= MAX_PER_SCAN) break;
      const key = `${c.id}:${kind}`;
      if (existingKeys.has(key)) continue;
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
          // 夜间批量：2 次检索足够找采购线索，少一次显著提速
          maxQueries: 2,
        });
        const { filterDecisionMakersForCompany } = await import('./linkedinEmployeeLocator');
        const enriched = await enrichDecisionMakersTitleAndWhatsApp({
          domain,
          companyName: client.name,
          decisionMakers: located.decisionMakers,
          // 夜间先补核心 5 人；其余可手动或次夜再挖
          limit: 5,
          requireWhatsApp: true,
        });
        const scoped = filterDecisionMakersForCompany(enriched, {
          companyName: client.name,
          domain,
        });
        await handlers!.onLinkedInDone({
          client,
          decisionMakers: scoped,
          historyId: hist?.id,
        });
        const waN = scoped.filter((d) => (d.whatsapp || '').trim()).length;
        const waMiss = scoped.filter((d) => !(d.whatsapp || '').trim()).length;
        const rejected = Math.max(0, located.stats.rejectedOffCompany || 0);
        job.note = `本公司联系人 +${located.stats.added} · WhatsApp ${waN}${
          waMiss ? `（待补 ${waMiss}` : ''
        }${waMiss ? '）' : ''}${rejected ? ` · 已剔除串公司 ${rejected}` : ''}`;
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
  try {
    const { shouldDeferHeavyWork } = await import('./foregroundGuard');
    if (shouldDeferHeavyWork()) return;
  } catch {
    /* ignore */
  }
  // 挂机模式：白天也跑轻量；非挂机：仍仅夜间窗
  const worker = isWorkerModeActive();
  const inNight = isQwenNightPromoWindow();
  if (!worker && !inNight) {
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
    const allowed = kindsAllowedNow();
    // 每晚窗口内定期扫缺口
    if (Date.now() - (state.lastScanAt || 0) > 8 * 60 * 1000) {
      scanAndEnqueue();
    }

    // 本地品类匹配不烧 Token：优先连跑一批
    let catalogBurst = state.jobs
      .filter(
        (j) =>
          j.status === 'queued' && j.kind === 'catalog_match' && allowed.has('catalog_match')
      )
      .slice(0, CATALOG_MATCH_BURST);
    if (!catalogBurst.length) {
      scanAndEnqueue();
      catalogBurst = state.jobs
        .filter(
          (j) =>
            j.status === 'queued' && j.kind === 'catalog_match' && allowed.has('catalog_match')
        )
        .slice(0, CATALOG_MATCH_BURST);
    }
    if (catalogBurst.length) {
      const { waitUntilWorkAllowed, yieldToUi } = await import('./backgroundWorkScheduler');
      for (const job of catalogBurst) {
        if (shouldStop) break;
        const ok = await waitUntilWorkAllowed(() => shouldStop, 60_000);
        if (!ok) break;
        await runOneJob(job);
        await yieldToUi(0);
      }
    }

    // 轻入队（白天+夜间）：邮箱等
    const lightJobs = state.jobs
      .filter(
        (j) =>
          j.status === 'queued' &&
          LIGHT_ENQUEUE_KINDS.includes(j.kind) &&
          allowed.has(j.kind)
      )
      .slice(0, LIGHT_BURST);
    {
      const { waitUntilWorkAllowed, yieldToUi } = await import('./backgroundWorkScheduler');
      for (const job of lightJobs) {
        if (shouldStop) break;
        const ok = await waitUntilWorkAllowed(() => shouldStop, 30_000);
        if (!ok) break;
        await runOneJob(job);
        await yieldToUi(0);
      }
    }

    // 重补全仅夜间（或非挂机的夜间窗）
    if (!allowed.has('linkedin_locate') && !allowed.has('product_dig') && !allowed.has('enrichment')) {
      return;
    }

    const { getHeavyJobCount, getSharedCooldownUntil, waitForLocalAiSlot } = await import(
      './loadGovernor'
    );
    if (Date.now() < getSharedCooldownUntil()) {
      return;
    }
    await waitForLocalAiSlot(() => shouldStop, 2);
    if (shouldStop) return;

    if (!state.jobs.some((j) => j.status === 'queued' && allowed.has(j.kind))) {
      scanAndEnqueue();
    }

    // 品类深挖 / 背调补全：夜间入队到各自泵
    for (const kind of ['product_dig', 'enrichment'] as NightGapKind[]) {
      if (!allowed.has(kind)) continue;
      const job = state.jobs.find((j) => j.status === 'queued' && j.kind === kind);
      if (job) await runOneJob(job);
    }

    let heavyRan = 0;
    while (heavyRan < HEAVY_PER_TICK && !shouldStop && allowed.has('linkedin_locate')) {
      const job = state.jobs.find(
        (j) => j.status === 'queued' && j.kind === 'linkedin_locate'
      );
      if (!job) break;
      await runOneJob(job);
      heavyRan += 1;
      const busy = getHeavyJobCount('ai') > 0 || getHeavyJobCount('automation') > 0;
      const gap = busy ? JOB_GAP_MS * 1.6 : JOB_GAP_MS;
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
    void import('./backgroundWorkScheduler').then(({ enqueueBackgroundWork }) => {
      enqueueBackgroundWork('night_upgrade', () => pumpNightUpgrade(), 'night_upgrade_tick');
    });
  }, TICK_MS);
  // 启动后若已在夜间窗口，稍延迟再扫，避免登录高峰抢资源
  window.setTimeout(() => {
    void import('./backgroundWorkScheduler').then(({ enqueueBackgroundWork }) => {
      enqueueBackgroundWork('night_upgrade', () => pumpNightUpgrade(), 'night_upgrade_boot');
    });
  }, 12_000);
};

export const stopNightSilentUpgrade = () => {
  shouldStop = true;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  handlers = null;
  const now = Date.now();
  for (const job of state.jobs) {
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'failed';
      job.finishedAt = now;
      job.error = '已手动停止';
    }
  }
  notify();
};

/** 停泵并清空夜间任务列表 */
export const abortAndClearNightUpgrade = () => {
  stopNightSilentUpgrade();
  setNightSilentUpgradeEnabled(false);
  state.jobs = [];
  notify();
};

export const describeNightSilentUpgrade = (): string =>
  `夜间静默补全（上海 22:00–08:00）· schema v${NIGHT_UPGRADE_SCHEMA_VERSION} · 联系人/邮箱/品类/背调补全/产品匹配 · 与批量背调双轨 · 每晚上限约 ${MAX_JOBS_PER_NIGHT}`;
