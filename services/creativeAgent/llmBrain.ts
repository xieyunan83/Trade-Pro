/**
 * 大模型大脑：把意图升级为外贸设计向 Brief。
 * 默认走平台已配置的对话模型；失败由上层回退 ruleBrain。
 */
import { callQwen } from '../geminiService';
import {
  CREATIVE_LLM_SYSTEM_PLAN,
  composeImageGenerationPrompt,
} from '../creativeQualityKit';
import type { CreativeBrief, CreativeBrainPort, CreativePlanInput } from './types';
import { ruleCreativeBrain } from './ruleBrain';

type LlmBriefJson = {
  titleZh?: string;
  summaryZh?: string;
  toolPrompt?: string;
  qaChecklist?: string[];
};

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
      `skillNegativePrompt: ${input.skillNegativePrompt || ''}`,
      `skillCraftNotes: ${input.skillCraftNotes || ''}`,
      `userBrief: ${input.userBrief || '(空，请按 Skill 默认强化)'}`,
      `sku: ${input.skuName || ''} ${input.skuCode || ''}`,
      `productNotes: ${input.productNotes || ''}`,
      `channel: ${input.channel || ''}`,
      `palette: ${input.palette || ''}`,
      `hasReferenceImages: ${input.hasReferenceImages ? 'yes' : 'no'}`,
      `baselineToolPrompt: ${fallback.toolPrompt}`,
    ].join('\n');

    try {
      const raw = await callQwen(`${CREATIVE_LLM_SYSTEM_PLAN}\n\n---\n${userBlock}`, {
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
      const llmCore = (parsed.toolPrompt || '').trim();
      // 再套质量内核：身份锁 + 负向库 + 商业脚注，避免 LLM 漏掉一致性
      const hardened = composeImageGenerationPrompt({
        baseToolPrompt: llmCore || fallback.toolPrompt,
        hasReferenceImages: input.hasReferenceImages,
        skillNegative: input.skillNegativePrompt,
        series: input.skillId === 'listing_set' || input.skillId === 'multi_angle',
      });
      const toolPrompt = hardened.prompt;
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
