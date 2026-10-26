/**
 * 澄海玩具出口 · 外贸任务流（小白主路径）
 * 持久化当前项目上下文，驱动指挥舱「下一步」与模块跳转。
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
};

export const JOURNEY_STAGES: JourneyStageDef[] = [
  {
    id: 'select',
    step: 1,
    title: '选品定盘',
    blurb: '录入或导入 SKU，对照目标市场看适市建议',
    module: ModuleType.PRODUCT_CATALOG,
    cta: '去产品库',
  },
  {
    id: 'quote',
    step: 2,
    title: '报价组合',
    blurb: '生成选品单 / 报价草稿，形成可发给客户的产品包',
    module: ModuleType.PRODUCT_QUOTE,
    cta: '去做报价',
  },
  {
    id: 'design',
    step: 3,
    title: '设计出样',
    blurb: '平面主图 / 3D 概念，让小白也能做出专业视觉',
    module: ModuleType.PRODUCT_DESIGN_2D,
    cta: '去做设计',
  },
  {
    id: 'acquire',
    step: 4,
    title: '找客获客',
    blurb: '按市场剧本搜索客户，或一键启动自动化流水线',
    module: ModuleType.PROMO_GENERATOR,
    cta: '启动获客',
  },
  {
    id: 'analyze',
    step: 5,
    title: '背调分析',
    blurb: '在获客作业里查看队列与报告；点开单条可看完整背调',
    // 背调作业列表在营销工具；无当前报告时进 BACKGROUND 会空白
    module: ModuleType.PROMO_GENERATOR,
    cta: '查看作业',
  },
  {
    id: 'outreach',
    step: 6,
    title: '触达开发',
    blurb: '开发策略与邮件；可先选历史客户再写信',
    module: ModuleType.STRATEGY,
    cta: '写开发信',
  },
  {
    id: 'crm',
    step: 7,
    title: '跟进成交',
    blurb: 'CRM 沉淀客户与决策人，持续跟进到样品与订单',
    module: ModuleType.CLIENT_CRM,
    cta: '打开 CRM',
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

/** 根据项目上下文 + 业务计数，推断当前应推进的阶段 */
export const resolveActiveStage = (
  state: TradeJourneyState,
  hint: JourneyProgressHint
): JourneyStageDef => {
  const done = new Set(state.completedStages);
  const skuCount = hint.skuCount || loadCatalogSkus().length;

  if (!state.asset || !state.targetMarket.trim() || !state.productFocus.trim()) {
    return JOURNEY_STAGES[0];
  }
  if (skuCount < 1 && !done.has('select')) return JOURNEY_STAGES[0];
  if (!done.has('quote') && skuCount > 0) return JOURNEY_STAGES[1];
  if (!done.has('design')) return JOURNEY_STAGES[2];
  if (hint.pendingTasks + hint.failedTasks > 0 || (!done.has('acquire') && hint.completedBg < 3)) {
    return JOURNEY_STAGES[3];
  }
  if (hint.completedBg > 0 && !done.has('analyze')) return JOURNEY_STAGES[4];
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
