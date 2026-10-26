/**
 * 创作运行时：选大脑 → 出 Brief →（UI 确认）→ 下游工具执行。
 * 智能在编排与 Skill；模型可随时替换。
 */
import type {
  CreativeBrief,
  CreativeBrainPort,
  CreativePlanInput,
  CreativeToolPort,
  CreativeToolRequest,
  CreativeToolResult,
} from './types';
import { llmCreativeBrain } from './llmBrain';
import { ruleCreativeBrain } from './ruleBrain';

export type PlanCreativeOptions = {
  /** 强制指定大脑；默认先试对话模型，失败回退规则 */
  brain?: CreativeBrainPort;
  /** 跳过大模型，仅规则（离线/省额度） */
  ruleOnly?: boolean;
};

let registeredBrain: CreativeBrainPort | null = null;
const toolRegistry = new Map<string, CreativeToolPort>();

/** 注册自研/开源大脑（启动时或管理后台切换） */
export const registerCreativeBrain = (brain: CreativeBrainPort) => {
  registeredBrain = brain;
};

export const registerCreativeTool = (tool: CreativeToolPort) => {
  toolRegistry.set(`${tool.kind}:${tool.id}`, tool);
};

export const listCreativeTools = (kind?: CreativeToolPort['kind']): CreativeToolPort[] => {
  const all = [...toolRegistry.values()];
  return kind ? all.filter((t) => t.kind === kind) : all;
};

/**
 * 生成确认卡 Brief：专业度来自 Skill + 编排，不绑死某一家模型。
 */
export const planCreativeBrief = async (
  input: CreativePlanInput,
  opts: PlanCreativeOptions = {}
): Promise<CreativeBrief> => {
  if (opts.ruleOnly) {
    return ruleCreativeBrain.plan(input);
  }
  const brain = opts.brain || registeredBrain || llmCreativeBrain;
  try {
    return await brain.plan(input);
  } catch {
    return ruleCreativeBrain.plan(input);
  }
};

/** 用已注册工具执行；未注册时抛错，由业务层走现有 generateDesignImages 等 */
export const runCreativeTool = async (
  kind: CreativeToolRequest['kind'],
  req: Omit<CreativeToolRequest, 'kind'>,
  preferredId?: string
): Promise<CreativeToolResult> => {
  const tools = listCreativeTools(kind);
  const tool =
    (preferredId && tools.find((t) => t.id === preferredId)) || tools[0];
  if (!tool) {
    throw new Error(`未注册 ${kind} 工具。请先 registerCreativeTool，或走业务层现有生成函数。`);
  }
  return tool.generate({ ...req, kind });
};

export { ruleCreativeBrain, llmCreativeBrain };
