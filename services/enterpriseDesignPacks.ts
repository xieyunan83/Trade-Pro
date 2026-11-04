/**
 * 企业模板技能库 · L1 版式参考 + L2 风格卡
 * 样本来源：教育玩具批发目录（封面 / 新品内页 / Toddler Play 网格）深度提炼
 * L1：版式页图生图锚点 · L2：色板/排版/构图/功能卖点文案公式（非 LoRA）
 */

import type { DesignSkillId } from './designAgentStore';

export type EnterprisePackKind =
  | 'catalog_spread'
  | 'poster_hero'
  | 'listing_white'
  | 'booth_cover'
  | 'custom';

export type EnterpriseStyleCard = {
  palette: string[];
  typographyNotes: string;
  layoutGrammar: string;
  lightingMood: string;
  decorationSystem: string;
  /** 可拼进生图的英文风格段 */
  stylePrompt: string;
  negativePrompt: string;
  /**
   * 功能卖点文案公式（中英）：主题钩子 → 发展动词 → 配件清单 → 尺寸规格
   * 用于傻瓜式一键套用与 Brief 编排
   */
  copyFormula: string;
  /** 给业务员看的一句话操作说明 */
  foolproofHint: string;
  /** 一键套用时预填的中文指令（用户可改） */
  foolproofPrompt: string;
  sourceNote?: string;
  updatedAt: number;
};

export type EnterpriseDesignPack = {
  id: string;
  name: string;
  kind: EnterprisePackKind;
  summary: string;
  skillHints: DesignSkillId[];
  layoutRefs: string[];
  styleCard: EnterpriseStyleCard;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
};

const LS_PACKS = 'trade_scout_enterprise_design_packs_v1';
const LS_ACTIVE = 'trade_scout_enterprise_design_pack_active_v1';
const LS_SEEDED = 'trade_scout_enterprise_design_packs_seeded_v1';
/** 升级样本库时递增，强制刷新内置包 L1/L2 */
const SEED_VERSION = 'edu_catalog_v2';

const T = {
  coverIntro: '/enterprise-templates/cover-new-2026.jpg',
  coverModular: '/enterprise-templates/cover-modular-grid.jpg',
  interiorNew: '/enterprise-templates/interior-new-products.jpg',
  interiorDense: '/enterprise-templates/interior-toddler-dense.jpg',
  interiorGrid: '/enterprise-templates/interior-toddler-grid.jpg',
} as const;

const now = () => Date.now();

const card = (
  partial: Omit<EnterpriseStyleCard, 'updatedAt'> & { updatedAt?: number }
): EnterpriseStyleCard => ({
  ...partial,
  updatedAt: partial.updatedAt || now(),
});

/** 从教育玩具目录样本提炼的共用文案语法 */
const COPY_BENEFIT_LED = `功能卖点文案公式（必须遵守）：
1) 主题钩子：用 1 句场景/角色扮演引入（如 picnic / shopping / building / doctor play）
2) 发展动词：strengthen / boost / develop / practice / explore + 具体能力（letter recognition, fine motor, hand-eye, vocabulary, counting, color/shape…）
3) 配件清单：Includes … 列清主要配件与数量感
4) 规格收尾：Measures …"（或公制）
5) 元数据区（版面上，勿堆成乱码小字）：SKU · AGES · 可选 SRP/CPQ（价与装箱用品红色强调）
禁：空洞形容词堆砌、假认证、过密参数表、不可读微字墙。`;

/**
 * 内置样本（已挂 L1 版式页 + 深挖 L2）
 * 覆盖：年度封面 / 模块封面 / 新品功能内页 / Toddler 多 SKU 网格 / 白底主图
 */
export const BUILTIN_ENTERPRISE_PACKS: EnterpriseDesignPack[] = [
  {
    id: 'pack_edu_year_intro_cover',
    name: '年度新品 · 封面导语',
    kind: 'booth_cover',
    summary:
      '左右色块分割 + 超大 NEW/年份标题 + 中段品牌使命短文 + 周边产品切图标注页码；适合画册开篇',
    skillHints: ['booth_cover', 'detail_long', 'multi_product_poster'],
    layoutRefs: [T.coverIntro],
    styleCard: card({
      palette: ['#0A2A5C', '#2F9BDB', '#FFFFFF', '#F5C518', '#E8F4FC'],
      typographyNotes:
        '超大粗无衬线白字 NEW / for YEAR 层级压倒一切；中段左对齐白字使命段落（中等字重、舒适行距）；产品旁小白字「品名, pg. N」；禁止正文微字墙',
      layoutGrammar:
        'Vertical split color-block cover: left ~25% deep navy with playful yellow dashed stars/swooshes, right ~75% bright sky blue; oversized white headline upper-center; short mission paragraph mid-page; 3–4 cut-out product heroes around text (top-left DIY vehicle, top-right literacy set, bottom plush row) each with tiny name+page caption; generous breathing room; catalog cover hierarchy not crowded poster',
      lightingMood:
        'Clean studio cut-outs on solid color fields, true toy colors, high commercial print sharpness, no muddy shadows',
      decorationSystem:
        'Yellow dotted star trails and launch swoosh on navy only; no carnival sticker borders; product-first cut-outs',
      stylePrompt:
        'Educational toy wholesale catalog year-intro cover: deep navy left panel with yellow dashed star trails, bright sky-blue main field, massive bold white sans-serif NEW for YEAR headline, short white mission paragraph left-aligned mid page, multiple sharp product cut-outs framing the text with tiny white product-name and page captions, playful but premium B2B catalog energy, locked product identity from references',
      negativePrompt:
        'dense micro-text walls, fake awards, flea-market collage, ignoring color-block split, watermark, illegible captions, cluttered icon spam',
      copyFormula: `${COPY_BENEFIT_LED}
封面导语变体：开篇用「From … to … we introduce nearly N new toys that inspire and empower…」；强调 innovation / creativity / engagement / bringing learning to life；不要堆 SKU 价目。`,
      foolproofHint: '上传 1–3 张产品图 → 点「一键套用」→ 确认生成封面',
      foolproofPrompt:
        '按年度新品封面模板做一页：左右海军蓝/天蓝色块分割，超大白色 NEW for 2026 标题，中间写 2–3 句使命短文（启发儿童、把学习变生动），周围排布我上传的产品切图并在旁标注品名；黄点星芒装饰仅放在海军蓝侧；产品外形锁定参考图。',
      sourceNote: '样本学习 · 年度封面导语页',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_edu_modular_tile_cover',
    name: '模块色砖 · 画册封面',
    kind: 'booth_cover',
    summary:
      '2×3 圆角色砖网格：产品砖 + 年份口号砖 + Logo 砖；白缝、高饱和底色；适合系列封面',
    skillHints: ['booth_cover', 'social_square', 'multi_product_poster'],
    layoutRefs: [T.coverModular],
    styleCard: card({
      palette: ['#FFFFFF', '#1E5BB8', '#2BB3E0', '#7AC943', '#F5A623', '#0F172A'],
      typographyNotes:
        '年份超大粗白字；CATALOG 放圆角白框内；口号用高对比色（如黄字）；产品砖内小字品名+页码靠角；整体无衬线几何体',
      layoutGrammar:
        '2-column × 3-row modular tile cover on white canvas, uniform gutters, large rounded rectangles (~24–32px radius), each tile either product-on-solid-color or message/logo block; one tile is hero year+slogan; bottom-right reserved for brand mark stack; product tiles include corner caption name + pg.',
      lightingMood: 'High-key studio products on saturated flat color tiles, crisp edges, friendly education brand feel',
      decorationSystem:
        'Solid primary-color tile fills only; white gutters as breathing room; no gradients or neon gels; optional soft circle callout for “nearly N new toys”',
      stylePrompt:
        'Educational catalog modular cover: white background with 2x3 grid of rounded colorful tiles, saturated blue orange green cyan blocks, oversized year and CATALOG typography in a blue tile, short learning slogan, product photography inside other tiles with tiny name and page labels, brand logo stack in one tile, clean modern Lego-brick catalog aesthetic, locked product identity',
      negativePrompt:
        'messy freeform collage, tiny illegible paragraphs, dark muddy tiles, watermark, uneven gutters, carnival stickers',
      copyFormula: `${COPY_BENEFIT_LED}
封面口号变体：We Bring Learning to Life! / Nearly N new toys inside! 短、有力、可大字上图。`,
      foolproofHint: '选好产品图 → 一键套用模块封面 → 生成',
      foolproofPrompt:
        '按模块色砖封面做一页：白底 2×3 圆角色块网格，一块写大号年份+CATALOG+口号，其余色块放我的产品图并在角上标品名；色块用蓝/橙/绿/青高饱和纯色；缝隙留白均匀；产品外形锁定参考图。',
      sourceNote: '样本学习 · 模块色砖封面',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_edu_feature_interior',
    name: '新品功能 · 专题内页',
    kind: 'catalog_spread',
    summary:
      '浅天蓝底、竖向分类签、3 段产品专题：大图+卖点框+功能利益文案+尺寸；价与装箱品红色',
    skillHints: ['multi_product_poster', 'detail_long', 'listing_set'],
    layoutRefs: [T.interiorNew],
    styleCard: card({
      palette: ['#D9F0FA', '#0B3A6E', '#E91E63', '#2E7D32', '#FFFFFF', '#1565C0'],
      typographyNotes:
        '产品名：粗海军蓝无衬线大标题；SKU 小号粗体；AGES 全大写+绿色圆点/六边形前缀；正文常规字重可读段落；SRP|CPQ 粗品红色单独一行；功能说明可用浅蓝描边小框',
      layoutGrammar:
        'Light sky-blue catalog interior: vertical category tab on right edge (“New Products”); 2–3 stacked feature bands; each band = hero product photo + optional detail/lifestyle inset + left or center benefit copy + feature callout box; footer navy bar with simple legend icons (best seller / award / STEM) and large page number; keep text zones large enough to stay readable — prefer short paragraphs not micro-walls',
      lightingMood: 'Even softbox catalog lighting, true plastic colors, white or soft cut-outs, print-ready sharpness',
      decorationSystem:
        'Thin light-blue feature callout boxes; green age bullets; magenta price line; navy footer icon strip; optional themed side graphic (e.g. playful label) without clutter',
      stylePrompt:
        'Educational toy new-products catalog interior page on soft sky-blue ground, vertical category tab, two or three horizontal product feature bands with large hero photos, navy bold product titles, short benefit-led descriptions, feature callout boxes, magenta SRP and CPQ line, green age tags, navy footer with legend icons and page number, commercial wholesale catalog clarity, locked product identity from references',
      negativePrompt:
        'illegible micro-text, fake certificates, flea market chaos, ignoring band hierarchy, watermark, mismatched product identity',
      copyFormula: `${COPY_BENEFIT_LED}
专题内页示例结构：
- 标题：产品名（可带™）
- 元数据：SKU · AGES N+
- 正文：Toddlers strengthen … / Includes … / Measures …
- 卖点框：一句视觉逻辑（如 vowels vs consonants）
- 商业行：$XX.XX SRP | CPQ N`,
      foolproofHint: '上传产品图 → 一键套用 → 自动按「功能利益」写说明并排版',
      foolproofPrompt:
        '按新品功能专题内页排版：浅天蓝底、右侧竖向分类签；每个产品一条横带——大图+粗海军蓝品名+绿色年龄标+2–3句功能利益文案（strengthen/boost/develop…）+浅蓝卖点框+品红色 SRP|CPQ；页脚海军蓝图标条；产品外形锁定参考图，文字区大而少、禁止微字墙。',
      sourceNote: '样本学习 · 新品功能内页',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_edu_toddler_sku_grid',
    name: '品类网格 · 多 SKU 内页',
    kind: 'catalog_spread',
    summary:
      '白底多栏 SKU 卡：品名→货号/年龄→功能利益段→尺寸→品红价；紫/粉侧栏分类名；可混入生活方式大图',
    skillHints: ['multi_product_poster', 'listing_set', 'detail_long'],
    layoutRefs: [T.interiorDense, T.interiorGrid],
    styleCard: card({
      palette: ['#FFFFFF', '#0B3A6E', '#E91E63', '#6B3FA0', '#2E7D32', '#F5F7FA'],
      typographyNotes:
        '每卡固定层级：①粗海军蓝品名 ②绿色货号+年龄大写标签 ③3–4 行功能利益正文 ④品红色 $SRP | CPQ；分类名竖排在紫/粉侧栏；页脚海军蓝图例',
      layoutGrammar:
        'White multi-SKU catalog grid (3-column or left-stack + right-hero mix). Each cell: product hero cut-out on top, then title → SKU/age → benefit paragraph → magenta commercial line. Optional bottom lifestyle+product pairing spanning 1–2 columns. Vertical purple/magenta category ribbon on side. Navy footer with icons + page number. Equal gutters, consistent card rhythm.',
      lightingMood: 'Sterile white page, soft even product lighting, accessories knolled around hero when needed, high clarity for buyers',
      decorationSystem:
        'Purple vertical category ribbon; green status dots; star/trophy/STEM footer icons; thin lavender promo banner optional; no sticker chaos',
      stylePrompt:
        'Wholesale educational toy category catalog page on white, multi-column SKU cards with navy bold titles, green item codes and age tags, benefit-led short copy, magenta SRP CPQ lines, purple vertical category ribbon, navy footer legend, optional lifestyle inset, clean B2B buyer-scan layout, locked product identity from references',
      negativePrompt:
        'crowded unreadable paragraphs, fake seals, uneven card sizes, dropping SKUs, watermark, carnival borders',
      copyFormula: `${COPY_BENEFIT_LED}
网格卡强制四段：
Title → SKU | TODDLERS+/AGES → Benefit paragraph (theme + skills + includes + measures) → $SRP | CPQ
动词优先：strengthen, boost, develop, practice, explore, build。`,
      foolproofHint: '多图上传 → 一键套用网格 → 每格自动按功能卖点结构描述',
      foolproofPrompt:
        '按品类多 SKU 网格内页：白底多栏产品卡，每卡品名（海军蓝粗体）→ 货号与年龄 → 3–4 句功能利益文案（场景钩子+发展能力+配件+尺寸）→ 品红色价格与装箱；侧边紫色竖排分类名；可在底部放一张生活方式大图；产品外形锁定参考图。',
      sourceNote: '样本学习 · Toddler Play 多 SKU 网格',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_listing_pure_white',
    name: '跨境主图 · 纯白',
    kind: 'listing_white',
    summary: '纯白底主图：主体约 85%、柔箱光；卖点文案留给套图，不在主图堆字',
    skillHints: ['product_hero', 'listing_set', 'multi_angle'],
    layoutRefs: [],
    styleCard: card({
      palette: ['#FFFFFF', '#E5E7EB', '#111827'],
      typographyNotes: '主图无字或极少字；卖点按功能利益公式写在套图/详情，不进主图',
      layoutGrammar:
        'Single centered product on pure #FFFFFF cyclorama, subject fills ~85% frame, square-safe margins, slight contact shadow only',
      lightingMood: 'Dual softbox + gentle rim, true-to-life plastics, catalog sharpness',
      decorationSystem: 'None — pure seamless background',
      stylePrompt:
        'Marketplace hero product photograph, pure white seamless background, soft dual softbox lighting, true material colors, subject fills about 85 percent of frame, crisp commercial catalog sharpness, locked SKU identity',
      negativePrompt:
        'busy background, neon gels, watermark, fake certification seals, color drift, props clutter, text spam on hero',
      copyFormula: COPY_BENEFIT_LED,
      foolproofHint: '上传产品图 → 一键套用 → 生成白底主图',
      foolproofPrompt:
        '做一张跨境白底主图：纯白无缝背景，产品居中约占 85%，柔箱光，真实材质配色，主图不写密字；外形锁定参考图。',
      sourceNote: '内置 · 跨境主图',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

const stampBuiltin = (p: EnterpriseDesignPack, t: number): EnterpriseDesignPack => ({
  ...p,
  createdAt: p.createdAt || t,
  updatedAt: p.updatedAt || t,
  styleCard: { ...p.styleCard, updatedAt: p.styleCard.updatedAt || t },
});

const withCopyDefaults = (p: EnterpriseDesignPack): EnterpriseDesignPack => {
  const c = p.styleCard || ({} as EnterpriseStyleCard);
  return {
    ...p,
    styleCard: card({
      palette: c.palette?.length ? c.palette : ['#FFFFFF', '#0F172A'],
      typographyNotes: c.typographyNotes || '',
      layoutGrammar: c.layoutGrammar || '',
      lightingMood: c.lightingMood || '',
      decorationSystem: c.decorationSystem || '',
      stylePrompt: c.stylePrompt || '',
      negativePrompt: c.negativePrompt || 'watermark, garbled text',
      copyFormula: c.copyFormula || COPY_BENEFIT_LED,
      foolproofHint: c.foolproofHint || '选择模板后上传产品图即可生成',
      foolproofPrompt: c.foolproofPrompt || '按当前企业模板风格生成，产品外形锁定参考图。',
      sourceNote: c.sourceNote,
      updatedAt: c.updatedAt,
    }),
  };
};

export const loadEnterprisePacks = (): EnterpriseDesignPack[] => {
  try {
    const raw = localStorage.getItem(LS_PACKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as EnterpriseDesignPack[]).map(withCopyDefaults);
  } catch {
    return [];
  }
};

export const saveEnterprisePacks = (packs: EnterpriseDesignPack[]) => {
  localStorage.setItem(LS_PACKS, JSON.stringify(packs));
};

/** 首次 / 版本升级：写入内置样本；保留用户自定义包 */
export const ensureEnterprisePacksSeeded = (): EnterpriseDesignPack[] => {
  const existing = loadEnterprisePacks();
  const seededFlag = localStorage.getItem(LS_SEEDED);
  const t = now();
  const builtins = BUILTIN_ENTERPRISE_PACKS.map((p) => stampBuiltin(p, t));
  const versionBump = seededFlag !== SEED_VERSION;

  if (!existing.length || versionBump) {
    const customs = existing.filter((p) => !p.builtin);
    // 版本升级：内置包整包替换（含公开 L1 路径与深挖 L2）；自定义保留
    const builtinIds = new Set(builtins.map((b) => b.id));
    const orphanCustom = customs.filter((c) => !builtinIds.has(c.id));
    const next = [...builtins, ...orphanCustom];
    saveEnterprisePacks(next);
    localStorage.setItem(LS_SEEDED, SEED_VERSION);
    if (!getActiveEnterprisePackId() || versionBump) {
      setActiveEnterprisePackId(builtins[0].id);
    }
    return next.map(withCopyDefaults);
  }

  const byId = new Map(existing.map((p) => [p.id, p]));
  let dirty = false;
  for (const b of builtins) {
    if (!byId.has(b.id)) {
      byId.set(b.id, b);
      dirty = true;
    }
  }
  // 清理已废弃的旧内置 id（仍标 builtin 但不在新清单）
  const aliveBuiltin = new Set(builtins.map((b) => b.id));
  for (const [id, p] of Array.from(byId.entries())) {
    if (p.builtin && !aliveBuiltin.has(id)) {
      byId.delete(id);
      dirty = true;
    }
  }
  const next = Array.from(byId.values()).sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  if (dirty) {
    saveEnterprisePacks(next);
  }
  if (!getActiveEnterprisePackId() && next[0]) {
    setActiveEnterprisePackId(next[0].id);
  }
  return next.map(withCopyDefaults);
};

export const getActiveEnterprisePackId = (): string | null => {
  try {
    return localStorage.getItem(LS_ACTIVE);
  } catch {
    return null;
  }
};

export const setActiveEnterprisePackId = (id: string | null) => {
  if (!id) localStorage.removeItem(LS_ACTIVE);
  else localStorage.setItem(LS_ACTIVE, id);
};

export const getActiveEnterprisePack = (): EnterpriseDesignPack | null => {
  const packs = ensureEnterprisePacksSeeded();
  const id = getActiveEnterprisePackId();
  if (!id) return null;
  return packs.find((p) => p.id === id) || null;
};

export const upsertEnterprisePack = (pack: EnterpriseDesignPack): EnterpriseDesignPack[] => {
  const packs = ensureEnterprisePacksSeeded();
  const i = packs.findIndex((p) => p.id === pack.id);
  const next = [...packs];
  const stamped = withCopyDefaults({ ...pack, updatedAt: now() });
  if (i >= 0) next[i] = stamped;
  else next.unshift(stamped);
  saveEnterprisePacks(next);
  return next;
};

export const deleteEnterprisePack = (id: string): EnterpriseDesignPack[] => {
  const safe = ensureEnterprisePacksSeeded();
  const target = safe.find((p) => p.id === id);
  if (!target || target.builtin) return safe;
  const out = safe.filter((p) => p.id !== id);
  saveEnterprisePacks(out);
  if (getActiveEnterprisePackId() === id) {
    setActiveEnterprisePackId(out[0]?.id || null);
  }
  return out;
};

export const appendPackLayoutRefs = (
  packId: string,
  refs: string[],
  maxRefs = 6
): EnterpriseDesignPack | null => {
  const packs = ensureEnterprisePacksSeeded();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return null;
  const merged = [...pack.layoutRefs];
  for (const r of refs) {
    if (!r || merged.includes(r)) continue;
    merged.push(r);
    if (merged.length >= maxRefs) break;
  }
  const updated: EnterpriseDesignPack = {
    ...pack,
    layoutRefs: merged.slice(0, maxRefs),
    updatedAt: now(),
  };
  upsertEnterprisePack(updated);
  return updated;
};

export const clearPackLayoutRefs = (packId: string): EnterpriseDesignPack | null => {
  const packs = ensureEnterprisePacksSeeded();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) return null;
  // 内置包清空后恢复公开样本 L1
  const builtin = BUILTIN_ENTERPRISE_PACKS.find((b) => b.id === packId);
  const updated: EnterpriseDesignPack = {
    ...pack,
    layoutRefs: pack.builtin && builtin ? [...builtin.layoutRefs] : [],
    updatedAt: now(),
  };
  upsertEnterprisePack(updated);
  return updated;
};

export const createCustomEnterprisePack = (opts: {
  name: string;
  kind?: EnterprisePackKind;
  summary?: string;
  skillHints?: DesignSkillId[];
}): EnterpriseDesignPack => {
  const t = now();
  const pack: EnterpriseDesignPack = {
    id: `pack_custom_${t}_${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name.trim() || '自定义模板包',
    kind: opts.kind || 'custom',
    summary: opts.summary?.trim() || '上传版式页后可提炼风格卡',
    skillHints: opts.skillHints || ['free', 'multi_product_poster'],
    layoutRefs: [],
    styleCard: card({
      palette: ['#FFFFFF', '#0B3A6E', '#E91E63'],
      typographyNotes: '待从版式页提炼；默认海军蓝标题 + 品红色商业行',
      layoutGrammar: 'Follow uploaded layout references when present',
      lightingMood: 'Match layout reference lighting',
      decorationSystem: 'Match layout reference decorations',
      stylePrompt:
        'Match the visual system of the provided layout reference pages; keep product identity locked; commercial educational catalog quality',
      negativePrompt: 'watermark, garbled text, ignoring layout reference',
      copyFormula: COPY_BENEFIT_LED,
      foolproofHint: '上传版式页 → 提炼风格卡 → 一键套用',
      foolproofPrompt: '按我上传的版式参考生成，产品外形锁定；文案按功能利益公式撰写。',
      sourceNote: '自定义包',
    }),
    builtin: false,
    createdAt: t,
    updatedAt: t,
  };
  upsertEnterprisePack(pack);
  setActiveEnterprisePackId(pack.id);
  return pack;
};

export const resetBuiltinEnterprisePacks = (): EnterpriseDesignPack[] => {
  const customs = loadEnterprisePacks().filter((p) => !p.builtin);
  const t = now();
  const builtins = BUILTIN_ENTERPRISE_PACKS.map((p) => stampBuiltin(p, t));
  const next = [...builtins, ...customs];
  saveEnterprisePacks(next);
  localStorage.setItem(LS_SEEDED, SEED_VERSION);
  setActiveEnterprisePackId(builtins[0]?.id || null);
  return next;
};

export const packImpliesLayoutLastRef = (pack: EnterpriseDesignPack | null | undefined): boolean => {
  if (!pack?.layoutRefs?.length) return false;
  return (
    pack.kind === 'catalog_spread' ||
    pack.kind === 'poster_hero' ||
    pack.kind === 'booth_cover' ||
    pack.kind === 'custom'
  );
};

export const mergeRefsWithPack = (
  productRefs: string[],
  pack: EnterpriseDesignPack | null | undefined,
  maxTotal = 9
): { refs: string[]; lastRefIsLayout: boolean } => {
  if (!pack?.layoutRefs?.length) {
    return { refs: productRefs.slice(0, maxTotal), lastRefIsLayout: false };
  }
  const layoutUrls = new Set(pack.layoutRefs.filter(Boolean));
  // 产品槽不得混入版式样本（否则模型会把模板里的货当成要锁的产品）
  const products = productRefs.filter((u) => u && !layoutUrls.has(u));
  // 只保留 1 张版式末张，避免多张版式被误当成产品图
  const layoutOne = pack.layoutRefs.find(Boolean);
  if (!layoutOne) {
    return { refs: products.slice(0, maxTotal), lastRefIsLayout: false };
  }
  const head = products.slice(0, Math.max(1, maxTotal - 1));
  if (!head.length) {
    // 没有产品图时不要只扔版式图去「生海报」，否则必出复刻样本
    return { refs: [], lastRefIsLayout: false };
  }
  const refs = [...head, layoutOne].slice(0, maxTotal);
  return { refs, lastRefIsLayout: true };
};

export const applyPackStyleToPrompt = (
  basePrompt: string,
  pack: EnterpriseDesignPack | null | undefined
): string => {
  if (!pack?.styleCard?.stylePrompt?.trim()) return basePrompt;
  const style = pack.styleCard.stylePrompt.trim();
  const copy = pack.styleCard.copyFormula?.trim();
  const base = (basePrompt || '').trim();
  // copyFormula 只作文案结构参考，禁止诱导模型自由编造图面英文段落
  const extras = [
    `[Enterprise template style · ${pack.name}]`,
    style,
    copy
      ? `[Copy craft — structure only, NOT free text to invent]\n${copy}\nIf APPROVED ON-IMAGE lines exist elsewhere in the prompt, render ONLY those exact lines. Otherwise NO TEXT on image.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (!base) return extras;
  if (base.includes(style.slice(0, 40))) return base;
  return `${base}\n\n${extras}`;
};

export const applyPackNegative = (
  baseNegative: string,
  pack: EnterpriseDesignPack | null | undefined
): string => {
  const bits = [baseNegative?.trim(), pack?.styleCard?.negativePrompt?.trim()].filter(Boolean);
  return Array.from(new Set(bits.join(', ').split(/,\s*/).filter(Boolean))).join(', ');
};

export const packCraftNotes = (pack: EnterpriseDesignPack | null | undefined): string => {
  if (!pack) return '';
  const c = pack.styleCard;
  return [
    `企业模板包「${pack.name}」：`,
    c.layoutGrammar,
    c.typographyNotes,
    c.lightingMood,
    c.decorationSystem,
    c.copyFormula,
    pack.layoutRefs.length
      ? `已挂 ${pack.layoutRefs.length} 张版式参考（末张为版式锚点）。`
      : '当前仅使用风格卡约束。',
  ]
    .filter(Boolean)
    .join('\n');
};

/** 傻瓜式一键指令（可带 SKU 信息） */
export const buildFoolproofPrompt = (
  pack: EnterpriseDesignPack | null | undefined,
  opts?: { skuName?: string; skuCode?: string; userNote?: string }
): string => {
  if (!pack) return opts?.userNote?.trim() || '';
  const bits = [
    pack.styleCard.foolproofPrompt.trim(),
    opts?.skuName ? `产品名：${opts.skuName}` : '',
    opts?.skuCode ? `型号/SKU：${opts.skuCode}` : '',
    opts?.userNote?.trim() || '',
  ].filter(Boolean);
  return bits.join('\n');
};

export const extractStyleCardFromLayoutRefs = async (
  pack: EnterpriseDesignPack,
  layoutImages: string[]
): Promise<EnterpriseStyleCard> => {
  const imgs = layoutImages.filter(Boolean).slice(0, 4);
  if (!imgs.length) {
    throw new Error('请先上传至少 1 张版式页');
  }

  const { callQwen } = await import('./geminiService');
  const prompt = `你是外贸/教育玩具企业的平面设计规范助理。根据模板包与版式页数量，输出可执行风格卡 JSON（不要 markdown）。
模板包名称：${pack.name}
类型：${pack.kind}
摘要：${pack.summary}
版式页数量：${imgs.length}
已有草稿：${JSON.stringify({
    palette: pack.styleCard.palette,
    typographyNotes: pack.styleCard.typographyNotes,
    layoutGrammar: pack.styleCard.layoutGrammar,
    copyFormula: pack.styleCard.copyFormula?.slice(0, 200),
  })}

要求：
1. stylePrompt 英文、可拼进图像生成；禁止供应商/大模型商品名
2. copyFormula 必须包含功能利益文案公式：主题钩子→发展动词→配件→尺寸→元数据
3. foolproofPrompt 用中文写给业务员的一键指令
4. palette 3–6 色

严格输出 JSON：
{
  "palette": string[],
  "typographyNotes": string,
  "layoutGrammar": string,
  "lightingMood": string,
  "decorationSystem": string,
  "stylePrompt": string,
  "negativePrompt": string,
  "copyFormula": string,
  "foolproofHint": string,
  "foolproofPrompt": string,
  "sourceNote": string
}`;

  const raw = await callQwen(prompt, {
    jsonMode: true,
    timeoutMs: 60_000,
    maxTokens: 1600,
  });

  let parsed: Partial<EnterpriseStyleCard> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }

  const next = card({
    palette:
      Array.isArray(parsed.palette) && parsed.palette.length
        ? parsed.palette.map(String)
        : pack.styleCard.palette,
    typographyNotes: String(parsed.typographyNotes || pack.styleCard.typographyNotes),
    layoutGrammar: String(parsed.layoutGrammar || pack.styleCard.layoutGrammar),
    lightingMood: String(parsed.lightingMood || pack.styleCard.lightingMood),
    decorationSystem: String(parsed.decorationSystem || pack.styleCard.decorationSystem),
    stylePrompt: String(parsed.stylePrompt || pack.styleCard.stylePrompt),
    negativePrompt: String(parsed.negativePrompt || pack.styleCard.negativePrompt),
    copyFormula: String(parsed.copyFormula || pack.styleCard.copyFormula || COPY_BENEFIT_LED),
    foolproofHint: String(parsed.foolproofHint || pack.styleCard.foolproofHint),
    foolproofPrompt: String(parsed.foolproofPrompt || pack.styleCard.foolproofPrompt),
    sourceNote: String(parsed.sourceNote || `自 ${imgs.length} 张版式页提炼`),
  });

  upsertEnterprisePack({
    ...pack,
    styleCard: next,
    updatedAt: now(),
  });
  return next;
};

export const KIND_LABELS: Record<EnterprisePackKind, string> = {
  catalog_spread: '目录内页',
  poster_hero: '营销海报',
  listing_white: '跨境主图',
  booth_cover: '画册封面',
  custom: '自定义',
};
