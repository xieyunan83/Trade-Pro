/**
 * 无大模型也能跑的规则大脑：用 Skill 底稿 + 产品语境拼 Brief。
 * 保证「换模型前 / 模型挂了」平台仍专业可用。
 */
import type { CreativeBrief, CreativeBrainPort, CreativePlanInput } from './types';

const QA_BY_DOMAIN: Record<CreativePlanInput['domain'], string[]> = {
  design_2d: [
    '主体完整、无残缺肢体或错误结构',
    '背景干净，无水印杂字（除非需求要求文案）',
    '色彩与材质和描述一致，适合外贸电商展示',
    '构图符合当前 Skill（主图/Listing/社媒等）',
  ],
  packaging: [
    '包装形态与 Skill 一致（开窗/吸塑/礼盒等）',
    '卖场陈列逻辑清晰，可识别货架/挂钩用途',
    '留出 Logo / 年龄标 / 认证区的视觉空间',
    '无乱码文字；若有示意字仅为占位级',
  ],
  video: [
    '产品外观与参考图一致',
    '运镜稳定，无明显闪烁变形',
    '时长与画幅符合确认卡设定',
  ],
  model_3d: [
    '外形与参考图一致，无明显拓扑破面',
    '比例正确，可作展示或打印预备',
    '导出格式可用（如 GLB）',
  ],
};

const buildToolPrompt = (input: CreativePlanInput): string => {
  const parts: string[] = [];
  if (input.skillDefaultPrompt.trim()) parts.push(input.skillDefaultPrompt.trim());
  if (input.skillCraftNotes?.trim()) {
    parts.push(`Craft / channel brief: ${input.skillCraftNotes.trim()}`);
  }
  if (input.userBrief.trim()) {
    parts.push(`User creative direction: ${input.userBrief.trim()}`);
  }
  if (input.skuName || input.skuCode) {
    parts.push(
      `Product identity: ${[input.skuName, input.skuCode].filter(Boolean).join(' / ')}. Keep SKU appearance consistent.`
    );
  }
  if (input.productNotes?.trim()) {
    parts.push(`Product notes: ${input.productNotes.trim()}`);
  }
  if (input.channel) parts.push(`Retail channel context: ${input.channel}`);
  if (input.palette) parts.push(`Color / finish direction: ${input.palette}`);
  if (input.hasReferenceImages) {
    parts.push('Follow attached reference images for product shape, colors, and branding.');
  }
  parts.push(
    'Commercial quality, sharp focus, no watermark, no random gibberish text, export-ready for China toy / gift trade.'
  );
  if (input.skillNegativePrompt?.trim()) {
    parts.push(`Avoid: ${input.skillNegativePrompt.trim()}`);
  }
  return parts.join('\n');
};

const buildSummaryZh = (input: CreativePlanInput): string => {
  const bits = [
    `Skill「${input.skillLabel}」`,
    input.skuName || input.skuCode ? `产品 ${input.skuName || input.skuCode}` : null,
    input.hasReferenceImages ? '含参考图' : '纯描述',
    input.userBrief.trim() ? `需求：${input.userBrief.trim().slice(0, 80)}` : input.skillHint,
  ].filter(Boolean);
  return bits.join(' · ');
};

export const ruleCreativeBrain: CreativeBrainPort = {
  id: 'rule',
  label: '规则编排',
  plan: async (input) => {
    const multiAngle = input.skillId === 'multi_angle';
    const brief: CreativeBrief = {
      domain: input.domain,
      skillId: input.skillId,
      titleZh: `${input.skillLabel}方案`,
      summaryZh: buildSummaryZh(input),
      toolPrompt: buildToolPrompt(input),
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
