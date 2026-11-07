/**
 * 官方产品品类树（稳定 ID）
 * 数据源：阿里巴巴国际站全站类目表（大类 / 一级 / 二级，约 38×554×6973）
 * 产品库与客户画像两侧均应对齐本树的 ID。
 */
import taxonomyPack from './alibabaFullTaxonomy.nodes.json';

export type TaxonomySide = 'sell' | 'procure' | 'both';

export type TaxonomyNode = {
  /** 稳定 ID：二级优先平台数字 ID；一级/大类为 slug */
  id: string;
  level: 0 | 1 | 2;
  nameEn: string;
  nameZh: string;
  parentId?: string | null;
  rootId?: string;
  url?: string | null;
  /** 匹配同义词（中英 + 旧版玩具 L1 平台 ID） */
  aliases: string[];
};

type Pack = {
  version: string;
  stats: { roots: number; l1: number; l2: number };
  nodes: Array<{
    id: string;
    level: 0 | 1 | 2;
    nameEn: string;
    nameZh: string;
    parentId?: string | null;
    rootId?: string;
    url?: string | null;
    aliases?: string[];
  }>;
  legacyL1IdMap: Record<string, string>;
  toyRootId: string;
};

const pack = taxonomyPack as Pack;

/** 常见表达偏差 → 官方树（中英同义词，匹配前归一） */
export const TAXONOMY_ALIAS_RULES: Array<{
  keys: string[];
  /** 优先落到的一级类目 id（新树 slug id） */
  l1Id?: string;
  l2Hint?: string;
  labelZh: string;
}> = [
  {
    keys: ['diecast', '合金车', '合金小车', '金属车', 'toy car', 'car toy', 'pull back', '回力车', 'alloy car'],
    l1Id: 'l1__parents_kids_and_toys__toy_vehicle',
    l2Hint: 'vehicle',
    labelZh: '玩具车 / 合金车',
  },
  {
    keys: ['rc car', 'remote control', '遥控车', '遥控玩具', 'rc toy'],
    l1Id: 'l1__parents_kids_and_toys__remote_control_toys',
    l2Hint: 'remote',
    labelZh: '遥控玩具',
  },
  {
    keys: ['plush', '软玩具', '毛绒', 'stuffed', 'soft toy'],
    l1Id: 'l1__parents_kids_and_toys__stuffed_animals_and_plush_toys',
    l2Hint: 'stuffed',
    labelZh: '毛绒玩具',
  },
  {
    keys: ['educational toy', '益智', 'stem toy', 'learning toy', 'montessori'],
    l1Id: 'l1__parents_kids_and_toys__educational_toys',
    labelZh: '益智玩具',
  },
  {
    keys: ['puzzle', '拼图', 'jigsaw'],
    l1Id: 'l1__parents_kids_and_toys__puzzle_and_games',
    l2Hint: 'puzzle',
    labelZh: '拼图与游戏',
  },
  {
    keys: ['building block', '积木', 'brick', 'lego', 'model building'],
    l1Id: 'l1__parents_kids_and_toys__blocks_and_model_building_toys',
    labelZh: '积木与拼装',
  },
  {
    keys: ['doll', '娃娃', 'barbie', 'fashion doll', 'pretend play'],
    l1Id: 'l1__parents_kids_and_toys__dress_up_and_pretend_play',
    labelZh: '装扮与过家家',
  },
  {
    keys: ['fidget', '解压', 'pop it', '减压', 'gag'],
    l1Id: 'l1__parents_kids_and_toys__novelty_and_gag_toys',
    l2Hint: 'fidget',
    labelZh: '新奇整蛊 / 解压玩具',
  },
  {
    keys: ['outdoor play', '户外游乐', 'playground', '滑梯', 'trampoline'],
    l1Id: 'l1__parents_kids_and_toys__outdoor_toys_and_structures',
    labelZh: '户外玩具与设施',
  },
  {
    keys: ['baby toy', 'toddler toy', '婴幼儿玩具', 'baby & toddler'],
    l1Id: 'l1__parents_kids_and_toys__baby_and_toddler_toys',
    labelZh: '婴幼儿玩具',
  },
  {
    keys: ['baby', 'infant', '母婴', 'nursery', '喂养', 'stroller', '推车'],
    l1Id: 'l1__parents_kids_and_toys__baby_supplies_and_products',
    labelZh: '婴儿用品',
  },
  {
    keys: ['baby care', '婴儿护理', 'diaper', '纸尿裤'],
    l1Id: 'l1__parents_kids_and_toys__diapering',
    labelZh: '尿布用品',
  },
  {
    keys: ['board game', '桌游', 'card game', 'anime', '卡牌'],
    l1Id: 'l1__parents_kids_and_toys__anime_and_game_and_cards',
    labelZh: '动漫游戏与卡牌',
  },
  {
    keys: ['action figure', '人偶', 'figurine', '盲盒', 'blind box', 'designer toy'],
    l1Id: 'l1__parents_kids_and_toys__designer_toys_and_blind_boxes',
    labelZh: '设计师玩具与盲盒',
  },
  {
    keys: ['classic toy', '经典玩具', 'wooden toy'],
    l1Id: 'l1__parents_kids_and_toys__classic_toys',
    labelZh: '经典玩具',
  },
  {
    keys: ['pet', '宠物', 'dog toy', 'cat toy'],
    l1Id: undefined,
    labelZh: '宠物用品',
  },
  {
    keys: ['toy', '玩具', 'games', 'kids toy'],
    l1Id: 'l1__parents_kids_and_toys__classic_toys',
    labelZh: '经典玩具',
  },
];

const aliasExtrasByL1 = new Map<string, string[]>();
for (const rule of TAXONOMY_ALIAS_RULES) {
  if (!rule.l1Id) continue;
  const prev = aliasExtrasByL1.get(rule.l1Id) || [];
  aliasExtrasByL1.set(rule.l1Id, [...prev, ...rule.keys]);
}

export const PRODUCT_TAXONOMY: TaxonomyNode[] = pack.nodes.map((n) => {
  const extras = n.level === 1 ? aliasExtrasByL1.get(n.id) || [] : [];
  return {
    id: n.id,
    level: n.level,
    nameEn: n.nameEn,
    nameZh: n.nameZh,
    parentId: n.parentId || undefined,
    rootId: n.rootId,
    url: n.url,
    aliases: [...new Set([...(n.aliases || []), n.nameEn, n.nameZh, ...extras].filter(Boolean))],
  };
});

export const PRODUCT_TAXONOMY_BY_ID: Record<string, TaxonomyNode> = Object.fromEntries(
  PRODUCT_TAXONOMY.map((n) => [n.id, n])
);

/** 旧玩具一级平台 ID → 新树一级 slug id */
export const LEGACY_L1_ID_MAP: Record<string, string> = pack.legacyL1IdMap || {};

export const TOY_ROOT_ID = pack.toyRootId || 'root__parents_kids_and_toys';

export const PRODUCT_TAXONOMY_ROOTS = PRODUCT_TAXONOMY.filter((n) => n.level === 0);
export const PRODUCT_TAXONOMY_L1 = PRODUCT_TAXONOMY.filter((n) => n.level === 1);
export const PRODUCT_TAXONOMY_L2 = PRODUCT_TAXONOMY.filter((n) => n.level === 2);

export const TAXONOMY_VERSION = pack.version;
export const TAXONOMY_STATS = pack.stats;

export const resolveLegacyCategoryId = (id?: string): string | undefined => {
  if (!id) return undefined;
  if (PRODUCT_TAXONOMY_BY_ID[id]) return id;
  return LEGACY_L1_ID_MAP[id] || id;
};

export const getTaxonomyChildren = (parentId: string): TaxonomyNode[] => {
  const pid = resolveLegacyCategoryId(parentId) || parentId;
  return PRODUCT_TAXONOMY.filter((n) => n.parentId === pid);
};

export const getTaxonomyL1ByRoot = (rootId?: string): TaxonomyNode[] => {
  if (!rootId) return PRODUCT_TAXONOMY_L1;
  return PRODUCT_TAXONOMY_L1.filter((n) => n.parentId === rootId);
};

export const formatTaxonomyLabel = (id?: string): string => {
  if (!id) return '';
  const rid = resolveLegacyCategoryId(id) || id;
  const n = PRODUCT_TAXONOMY_BY_ID[rid];
  if (!n) return id;
  if (n.level === 0) return `${n.nameZh}（${n.nameEn}）`;
  if (n.level === 1) {
    const root = n.parentId ? PRODUCT_TAXONOMY_BY_ID[n.parentId] : undefined;
    return root ? `${root.nameZh} / ${n.nameZh}` : n.nameZh;
  }
  const l1 = n.parentId ? PRODUCT_TAXONOMY_BY_ID[n.parentId] : undefined;
  const root = l1?.parentId ? PRODUCT_TAXONOMY_BY_ID[l1.parentId] : undefined;
  if (root && l1) return `${root.nameZh} / ${l1.nameZh} / ${n.nameZh}`;
  if (l1) return `${l1.nameZh} / ${n.nameZh}`;
  return n.nameZh;
};

/** 供模型约束：默认只塞母婴玩具大类，避免 prompt 爆长度；需要全站时再扩 */
export const taxonomyPromptList = (opts?: { rootId?: string; maxL1?: number; maxL2PerL1?: number }): string => {
  const rootId = opts?.rootId || TOY_ROOT_ID;
  const maxL1 = opts?.maxL1 ?? 22;
  const maxL2 = opts?.maxL2PerL1 ?? 6;
  const l1s = getTaxonomyL1ByRoot(rootId).slice(0, maxL1);
  return l1s
    .map((l1) => {
      const kids = getTaxonomyChildren(l1.id)
        .slice(0, maxL2)
        .map((c) => `${c.nameEn}[${c.id}]`)
        .join('; ');
      return `- L1[${l1.id}] ${l1.nameEn} / ${l1.nameZh}: ${kids}`;
    })
    .join('\n');
};

/** 兼容旧 Discovery：玩具相关一级（英文名 + 子级英文名列表） */
export const getToyAlibabaL1Compat = (): Array<{ id: string; nameEn: string; nameZh: string; children: string[] }> =>
  getTaxonomyL1ByRoot(TOY_ROOT_ID).map((l1) => ({
    id: l1.id,
    nameEn: l1.nameEn,
    nameZh: l1.nameZh,
    children: getTaxonomyChildren(l1.id).map((c) => c.nameEn),
  }));
