/** 产品海报 / 电商长图提示词（Wan2.7-image-pro）
 * 前端表单字段不变；仅非空字段进入「Exact English Copy」，禁止模型编造文案与包装图。
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

/** 默认留空，避免演示样例数据混进长图文案 */
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

const line = (label: string, value: string): string | null => {
  const v = t(value);
  return v ? `${label}: ${v}` : null;
};

/** 仅把用户填过的字段拼成「允许出现的英文原文」；空字段一律不写 */
export const buildApprovedEnglishCopy = (fields: SinglePosterFields): string => {
  const lines = [
    line('Brand / Series', fields.seriesName),
    line('Product Name', fields.productName),
    line('Model', fields.modelNo),
    line('Product Dimensions', fields.size),
    line('Net Weight', fields.netWeight),
    line('Gross Weight', fields.grossWeight),
    line('Carton Packing', fields.packingAmount),
    line('Outer Box Size', fields.boxSize),
    line('Recommended Age', fields.age),
    line('Selling Point 1', fields.benefit1),
    line('Selling Point 2', fields.benefit2),
    line('Selling Point 3', fields.benefit3),
  ].filter(Boolean) as string[];

  if (fields.hasLight) lines.push('Feature: Light-up');
  if (fields.hasSound) lines.push('Feature: Sound / Music');

  if (!lines.length) {
    return '(No approved marketing copy supplied. Use ZERO text in the image, or only tiny tasteful whitespace — do not invent any words, numbers, brand names, or slogans.)';
  }
  return lines.join('\n');
};

const buildVerifiedFeatures = (fields: SinglePosterFields): string => {
  const parts = [
    t(fields.benefit1),
    t(fields.benefit2),
    t(fields.benefit3),
    fields.hasLight ? 'Light-up feature (only if supported by copy)' : '',
    fields.hasSound ? 'Sound / music feature (only if supported by copy)' : '',
  ].filter(Boolean);
  return parts.length
    ? parts.join('; ')
    : 'Only features clearly visible on the uploaded product photo. Do not invent functions.';
};

const buildUsageScenarios = (fields: SinglePosterFields): string => {
  const age = t(fields.age);
  const name = t(fields.productName) || 'this product';
  if (age) {
    return `Real-life family / kids play and party moments suitable for age ${age}, outdoor lawn, living room playtime, birthday celebration — always with ${name} used naturally in the scene.`;
  }
  return `Beautiful real-world usage environments that match the product category visible in the reference photo for ${name}. Prefer outdoor fun, home play, party, or daily-life scenes — never a plain studio backdrop.`;
};

const logoInstruction = (logoMode: 'builtin' | 'custom' | 'none') => {
  if (logoMode === 'none') {
    return 'Do NOT place any brand logo, watermark, marketplace badge, or Buy Now button.';
  }
  return 'If a LOGO reference image is provided, place that exact logo only (hero and/or closing). Never invent a different logo or brand mark.';
};

const SHARED_NEGATIVE = `
plain blue studio background, plain white studio background, empty backdrop, empty gradient background, isolated product cutout as primary background, cheap product listing, two-column layout, split layout, brochure layout, catalog layout, specification sheet, dense parameter table, tiny text, unreadable text, gibberish text, misspelled text, Chinese text, Japanese text, Korean text, random slogans, invented product name, wrong model number, fake product data, fake dimensions, fake certifications, fake logo, watermark, QR code, price tag, discount badge, Buy Now button, virtual packaging, invented box, invented carton, invented accessories, incorrect product structure, incorrect color, wrong material, extra buttons, extra ports, extra handles, missing components, duplicate product, duplicate accessories, distorted product, warped geometry, floating product, bad perspective, cluttered composition, cheap graphic design, unrelated background, unrealistic human interaction, distorted hands, extra fingers, low resolution, blurry product, broken typography.
`.trim();

/**
 * 方案一：单品 — 严格单列竖排电商故事长图（Wan2.7-image-pro）
 */
export const buildSingleProductPosterPrompt = (
  fields: SinglePosterFields,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const brand = t(fields.seriesName) || t(fields.productName) || 'Brand';
  const productName = t(fields.productName) || 'Product';
  const model = t(fields.modelNo) || 'Not supplied';
  const dimensions = t(fields.size) || 'Not supplied — do not invent measurements';
  const approved = buildApprovedEnglishCopy(fields);
  const features = buildVerifiedFeatures(fields);
  const selling = [t(fields.benefit1), t(fields.benefit2), t(fields.benefit3)].filter(Boolean).join('; ') ||
    'Only selling points listed in Exact English Copy Allowed. If none, use no selling-point text.';
  const usage = buildUsageScenarios(fields);
  const target = t(fields.age)
    ? `Parents and children; recommended age ${t(fields.age)}`
    : 'Target customers appropriate to the product category visible in the reference image';

  return `
You are a senior art director for premium e-commerce product storytelling.

Create ONE premium vertical e-commerce product detail page from the uploaded product reference image(s) and the exact product data below.

The output must be a single, cohesive, EXTRA-TALL VERTICAL LONG IMAGE.
It must look like a high-end branded product story, not a catalog, not a flyer, not a specification sheet, and not a two-column marketplace listing.

==================================================
1. PRODUCT REFERENCE AND DATA
==================================================

UPLOADED REFERENCE IMAGE:
The uploaded image is the only authoritative visual reference for the physical product.
If multiple images are given: the product photo is the appearance source of truth; any cutout is only for silhouette fidelity — NEVER use a cutout floating on plain studio color as a finished section background.

Brand:
${brand}

Product Name:
${productName}

Model:
${model}

Product Category:
Infer only from the uploaded photo (e.g. bubble machine / toy). Do not invent a different category name in text unless it appears in Exact English Copy Allowed.

Product Color and Finish:
Match the uploaded reference image exactly.

Material:
Infer only from the uploaded reference image appearance. Do not invent material claims in text.

Exact Product Dimensions:
${dimensions}

Verified Product Features:
${features}

Verified Selling Points:
${selling}

Verified Usage Scenarios:
${usage}

Target Customers:
${target}

Exact English Copy Allowed in This Image:
${approved}

Brand Personality:
Playful, premium, trustworthy family / party fun — commercial but warm.

Preferred Visual Style:
Editorial lifestyle e-commerce storytelling; cinematic real-world scenes; refined modern display typography suitable for kids/party products (elegant rounded sans or premium geometric sans — beautiful, large, legible).

Preferred Color Palette:
Derived from the real product colors plus soft, lively lifestyle colors (sky, grass, warm indoor light). Never a flat blue seamless studio sweep as the hero background.

${logoInstruction(logoMode)}

CRITICAL DATA RULE:
Every visible word in the image MUST be copied EXACTLY from “Exact English Copy Allowed in This Image” (or be empty).
Do NOT use demo data, training-memory specs, or any numbers/names that are not listed there.
If a field is “Not supplied”, do not invent a substitute.

==================================================
2. ABSOLUTE ACCURACY RULES
==================================================

The uploaded reference image is the source of truth for the physical product.

You MUST preserve the product exactly as shown in the uploaded reference image:
- identical silhouette and overall proportions
- identical color, surface finish, material appearance, and product geometry
- identical openings, buttons, ports, switches, feet, handles, vents, nozzles, lenses, components, and structural details
- no extra product parts
- no missing product parts
- no invented accessories
- no redesigned shell, no altered shape, no incorrect product color
- no fictional logo, no competitor branding, no watermark

Do not create a box, retail package, instruction manual, label, carton, shipping box, package contents flat-lay, certification badge, award badge, QR code, price tag, discount badge, or accessory unless it is visibly included in the uploaded reference image.

If packaging images are not supplied, NEVER generate packaging.
Instead, use another beautiful and relevant real-life usage scene.

Never invent product specifications, dimensions, functions, ratings, safety claims, certifications, compatibility, battery life, capacity, performance values, age grades, or technical data beyond Exact English Copy Allowed.

==================================================
3. TEXT: STRICT COPY CONTROL
==================================================

All visible text must be in ENGLISH ONLY.

IMPORTANT:
Use ONLY the exact wording provided under:
“Exact English Copy Allowed in This Image”.

Do not rewrite it.
Do not translate it.
Do not summarize it.
Do not invent slogans.
Do not change model numbers.
Do not add unsupported claims.
Do not add random technical specifications.
Do not create fake tables.
Do not create placeholder text.
Do not generate gibberish, misspelled words, Chinese characters, Japanese characters, Korean characters, or meaningless characters.

If there is not enough approved copy for a section:
use no text in that section, or use a clean text-free visual composition.
Prioritize beautiful imagery and accurate product presentation over generated text.

Text design requirements:
- Use large, highly legible English typography only
- Use a refined modern font style appropriate to the product category and brand personality — beautiful, thematic, premium (not generic ugly system UI font)
- Use no more than 3 to 10 words per text block where possible
- Use a maximum of one headline and one short supporting line per scene
- Keep text away from product edges and important product details
- Use generous whitespace
- No tiny text
- No dense paragraphs
- No specification table
- No multi-column text blocks
- No crowded labels

==================================================
4. MANDATORY LAYOUT RULES
==================================================

Create ONE SINGLE-COLUMN VERTICAL STORYTELLING LAYOUT.

The entire long image must flow from top to bottom in one continuous vertical sequence.

Every scene must occupy the full width of the page.
Every scene must be stacked vertically, one after another.

DO NOT create:
- two-column layout
- split-screen layout
- left-and-right product panels
- product image on the top with a separate double-column information sheet below
- brochure layout
- catalog card layout
- spreadsheet layout
- boxed parameter tables
- multiple unrelated images squeezed together
- a collage of small thumbnails
- product listing page layout

Use 6 to 8 full-width visual sections.
Each section should feel like a premium campaign image, with one clear visual idea and one clear message.

Recommended aspect ratio:
vertical 1:7 or 1:9.

==================================================
5. BACKGROUND AND SCENE RULES
==================================================

Never use a plain studio blue background, plain white background, empty gradient background, cheap seamless backdrop, or isolated product cutout as the primary visual background.

Every major section must use:
- a beautiful real-world environment, OR
- a realistic lifestyle setting, OR
- a premium contextual setting that directly supports the product’s actual usage.

Backgrounds must be relevant to:
${usage}

Use natural, believable, commercially styled environments:
- realistic lighting
- authentic surfaces
- tasteful props
- environmental depth
- premium color coordination
- clean but lived-in spaces
- product remains highly visible and recognizable

The product must never look pasted onto the background.
It must have realistic scale, contact shadows, perspective, and lighting consistent with the scene.

==================================================
6. VISUAL STORY STRUCTURE
==================================================

Create the long image in this exact SINGLE-COLUMN order:

SECTION 1 — IMMERSIVE HERO SCENE
Create a strong full-width lifestyle hero image.
Show the product in its most attractive and natural real-world usage environment.
The product is large, clear, and immediately recognizable.
Use a cinematic but realistic lifestyle background.
Use only approved text, placed elegantly with generous whitespace.
No isolated studio product on a plain background.

SECTION 2 — PRIMARY BENEFIT IN ACTION
Show the single strongest verified product benefit through a real action scene.
The product must visibly demonstrate its actual function.
Show a realistic user only if it is relevant to the product.
The person must match the target customer profile.
Use one approved short headline only, if supplied.

SECTION 3 — SECOND REAL-LIFE USAGE SCENE
Show a different practical usage scenario.
Change the environment, camera angle, and emotional moment.
The scene should make the customer understand when, where, and why to use the product.
Keep the product physically accurate.

SECTION 4 — PRODUCT DETAIL AND CRAFTSMANSHIP
Show one large, refined close-up composition of real product details.
Highlight only actual visible components and verified features.
Use elegant macro photography, natural material texture, realistic lighting, and minimal callout lines.
Use text only from the approved copy.

SECTION 5 — THIRD USE CASE OR EMOTIONAL VALUE SCENE
Show another authentic lifestyle scenario.
Focus on the emotional or practical result of using the product:
joy, convenience, organization, relaxation, family interaction, outdoor fun, productivity, comfort, or confidence.
Use only an outcome supported by the verified product data.
Do NOT insert packaging here.

SECTION 6 — FEATURE DEMONSTRATION
Show the product’s verified operating feature in a visually clear way.
Use one large image or a seamless full-width sequence within the same scene.
Do not use tiny panels, diagrams, grids, or technical tables.
Use subtle visual guidance only when necessary.

SECTION 7 — SIZE OR PRODUCT FORM FACTOR
Only if exact dimensions are supplied in Exact English Copy Allowed:
show the product naturally in a realistic scene with a minimal, elegant dimension overlay.
Display only the exact dimensions provided in the data.
Do not create a table.
Do not add any other measurements.

If exact dimensions are not supplied:
replace this section with another lifestyle scene.

SECTION 8 — PREMIUM CLOSING SCENE
End with a beautiful full-width real-life or contextual product scene.
The product should look aspirational, polished, and desirable.
Use the brand name and product name only if they appear in the approved English copy.
No “Buy Now” button, no price, no fake promotion, no QR code, and no marketplace logo.
No packaging.

==================================================
7. HUMAN AND LIFESTYLE PHOTOGRAPHY RULES
==================================================

When people are included:
- show realistic hands, faces, anatomy, and interaction
- ensure the product is used correctly
- people must look natural, happy, and authentic rather than posed like stock models
- match the target audience: ${target}
- show diverse but contextually appropriate people
- avoid distorted hands, extra fingers, incorrect grips, or impossible use of the product

==================================================
8. ART DIRECTION
==================================================

Overall aesthetic:
Editorial lifestyle e-commerce storytelling; full-bleed scenes; premium vertical campaign.

Brand personality:
Playful, premium, trustworthy family / party fun.

Color palette:
Product colors + lively lifestyle colors. Never flat studio blue sweep as hero.

Create a cohesive premium design with:
- editorial e-commerce photography
- authentic lifestyle storytelling
- refined visual rhythm from top to bottom
- elegant thematic typography
- realistic depth and lighting
- clean spacing
- subtle premium graphic accents only when needed
- a harmonious visual identity across all sections

==================================================
9. NEGATIVE PROMPT
==================================================

${SHARED_NEGATIVE}

==================================================
10. FINAL INSTRUCTION
==================================================

Generate one complete, premium, full-width, single-column, vertically stacked e-commerce long image.

The image must be driven by realistic usage scenarios and beautiful real-world backgrounds.
Do not make a studio catalog page.
Do not make a two-column product listing.
Do not invent product data, product packaging, accessories, text, functions, or specifications.

Use the uploaded product image as the strict visual product reference.
Use only the exact approved English copy supplied by the user.
Prioritize product accuracy, premium lifestyle imagery, coherent vertical storytelling, and readable elegant typography.
`.trim();
};

/**
 * 方案二：多品系列 — 同样单列竖排、实景优先、禁止虚构包装与乱写规格
 */
export const buildMultiProductPosterPrompt = (
  fields: MultiPosterFields,
  productCount: number,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const approved = [
    line('Brand', fields.brandName),
    line('Collection', fields.collectionTitle),
    line('Year', fields.year),
    line('Main Model', fields.mainModel),
    line('Features', fields.mainFeatures),
    line('Product Size', fields.productSize),
    line('Package Size', fields.packageSize),
  ]
    .filter(Boolean)
    .join('\n');

  const brand = t(fields.brandName) || 'Brand';
  const title = t(fields.collectionTitle) || 'Collection';

  return `
You are a senior art director for premium e-commerce product storytelling.

Create ONE EXTRA-TALL VERTICAL LONG IMAGE for a multi-SKU / collection story.
Single-column full-width sections only. Lifestyle real-world backgrounds only. No two-column layout. No invented packaging.

UPLOADED REFERENCES: ${productCount} product photo(s) — appearance source of truth for every SKU.

Exact English Copy Allowed in This Image:
${approved || '(No approved copy — use ZERO invented text.)'}

Brand: ${brand}
Collection: ${title}
Model: ${t(fields.mainModel) || 'Not supplied'}
Features: ${t(fields.mainFeatures) || 'Only what is visible / listed above'}
Product Size: ${t(fields.productSize) || 'Not supplied — do not invent'}
Package Size text may appear ONLY if listed in Exact English Copy — NEVER draw a virtual box or carton.

${logoInstruction(logoMode)}

LAYOUT: 6–8 full-width stacked lifestyle sections (hero → benefit in action → second scene → detail close-up → third scene → feature demo → optional size overlay if size supplied → closing). Every section uses real usage environments. First uploaded product is hero; others appear as series variants inside lifestyle scenes, not as a thumbnail grid collage.

TEXT: English only; copy EXACTLY from Exact English Copy Allowed; beautiful thematic typography; no tables; no Buy Now; no gibberish.

NEGATIVE PROMPT:
${SHARED_NEGATIVE}

FINAL: One premium single-column vertical campaign long image. Product-accurate. Lifestyle backgrounds. No packaging invention. No fake specs.
`.trim();
};

/** 扣背景提示（图生图 / 编辑） */
export const REMOVE_BG_PROMPT = `
Edit the image: remove the entire background completely. Keep only the product itself with clean cutout edges.
Output the product centered on a pure transparent or pure white background, no shadows clutter, no text, no logo added.
Preserve exact product shape, color, materials, and all visible components — do not redesign the product.
`.trim();
