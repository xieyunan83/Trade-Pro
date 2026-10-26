/**
 * 包装设计 Agent · 项目 / 资产 / 玩具包装 Skills（独立存储）
 * Skills 内置：包装形态 × 卖场适配 × 色彩气质，确认后出图到画布。
 */

export type PackagingSkillId =
  | 'window_box'
  | 'closed_color_box'
  | 'blister_hang'
  | 'gift_set_tray'
  | 'polybag_header'
  | 'pdq_display'
  | 'tin_metal'
  | 'kraft_eco'
  | 'surprise_blind'
  | 'cylinder_tube'
  | 'premium_unbox'
  | 'amazon_shipper'
  | 'export_master'
  | 'free';

export type PackagingAsset = {
  id: string;
  projectId: string;
  url: string;
  prompt: string;
  skillId: PackagingSkillId;
  createdAt: number;
};

export type PackagingChatMsg = {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  at: number;
  assetIds?: string[];
};

export type PackagingProject = {
  id: string;
  title: string;
  skillId: PackagingSkillId;
  skuCode?: string;
  skuName?: string;
  messages: PackagingChatMsg[];
  assetIds: string[];
  ownerUsername?: string;
  departmentId?: string;
  createdAt: number;
  updatedAt: number;
};

const LS_PROJECTS = 'trade_scout_packaging_projects_v1';
const LS_ASSETS = 'trade_scout_packaging_assets_v1';

/**
 * 澄海玩具外贸常见包装形态 → 卖场 → 色彩气质（内置 Skill）
 */
export const PACKAGING_SKILLS: Array<{
  id: PackagingSkillId;
  label: string;
  category: string;
  channel: string;
  palette: string;
  hint: string;
  defaultPrompt: string;
  aspectHint: string;
}> = [
  {
    id: 'window_box',
    label: '开窗彩盒',
    category: '商超',
    channel: '商超货架 / 玩具专卖 / 会展样品',
    palette: '高饱和品牌色 + 白色开窗框，正面层次清晰',
    hint: 'PVC/PET 开窗见真品，货架 halfline 主推',
    defaultPrompt:
      'Toy product retail window box packaging mockup, clear PET window showing the toy inside, vibrant CMYK print panels, brand logo area top, age grade and CE icons tasteful, supermarket shelf lighting, photorealistic packaging design, no watermark',
    aspectHint: '3:4 立盒',
  },
  {
    id: 'closed_color_box',
    label: '闭窗彩盒',
    category: '精品',
    channel: '精品店 / 礼品柜 / 品牌专柜',
    palette: '克制双色或三色，烫金/哑光质感，留白高级',
    hint: '不露产品，靠插画与质感卖故事',
    defaultPrompt:
      'Premium closed color box for toy gift, no window, elegant illustration of product, foil-stamp feel accents, soft matte finish, boutique retail lighting, sophisticated composition, photorealistic packaging mockup, no watermark',
    aspectHint: '3:4',
  },
  {
    id: 'blister_hang',
    label: '吸塑挂卡',
    category: '折扣',
    channel: '折扣店挂钩 / 五金玩具墙 / 便利店',
    palette: '黄红蓝高对比，大字卖点，挂孔明确',
    hint: '卡头 + 透明泡壳，peghook 陈列',
    defaultPrompt:
      'Toy blister card packaging with hang hole, clear plastic clamshell over cardboard header card, bold high-contrast graphics, peghook retail display ready, dollar-store friendly, photorealistic, no watermark',
    aspectHint: '2:3 竖卡',
  },
  {
    id: 'gift_set_tray',
    label: '礼盒内托套装',
    category: '礼品',
    channel: '节日礼品 / 百货套装柜 / 团购',
    palette: '酒红或香槟金 + 奶白内托，节日但不廉价',
    hint: '开盖见内托分格，适合多件套',
    defaultPrompt:
      'Open gift set box with molded tray holding toy accessories, festive but premium burgundy and champagne palette, soft tissue feel, department store gift packaging, photorealistic unboxing view, no watermark',
    aspectHint: '4:3 开盖',
  },
  {
    id: 'polybag_header',
    label: '袋装卡头',
    category: '促销',
    channel: '一元店 / 促销堆头 / 展会散货',
    palette: '荧光黄橙 + 大号品名，成本感但整齐',
    hint: 'OPP/PE 袋 + 纸卡头，低成本快销',
    defaultPrompt:
      'Polybag toy packaging with printed header card sealed on top, bright neon promotional colors, large product name, low-cost retail dump bin style, clean studio photo, no watermark',
    aspectHint: '2:3',
  },
  {
    id: 'pdq_display',
    label: 'PDQ 陈列盒',
    category: '仓储',
    channel: '仓储会员店端架 / Club 堆头 / 商超地堆',
    palette: '大色块品牌色 + 清晰 SKU 面与层数',
    hint: '可撕开即陈列的托盘盒，多件装',
    defaultPrompt:
      'PDQ display tray of toy retail packs, ready for warehouse club endcap, bold brand color blocks, multiple units visible, corrugated tray base, photorealistic retail merchandising shot, no watermark',
    aspectHint: '16:9 陈列',
  },
  {
    id: 'tin_metal',
    label: '铁盒收藏装',
    category: '潮玩',
    channel: '潮玩店 / 限定发售 / 收藏柜',
    palette: '深底金属质感 + 少量荧光点缀',
    hint: '马口铁或铝感，适合限量与复古',
    defaultPrompt:
      'Collectible metal tin packaging for toys, deep navy or black base with metallic print highlights, limited edition feel, premium collectible shelf, photorealistic, no watermark',
    aspectHint: '1:1',
  },
  {
    id: 'kraft_eco',
    label: '牛皮纸环保装',
    category: '欧系',
    channel: '欧系自然渠道 / 有机卖场 / 绿色认证货架',
    palette: '牛皮纸大地色 + 植物绿点缀，油墨克制',
    hint: '可回收材质气质，适合出口欧盟环保卖点',
    defaultPrompt:
      'Eco kraft paper toy packaging, recycled cardboard texture, botanical green accents, minimal ink coverage, EU eco-retail shelf aesthetic, soft daylight, photorealistic, no watermark',
    aspectHint: '3:4',
  },
  {
    id: 'surprise_blind',
    label: '盲盒 / 扭蛋风',
    category: '冲动',
    channel: '自动贩卖 / 潮玩柜 / 冲动购位',
    palette: '撞色渐变 + 神秘开窗或角色剪影',
    hint: '悬念感强，适合盲抽与胶囊系列',
    defaultPrompt:
      'Blind box style toy packaging, mysterious silhouette window, vibrant clash gradient colors, collectible series numbering, kiosk impulse display, photorealistic, no watermark',
    aspectHint: '3:4',
  },
  {
    id: 'cylinder_tube',
    label: '圆筒装',
    category: '卷类',
    channel: '拼图海报 / 卷装玩具 / 礼品筒',
    palette: '环绕条纹或渐变立面，顶盖品牌色',
    hint: '圆柱罐/纸筒，适合卷状与长件',
    defaultPrompt:
      'Cylindrical tube packaging for puzzle or rolled toy, spiral stripe or gradient wrap, branded lid top, standing on retail surface, photorealistic packaging mockup, no watermark',
    aspectHint: '9:16 立筒',
  },
  {
    id: 'premium_unbox',
    label: '开箱体验礼盒',
    category: 'DTC',
    channel: '独立站 DTC / 会员礼 / 品牌开箱视频',
    palette: '莫兰迪或高级灰 + 内衬撞色惊喜',
    hint: '层层打开的体验感，适合短视频开箱',
    defaultPrompt:
      'Premium unboxing experience gift box for toy brand, layered open flaps, contrasting liner color, Morandi outer palette, influencer unboxing aesthetic, soft studio light, photorealistic, no watermark',
    aspectHint: '4:5 开箱',
  },
  {
    id: 'amazon_shipper',
    label: '电商外箱示意',
    category: '跨境',
    channel: '跨境电商仓配 / FBA 发货示意',
    palette: '牛皮外箱 + 简洁唛头黑字，警示标规范',
    hint: '外箱唛头与易碎标，偏物流观感',
    defaultPrompt:
      'E-commerce shipper carton for toys, kraft corrugated box with clean shipping marks, fragile icons, simple brand stamp, warehouse lighting, photorealistic logistics packaging, no watermark',
    aspectHint: '4:3',
  },
  {
    id: 'export_master',
    label: '外销外箱品牌面',
    category: 'B2B',
    channel: '外销批发 / 展厅出样 / 柜装箱唛',
    palette: '企业蓝灰 + LOGO 安全区，信息层级清楚',
    hint: '主唛/侧唛气质，适合买家验货照',
    defaultPrompt:
      'Export master carton brand panel for toy factory, corporate blue-gray palette, clear logo safe zone, SKU and quantity info hierarchy, B2B wholesale warehouse, photorealistic, no watermark',
    aspectHint: '16:9',
  },
  {
    id: 'free',
    label: '自由包装',
    category: '通用',
    hint: '完全由你描述形态、卖场与配色',
    channel: '自定义渠道',
    palette: '按你的描述搭配',
    defaultPrompt: '',
    aspectHint: '自定义',
  },
];

export const loadPackagingProjects = (): PackagingProject[] => {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export const savePackagingProjects = (rows: PackagingProject[]) => {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(rows));
};

export const loadPackagingAssets = (): PackagingAsset[] => {
  try {
    const raw = localStorage.getItem(LS_ASSETS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

export const savePackagingAssets = (rows: PackagingAsset[]) => {
  localStorage.setItem(LS_ASSETS, JSON.stringify(rows));
};

export const newPackagingId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
