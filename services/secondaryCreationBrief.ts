/**
 * 产品二次创作 Brief：结构化改动字段 → 可执行英文改动清单 + 中文摘要
 * 原则：参考图为唯一外形真相；只改用户点名的项；未提及处像素级保持。
 */

export type PackagingStyleId =
  | 'keep'
  | 'window_box'
  | 'color_box'
  | 'opp_bag'
  | 'blister'
  | 'display_box'
  | 'gift_set'
  | 'custom';

export type SecondaryCreationFields = {
  /** 外包装形式 */
  packagingStyle: PackagingStyleId;
  /** 自定义包装说明（packagingStyle=custom 或补充） */
  packagingCustom: string;
  /** 外包装主色 / 印刷配色 */
  packagingColor: string;
  /** 产品本体主色 */
  productColor: string;
  /** 外观局部调整（加灯、改按钮、改脸型等） */
  appearanceEdit: string;
  /** 材质/表面处理 */
  materialFinish: string;
  /** 新增功能 */
  addFeatures: string;
  /** 去掉的配件/元素 */
  removeParts: string;
  /** 场景/背景（可选） */
  sceneBackground: string;
  /** 自由补充 */
  freeNote: string;
};

export const DEFAULT_SECONDARY_FIELDS: SecondaryCreationFields = {
  packagingStyle: 'keep',
  packagingCustom: '',
  packagingColor: '',
  productColor: '',
  appearanceEdit: '',
  materialFinish: '',
  addFeatures: '',
  removeParts: '',
  sceneBackground: '',
  freeNote: '',
};

export const PACKAGING_STYLE_OPTIONS: Array<{
  id: PackagingStyleId;
  label: string;
  en: string;
}> = [
  { id: 'keep', label: '包装不变', en: 'keep packaging structure identical to reference' },
  { id: 'window_box', label: '开窗彩盒', en: 'redesign as a window color box (clear window + printed carton)' },
  { id: 'color_box', label: '全封彩盒', en: 'redesign as a closed color carton box' },
  { id: 'opp_bag', label: 'OPP 袋', en: 'redesign packaging as clear OPP polybag with header card' },
  { id: 'blister', label: '吸塑卡', en: 'redesign as blister card packaging' },
  { id: 'display_box', label: '展示盒', en: 'redesign as retail display / PDQ box' },
  { id: 'gift_set', label: '礼盒套装', en: 'redesign as gift-set packaging with inner tray' },
  { id: 'custom', label: '自定义包装', en: 'custom packaging per user note' },
];

const t = (s: string) => (s || '').trim();

export const secondaryFieldsHaveEdits = (f: SecondaryCreationFields): boolean => {
  if (f.packagingStyle !== 'keep') return true;
  return !!(
    t(f.packagingCustom) ||
    t(f.packagingColor) ||
    t(f.productColor) ||
    t(f.appearanceEdit) ||
    t(f.materialFinish) ||
    t(f.addFeatures) ||
    t(f.removeParts) ||
    t(f.sceneBackground) ||
    t(f.freeNote)
  );
};

/** 中文改动清单（写入用户可见 prompt / 对话） */
export const buildSecondaryCreationUserBrief = (
  f: SecondaryCreationFields,
  meta?: { skuName?: string; skuCode?: string }
): string => {
  const lines: string[] = [
    '【产品二次创作 · 局部再设计】',
    '规则：以上传/产品库参考图为唯一外形真相；只改下列点名项，其余颜色、比例、五金、印刷、结构保持一致，禁止整体换模。',
  ];
  if (meta?.skuName) lines.push(`产品：${meta.skuName}`);
  if (meta?.skuCode) lines.push(`型号：${meta.skuCode}`);

  const pack = PACKAGING_STYLE_OPTIONS.find((o) => o.id === f.packagingStyle);
  if (f.packagingStyle !== 'keep') {
    lines.push(`包装形式：改为「${pack?.label || f.packagingStyle}」`);
  }
  if (t(f.packagingCustom)) lines.push(`包装补充：${t(f.packagingCustom)}`);
  if (t(f.packagingColor)) lines.push(`外包装配色：${t(f.packagingColor)}`);
  if (t(f.productColor)) lines.push(`产品本体颜色：${t(f.productColor)}`);
  if (t(f.appearanceEdit)) lines.push(`外观调整：${t(f.appearanceEdit)}`);
  if (t(f.materialFinish)) lines.push(`材质/表面：${t(f.materialFinish)}`);
  if (t(f.addFeatures)) lines.push(`新增功能：${t(f.addFeatures)}`);
  if (t(f.removeParts)) lines.push(`去掉：${t(f.removeParts)}`);
  if (t(f.sceneBackground)) lines.push(`场景背景：${t(f.sceneBackground)}`);
  if (t(f.freeNote)) lines.push(`其他：${t(f.freeNote)}`);

  if (!secondaryFieldsHaveEdits(f)) {
    lines.push('（尚未填写改动点 — 请至少选一项包装/颜色/外观调整）');
  }
  return lines.join('\n');
};

/** 英文改动段（拼进生图工具提示，配合 identity lock） */
export const buildSecondaryCreationEditEnglish = (f: SecondaryCreationFields): string => {
  const edits: string[] = [];
  const pack = PACKAGING_STYLE_OPTIONS.find((o) => o.id === f.packagingStyle);
  if (f.packagingStyle !== 'keep' && pack) {
    edits.push(`Packaging: ${pack.en}`);
  }
  if (t(f.packagingCustom)) edits.push(`Packaging detail: ${t(f.packagingCustom)}`);
  if (t(f.packagingColor)) {
    edits.push(
      `Packaging print/colors ONLY: change to ${t(f.packagingColor)}; keep carton structure unless packaging form also changed`
    );
  }
  if (t(f.productColor)) {
    edits.push(
      `Product body colors ONLY: recolor to ${t(f.productColor)}; keep silhouette, tooling, logos placement`
    );
  }
  if (t(f.appearanceEdit)) edits.push(`Appearance local edit: ${t(f.appearanceEdit)}`);
  if (t(f.materialFinish)) edits.push(`Material / finish: ${t(f.materialFinish)}`);
  if (t(f.addFeatures)) {
    edits.push(`Add features (integrate naturally, do not reinvent the SKU): ${t(f.addFeatures)}`);
  }
  if (t(f.removeParts)) edits.push(`Remove these parts/elements: ${t(f.removeParts)}`);
  if (t(f.sceneBackground)) {
    edits.push(`Background/scene: ${t(f.sceneBackground)} — product identity still locked`);
  }
  if (t(f.freeNote)) edits.push(`Additional edit notes: ${t(f.freeNote)}`);

  if (!edits.length) {
    return 'No explicit edits listed — improve commercial studio presentation only; do not redesign the product.';
  }
  return edits.map((e, i) => `${i + 1}. ${e}`).join('\n');
};

export const SECONDARY_CREATION_NEGATIVE =
  'full redesign, different SKU, morphing silhouette, unrequested recolor of locked parts, inventing new tooling, ignoring reference product, hybrid chimera product, watermark, garbled text, fake seals';
