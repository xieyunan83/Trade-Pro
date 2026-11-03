/**
 * 企业模板技能库 · L1 版式参考 + L2 风格卡
 * L1：上传的目录页 / 海报页（图生图版式锚点）
 * L2：可执行的风格约束（色板、排版、构图语法、光影），非 LoRA 微调
 */

import type { DesignSkillId } from './designAgentStore';

export type EnterprisePackKind =
  | 'catalog_spread'
  | 'poster_hero'
  | 'listing_white'
  | 'booth_cover'
  | 'custom';

export type EnterpriseStyleCard = {
  /** 主色 / 辅色 / 强调色（可读描述即可） */
  palette: string[];
  /** 标题区、型号条、留白习惯 */
  typographyNotes: string;
  /** 栅格、主次层级、产品占位 */
  layoutGrammar: string;
  /** 光影与材质气质 */
  lightingMood: string;
  /** 装饰线、色块、角标系统（不含供应商名） */
  decorationSystem: string;
  /** 可拼进生图的英文风格段 */
  stylePrompt: string;
  /** 负向补充 */
  negativePrompt: string;
  /** 提炼来源说明（中性） */
  sourceNote?: string;
  updatedAt: number;
};

export type EnterpriseDesignPack = {
  id: string;
  name: string;
  kind: EnterprisePackKind;
  summary: string;
  /** 适合挂接的 Design Skill */
  skillHints: DesignSkillId[];
  /** L1：版式页图（data URL 或可访问 URL） */
  layoutRefs: string[];
  /** L2：风格卡；内置样本开箱即用 */
  styleCard: EnterpriseStyleCard;
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
};

const LS_PACKS = 'trade_scout_enterprise_design_packs_v1';
const LS_ACTIVE = 'trade_scout_enterprise_design_pack_active_v1';
const LS_SEEDED = 'trade_scout_enterprise_design_packs_seeded_v1';

const now = () => Date.now();

const card = (
  partial: Omit<EnterpriseStyleCard, 'updatedAt'> & { updatedAt?: number }
): EnterpriseStyleCard => ({
  ...partial,
  updatedAt: partial.updatedAt || now(),
});

/** 内置样本：澄海玩具外贸常见目录 / 海报 / 主图 / 展会封面气质（L2 可执行；L1 待用户补版式页） */
export const BUILTIN_ENTERPRISE_PACKS: EnterpriseDesignPack[] = [
  {
    id: 'pack_catalog_grid_export',
    name: '出口目录内页 · 网格',
    kind: 'catalog_spread',
    summary: '左右分栏或 2×2/3×3 产品格，型号条清晰，白/浅灰底，适合画册内页二次创作',
    skillHints: ['multi_product_poster', 'detail_long', 'listing_set'],
    layoutRefs: [],
    styleCard: card({
      palette: ['#FFFFFF', '#F3F4F6', '#0F172A', '#DC2626', '#2563EB'],
      typographyNotes:
        '顶部窄条系列名；每格下方型号+一短卖点；中英双语标题区预留；正文不上满字墙',
      layoutGrammar:
        'Catalog spread: consistent product cells with equal margins, one hero SKU optional larger, clean gutters, barcode/model strip under each cell, bilingual title-safe header band, generous white space, no overlapping products',
      lightingMood: 'Even catalog softbox, low contrast shadows, true plastic colors, print-ready sharpness',
      decorationSystem: 'Thin slate rules, small corner brand mark area, optional red accent bars — no fake seals',
      stylePrompt:
        'Chenghai toy-export catalog interior page aesthetic: clean multi-SKU grid or two-column spread, equal cell gutters, white or light-gray page ground, sharp product fidelity, bilingual header band with title-safe margins, model number strip under each product, commercial print catalog quality, locked product identity from references',
      negativePrompt:
        'carnival sticker chaos, low-end flea market collage, watermark, fake certificates, tiny illegible paragraphs, mismatched cell sizes, dropping SKUs',
      sourceNote: '内置样本 · 出口目录内页',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_poster_scene_long',
    name: '出口海报 · 实景长图',
    kind: 'poster_hero',
    summary: '竖版营销长图：大字少字、场景段、产品英雄角，适合海报工作室与详情首屏',
    skillHints: ['detail_long', 'multi_product_poster', 'product_hero'],
    layoutRefs: [],
    styleCard: card({
      palette: ['#0B1220', '#F8FAFC', '#F59E0B', '#38BDF8'],
      typographyNotes: '顶部大标题区 + 中段场景说明短句 + 底部型号；禁止参数表与装箱量上图',
      layoutGrammar:
        'Vertical marketing long-poster: hero product upper-middle, lifestyle scene bands, large readable title zone, sparse copy, strong vertical rhythm, mobile-first safe margins',
      lightingMood: 'Cinematic but clean key light, soft rim, realistic materials, export e-commerce polish',
      decorationSystem: 'Soft gradient washes and scene props only when needed; no dense icon walls',
      stylePrompt:
        'Export-trade vertical product poster: bold sparse typography zones, lifestyle scene storytelling top-to-bottom, hero toy prominent, high commercial polish, bilingual title-safe areas, no packing-spec tables, no virtual packaging spam',
      negativePrompt:
        'parameter tables, packing qty charts, virtual carton spam, garbled micro-text, watermark, busy icon wall',
      sourceNote: '内置样本 · 实景营销长图',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_listing_pure_white',
    name: '跨境主图 · 纯白',
    kind: 'listing_white',
    summary: '亚马逊/独立站主图规范：纯白底、主体约 85%、柔箱光、锁定 SKU',
    skillHints: ['product_hero', 'listing_set', 'multi_angle'],
    layoutRefs: [],
    styleCard: card({
      palette: ['#FFFFFF', '#E5E7EB', '#111827'],
      typographyNotes: '主图无字或极少字；卖点留给套图分镜',
      layoutGrammar:
        'Single centered product on pure #FFFFFF cyclorama, subject fills ~85% frame, square-safe margins, slight contact shadow only',
      lightingMood: 'Dual softbox + gentle rim, true-to-life plastics, catalog sharpness',
      decorationSystem: 'None — pure seamless background',
      stylePrompt:
        'Marketplace hero product photograph, pure white seamless background, soft dual softbox lighting, true material colors, subject fills about 85 percent of frame, crisp commercial catalog sharpness, locked SKU identity',
      negativePrompt:
        'busy background, neon gels, watermark, fake certification seals, color drift, props clutter',
      sourceNote: '内置样本 · 跨境主图',
    }),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'pack_booth_catalog_cover',
    name: '展会画册 · 封面',
    kind: 'booth_cover',
    summary: 'B2B 展会画册封面：英雄产品、标题锁区、展厅专业灯光',
    skillHints: ['booth_cover', 'detail_long', 'social_square'],
    layoutRefs: [],
    styleCard: card({
      palette: ['#0F172A', '#F1F5F9', '#C4A35A', '#FFFFFF'],
      typographyNotes: '封面大标题锁区居中或偏上；副标双语短句；年份可选',
      layoutGrammar:
        'Brochure cover hierarchy: large title-safe negative space, hero product lower-third or center-right, premium exhibition lighting, clean brand mark corner',
      lightingMood: 'Showroom cinematic key + soft fill, professional B2B trust mood',
      decorationSystem: 'Gold/slate accent line, minimal geometric frame — no carnival stickers',
      stylePrompt:
        'B2B trade-fair catalog cover composition, premium exhibition lighting on hero toy, spacious negative space for bilingual title lockup, Chenghai toy-export showroom professionalism, brochure cover hierarchy',
      negativePrompt:
        'carnival chaos, flea market vibe, watermark, fake awards seals, cluttered stickers',
      sourceNote: '内置样本 · 展会封面',
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

export const loadEnterprisePacks = (): EnterpriseDesignPack[] => {
  try {
    const raw = localStorage.getItem(LS_PACKS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EnterpriseDesignPack[]) : [];
  } catch {
    return [];
  }
};

export const saveEnterprisePacks = (packs: EnterpriseDesignPack[]) => {
  localStorage.setItem(LS_PACKS, JSON.stringify(packs));
};

/** 首次进入：写入内置样本；已有用户包则合并补齐缺失的 builtin id */
export const ensureEnterprisePacksSeeded = (): EnterpriseDesignPack[] => {
  const existing = loadEnterprisePacks();
  const seededFlag = localStorage.getItem(LS_SEEDED);
  const t = now();
  const builtins = BUILTIN_ENTERPRISE_PACKS.map((p) => stampBuiltin(p, t));

  if (!existing.length) {
    saveEnterprisePacks(builtins);
    localStorage.setItem(LS_SEEDED, '1');
    if (!getActiveEnterprisePackId()) {
      setActiveEnterprisePackId(builtins[0].id);
    }
    return builtins;
  }

  const byId = new Map(existing.map((p) => [p.id, p]));
  let dirty = false;
  for (const b of builtins) {
    if (!byId.has(b.id)) {
      byId.set(b.id, b);
      dirty = true;
    } else {
      const cur = byId.get(b.id)!;
      // 内置包：保留用户已上传的 L1；L2 若仍为空源注则刷新样本卡
      if (cur.builtin) {
        const merged: EnterpriseDesignPack = {
          ...b,
          layoutRefs: cur.layoutRefs?.length ? cur.layoutRefs : b.layoutRefs,
          styleCard:
            cur.styleCard?.stylePrompt?.trim() && cur.layoutRefs?.length
              ? cur.styleCard
              : b.styleCard,
          updatedAt: Math.max(cur.updatedAt || 0, b.updatedAt),
        };
        if (JSON.stringify(merged) !== JSON.stringify(cur)) {
          byId.set(b.id, merged);
          dirty = true;
        }
      }
    }
  }
  const next = Array.from(byId.values()).sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  if (dirty || !seededFlag) {
    saveEnterprisePacks(next);
    localStorage.setItem(LS_SEEDED, '1');
  }
  if (!getActiveEnterprisePackId() && next[0]) {
    setActiveEnterprisePackId(next[0].id);
  }
  return next;
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
  const stamped = { ...pack, updatedAt: now() };
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
  const updated: EnterpriseDesignPack = {
    ...pack,
    layoutRefs: [],
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
      palette: ['#FFFFFF', '#0F172A'],
      typographyNotes: '待从版式页提炼',
      layoutGrammar: 'Follow uploaded layout references when present',
      lightingMood: 'Match layout reference lighting',
      decorationSystem: 'Match layout reference decorations',
      stylePrompt:
        'Match the visual system of the provided layout reference pages; keep product identity locked; commercial print quality',
      negativePrompt: 'watermark, garbled text, ignoring layout reference',
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
  // 保留用户在 builtin 上上传的 L1
  const prev = loadEnterprisePacks();
  const withL1 = builtins.map((b) => {
    const old = prev.find((p) => p.id === b.id);
    return old?.layoutRefs?.length ? { ...b, layoutRefs: old.layoutRefs } : b;
  });
  const next = [...withL1, ...customs];
  saveEnterprisePacks(next);
  localStorage.setItem(LS_SEEDED, '1');
  return next;
};

/** 是否把末张当版式参考 */
export const packImpliesLayoutLastRef = (pack: EnterpriseDesignPack | null | undefined): boolean => {
  if (!pack?.layoutRefs?.length) return false;
  return (
    pack.kind === 'catalog_spread' ||
    pack.kind === 'poster_hero' ||
    pack.kind === 'booth_cover' ||
    pack.kind === 'custom'
  );
};

/**
 * 合并产品参考 + 模板包 L1。
 * 版式页放在末尾（与 multi_product_poster / lastRefIsLayout 约定一致）。
 */
export const mergeRefsWithPack = (
  productRefs: string[],
  pack: EnterpriseDesignPack | null | undefined,
  maxTotal = 9
): { refs: string[]; lastRefIsLayout: boolean } => {
  if (!pack?.layoutRefs?.length) {
    return { refs: productRefs.slice(0, maxTotal), lastRefIsLayout: false };
  }
  const layout = pack.layoutRefs.filter(Boolean);
  const products = productRefs.filter(Boolean);
  // 留至少 1 个版式位
  const maxProducts = Math.max(0, maxTotal - Math.min(layout.length, 2));
  const head = products.slice(0, maxProducts);
  const tail = layout.slice(0, Math.max(1, maxTotal - head.length));
  const refs = [...head, ...tail].slice(0, maxTotal);
  return { refs, lastRefIsLayout: refs.length >= 2 && tail.length > 0 };
};

export const applyPackStyleToPrompt = (
  basePrompt: string,
  pack: EnterpriseDesignPack | null | undefined
): string => {
  if (!pack?.styleCard?.stylePrompt?.trim()) return basePrompt;
  const style = pack.styleCard.stylePrompt.trim();
  const base = (basePrompt || '').trim();
  if (!base) return style;
  if (base.includes(style.slice(0, 48))) return base;
  return `${base}\n\n[Enterprise template style · ${pack.name}]\n${style}`;
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
    pack.layoutRefs.length
      ? `已挂 ${pack.layoutRefs.length} 张版式参考（末张为版式锚点）。`
      : '尚未上传版式页，当前仅使用风格卡约束。',
  ]
    .filter(Boolean)
    .join('\n');
};

/** 从版式页提炼 / 刷新 L2 风格卡 */
export const extractStyleCardFromLayoutRefs = async (
  pack: EnterpriseDesignPack,
  layoutImages: string[]
): Promise<EnterpriseStyleCard> => {
  const imgs = layoutImages.filter(Boolean).slice(0, 4);
  if (!imgs.length) {
    throw new Error('请先上传至少 1 张版式页');
  }

  const { callQwen } = await import('./geminiService');
  // 不把整图 base64 塞进纯文本；改为让模型基于用户已描述的「版式类型」+ 元数据提炼。
  // 若运行时支持多模态，可后续扩展；此处用结构化描述任务保证稳定 JSON。
  const prompt = `你是外贸玩具企业的平面设计规范助理。根据模板包信息与版式页数量，输出可执行的风格卡 JSON（不要 markdown）。
模板包名称：${pack.name}
类型：${pack.kind}
摘要：${pack.summary}
版式页数量：${imgs.length}
已有风格草稿：${JSON.stringify({
    palette: pack.styleCard.palette,
    typographyNotes: pack.styleCard.typographyNotes,
    layoutGrammar: pack.styleCard.layoutGrammar,
  })}

要求：
1. stylePrompt 必须是英文、可直接拼进图像生成提示，描述版式/色板/光影/装饰系统，禁止出现具体供应商或模型商品名
2. negativePrompt 英文短句
3. palette 3–6 个色值或色名
4. 中文字段简洁专业

严格输出 JSON：
{
  "palette": string[],
  "typographyNotes": string,
  "layoutGrammar": string,
  "lightingMood": string,
  "decorationSystem": string,
  "stylePrompt": string,
  "negativePrompt": string,
  "sourceNote": string
}`;

  const raw = await callQwen(prompt, {
    jsonMode: true,
    timeoutMs: 60_000,
    maxTokens: 1200,
  });

  let parsed: Partial<EnterpriseStyleCard> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }

  const next = card({
    palette: Array.isArray(parsed.palette) && parsed.palette.length
      ? parsed.palette.map(String)
      : pack.styleCard.palette,
    typographyNotes: String(parsed.typographyNotes || pack.styleCard.typographyNotes),
    layoutGrammar: String(parsed.layoutGrammar || pack.styleCard.layoutGrammar),
    lightingMood: String(parsed.lightingMood || pack.styleCard.lightingMood),
    decorationSystem: String(parsed.decorationSystem || pack.styleCard.decorationSystem),
    stylePrompt: String(parsed.stylePrompt || pack.styleCard.stylePrompt),
    negativePrompt: String(parsed.negativePrompt || pack.styleCard.negativePrompt),
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
  booth_cover: '展会封面',
  custom: '自定义',
};
