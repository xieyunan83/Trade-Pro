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
  'watermark, logo spam, garbled text, illegible letters, random glyphs, extra limbs, deformed geometry, morphing product, redesigning the SKU, unrequested color changes, unrequested part swaps, wrong colors vs reference, wrong packaging vs reference, stock collage, contact sheet, multi-panel grid, low-res, heavy jpeg artifacts, oversaturated neon gel lighting, fake certification seals, fake awards badges, marketplace UI chrome, AI plastic skin, text hallucination, blurry logo print, different product family';

export const UNIVERSAL_VIDEO_NEGATIVES =
  'watermark, on-screen text spam, morphing product, identity drift between frames, extra limbs, jittery camera, flicker, melting plastics, wrong SKU redesign, blurry logo, low bitrate mush, fake UI overlays, seizure cuts, garbled subtitles';

export const UNIVERSAL_3D_NEGATIVES =
  'broken topology, melted geometry, extra limbs, floating debris, watermark decals, blurry embossed logo, scene props clutter, asymmetric paired parts, holes in mesh';

/** 商业外贸画质脚注（正向，短而硬） */
export const COMMERCIAL_CRAFT_FOOTER =
  'Commercial China toy/gift export quality: catalog sharpness, true plastics/fabrics/metals, locked product identity, soft dual softbox + gentle rim, clean silhouette, no watermark, no gibberish text, ready for marketplace and trade-fair use.';

/** 有参考图时的身份锁（以参考图为唯一真相） */
export const identityLockBlock = (hasRefs: boolean, domain: 'image' | 'video' | '3d' = 'image'): string => {
  if (!hasRefs) return '';
  if (domain === 'video') {
    return 'IDENTITY LOCK: Keep the product appearance identical to the reference frame(s) across the whole clip — silhouette, proportions, colors, materials, logos/decals. Camera and motion may change; the SKU must not morph or redesign.';
  }
  if (domain === '3d') {
    return 'IDENTITY LOCK: Reconstruct the exact product from references — proportions, parts, colors and surface finish. Do not invent alternate tooling.';
  }
  return [
    'IDENTITY LOCK (STRICT): The attached product reference image(s) are the ONLY ground truth for silhouette, proportions, part count, tooling, materials, logos/decals, packaging structure and print layout.',
    'Do NOT invent a different product, swap molds, restyle faces, or freely recolor unmentioned parts.',
    'Preserve every region the user did NOT ask to change.',
  ].join(' ');
};

/**
 * 参考图二次创作指令：用户写「改哪里」，模型只改那里，其余像素级一致。
 */
export const referenceEditDirectiveBlock = (userEditBrief?: string): string => {
  const edit = (userEditBrief || '').trim();
  return joinBlocks([
    'TASK TYPE: Reference-based secondary creation / controlled product edit (NOT text-only fantasy design).',
    edit
      ? `USER EDIT REQUEST (MUST follow exactly; apply ONLY these changes): ${edit}`
      : 'USER EDIT REQUEST: Keep the product identical to reference; only improve commercial studio lighting / crop if needed — do not redesign.',
    'EDIT SCOPE RULES:',
    '- Change ONLY what the user explicitly requests (e.g. specific part color, packaging graphic, function feature, accessory, background, camera angle).',
    '- Everything else MUST stay consistent with the reference: unmentioned colors, materials, logos, proportions, packaging structure, buttons, windows, prints.',
    '- If the request is ambiguous, prefer LESS change over creative reinterpretation.',
    '- Output must still look like the SAME SKU after edits — a buyer comparing to the reference photo must recognize it instantly.',
  ]);
};

/**
 * 多参考图角色说明：确保每张图都进入指令，避免模型只吃前 1～2 张。
 * lastIsLayout：末张为版式/海报方案，前面全部为需出现的独立产品。
 */
export const multiImageRoleBlock = (
  count: number,
  opts?: { lastIsLayout?: boolean }
): string => {
  if (count <= 0) return '';
  const lastIsLayout = !!opts?.lastIsLayout && count >= 2;
  if (lastIsLayout) {
    const nProd = count - 1;
    const list = Array.from({ length: nProd }, (_, i) => `Image ${i + 1}`).join(', ');
    return [
      `MULTI-IMAGE ROLES (ALL must contribute): ${list} are SEPARATE product SKUs.`,
      `For EACH of Images 1–${nProd}: lock exact silhouette, proportions, colors, materials, logos/decals — no merging products into one hybrid, no dropping any SKU.`,
      `Image ${count} is LAYOUT / POSTER STYLE REFERENCE ONLY (composition, hierarchy, background treatment, decorative motif, typography zones) — NOT a product to replace the others.`,
      `Output ONE poster/promotional frame that places ALL products from Images 1–${nProd} following Image ${count}'s layout scheme; invent missing props/decor only in that scheme's style; never redesign the products.`,
    ].join(' ');
  }
  if (count === 1) {
    return 'REFERENCE: Image 1 is the product ground truth — keep identity locked.';
  }
  const list = Array.from({ length: count }, (_, i) => `Image ${i + 1}`).join(', ');
  return `MULTI-IMAGE ROLES (ALL must contribute): ${list} are attached references. Use every image — do not ignore later ones. Prefer product identity consistency across all product photos; if angles differ, fuse complementary views of the SAME SKU without inventing a new design.`;
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
  /** 参考图张数；用于强制「每张都生效」 */
  referenceCount?: number;
  /** 末张为版式/海报方案参考 */
  lastRefIsLayout?: boolean;
  skillNegative?: string;
  series?: boolean;
  /** 已由 Brief 拼好的主提示；传入则不再重复 Skill 底稿 */
  baseToolPrompt?: string;
  /** true：负向只返回字段，不拼进 prompt（留给将来 API） */
  negativeAsFieldOnly?: boolean;
}): CreativePromptParts => {
  const hasRefs = !!opts.hasReferenceImages;
  const refCount = Math.max(0, opts.referenceCount || (hasRefs ? 1 : 0));
  const identity = identityLockBlock(hasRefs, 'image');
  const roles = multiImageRoleBlock(refCount, { lastIsLayout: opts.lastRefIsLayout });
  const skuLine =
    opts.skuName || opts.skuCode
      ? `Product identity: ${[opts.skuName, opts.skuCode].filter(Boolean).join(' / ')}. Keep SKU appearance consistent.`
      : '';

  const editDirective = hasRefs ? referenceEditDirectiveBlock(opts.userBrief) : '';

  const positive = opts.baseToolPrompt?.trim()
    ? joinBlocks([
        // 有参考时：先钉死「只改用户要求」，再叠 Brief，避免编排结果冲掉编辑范围
        hasRefs ? editDirective : '',
        opts.baseToolPrompt,
        roles,
        identity,
        opts.series ? SERIES_CONSISTENCY_BLOCK : '',
        COMMERCIAL_CRAFT_FOOTER,
      ])
    : joinBlocks([
        hasRefs ? editDirective : '',
        hasRefs
          ? opts.skillDefaultPrompt
            ? `Skill framing (secondary to edit request + identity lock): ${opts.skillDefaultPrompt}`
            : 'Produce a commercial catalog-ready product visual after applying the edit request.'
          : opts.skillDefaultPrompt ||
            'Create a polished commercial product design visual',
        opts.craftNotes ? `Craft / channel brief: ${opts.craftNotes}` : '',
        !hasRefs && opts.userBrief ? `User creative direction: ${opts.userBrief}` : '',
        skuLine,
        opts.productNotes ? `Product notes: ${opts.productNotes}` : '',
        opts.channel ? `Retail channel context: ${opts.channel}` : '',
        opts.palette ? `Color / finish direction: ${opts.palette}` : '',
        roles,
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
  /** Skill 渠道脚注，如 Amazon Gallery / booth loop */
  skillFrameworkNote?: string;
}): CreativePromptParts => {
  const positive = joinBlocks([
    opts.basePrompt,
    opts.storyboard ? `Shot list / storyboard: ${opts.storyboard}` : '',
    opts.skillFrameworkNote || '',
    identityLockBlock(!!opts.hasReferenceImages, 'video'),
    'Smooth cinematic motion, stable framing, commercial ecommerce clarity, muted-friendly visuals, no watermark.',
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
1) 有参考图时（二次创作）：toolPrompt 必须以「Reference-based edit」开头；明确 USER EDIT REQUEST；只改用户点名的部位/颜色/包装/功能/背景等；未点名区域必须与参考图一致；禁止整体换模、随意换色、换脸。
2) 无参考图时：按文字描述创作，仍保持商业玩具出口画质。
3) 保留 SKU 身份；贴合 Skill；适合跨境电商/展会。
4) 不要编造认证文字、平台徽章、水印或乱码字。
5) 光影默认电商柔箱 + 轻轮廓光；避免霓虹凝胶与廉价贴纸风。
6) summaryZh / titleZh 禁止出现任何大模型或供应商商品名。`;
