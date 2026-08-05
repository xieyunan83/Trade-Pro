/** 产品海报 / 电商长图（Wan2.7-image-pro）— 短提示词 + 硬约束
 * 前端表单不变；仅非空字段可上图；禁止虚拟包装、参数表、模糊小字、乱造细节。
 */

export interface SinglePosterFields {
  productName: string;
  modelNo: string;
  seriesName: string;
  size: string;
  packingAmount: string;
  grossWeight: string;
  netWeight: string;
  boxSize: string;
  age: string;
  benefit1: string;
  benefit2: string;
  benefit3: string;
  hasLight: boolean;
  hasSound: boolean;
}

export interface MultiPosterFields {
  collectionTitle: string;
  brandName: string;
  year: string;
  mainModel: string;
  mainFeatures: string;
  productSize: string;
  packageSize: string;
  contactEmail: string;
}

export const DEFAULT_SINGLE_FIELDS: SinglePosterFields = {
  productName: '',
  modelNo: '',
  seriesName: '',
  size: '',
  packingAmount: '',
  grossWeight: '',
  netWeight: '',
  boxSize: '',
  age: '',
  benefit1: '',
  benefit2: '',
  benefit3: '',
  hasLight: false,
  hasSound: false,
};

export const DEFAULT_MULTI_FIELDS: MultiPosterFields = {
  collectionTitle: '',
  brandName: '',
  year: new Date().getFullYear().toString(),
  mainModel: '',
  mainFeatures: '',
  productSize: '',
  packageSize: '',
  contactEmail: '',
};

const t = (v: string) => (v || '').trim();

/** 允许印在图上的英文（越少越好，避免糊字） */
export const buildApprovedEnglishCopy = (fields: SinglePosterFields): string => {
  const bits: string[] = [];
  if (t(fields.seriesName)) bits.push(t(fields.seriesName));
  if (t(fields.productName)) bits.push(t(fields.productName));
  if (t(fields.modelNo)) bits.push(`Model ${t(fields.modelNo)}`);
  if (t(fields.benefit1)) bits.push(t(fields.benefit1));
  if (t(fields.benefit2)) bits.push(t(fields.benefit2));
  if (t(fields.benefit3)) bits.push(t(fields.benefit3));
  if (t(fields.age)) bits.push(`Age ${t(fields.age)}`);
  if (t(fields.size)) bits.push(t(fields.size));
  // 装箱量/毛净重/外箱尺寸：不上图、不画包装（避免模型画虚拟盒）
  if (!bits.length) return '(NO TEXT — leave sections text-free)';
  return bits.join('\n');
};

const logoLine = (logoMode: 'builtin' | 'custom' | 'none') =>
  logoMode === 'none'
    ? 'No logo.'
    : 'If a logo image is provided, use that exact logo only once or twice. Never invent a logo.';

/**
 * 方案一：单品长图（刻意短提示，硬规则前置）
 */
export const buildSingleProductPosterPrompt = (
  fields: SinglePosterFields,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const copy = buildApprovedEnglishCopy(fields);
  const name = t(fields.productName) || 'the product';

  return `
TASK: One EXTRA-TALL vertical e-commerce LONG IMAGE (ratio about 1:8). Model: lifestyle campaign, NOT a catalog flyer.

PRODUCT PHOTO = only source of truth for shape/color/parts. Keep ${name} identical to the upload. No redesign.

========================
HARD RULES (must obey)
========================
1) LAYOUT: single column only. Full-width scenes stacked top → bottom. NO two columns, NO left-right split, NO info sheet under a hero.
2) BACKGROUNDS: every section uses a REAL lifestyle location (park, backyard, living room, birthday party, patio, beach picnic, etc.). FORBIDDEN: plain white, plain blue studio, empty gradient, product cutout on blank color.
3) SCENES: at least FIVE different full-width usage scenes with different places/angles/moments. More lifestyle photos, fewer graphic blocks.
4) TEXT: English only. Use ONLY these exact words (copy-paste, do not rewrite):
${copy}
- Max 1 short headline per scene (3–8 words). Prefer fewer words.
- HUGE sharp letters only. No tiny text. No paragraphs. No icon grids with micro captions.
- NO specification table. NO parameter grid. NO blurry or unreadable text. If text would be small, use NO text.
5) DETAILS: do NOT invent close-up callouts, magnifying circles, fake macros, or wrong parts. Prefer whole-product lifestyle shots. If one detail crop is needed, it must match the uploaded photo exactly — otherwise skip detail section.
6) PACKAGING: packaging photo was NOT uploaded. NEVER draw retail box, color box, carton, shipping box, package flat-lay, or “what’s in the box”. Replace any packaging idea with another lifestyle scene.
7) NO Buy Now, price, QR, watermark, fake badge, fake logo.
${logoLine(logoMode)}

========================
SECTION ORDER (all full-width)
========================
1. Hero lifestyle: product large in a beautiful real scene + optional approved title
2. Usage scene A (different place) — product in action / bubbles or real function if applicable
3. Usage scene B (different place/angle)
4. Usage scene C (family / kids / party emotion matching product)
5. Clean product beauty shot still INSIDE a real environment (not studio sweep)
6. Usage scene D (another environment) — instead of packaging
7. Closing lifestyle scene + brand/product name only if listed in approved text

Art: premium photography, sharp focus on product, elegant large typography, cohesive colors, realistic lighting and shadows.

NEGATIVE: studio backdrop, white void, blue seamless, two-column layout, catalog sheet, spec table, tiny blurry text, gibberish, Chinese/Japanese/Korean, invented packaging, carton, retail box, fake close-up circles, wrong product parts, Buy Now, QR, watermark.
`.trim();
};

/**
 * 方案二：多品 — 同样短约束
 */
export const buildMultiProductPosterPrompt = (
  fields: MultiPosterFields,
  productCount: number,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const copy = [
    t(fields.brandName),
    t(fields.collectionTitle),
    t(fields.mainModel) ? `Model ${t(fields.mainModel)}` : '',
    t(fields.mainFeatures),
    t(fields.productSize),
  ]
    .filter(Boolean)
    .join('\n') || '(NO TEXT)';

  return `
TASK: One EXTRA-TALL vertical LONG IMAGE for ${productCount} uploaded product photo(s). Single-column lifestyle campaign.

HARD RULES:
- Product looks must match uploads exactly.
- ≥5 different full-width real-world usage scenes. No plain studio backgrounds.
- Text ONLY from:
${copy}
- Huge sharp English only. No tables. No tiny blurry text.
- NEVER invent packaging/boxes/cartons (no packaging photo uploaded). Use extra lifestyle scenes instead.
- No two-column layout. No fake detail magnifiers. No Buy Now / QR.
${logoLine(logoMode)}

Stack full-width: hero lifestyle → scene2 → scene3 → scene4 → in-environment beauty → scene5 (no packaging) → closing.
NEGATIVE: studio void, two-column, spec table, blurry micro text, virtual packaging, wrong product, gibberish.
`.trim();
};

export const REMOVE_BG_PROMPT = `
Remove the background completely. Keep only the product with clean edges on pure white/transparent.
Do not redesign the product. No text, no logo, no packaging added.
`.trim();

/** 给人看的「简化提示词清单」（管理/核对用） */
export const POSTER_PROMPT_CHECKLIST_ZH = `
1. 一张超长竖图，单列从上往下排，禁止左右分栏。
2. 产品外形/颜色/零件必须跟上传原图一致，禁止改款。
3. 至少 5 段不同实景使用场景（公园/客厅/派对等），禁止纯白/纯蓝棚拍底。
4. 图上英文只能用用户填写的原文；每段最多一句短标题；必须大字清晰；禁止参数表、小字、糊字。
5. 禁止虚拟包装盒/外箱/彩盒（没上传包装图就不画）。
6. 禁止乱造局部放大镜细节；细节对不上原图就不要做细节段。
7. 禁止 Buy Now、价格、二维码、水印、假 Logo。
8. 用实景段替代任何「包装/参数表」想法。
`.trim();
