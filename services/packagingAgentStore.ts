/**
 * 包装设计 Agent · 项目 / 资产 / 玩具包装 Skills（独立存储）
 * Skills 内置：包装形态 × 卖场适配 × 色彩气质（行业最佳实践，非联网抓取私有库）
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

export type PackagingSkillDef = {
  id: PackagingSkillId;
  label: string;
  category: string;
  channel: string;
  palette: string;
  hint: string;
  defaultPrompt: string;
  negativePrompt: string;
  craftNotes: string;
  qaChecklist: string[];
  aspectHint: string;
};

export const PACKAGING_SKILLS: PackagingSkillDef[] = [
  {
    id: 'window_box',
    label: '开窗彩盒',
    category: '商超',
    channel: '商超货架 / 玩具专卖 / 会展样品',
    palette: '高饱和品牌色 + 白色开窗框，正面层次清晰',
    hint: 'PVC/PET 开窗见真品，货架 halfline 主推',
    defaultPrompt:
      'Photorealistic toy retail window box packaging mockup, crystal-clear PET window revealing the actual toy, CMYK print panels with clear brand lockup zone top, age-grade and compliance icon safe areas as empty placeholders only, accurate die-cut, supermarket shelf eye-level lighting, half-line facing',
    negativePrompt:
      'fraudulent readable certification text, watermark, warped die-lines, toy floating incorrectly outside box',
    craftNotes: '开窗见真品、留 Logo/年龄标区；勿生成可辨伪造认证全文。',
    qaChecklist: ['开窗见物清晰', '货架朝向正确', '有品牌与年龄标安全区', '无乱码认证字'],
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
      'Premium closed color box for toy gift, no window, elegant product illustration, soft-touch matte with restrained foil-stamp accents, boutique retail lighting, generous whitespace, luxury gift hierarchy, photorealistic pack shot',
    negativePrompt: 'cheap glossy clutter, rainbow sticker bomb, watermark, crowded typography soup',
    craftNotes: '闭窗精品：故事插画+质感，少即是多。',
    qaChecklist: ['无开窗', '质感高级', '插画聚焦', '留白足够'],
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
      'Toy blister card with euro-slot hang hole, clear clamshell over printed header card, high-contrast header graphics, peghook merchandising ready, value-retail clarity, photorealistic packaging',
    negativePrompt: 'missing hang hole, cloudy plastic, watermark, unreadable header',
    craftNotes: '挂卡必须有挂孔与泡壳逻辑；卡头信息区干净。',
    qaChecklist: ['挂孔可见', '泡壳透明合理', '卡头对比强', '适合挂钩墙'],
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
      'Open gift-set box with custom molded tray organizing toy accessories, festive burgundy/champagne palette without looking cheap, tissue-paper softness, department-store gift unboxing view, photorealistic',
    negativePrompt: 'messy foam crumbs, mismatched items, watermark, gaudy overprint',
    craftNotes: '开盖内托分格清楚，配件各归其位。',
    qaChecklist: ['内托分格清晰', '配件摆放整齐', '开盖构图完整', '不廉价'],
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
      'Polybag toy pack with sealed printed header card, neon promotional colors, large product name area, tidy low-cost dump-bin merchandising, clean studio photo',
    negativePrompt: 'wrinkled dirty bag, watermark, luxury foil mismatch',
    craftNotes: '低成本但整齐：卡头大字、袋装平整。',
    qaChecklist: ['卡头+袋结构正确', '促销感明确', '不脏乱'],
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
      'PDQ corrugated display tray filled with identical toy retail packs, warehouse-club endcap ready, bold brand color blocks, multiple facings visible, tear-away shipper logic implied, photorealistic merchandising',
    negativePrompt: 'single loose product only, watermark, collapsed tray',
    craftNotes: 'PDQ=可陈列托盘+多件装；强调端架堆头逻辑。',
    qaChecklist: ['多件陈列可见', '托盘结构清楚', '适合 Club/地堆'],
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
      'Collectible metal tin for toys, deep navy/black base, metallic print highlights, limited-edition shelf presence, emboss/deboss suggestion, photorealistic',
    negativePrompt: 'plastic looking tin, watermark, cheap sticker wrap only',
    craftNotes: '金属收藏感、限量气质。',
    qaChecklist: ['金属质感可信', '收藏柜气质', '图案克制'],
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
      'Eco kraft paper toy packaging, visible recycled board texture, botanical green accents, low ink coverage, EU natural retail shelf aesthetic, soft daylight, photorealistic',
    negativePrompt: 'plastic gloss overload, fake greenwashing badges with dense text, watermark',
    craftNotes: '欧盟自然渠道：牛皮纸、少油墨；勿伪造有机认证全文。',
    qaChecklist: ['牛皮纸纹理可见', '油墨克制', '欧系货架可信'],
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
      'Blind-box toy packaging, mysterious silhouette window, vibrant clash gradients, series number zone, kiosk impulse display, photorealistic collectible pack',
    negativePrompt: 'fully revealing the secret toy, watermark, dull corporate palette',
    craftNotes: '悬念开窗/剪影，系列编号区。',
    qaChecklist: ['悬念感足够', '系列编号区存在', '适合潮玩柜'],
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
      'Cylindrical tube packaging for puzzle/rolled toy, spiral stripe or gradient wrap, branded lid, standing retail hero, correct cylinder perspective, photorealistic',
    negativePrompt: 'squashed ellipse ignoring perspective, watermark',
    craftNotes: '圆柱透视正确，顶盖品牌色。',
    qaChecklist: ['圆柱透视正确', '顶盖清晰', '立放稳定'],
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
      'Premium layered unboxing gift box for toy DTC brand, open flaps revealing contrasting liner, Morandi outer palette, influencer unboxing composition, soft studio light, photorealistic',
    negativePrompt: 'flat single-lid only, watermark, messy kraft peanuts dominance',
    craftNotes: '多层开箱体验，外敛内亮，服务短视频。',
    qaChecklist: ['层级打开可见', '内外撞色惊喜', '适合开箱镜头'],
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
      'Kraft corrugated e-commerce shipper for toys, clean shipping marks, fragile icons as simple pictograms, subtle brand stamp, warehouse lighting, logistics packaging realism',
    negativePrompt: 'luxury gift wrap mismatch, watermark, unreadable dense fake addresses',
    craftNotes: '物流外箱：唛头简洁、易碎标示意，非零售彩盒。',
    qaChecklist: ['牛皮瓦楞质感', '唛头区清楚', '仓储光可信'],
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
      'Export master carton brand panel for toy factory, corporate blue-gray palette, clear logo safe zone, SKU and quantity info hierarchy as blank layout zones, B2B wholesale warehouse, photorealistic',
    negativePrompt: 'consumer gift wrap look, watermark, fake barcode spam',
    craftNotes: 'B2B 外箱品牌面：信息层级与 Logo 安全区，验货照气质。',
    qaChecklist: ['企业气质', 'Logo 安全区', '信息层级清楚'],
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
    negativePrompt: 'watermark, garbled text, broken packaging structure',
    craftNotes: '严格按用户描述的形态与卖场执行。',
    qaChecklist: ['符合描述', '结构可读', '无水印乱码'],
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
