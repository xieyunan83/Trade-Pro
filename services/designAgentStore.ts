/**
 * 产品设计 Agent · 项目 / 资产 / 对话（独立存储，不碰 CRM / 背调）
 * Agent + Skills + Canvas 资产，确认后生图。
 */

/** 清洗历史对话中可能残留的外部产品参考字样 */
export const scrubLeakText = (text: string): string => {
  if (!text) return text;
  return text
    .replace(/（理念参考\s*Lovart[^）]*）/gi, '')
    .replace(/\(理念参考\s*Lovart[^)]*\)/gi, '')
    .replace(/理念参考\s*Lovart[：:][^。\n]*/gi, '')
    .replace(/对齐\s*Lovart[^。\n]*/gi, '')
    .replace(/\bLovart\s*式?/gi, '')
    .replace(/\bLovart\b/gi, '')
    .replace(/https?:\/\/(www\.)?lovart\.ai\/?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([。．.])/g, '$1')
    .trim();
};
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

/** Skill 规格：内置跨境电商/展会摄影与构图最佳实践（非联网抓取第三方私有库） */
export type DesignSkillDef = {
  id: DesignSkillId;
  label: string;
  category: string;
  hint: string;
  /** 生图主提示（英文，可执行） */
  defaultPrompt: string;
  /** 负向约束，拼进 toolPrompt */
  negativePrompt: string;
  /** 给编排大脑的工艺说明（中英均可） */
  craftNotes: string;
  qaChecklist: string[];
  aspectHint: string;
};

export const DESIGN_SKILLS: DesignSkillDef[] = [
  {
    id: 'product_hero',
    label: '产品主图',
    category: '电商',
    hint: '白底/场景主视觉，适合独立站与询盘',
    defaultPrompt:
      'Amazon/Shopify style hero product photograph, single toy centered, pure #FFFFFF seamless cyclorama, soft dual softbox + gentle rim light, true-to-life color, crisp edges, commercial catalog sharpness, slight contact shadow, square crop safe margins, no props competing with product',
    negativePrompt:
      'watermark, logo spam, garbled text, busy background, harsh specular blowout, distorted proportions, extra limbs, low-res, stock collage',
    craftNotes:
      '遵循跨境主图规范：主体占画幅约 85%、纯白底、真实材质、禁止伪造认证标。光影以电商柔箱为主，避免影棚彩色凝胶。',
    qaChecklist: [
      '白底干净、无明显灰底或渐变脏边',
      '产品完整、无裁切关键部件',
      '颜色/材质与描述或参考图一致',
      '无水印、无乱码字、无假认证标',
    ],
    aspectHint: '1:1 / 4:5',
  },
  {
    id: 'listing_set',
    label: 'Listing 套图',
    category: '电商',
    hint: '卖点分镜风格，多张同规格',
    defaultPrompt:
      'Marketplace listing feature-frame style: one clear selling point per frame, toy product hero with optional lifestyle inset, bold but clean composition, high-key lighting, color-accurate plastics, ready for A+ / main+bullet image set, consistent brand framing across series',
    negativePrompt:
      'crowded infographic clutter, unreadable micro-text, fake UI badges, watermark, mismatched product identity between frames',
    craftNotes:
      '对标 Listing 卖点图：一图一事（尺寸/玩法/安全/场景）。文案区仅留白示意，不生成细小乱字。全套保持同一产品身份与色温。',
    qaChecklist: [
      '卖点主题单一清晰',
      '与主图产品为同一 SKU 身份',
      '适合后续叠加中英卖点条',
      '无假冒平台徽章',
    ],
    aspectHint: '1:1',
  },
  {
    id: 'detail_long',
    label: '详情长图风格',
    category: '营销',
    hint: '竖版详情视觉（单帧示意）',
    defaultPrompt:
      'Vertical detail-page hero banner for mobile PDP, top-to-bottom storytelling composition, premium toy packaging and product beauty, soft gradient or studio wash, generous safe margins for future Chinese/English copy blocks, export-trade catalog quality',
    negativePrompt:
      'tiny illegible paragraphs, watermark, stretched product, cluttered icons wall',
    craftNotes:
      '移动端详情首屏：上半英雄产品、中部卖点呼吸区、下部包装/场景。为文案留白，不填满假字。',
    qaChecklist: ['竖构图可读', '留白足够叠字', '包装与产品同系列', '无乱码正文'],
    aspectHint: '9:16',
  },
  {
    id: 'social_square',
    label: '社媒方图',
    category: '社媒',
    hint: 'Instagram / 小红书风格',
    defaultPrompt:
      'High-engagement social square product post, trendy soft gradient or pastel set design, centered toy with lifestyle mood, shallow depth of field, influencer-commerce aesthetic, bright skin-friendly color grade, scroll-stopping simplicity',
    negativePrompt:
      'dated clipart borders, heavy Instagram UI chrome, watermark, oversharpen halos',
    craftNotes:
      '社媒方图：情绪与趋势色优先，但仍保持产品可识别。避免生成平台原生 UI 框。',
    qaChecklist: ['一眼能认产品', '氛围时尚不廉价', '适合裁成封面', '无平台界面仿冒'],
    aspectHint: '1:1',
  },
  {
    id: 'booth_cover',
    label: '展会画册封面',
    category: '品牌',
    hint: '澄海展厅 / 画册封面气质',
    defaultPrompt:
      'B2B trade-fair catalog cover composition, premium exhibition lighting on hero toy, spacious negative space for bilingual title lockup, Chenghai toy-export showroom professionalism, brochure cover hierarchy, cinematic but clean',
    negativePrompt:
      'carnival chaos, low-end flea market vibe, watermark, fake awards seals',
    craftNotes:
      '展会画册封面：B2B 信任感、留标题区、产品英雄角。避免消费级嘈杂贴纸风。',
    qaChecklist: ['封面层级清晰', '有标题安全区', '灯光专业', '气质偏外贸展会而非地摊'],
    aspectHint: '3:4',
  },
  {
    id: 'multi_angle',
    label: '多角度套图',
    category: '三维预备',
    hint: '同一产品正面/45°/侧面/背面，供 3D 与视频复用',
    defaultPrompt:
      'Orthographic-consistent multi-angle product set on identical pure white seamless, same camera height and scale: front, three-quarter, side, back. Identical materials colors and tooling details across views, softbox lighting locked, turntable-reference quality for 3D/video pipelines',
    negativePrompt:
      'changing colors between angles, different SKUs, textured floors, props, watermark, text labels baked in',
    craftNotes:
      '四视图身份锁死：比例、颜色、开模线一致。供图生 3D / 视频多参考。每张单独白底。',
    qaChecklist: [
      '四视角为同一产品',
      '缩放与地平线一致',
      '白底统一',
      '可直接丢进 3D/视频多参考',
    ],
    aspectHint: '1:1 · 4 视角',
  },
  {
    id: 'free',
    label: '自由设计',
    category: '通用',
    hint: '完全由你描述，Agent 执行',
    defaultPrompt: '',
    negativePrompt: 'watermark, garbled text, extra limbs, low quality',
    craftNotes: '严格按用户描述执行，保留产品身份，商业可用画质。',
    qaChecklist: ['符合用户描述', '产品可识别', '无水印乱码'],
    aspectHint: '自定义',
  },
];

export const loadDesignProjects = (): DesignProject[] => {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    let dirty = false;
    const next = p.map((proj: DesignProject) => {
      const messages = (proj.messages || []).map((m) => {
        const text = scrubLeakText(m.text || '');
        if (text !== m.text) dirty = true;
        return { ...m, text };
      });
      return { ...proj, messages };
    });
    if (dirty) {
      try {
        localStorage.setItem(LS_PROJECTS, JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
    }
    return next;
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
