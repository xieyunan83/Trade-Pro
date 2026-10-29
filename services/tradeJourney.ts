/**
 * 澄海玩具出口 · 外贸任务流（小白主路径）
 * 持久化当前项目上下文，驱动指挥舱「下一步」与模块跳转。
 *
 * 依赖约定：
 * - standalone：可单独执行（无硬前置）
 * - requires：硬前置阶段；未满足时仍可点进模块，但 UI 会提示先完成前置
 * - 软建议用 prereqNote 说明（不拦截）
 */
import { ModuleType } from '../types';
import { loadCatalogSkus } from './productCatalogTypes';

const STORAGE_KEY = 'trade_scout_journey_v1';

export type JourneyStageId =
  | 'select'
  | 'quote'
  | 'design'
  | 'acquire'
  | 'analyze'
  | 'outreach'
  | 'crm';

export type JourneyAsset = 'factory' | 'idea' | 'clients';

export type TradeJourneyState = {
  updatedAt: number;
  /** 我有什么 */
  asset: JourneyAsset | null;
  /** 目标市场文案 */
  targetMarket: string;
  /** 主推品类 / 关键词 */
  productFocus: string;
  /** 用户勾选已完成的阶段 */
  completedStages: JourneyStageId[];
  /** 最近一次适市结论摘要 */
  lastFitSummary?: string;
};

export type JourneyStageDef = {
  id: JourneyStageId;
  step: number;
  title: string;
  blurb: string;
  module: ModuleType;
  cta: string;
  /** 可单独执行，无硬前置 */
  standalone: boolean;
  /** 硬前置阶段（建议先完成；未完成时显示提示） */
  requires?: JourneyStageId[];
  /** 软建议说明 */
  prereqNote?: string;
};

export const JOURNEY_STAGES: JourneyStageDef[] = [
  {
    id: 'select',
    step: 1,
    title: '选品定盘',
    blurb: '录入或导入 SKU，对照目标市场看适市建议',
    module: ModuleType.PRODUCT_CATALOG,
    cta: '去产品库',
    standalone: true,
    prereqNote: '推荐起点；有现成产品库时可跳过勾选',
  },
  {
    id: 'quote',
    step: 2,
    title: '报价组合',
    blurb: '生成选品单 / 报价草稿，形成可发给客户的产品包',
    module: ModuleType.PRODUCT_QUOTE,
    cta: '去做报价',
    standalone: true,
    prereqNote: '建议先有 SKU（选品或已有产品库）',
  },
  {
    id: 'design',
    step: 3,
    title: '设计出样',
    blurb: '平面主图 / 3D 概念，让小白也能做出专业视觉',
    module: ModuleType.PRODUCT_DESIGN_2D,
    cta: '去做设计',
    standalone: true,
    prereqNote: '可与选品并行；有主推品类时效果更好',
  },
  {
    id: 'acquire',
    step: 4,
    title: '找客获客',
    blurb: '按市场剧本搜索客户，或一键启动自动化流水线',
    module: ModuleType.PROMO_GENERATOR,
    cta: '启动获客',
    standalone: true,
    prereqNote: '可单独执行；定好市场与品类更准',
  },
  {
    id: 'analyze',
    step: 5,
    title: '背调分析',
    blurb: '在获客作业里查看队列与报告；点开单条可看完整背调',
    // 背调作业列表在营销工具；无当前报告时进 BACKGROUND 会空白
    module: ModuleType.PROMO_GENERATOR,
    cta: '查看作业',
    standalone: false,
    requires: ['acquire'],
    prereqNote: '需先有获客结果或待背调作业',
  },
  {
    id: 'outreach',
    step: 6,
    title: '触达开发',
    blurb: '开发策略与邮件；可先选历史客户再写信',
    module: ModuleType.STRATEGY,
    cta: '写开发信',
    standalone: true,
    prereqNote: '建议先有客户（获客/CRM）；有名单可直接写',
  },
  {
    id: 'crm',
    step: 7,
    title: '跟进成交',
    blurb: 'CRM 沉淀客户与决策人，持续跟进到样品与订单',
    module: ModuleType.CLIENT_CRM,
    cta: '打开 CRM',
    standalone: true,
    prereqNote: '可随时打开；有客户后跟进更有内容',
  },
];

export type JourneyProgressHint = {
  skuCount: number;
  pendingTasks: number;
  failedTasks: number;
  completedBg: number;
  crmCount: number;
};

const defaultState = (): TradeJourneyState => ({
  updatedAt: 0,
  asset: null,
  targetMarket: '',
  productFocus: '',
  completedStages: [],
});

export const loadTradeJourney = (): TradeJourneyState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as TradeJourneyState;
    return {
      ...defaultState(),
      ...parsed,
      completedStages: Array.isArray(parsed.completedStages) ? parsed.completedStages : [],
    };
  } catch {
    return defaultState();
  }
};

export const saveTradeJourney = (state: TradeJourneyState): TradeJourneyState => {
  const next = { ...state, updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
};

export const patchTradeJourney = (
  partial: Partial<TradeJourneyState>
): TradeJourneyState => {
  const cur = loadTradeJourney();
  return saveTradeJourney({ ...cur, ...partial });
};

export const toggleJourneyStage = (id: JourneyStageId, done: boolean): TradeJourneyState => {
  const cur = loadTradeJourney();
  const set = new Set(cur.completedStages);
  if (done) set.add(id);
  else set.delete(id);
  return saveTradeJourney({ ...cur, completedStages: Array.from(set) });
};

export type StageGate = {
  /** 硬前置是否满足（可安心执行） */
  ready: boolean;
  /** 未满足时的短提示；满足则为空 */
  blocker: string;
  /** 软建议（不拦截） */
  tip: string;
};

/** 判断某阶段当前是否具备执行条件（硬前置 + 业务计数） */
export const evaluateStageGate = (
  stage: JourneyStageDef,
  state: TradeJourneyState,
  hint: JourneyProgressHint
): StageGate => {
  const done = new Set(state.completedStages);
  const tip = stage.prereqNote || '';
  const skuCount = hint.skuCount || loadCatalogSkus().length;

  // 已有客户名单：背调 / CRM / 触达可直接做
  if (state.asset === 'clients' && (stage.id === 'analyze' || stage.id === 'crm' || stage.id === 'outreach')) {
    return { ready: true, blocker: '', tip };
  }

  if (stage.id === 'quote' && skuCount < 1 && !done.has('select')) {
    return {
      ready: true,
      blocker: '',
      tip: tip || '建议先录入 SKU',
    };
  }

  if (stage.id === 'analyze') {
    const hasWork =
      done.has('acquire') ||
      hint.completedBg > 0 ||
      hint.pendingTasks > 0 ||
      hint.failedTasks > 0;
    if (!hasWork) {
      return {
        ready: false,
        blocker: '请先完成「找客获客」，或等待背调作业出现后再查看',
        tip,
      };
    }
  }

  if (stage.requires?.length) {
    const missing = stage.requires.filter((id) => !done.has(id));
    // 业务计数可替代「勾选完成」
    if (stage.id === 'analyze') {
      /* 已在上方用作业计数判断 */
    } else if (missing.length) {
      const titles = missing
        .map((id) => JOURNEY_STAGES.find((s) => s.id === id)?.title || id)
        .join('、');
      return {
        ready: false,
        blocker: `建议先完成：${titles}`,
        tip,
      };
    }
  }

  return { ready: true, blocker: '', tip };
};

/** 根据项目上下文 + 业务计数，推断当前应推进的阶段 */
export const resolveActiveStage = (
  state: TradeJourneyState,
  hint: JourneyProgressHint
): JourneyStageDef => {
  const done = new Set(state.completedStages);
  const skuCount = hint.skuCount || loadCatalogSkus().length;

  // 已有客户名单：优先推背调 / CRM，而不是强行选品
  if (state.asset === 'clients') {
    if (hint.pendingTasks + hint.failedTasks > 0 || (!done.has('analyze') && hint.completedBg < 1)) {
      return JOURNEY_STAGES.find((s) => s.id === 'analyze') || JOURNEY_STAGES[4];
    }
    if (!done.has('outreach')) return JOURNEY_STAGES.find((s) => s.id === 'outreach') || JOURNEY_STAGES[5];
    if (!done.has('crm') || hint.crmCount < 1) return JOURNEY_STAGES.find((s) => s.id === 'crm') || JOURNEY_STAGES[6];
  }

  if (!state.asset || !state.targetMarket.trim() || !state.productFocus.trim()) {
    return JOURNEY_STAGES[0];
  }
  if (skuCount < 1 && !done.has('select')) return JOURNEY_STAGES[0];
  if (!done.has('quote') && skuCount > 0) return JOURNEY_STAGES[1];
  if (!done.has('design')) return JOURNEY_STAGES[2];
  if (hint.pendingTasks + hint.failedTasks > 0 || (!done.has('acquire') && hint.completedBg < 3)) {
    return JOURNEY_STAGES[3];
  }
  if ((hint.completedBg > 0 || hint.pendingTasks > 0) && !done.has('analyze')) return JOURNEY_STAGES[4];
  if (!done.has('outreach')) return JOURNEY_STAGES[5];
  if (!done.has('crm') || hint.crmCount < 1) return JOURNEY_STAGES[6];
  for (const s of JOURNEY_STAGES) {
    if (!done.has(s.id)) return s;
  }
  return JOURNEY_STAGES[JOURNEY_STAGES.length - 1];
};

export const ASSET_OPTIONS: { id: JourneyAsset; label: string; tip: string }[] = [
  { id: 'factory', label: '我有工厂货源', tip: '先建产品库与报价，再按市场剧本获客' },
  { id: 'idea', label: '我有产品想法', tip: '先适市与设计出样，再找匹配买家' },
  { id: 'clients', label: '我已有客户名单', tip: '直接背调 / 入 CRM，再补产品包与开发信' },
];
