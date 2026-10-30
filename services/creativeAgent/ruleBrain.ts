/**
 * 无大模型也能跑的规则大脑：用 Skill 底稿 + 产品语境 + 质量内核拼 Brief。
 * 保证「换模型前 / 模型挂了」平台仍专业可用。
 */
import { composeImageGenerationPrompt } from '../creativeQualityKit';
import type { CreativeBrief, CreativeBrainPort, CreativePlanInput } from './types';

const QA_BY_DOMAIN: Record<CreativePlanInput['domain'], string[]> = {
  design_2d: [
    '主体完整、无残缺肢体或错误结构',
    '背景干净，无水印杂字（除非需求要求文案）',
    '色彩与材质和描述/参考图一致，适合外贸电商展示',
    '构图符合当前 Skill（主图/Listing/社媒等）',
    '与参考图为同一 SKU 身份（有参考时）',
  ],
  packaging: [
    '包装形态与 Skill 一致（开窗/吸塑/礼盒等）',
    '卖场陈列逻辑清晰，可识别货架/挂钩用途',
    '留出 Logo / 年龄标 / 认证区的视觉空间',
    '无乱码文字；若有示意字仅为占位级',
    '产品开窗/主视觉与实物身份一致',
  ],
  video: [
    '产品外观与参考图一致，全程无变形换脸',
    '运镜稳定，无明显闪烁变形',
    '时长与画幅符合确认卡设定',
    '无水印、无乱码字幕',
  ],
  model_3d: [
    '外形与参考图一致，无明显拓扑破面',
    '比例正确，可作展示或打印预备',
    '导出格式可用（如 GLB）',
  ],
};

const buildSummaryZh = (input: CreativePlanInput): string => {
  const bits = [
    `Skill「${input.skillLabel}」`,
    input.skuName || input.skuCode ? `产品 ${input.skuName || input.skuCode}` : null,
    input.hasReferenceImages ? '含参考图·身份锁定' : '纯描述',
    input.userBrief.trim() ? `需求：${input.userBrief.trim().slice(0, 80)}` : input.skillHint,
  ].filter(Boolean);
  return bits.join(' · ');
};

export const ruleCreativeBrain: CreativeBrainPort = {
  id: 'rule',
  label: '规则编排',
  plan: async (input) => {
    const multiAngle = input.skillId === 'multi_angle';
    const series = input.skillId === 'listing_set' || multiAngle;
    const composed = composeImageGenerationPrompt({
      skillDefaultPrompt: input.skillDefaultPrompt,
      craftNotes: input.skillCraftNotes,
      userBrief: input.userBrief,
      skuName: input.skuName,
      skuCode: input.skuCode,
      productNotes: input.productNotes,
      channel: input.channel,
      palette: input.palette,
      hasReferenceImages: input.hasReferenceImages,
      skillNegative: input.skillNegativePrompt,
      series,
      negativeAsFieldOnly: false,
    });
    const brief: CreativeBrief = {
      domain: input.domain,
      skillId: input.skillId,
      titleZh: `${input.skillLabel}方案`,
      summaryZh: buildSummaryZh(input),
      toolPrompt: composed.prompt,
      qaChecklist:
        input.skillQaChecklist && input.skillQaChecklist.length >= 2
          ? input.skillQaChecklist.slice(0, 8)
          : QA_BY_DOMAIN[input.domain] || QA_BY_DOMAIN.design_2d,
      multiAngle,
      brainId: 'rule',
    };
    return brief;
  },
};
