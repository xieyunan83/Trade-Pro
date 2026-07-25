/** 单品海报 / 多品海报 提示词模板（根据 Lefei / Bubble Wow 样例提炼） */

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

/** 方案一：单品宣传海报（参考 Lefei 工程车海报） */
export const buildSingleProductPosterPrompt = (
  fields: SinglePosterFields,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const logoHint =
    logoMode === 'none'
      ? 'Do NOT place any brand logo.'
      : logoMode === 'builtin'
        ? 'Place the provided brand LOGO at the top-left of the black header bar (use the reference logo image if given).'
        : 'Place the user-uploaded LOGO at the top-left of the black header bar.';

  return `
Create a professional vertical toy wholesale promotional poster, clean catalog style, similar to premium Chinese toy export flyers.

LAYOUT (strict):
1) Top: solid black horizontal header bar. ${logoHint} Large bold white product title "${fields.productName}" centered/right on the bar.
2) Below header on light blue soft gradient background with subtle light rays: three short teal uppercase benefit lines spaced across:
   "${fields.benefit1}" · "${fields.benefit2}" · "${fields.benefit3}"
3) Center: LARGE isolated product photo of the uploaded toy ONLY (background already removed / cutout), studio lighting, sharp, commercial.
4) Under the main product: three small rounded square inset photos showing product details/functions.
5) Bottom-left: four small white rounded icons in a row — age "${fields.age}", hand (tactile), ${fields.hasLight ? 'lightbulb (lights)' : 'feature icon'}, ${fields.hasSound ? 'music note (sound)' : 'feature icon'}.
6) Bottom-left under icons: black info blocks with white text:
   NO: ${fields.modelNo}
   NAME: ${fields.seriesName}
   SIZE: ${fields.size}
   PACKING AMOUNT: ${fields.packingAmount}
   GROSS WEIGHT: ${fields.grossWeight}
   NET WEIGHT: ${fields.netWeight}
7) Bottom-right: product retail box packaging mock with dimension labels "${fields.boxSize}".

Style: high-end B2B toy catalog, light cyan-blue atmospheric background, high contrast typography, no clutter, no watermark, print-ready, 2K quality.
Use the uploaded product cutout as the hero subject. Do not invent a different product.
`.trim();
};

/** 方案二：多品组合海报（参考 Bubble Wow 目录页） */
export const buildMultiProductPosterPrompt = (
  fields: MultiPosterFields,
  productCount: number,
  logoMode: 'builtin' | 'custom' | 'none'
): string => {
  const logoHint =
    logoMode === 'none'
      ? 'No logo.'
      : 'Include brand logo in the header (use provided logo reference if available).';

  return `
Create a professional toy catalog page / multi-product promotional poster on clean white background with blue accents.

LAYOUT:
1) Header row: year "${fields.year}" left, brand "${fields.brandName}" center (${logoHint}), title "${fields.collectionTitle}" right.
2) Main area: one large featured product (first uploaded cutout) on a teal panel, with callout circle showing product in use if sensible.
3) Specs beside main product:
   Model ${fields.mainModel}
   ${fields.mainFeatures}
   Product size: ${fields.productSize}
   Package size: ${fields.packageSize}
4) Accessories / "what's in the box" small grid with icons/text if space allows.
5) Below: show the other ${Math.max(0, productCount - 1)} uploaded product cutouts as color variants / series items in a neat row with short labels.
6) Right edge: colorful vertical category tabs (optional decorative).
7) Footer blue bar with email "${fields.contactEmail}".

Style: Bubble Wow / wholesale catalog, clean grids, consistent product cutouts, blue theme, no watermark, print-ready.
Use ONLY the uploaded product images as the products — do not replace them with unrelated toys.
`.trim();
};

/** 扣背景提示（图生图 / 编辑） */
export const REMOVE_BG_PROMPT = `
Edit the image: remove the entire background completely. Keep only the product itself with clean cutout edges.
Output the product centered on a pure transparent or pure white background, no shadows clutter, no text, no logo added.
`.trim();
