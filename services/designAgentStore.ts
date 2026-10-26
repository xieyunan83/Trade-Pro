/**
 * 产品设计 Agent · 项目 / 资产 / 对话（独立存储，不碰 CRM / 背调）
 * 理念对齐 Lovart：Agent + Skills + Canvas 资产，而非单次文生图。
 * @see https://www.lovart.ai/
 */
export type DesignSkillId =
  | 'product_hero'
  | 'listing_set'
  | 'detail_long'
  | 'social_square'
  | 'booth_cover'
  | 'multi_angle'
  | 'free';

export type DesignAsset = {
  id: string;
  projectId: string;
  url: string;
  prompt: string;
  skillId: DesignSkillId;
  /** 多角度套图标签：正面 / 45° / 侧面 / 背面 */
  angle?: string;
  createdAt: number;
};

export type DesignChatMsg = {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  at: number;
  assetIds?: string[];
};

export type DesignProject = {
  id: string;
  title: string;
  skillId: DesignSkillId;
  /** 可选挂接产品库 SKU */
  skuCode?: string;
  skuName?: string;
  messages: DesignChatMsg[];
  assetIds: string[];
  ownerUsername?: string;
  departmentId?: string;
  createdAt: number;
  updatedAt: number;
};

const LS_PROJECTS = 'trade_scout_design_projects_v1';
const LS_ASSETS = 'trade_scout_design_assets_v1';

export const DESIGN_SKILLS: Array<{
  id: DesignSkillId;
  label: string;
  category: string;
  hint: string;
  defaultPrompt: string;
  aspectHint: string;
}> = [
  {
    id: 'product_hero',
    label: '产品主图',
    category: '电商',
    hint: '白底/场景主视觉，适合独立站与询盘',
    defaultPrompt:
      'Professional product hero shot, clean white seamless background, soft studio lighting, sharp focus, commercial photography, no watermark, no text',
    aspectHint: '1:1 / 4:5',
  },
  {
    id: 'listing_set',
    label: 'Listing 套图',
    category: '电商',
    hint: '卖点分镜风格，多张同规格',
    defaultPrompt:
      'E-commerce listing style product image, clear features, lifestyle context for toys/gift, bright colors, marketplace ready, no watermark',
    aspectHint: '1:1',
  },
  {
    id: 'detail_long',
    label: '详情长图风格',
    category: '营销',
    hint: '竖版详情视觉（单帧示意）',
    defaultPrompt:
      'Vertical e-commerce detail banner style product visual, informative composition, premium packaging feel, Chinese export toy product photography',
    aspectHint: '9:16',
  },
  {
    id: 'social_square',
    label: '社媒方图',
    category: '社媒',
    hint: 'Instagram / 小红书风格',
    defaultPrompt:
      'Social media square post design mood for product launch, trendy layout feel, soft gradient backdrop, product centered, high engagement aesthetic',
    aspectHint: '1:1',
  },
  {
    id: 'booth_cover',
    label: '展会画册封面',
    category: '品牌',
    hint: '澄海展厅 / 画册封面气质',
    defaultPrompt:
      'Trade fair catalog cover style, premium product showcase, exhibition lighting, bilingual feel, professional B2B brochure cover composition',
    aspectHint: '3:4',
  },
  {
    id: 'multi_angle',
    label: '多角度套图',
    category: '三维预备',
    hint: '同一产品正面/45°/侧面/背面，供 3D 与视频复用',
    defaultPrompt:
      'Consistent product identity across angles, identical colors materials scale, clean white seamless background, studio softbox, commercial photography, no watermark, no text',
    aspectHint: '1:1 · 4 视角',
  },
  {
    id: 'free',
    label: '自由设计',
    category: '通用',
    hint: '完全由你描述，Agent 执行',
    defaultPrompt: '',
    aspectHint: '自定义',
  },
];

export const loadDesignProjects = (): DesignProject[] => {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export const saveDesignProjects = (rows: DesignProject[]) => {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(rows));
};

export const loadDesignAssets = (): DesignAsset[] => {
  try {
    const raw = localStorage.getItem(LS_ASSETS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export const saveDesignAssets = (rows: DesignAsset[]) => {
  localStorage.setItem(LS_ASSETS, JSON.stringify(rows));
};

export const newDesignId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
