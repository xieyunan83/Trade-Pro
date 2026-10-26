/**
 * 大模型大脑：把意图升级为外贸设计向 Brief。
 * 默认走平台已配置的对话模型；失败由上层回退 ruleBrain。
 */
import { callQwen } from '../geminiService';
import type { CreativeBrief, CreativeBrainPort, CreativePlanInput } from './types';
import { ruleCreativeBrain } from './ruleBrain';

type LlmBriefJson = {
  titleZh?: string;
  summaryZh?: string;
  toolPrompt?: string;
  qaChecklist?: string[];
};

const SYSTEM_PLAN = `你是澄海玩具出口场景的「设计编排助手」。
根据 Skill 与用户需求，输出严格 JSON（不要 markdown）：
{
  "titleZh": "短标题",
  "summaryZh": "给业务员看的确认摘要，中文，禁止出现任何 AI 供应商/模型商品名",
  "toolPrompt": "给生图引擎的英文提示词，专业、可执行、含构图与光影，禁止水印与乱码字",
  "qaChecklist": ["质检项1", "质检项2", "质检项3", "质检项4"]
}
要求：保留产品身份；贴合 Skill；适合跨境电商/展会；不要编造不存在的认证文字。`;

export const llmCreativeBrain: CreativeBrainPort = {
  id: 'llm',
  label: '对话编排',
  plan: async (input) => {
    const fallback = await ruleCreativeBrain.plan(input);
    const userBlock = [
      `domain: ${input.domain}`,
      `skillId: ${input.skillId}`,
      `skillLabel: ${input.skillLabel}`,
      `skillHint: ${input.skillHint}`,
      `skillDefaultPrompt: ${input.skillDefaultPrompt}`,
      `userBrief: ${input.userBrief || '(空，请按 Skill 默认强化)'}`,
      `sku: ${input.skuName || ''} ${input.skuCode || ''}`,
      `productNotes: ${input.productNotes || ''}`,
      `channel: ${input.channel || ''}`,
      `palette: ${input.palette || ''}`,
      `hasReferenceImages: ${input.hasReferenceImages ? 'yes' : 'no'}`,
      `baselineToolPrompt: ${fallback.toolPrompt}`,
    ].join('\n');

    try {
      const raw = await callQwen(`${SYSTEM_PLAN}\n\n---\n${userBlock}`, {
        jsonMode: true,
        timeoutMs: 45_000,
      });
      let parsed: LlmBriefJson = {};
      try {
        parsed = JSON.parse(raw) as LlmBriefJson;
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]) as LlmBriefJson;
      }
      const toolPrompt = (parsed.toolPrompt || '').trim() || fallback.toolPrompt;
      const qa =
        Array.isArray(parsed.qaChecklist) && parsed.qaChecklist.length >= 2
          ? parsed.qaChecklist.map(String).slice(0, 8)
          : fallback.qaChecklist;
      return {
        ...fallback,
        titleZh: (parsed.titleZh || '').trim() || fallback.titleZh,
        summaryZh: (parsed.summaryZh || '').trim() || fallback.summaryZh,
        toolPrompt,
        qaChecklist: qa,
        brainId: 'llm',
      };
    } catch {
      return fallback;
    }
  },
};
