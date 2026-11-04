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
 * 末张版式 + 前面产品：强制「换品入版」，禁止复刻版式图里的原产品。
 * 前面多张图无论同 SKU 多角度还是多 SKU，都必须各自入画。
 */
export const layoutProductSwapDirectiveBlock = (productCount: number): string => {
  const n = Math.max(1, productCount);
  return [
    'CRITICAL TASK — LAYOUT SWAP (NOT COPY):',
    `Images 1–${n} are OUR product PHOTO CUTOUTS (same SKU at different camera angles OR different SKUs). Image ${n + 1} is ONLY a layout / poster template.`,
    `Rebuild the poster using Image ${n + 1}'s composition EXACTLY: color-block split, typography zones, hierarchy, decorative motifs, margins, product-slot positions — but replace EVERY template merchandise with OUR cutouts.`,
    `PRODUCT SLOT RULE: the template shows multiple product heroes around the text — fill those slots with Images 1–${n}. EACH of Images 1–${n} MUST appear as its OWN separate cutout (one slot per Image).`,
    `If the template has more slots than ${n}, reuse only after all ${n} refs are already placed; if fewer slots, prefer the clearest angles but NEVER drop a provided Image silently when space allows.`,
    `FORBIDDEN: near-copy of the template merchandise; inventing new camera angles from Image 1 alone; cloning Image 1 into every slot; ignoring Images 2–${n}; stacking products over the template's headline/mission text zones.`,
    `REQUIRED: buyer instantly recognizes OUR product identity from EACH of Images 1–${n}; text zones stay clear like the template.`,
  ].join(' ');
};

/**
 * 多参考图角色说明：确保每张图都进入指令，避免模型只吃前 1～2 张。
 * lastIsLayout：末张为版式/海报方案，前面全部为需出现的产品切图。
 * distinctProducts：多 SKU 整合（每张产品都必须出现在成图中）。
 */
export const multiImageRoleBlock = (
  count: number,
  opts?: { lastIsLayout?: boolean; distinctProducts?: boolean }
): string => {
  if (count <= 0) return '';
  const lastIsLayout = !!opts?.lastIsLayout && count >= 2;
  if (lastIsLayout) {
    const nProd = count - 1;
    const list = Array.from({ length: nProd }, (_, i) => `Image ${i + 1}`).join(', ');
    return [
      layoutProductSwapDirectiveBlock(nProd),
      `MULTI-IMAGE ROLES: ${list} = PRODUCT ground truth cutouts (silhouette, colors, materials, logos, AND camera angle/pose locked per Image).`,
      `Image ${count} = LAYOUT TEMPLATE ONLY (composition / background / type hierarchy / decor). Do NOT keep Image ${count}'s original merchandise.`,
      `Output ONE poster that places ALL ${nProd} cutouts from Images 1–${nProd} into Image ${count}'s layout — never invent missing angles from a single photo.`,
    ].join(' ');
  }
  if (count === 1) {
    return 'REFERENCE: Image 1 is the product ground truth — keep identity locked.';
  }
  const list = Array.from({ length: count }, (_, i) => `Image ${i + 1}`).join(', ');
  if (opts?.distinctProducts) {
    return [
      `MULTI-PRODUCT INTEGRATION (MANDATORY): ${list} are DISTINCT product SKUs (not alternate angles of one item).`,
      `EVERY product in Images 1–${count} MUST appear as a clear, recognizable hero in the final single promotional poster.`,
      `FORBIDDEN: using only Image 1; dropping/hiding Images 2–${count}; merging SKUs into a chimera; outputting a single-product catalog shot.`,
      `REQUIRED: one cohesive multi-SKU commercial cover featuring all ${count} products with identity locked to each reference.`,
    ].join(' ');
  }
  // 同 SKU 多角度：必须把每张参考图都摆进成图，禁止只吃正面再“编造”侧面
  return [
    `MULTI-VIEW REFERENCES (MANDATORY — ALL ${count} MUST APPEAR): ${list} are DIFFERENT camera angles / poses of the SAME product.`,
    `The final poster MUST show ${count} distinct product cutouts — placement 1 = Image 1's exact angle/pose, placement 2 = Image 2, … placement ${count} = Image ${count}.`,
    `FORBIDDEN: using only Image 1; inventing a new 45°/side/back view by rotating Image 1; cloning Image 1 into every slot; dropping Images 2–${count}; two near-identical fronts when a side/45° ref was provided.`,
    `REQUIRED: each provided reference photo is visibly used as a separate hero cutout; identity + angle locked to that Image.`,
  ].join(' ');
};

/** 版式换品场景的额外负向 */
export const LAYOUT_SWAP_NEGATIVES =
  'copying the layout reference products, keeping template plush toys, keeping template alphabet cans, near-duplicate of layout reference image, ignoring product reference photos, reproducing sample catalog merchandise';

/**
 * 产品须无缝融入海报：禁止白底方框、卡片、保留参考图棚拍底。
 */
export const productCutoutCompositeBlock = (): string =>
  [
    'PRODUCT COMPOSITE (STRICT):',
    'Reference images are PRODUCT SUBJECT cutouts (transparent / no studio backdrop).',
    'Place each product seamlessly into the poster scene or color field — soft contact shadow OK.',
    'FORBIDDEN: white/rounded product cards, polaroid frames, boxed thumbnails, UI tiles, keeping the original studio white/gray background behind the toy, floating cutout rectangles, catalog contact-sheet cells.',
    'REQUIRED: products appear as real objects in the design, not photos pasted inside boxes.',
  ].join(' ');

/**
 * 文字与产品分区：产品不得挡住介绍文字；有版式模板时严格跟模板文字区。
 */
export const typographySafeLayoutBlock = (opts?: { hasLayoutTemplate?: boolean }): string =>
  [
    'TYPOGRAPHY SAFE LAYOUT (STRICT):',
    opts?.hasLayoutTemplate
      ? 'Follow the layout template text zones exactly (headline / mission / captions). Products sit ONLY in the template product slots around the text — never over letters.'
      : 'Reserve a clear copy column / band (e.g. upper-right or left strip) with NO product silhouette overlapping any letter.',
    'Products and text must not collide: no toy covering headlines, bullets, captions, or body areas.',
    'Keep ≥8% margin between product edges and any text; if space is tight, shrink or move the product — never cover copy.',
    'FORBIDDEN: product standing on top of paragraphs; text running through the toy; stacking a product over the description block; crowding the center text with a large overlapping hero.',
    'FORBIDDEN: inventing long body paragraphs — only the approved short lines may appear, fully legible, matching the template hierarchy when a layout ref is present.',
  ].join(' ');

/** 图面文字白名单：只允许印这些短句，否则禁止任何正文（防乱码/重复） */
export const lockedOnImageCopyBlock = (lines: string[]): string => {
  const cleaned = (lines || [])
    .map((l) => (l || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6);
  if (!cleaned.length) {
    return [
      'ON-IMAGE TEXT POLICY (STRICT): (NO TEXT).',
      'Leave all typography / headline / bullet / paragraph zones empty.',
      'Do NOT invent English words, Latin-looking gibberish, product descriptions, bullet lists, or fake body copy.',
    ].join(' ');
  }
  return [
    'ON-IMAGE TEXT POLICY (STRICT):',
    `Render AT MOST these ${cleaned.length} short lines — each ONCE, fully visible, never behind a product.`,
    'Place them only inside the reserved copy zone (top-right or left band). Huge sharp letters.',
    'Copy-paste character-for-character. Do not rewrite, expand into paragraphs, or invent synonyms.',
    ...cleaned.map((l, i) => `LINE ${i + 1}: ${l}`),
    'FORBIDDEN: any word not in the lines above; duplicate lines; body paragraphs; multi-sentence blocks; gibberish; tiny micro-text; fake awards; text occluded by products.',
    'If a line cannot sit fully in the safe zone without touching a product, OMIT that line — never invent filler.',
  ].join('\n');
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
  /** 多 SKU 整合：每张产品图都必须入画 */
  distinctProducts?: boolean;
  /** 图面英文白名单（经文案流水线校验）；空数组=禁止上图文字 */
  lockedOnImageCopy?: string[];
  /** 已拼好的 ON-IMAGE TEXT POLICY 块（优先于 lockedOnImageCopy） */
  onImageLockBlock?: string;
  skillNegative?: string;
  series?: boolean;
  /** 已由 Brief 拼好的主提示；传入则不再重复 Skill 底稿 */
  baseToolPrompt?: string;
  /** true：负向只返回字段，不拼进 prompt（留给将来 API） */
  negativeAsFieldOnly?: boolean;
}): CreativePromptParts => {
  const hasRefs = !!opts.hasReferenceImages;
  const refCount = Math.max(0, opts.referenceCount ?? (hasRefs ? 1 : 0));
  const identity = identityLockBlock(hasRefs, 'image');
  const roles = multiImageRoleBlock(refCount, {
    lastIsLayout: opts.lastRefIsLayout,
    distinctProducts: opts.distinctProducts,
  });
  const textLock =
    (opts.onImageLockBlock || '').trim() ||
    (opts.lockedOnImageCopy
      ? lockedOnImageCopyBlock(opts.lockedOnImageCopy)
      : lockedOnImageCopyBlock([]));
  const cutoutComposite = hasRefs ? productCutoutCompositeBlock() : '';
  const typeSafe = typographySafeLayoutBlock({
    hasLayoutTemplate: !!opts.lastRefIsLayout,
  });
  const skuLine =
    opts.skuName || opts.skuCode
      ? `Product identity: ${[opts.skuName, opts.skuCode].filter(Boolean).join(' / ')}. Keep SKU appearance consistent.`
      : '';

  const editDirective = hasRefs ? referenceEditDirectiveBlock(opts.userBrief) : '';
  const layoutSwap =
    hasRefs && opts.lastRefIsLayout && refCount >= 2
      ? layoutProductSwapDirectiveBlock(refCount - 1)
      : '';

  const positive = opts.baseToolPrompt?.trim()
    ? joinBlocks([
        // 多参考优先钉死「每张都要用」，避免 Brief/二次创作把后几张角度吃掉
        roles,
        cutoutComposite,
        typeSafe,
        hasRefs ? editDirective : '',
        layoutSwap,
        textLock,
        opts.baseToolPrompt,
        identity,
        opts.series ? SERIES_CONSISTENCY_BLOCK : '',
        COMMERCIAL_CRAFT_FOOTER,
      ])
    : joinBlocks([
        roles,
        cutoutComposite,
        typeSafe,
        hasRefs ? editDirective : '',
        layoutSwap,
        textLock,
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
        identity,
        opts.series ? SERIES_CONSISTENCY_BLOCK : '',
        COMMERCIAL_CRAFT_FOOTER,
      ]);

  const negative = mergeNegatives(
    UNIVERSAL_IMAGE_NEGATIVES,
    'garbled English, invented words, Latin gibberish, fake body paragraphs on poster',
    'white product cards, rounded photo frames, boxed thumbnails, studio white backdrop behind product, polaroid frames, contact-sheet cells',
    'product covering text, toy overlapping headlines, text behind product, illegible occluded copy, long prose paragraph on poster',
    'using only first reference, inventing angles from one photo, cloning front view into every slot, dropping later reference images',
    opts.lastRefIsLayout ? LAYOUT_SWAP_NEGATIVES : '',
    opts.skillNegative
  );
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
1b) 若末张为版式模板：toolPrompt 必须写明 LAYOUT SWAP——只借末张构图/色块/标题区，前面产品图换入成图；禁止复刻模板内原商品。
2) 无参考图时：按文字描述创作，仍保持商业玩具出口画质。
3) 保留 SKU 身份；贴合 Skill；适合跨境电商/展会。
4) 图面文字：禁止让模型自由发挥英文段落；若输入已给 ON-IMAGE TEXT POLICY / 白名单短句，toolPrompt 只引用这些短句；否则明确 NO TEXT。禁止乱码假词。
5) 光影默认电商柔箱 + 轻轮廓光；避免霓虹凝胶与廉价贴纸风。
6) summaryZh / titleZh 禁止出现任何大模型或供应商商品名。`;
