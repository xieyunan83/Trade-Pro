/** 产品海报 / 电商长图提示词（Wan2.7 图生图）
 * 前端表单字段保持不变，仅映射到长图模板占位符。
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
  productName: 'DIRT TRUCK',
  modelNo: '28005',
  seriesName: 'MUSIC TRUCK SERIES',
  size: '68X43.5X58CM',
  packingAmount: '24 PCS',
  grossWeight: '17.5KG',
  netWeight: '14.5KG',
  boxSize: '18.5 x 10.5 x 32.5 CM',
  age: '3+',
  benefit1: 'COGNITIVE ABILITY',
  benefit2: 'IMAGINATION AND CREATIVITY',
  benefit3: 'TACTILE ABILITY',
  hasLight: true,
  hasSound: true,
};

export const DEFAULT_MULTI_FIELDS: MultiPosterFields = {
  collectionTitle: 'Bubble Gun',
  brandName: 'Bubble Wow',
  year: new Date().getFullYear().toString(),
  mainModel: 'BW1008',
  mainFeatures: 'Electric, Output * 60 bubble gun',
  productSize: '42.3*13*27.4cm',
  packageSize: '33*14*28cm',
  contactEmail: 'service@example.com',
};

const orDash = (v: string, fallback = 'As shown in the reference image / not specified') =>
  (v || '').trim() || fallback;

const logoInstruction = (logoMode: 'builtin' | 'custom' | 'none') => {
  if (logoMode === 'none') {
    return 'Do NOT place any brand logo, watermark, or marketplace badge.';
  }
  return 'If a brand LOGO reference image is provided, place it tastefully in the hero and closing sections only. Do not invent a different logo.';
};

const NEGATIVE_PROMPT = `
NEGATIVE PROMPT:
low resolution, blurry product, distorted product shape, inaccurate product structure, redesigned product, wrong color, wrong material, duplicate product, duplicated accessories, extra buttons, extra ports, extra handles, missing components, warped geometry, melted object, floating object, bad perspective, cluttered composition, poor lighting, cheap marketplace style, inconsistent visual style, unreadable typography, gibberish text, Chinese text, Japanese text, Korean text, spelling mistakes, random logo, competitor logo, watermark, QR code, fake certification badge, fake discount label, fake product data, incorrect dimensions, unsupported claims, excessive text, tiny text, overlapping text, broken infographic, bad anatomy, extra fingers, distorted hands, unrealistic human interaction, blurry face, cropped product, irrelevant props.
`.trim();

/**
 * 方案一：单品电商详情长图
 * 表单字段 → 模板；参考图中第一张产品原图/抠图为 PRIMARY 外观依据。
 */
export const buildSingleProductPosterPrompt = (
  fields: SinglePosterFields,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const brand = orDash(fields.seriesName.split(/\s+SERIES/i)[0]?.trim() || fields.seriesName, 'Brand');
  const functions = [
    fields.benefit1,
    fields.benefit2,
    fields.benefit3,
    fields.hasLight ? 'Light-up features' : '',
    fields.hasSound ? 'Sound / music features' : '',
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ');

  const sellingPoints = [fields.benefit1, fields.benefit2, fields.benefit3]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ');

  const techSpecs = [
    fields.packingAmount ? `Packing amount: ${fields.packingAmount}` : '',
    fields.boxSize ? `Outer / color box size: ${fields.boxSize}` : '',
    fields.age ? `Recommended age: ${fields.age}` : '',
    fields.hasLight ? 'Includes lighting features' : '',
    fields.hasSound ? 'Includes sound features' : '',
  ]
    .filter(Boolean)
    .join('; ');

  const weight = [fields.netWeight && `Net: ${fields.netWeight}`, fields.grossWeight && `Gross: ${fields.grossWeight}`]
    .filter(Boolean)
    .join(' / ');

  const targetCustomers = fields.age
    ? `Parents and gift buyers; children / kids recommended age ${fields.age}`
    : 'Target retail consumers and gift buyers for this product category';

  const packageContents = [
    fields.packingAmount ? `Carton packing: ${fields.packingAmount}` : '',
    fields.boxSize ? `Retail / outer box: ${fields.boxSize}` : '',
    'Main product unit as shown in reference image',
  ]
    .filter(Boolean)
    .join('; ');

  return `
You are an expert e-commerce art director, premium product photographer, product marketing strategist, and infographic layout designer.

TASK:
FIRST carefully analyze the uploaded reference product image(s) as the PRIMARY visual reference. Identify the product category, product structure, material, color, shape, key components, functional details, target use cases, and likely target customers from the photo itself.
THEN combine that visual analysis with the IMPORTANT PRODUCT DATA below to create ONE complete vertical e-commerce product detail page / long infographic image for an online marketplace. The result should look like a premium product detail page commonly seen on leading global e-commerce platforms and top-tier marketplace brand stores in this product category.

IMPORTANT PRODUCT DATA:
- Brand: ${brand}
- Product name: ${orDash(fields.productName)}
- Product model: ${orDash(fields.modelNo)}
- Product series: ${orDash(fields.seriesName)}
- Product category: Infer from the uploaded reference image (toy / consumer goods / etc.)
- Main material: Infer from the uploaded reference image; do not invent unsupported materials
- Product color / finish: Match the uploaded reference image exactly
- Product dimensions: ${orDash(fields.size)}
- Product weight: ${orDash(weight)}
- Technical specifications: ${orDash(techSpecs)}
- Main functions: ${orDash(functions)}
- Core selling points: ${orDash(sellingPoints)}
- Key components / structural details: Infer from the uploaded reference image; highlight only what is visible or listed above
- Included accessories / package contents: ${orDash(packageContents)}
- Target customers: ${targetCustomers}
- Main usage scenarios: Realistic play / daily use scenarios matching the product category and age positioning
- Brand tone: Premium, trustworthy, conversion-focused commercial
- Visual style: Modern marketplace detail-page / editorial commercial long image
- Preferred color palette: Derived from the product colors in the reference image, with clean premium neutrals
- Reference industry / leading brand style: Leading global marketplace brand stores and top exporters in the same category
- ${logoInstruction(logoMode)}

REFERENCE IMAGE RULES:
1. Preserve the product’s real and recognizable appearance from the uploaded reference image.
2. Keep the correct product silhouette, proportions, color, material, component placement, buttons, ports, handles, logos, patterns, and construction details.
3. Do not redesign, replace, distort, simplify, or invent product features that are not supported by the reference image or product data.
4. Make the product look refined, clean, premium, realistic, and commercially appealing.
5. If product information conflicts with the uploaded image, prioritize the uploaded image for physical appearance and use the provided data for text and selling-point structure.
6. Do not show competing brands, random logos, watermarks, QR codes, or irrelevant objects.
7. If both an original photo and a cutout are provided, use them as the same product: keep appearance faithful to the photo; use the cutout for clean commercial placement.

OUTPUT FORMAT:
Create a single extra-tall vertical e-commerce detail-page image.
- Recommended aspect ratio: 1:6 to 1:10 vertical long image
- Recommended canvas: about 1440 px wide, very tall vertical composition
- Build a coherent, scrollable, section-by-section visual narrative
- Use a clean premium grid layout with clear visual hierarchy
- All visible text must be in ENGLISH ONLY
- Use short, polished, readable English marketing copy
- Use large headlines, short subheadings, concise feature labels, simple specification tables, and clear callout labels
- Avoid excessive paragraphs, dense text blocks, spelling errors, meaningless pseudo-text, and unreadable tiny typography
- Reserve enough clean whitespace around all text areas

DESIGN DIRECTION:
Create a high-conversion marketplace product detail page with a polished editorial and commercial style:
- Professional studio product photography combined with premium lifestyle photography
- High-end product advertising composition
- Modern, minimal, trustworthy, and conversion-focused
- Balanced use of product close-ups, feature callouts, real-life scenes, technical diagrams, and specification layouts
- Strong hierarchy: hero image first, benefits second, evidence and details next, specifications and package content near the end
- Use subtle shadows, refined gradients, premium lighting, tasteful graphic lines, and clean background surfaces
- Keep the product as the visual focus in every section
- Match the design language to the product category and target customers
- The full page must feel like one unified branded campaign, not a collage of unrelated images

LONG IMAGE CONTENT STRUCTURE:
Create the following sections in this exact order.

SECTION 1 — HERO BANNER / FIRST SCREEN
- Powerful premium opening visual; full product at a strong selling angle.
- Brand "${brand}", title "${orDash(fields.productName)}", model/series "${orDash(fields.modelNo)} / ${orDash(fields.seriesName)}"
- One short English slogan from the strongest selling point; 3 concise benefit badges from: ${orDash(sellingPoints)}.

SECTION 2 — CORE VALUE PROPOSITION
- Top 3–5 benefits from the selling points / functions above with headline + short support line + visual.
- Only claim functions supported by data or clearly visible on the product.

SECTION 3 — LIFESTYLE / REAL USAGE SCENARIO
- Product used naturally by "${targetCustomers}" in a realistic scenario.
- Concise English lifestyle headline + short supporting line.

SECTION 4 — FEATURE DETAIL CLOSE-UPS
- 3–6 macro/close-up panels highlighting visible components and selling points with refined callout labels.

SECTION 5 — MATERIALS, CRAFTSMANSHIP, AND QUALITY
- Highlight materials/finish visible in the reference; tasteful credible English statements only.
- No unsupported medical, environmental, safety, or certification claims.

SECTION 6 — FUNCTION / PERFORMANCE EXPLANATION
- Explain main functions (${orDash(functions)}) with simple visual sequence / diagrams consistent with the real product.

SECTION 7 — SIZE AND SPECIFICATIONS
- Clean specs with dimension lines using ONLY supplied numbers:
  Dimensions ${orDash(fields.size)}; Weight ${orDash(weight)}; Model ${orDash(fields.modelNo)}; ${orDash(techSpecs)}.

SECTION 8 — IDEAL FOR / TARGET CUSTOMER
- 3–5 concise English customer or scenario labels aligned with ${targetCustomers}.

SECTION 9 — PACKAGE CONTENTS / WHAT’S IN THE BOX
- Flat-lay / organized packaging for: ${orDash(packageContents)}. Label items in clear English.

SECTION 10 — FINAL BRAND CLOSE / PURCHASE MOTIVATION
- Clean branded closing with product, "${brand}", "${orDash(fields.productName)}", short credible English close.
- No fake discounts, urgency, QR codes, contact info, or marketplace logos.

COPYWRITING RULES:
- All text English only; polished premium American English; concise and scannable.
- Avoid generic unsupported superlatives and unsupported claims.
- No Chinese / Japanese / Korean, placeholder, lorem ipsum, or unreadable text.

VISUAL QUALITY REQUIREMENTS:
Commercial-grade e-commerce design; photorealistic accurate product; crisp cutouts; premium lighting; cohesive sections; legible English; no clutter, warped parts, extra components, or watermarks.

${NEGATIVE_PROMPT}

FINAL INSTRUCTION:
Generate one unified, polished, English-only, premium vertical e-commerce long image using the uploaded product image as the physical product reference. Clearly communicate design, core benefits, real-life use cases, functional details, materials, dimensions, specifications, target users, and package contents in a marketplace-ready layout.
`.trim();
};

/**
 * 方案二：多品系列电商长图 / 目录长图
 * 保持多品表单字段，输出同风格垂直长图叙事。
 */
export const buildMultiProductPosterPrompt = (
  fields: MultiPosterFields,
  productCount: number,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const brand = orDash(fields.brandName, 'Brand');
  const title = orDash(fields.collectionTitle, 'Product Collection');

  return `
You are an expert e-commerce art director, premium product photographer, product marketing strategist, and infographic layout designer.

TASK:
FIRST analyze ALL uploaded reference product images. Identify shared category, materials, colors, structures, and differences between variants.
THEN create ONE complete vertical e-commerce collection / multi-SKU detail long image for an online marketplace, in the style of leading global brand stores.

IMPORTANT PRODUCT DATA:
- Brand: ${brand}
- Collection / product name: ${title}
- Year: ${orDash(fields.year)}
- Main model: ${orDash(fields.mainModel)}
- Main functions / selling points: ${orDash(fields.mainFeatures)}
- Product dimensions: ${orDash(fields.productSize)}
- Package dimensions: ${orDash(fields.packageSize)}
- Number of product variants in references: ${productCount}
- Footer contact (optional small text only if space and tasteful): ${orDash(fields.contactEmail, 'omit contact if not needed')}
- Brand tone: Premium wholesale / marketplace catalog
- Visual style: Clean multi-SKU marketplace detail page, cohesive series layout
- ${logoInstruction(logoMode)}

REFERENCE IMAGE RULES:
1. Use ONLY the uploaded products as the real products — do not invent different SKUs.
2. Preserve each variant’s real color, shape, and details.
3. First uploaded image is the hero / featured SKU; others are series / color variants.
4. No competing brands, watermarks, QR codes, or irrelevant objects.

OUTPUT FORMAT:
One extra-tall vertical long image (about 1:6 to 1:10), ~1440px wide, English-only text, premium scannable marketing copy, clean whitespace.

LONG IMAGE CONTENT STRUCTURE (exact order):
SECTION 1 — HERO: Brand ${brand}, title ${title}, year ${orDash(fields.year)}, featured first product, short slogan from main features, 3 benefit badges.
SECTION 2 — CORE VALUE: 3–5 benefits from "${orDash(fields.mainFeatures)}".
SECTION 3 — LIFESTYLE: Realistic usage matching the category.
SECTION 4 — FEATURE CLOSE-UPS: Details of the hero SKU with English callouts.
SECTION 5 — MATERIALS / QUALITY: Based on visible materials only.
SECTION 6 — FUNCTION: Visual explanation of main features.
SECTION 7 — SIZE / SPECS: Product ${orDash(fields.productSize)}; Package ${orDash(fields.packageSize)}; Model ${orDash(fields.mainModel)}.
SECTION 8 — SERIES / VARIANTS: Neat row/grid of the other uploaded cutouts with short English labels.
SECTION 9 — PACKAGE / WHAT’S IN THE BOX: Clean flat-lay style if applicable.
SECTION 10 — BRAND CLOSE: Final hero of the collection, ${brand} + ${title}, confident close. Optional subtle email ${orDash(fields.contactEmail, 'none')}. No fake discounts.

COPYWRITING / VISUAL QUALITY: Same premium English-only marketplace standards as a flagship brand detail page. No Chinese text, no gibberish, no unsupported claims.

${NEGATIVE_PROMPT}

FINAL INSTRUCTION:
Generate one unified premium vertical e-commerce long image for this multi-product collection using the uploaded images as the only product references.
`.trim();
};

/** 扣背景提示（图生图 / 编辑） */
export const REMOVE_BG_PROMPT = `
Edit the image: remove the entire background completely. Keep only the product itself with clean cutout edges.
Output the product centered on a pure transparent or pure white background, no shadows clutter, no text, no logo added.
Preserve exact product shape, color, materials, and all visible components — do not redesign the product.
`.trim();
