/**
 * 创作 Agent 契约：智能在 Skills / Brief / 质检，模型只是可替换的「大脑」与「画笔」。
 * 换千问 / 开源 / 自研模型时，只换 BrainPort / ToolPort，不改业务流程。
 */

export type CreativeDomain = 'design_2d' | 'packaging' | 'video' | 'model_3d';

export type CreativePlanInput = {
  domain: CreativeDomain;
  skillId: string;
  skillLabel: string;
  skillHint: string;
  /** Skill 内置底稿（英文为主，供生图） */
  skillDefaultPrompt: string;
  /** 用户自然语言需求 */
  userBrief: string;
  /** 产品语境（可选） */
  skuCode?: string;
  skuName?: string;
  productNotes?: string;
  hasReferenceImages?: boolean;
  /** 渠道 / 卖场等扩展字段（包装等） */
  channel?: string;
  palette?: string;
};

/** 确认卡展示 + 下游工具统一吃这份 Brief */
export type CreativeBrief = {
  domain: CreativeDomain;
  skillId: string;
  /** 业务员可读标题 */
  titleZh: string;
  /** 确认卡摘要（中文，禁止供应商名） */
  summaryZh: string;
  /** 交给生图/视频工具的最终提示词 */
  toolPrompt: string;
  /** 质检清单（生成后/人工可勾） */
  qaChecklist: string[];
  /** 建议画幅提示 */
  aspectHint?: string;
  /** 是否建议多视角 */
  multiAngle?: boolean;
  /** 大脑来源标记（仅内部/管理，前台可忽略） */
  brainId: string;
};

export type CreativeBrainPort = {
  id: string;
  label: string;
  /** 把用户意图 + Skill 编成结构化 Brief；失败应抛错由上层回退 */
  plan: (input: CreativePlanInput) => Promise<CreativeBrief>;
};

export type CreativeToolKind = 'image' | 'video' | 'model3d';

export type CreativeToolRequest = {
  kind: CreativeToolKind;
  prompt: string;
  referenceImages?: string[];
  extra?: Record<string, unknown>;
};

export type CreativeToolResult = {
  urls: string[];
  raw?: unknown;
};

/** 画笔口：万相 / 开源 SD / 自研均可实现 */
export type CreativeToolPort = {
  id: string;
  kind: CreativeToolKind;
  generate: (req: CreativeToolRequest) => Promise<CreativeToolResult>;
};
