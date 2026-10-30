/**
 * 创作质量内核：把「可复用 Skill 工艺 + 身份锁 + 负向库 + 商业质检」收成一套，
 * 供平面 / 包装 / 视频 / 社媒 / 3D 共用。对齐专业设计 Agent 工作流（Skills 编码最佳实践、
 * 参考图为真相、拒绝库防漂移），不依赖某一家前端品牌。
 */

export type CreativePromptParts = {
  /** 给生图/视频主通道的正向提示 */
  prompt: string;
  /** 合并后的负向（可走 API negative_prompt，或拼进提示词） */
  negative: string;
};

/** 全站通用负向：产品身份漂移、乱码字、水印、低质伪认证 */
export const UNIVERSAL_IMAGE_NEGATIVES =
  'watermark, logo spam, garbled text, illegible letters, random glyphs, extra limbs, deformed geometry, morphing product, redesigning the SKU, wrong colors vs reference, stock collage, contact sheet, multi-panel grid, low-res, heavy jpeg artifacts, oversaturated neon gel lighting, fake certification seals, fake awards badges, marketplace UI chrome, AI plastic skin, text hallucination, blurry logo print';

export const UNIVERSAL_VIDEO_NEGATIVES =
  'watermark, on-screen text spam, morphing product, identity drift between frames, extra limbs, jittery camera, flicker, melting plastics, wrong SKU redesign, blurry logo, low bitrate mush, fake UI overlays, seizure cuts, garbled subtitles';

export const UNIVERSAL_3D_NEGATIVES =
  'broken topology, melted geometry, extra limbs, floating debris, watermark decals, blurry embossed logo, scene props clutter, asymmetric paired parts, holes in mesh';

/** 商业外贸画质脚注（正向，短而硬） */
export const COMMERCIAL_CRAFT_FOOTER =
  'Commercial China toy/gift export quality: catalog sharpness, true plastics/fabrics/metals, locked product identity, soft dual softbox + gentle rim, clean silhouette, no watermark, no gibberish text, ready for marketplace and trade-fair use.';

/** 有参考图时的身份锁（Lovart 式「以参考为真相」） */
export const identityLockBlock = (hasRefs: boolean, domain: 'image' | 'video' | '3d' = 'image'): string => {
  if (!hasRefs) return '';
  if (domain === 'video') {
    return 'IDENTITY LOCK: Keep the product appearance identical to the reference frame(s) across the whole clip — silhouette, proportions, colors, materials, logos/decals. Camera and motion may change; the SKU must not morph or redesign.';
  }
  if (domain === '3d') {
    return 'IDENTITY LOCK: Reconstruct the exact product from references — proportions, parts, colors and surface finish. Do not invent alternate tooling.';
  }
  return 'IDENTITY LOCK: Treat reference image(s) as the sole ground truth for silhouette, proportions, colors, materials, logos/decals placement and tooling. Do not invent a different product. Only change camera, framing, backdrop or lighting as instructed.';
};

/** 系列一致性（Listing 套图 / 多张连出） */
export const SERIES_CONSISTENCY_BLOCK =
  'SERIES CONSISTENCY: If producing a set, keep identical product identity, color temperature, softbox look and crop margins across frames; vary only the selling-point focus.';

export const mergeNegatives = (...chunks: Array<string | undefined | null>): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    const raw = (chunk || '').trim();
    if (!raw) continue;
    for (const part of raw.split(/[,;\n]+/)) {
      const t = part.trim().toLowerCase();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(part.trim());
    }
  }
  return out.join(', ');
};

const joinBlocks = (parts: Array<string | undefined | null>): string =>
  parts
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join('\n');

/**
 * 组装平面 / 包装 / 社媒生图提示：正向工艺 + 身份锁 + 负向库。
 * 万相等无独立 negative 字段时，把 NEGATIVE CONSTRAINTS 附在提示词末尾（与海报模板同策略）。
 */
export const composeImageGenerationPrompt = (opts: {
  skillDefaultPrompt?: string;
  craftNotes?: string;
  userBrief?: string;
  skuName?: string;
  skuCode?: string;
  productNotes?: string;
  channel?: string;
  palette?: string;
  hasReferenceImages?: boolean;
  skillNegative?: string;
  series?: boolean;
  /** 已由 Brief 拼好的主提示；传入则不再重复 Skill 底稿 */
  baseToolPrompt?: string;
  /** true：负向只返回字段，不拼进 prompt（留给将来 API） */
  negativeAsFieldOnly?: boolean;
}): CreativePromptParts => {
  const hasRefs = !!opts.hasReferenceImages;
  const identity = identityLockBlock(hasRefs, 'image');
  const skuLine =
    opts.skuName || opts.skuCode
      ? `Product identity: ${[opts.skuName, opts.skuCode].filter(Boolean).join(' / ')}. Keep SKU appearance consistent.`
      : '';

  const positive = opts.baseToolPrompt?.trim()
    ? joinBlocks([
        opts.baseToolPrompt,
        identity,
        opts.series ? SERIES_CONSISTENCY_BLOCK : '',
        COMMERCIAL_CRAFT_FOOTER,
      ])
    : joinBlocks([
        opts.skillDefaultPrompt,
        opts.craftNotes ? `Craft / channel brief: ${opts.craftNotes}` : '',
        opts.userBrief ? `User creative direction: ${opts.userBrief}` : '',
        skuLine,
        opts.productNotes ? `Product notes: ${opts.productNotes}` : '',
        opts.channel ? `Retail channel context: ${opts.channel}` : '',
        opts.palette ? `Color / finish direction: ${opts.palette}` : '',
        hasRefs ? 'Follow attached reference images for product shape, colors, and branding.' : '',
        identity,
        opts.series ? SERIES_CONSISTENCY_BLOCK : '',
        COMMERCIAL_CRAFT_FOOTER,
      ]);

  const negative = mergeNegatives(UNIVERSAL_IMAGE_NEGATIVES, opts.skillNegative);
  const prompt = opts.negativeAsFieldOnly
    ? positive
    : joinBlocks([positive, negative ? `NEGATIVE CONSTRAINTS (must avoid): ${negative}` : '']);

  return { prompt, negative };
};

export const composeVideoGenerationPrompt = (opts: {
  basePrompt: string;
  storyboard?: string;
  hasReferenceImages?: boolean;
  skillNegative?: string;
}): CreativePromptParts => {
  const positive = joinBlocks([
    opts.basePrompt,
    opts.storyboard ? `Shot list / storyboard: ${opts.storyboard}` : '',
    identityLockBlock(!!opts.hasReferenceImages, 'video'),
    'Smooth cinematic motion, stable framing, commercial ecommerce clarity, no watermark.',
  ]);
  const negative = mergeNegatives(UNIVERSAL_VIDEO_NEGATIVES, opts.skillNegative);
  return { prompt: positive, negative };
};

/** LLM 编排系统约束：强化一致性与负向，禁止供应商名 */
export const CREATIVE_LLM_SYSTEM_PLAN = `你是澄海玩具出口场景的「设计编排助手」。
根据 Skill 与用户需求，输出严格 JSON（不要 markdown）：
{
  "titleZh": "短标题",
  "summaryZh": "给业务员看的确认摘要，中文，禁止出现任何 AI 供应商/模型商品名",
  "toolPrompt": "给生图/视频引擎的英文提示词：含构图、光影、材质、画幅意图；必须含产品身份锁定；专业可执行",
  "qaChecklist": ["质检项1", "质检项2", "质检项3", "质检项4"]
}
硬性规则：
1) 有参考图时：toolPrompt 必须强调以参考图为唯一外形真相，禁止换脸/换色/换结构。
2) 保留 SKU 身份；贴合 Skill；适合跨境电商/展会。
3) 不要编造认证文字、平台徽章、水印或乱码字。
4) 光影默认电商柔箱 + 轻轮廓光；避免霓虹凝胶与廉价贴纸风。
5) summaryZh / titleZh 禁止出现任何大模型或供应商商品名。`;
