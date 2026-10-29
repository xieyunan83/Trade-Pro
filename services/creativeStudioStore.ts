/**
 * 产品创作工作室 · 3D / 视频 / 独立站 / 发文素材（独立 localStorage，不碰 CRM）
 */

export type Model3dMode = 'image' | 'text';
export type Model3dQuality = 'high_detail' | 'engine_ready';
export type Model3dJobStatus = 'queued' | 'running' | 'ready' | 'failed';

export type Model3dJob = {
  id: string;
  title: string;
  mode: Model3dMode;
  quality: Model3dQuality;
  prompt: string;
  /** data URL 或外链（首张，兼容旧数据） */
  sourceImage?: string;
  /** 多角度参考图 */
  sourceImages?: string[];
  skuCode?: string;
  skuName?: string;
  status: Model3dJobStatus;
  progress?: number;
  previewHint?: string;
  /** 上游任务 ID */
  providerTaskId?: string;
  /** GLB / 网格下载地址 */
  modelUrl?: string;
  pbrModelUrl?: string;
  baseModelUrl?: string;
  /** 渲染预览图 */
  previewImageUrl?: string;
  exportFormats: string[];
  error?: string;
  ownerUsername?: string;
  createdAt: number;
  updatedAt: number;
};

export type VideoMode = 'text' | 'image' | 'reference';
export type VideoJobStatus = 'draft' | 'rendering' | 'ready' | 'failed';

export type VideoJob = {
  id: string;
  title: string;
  mode: VideoMode;
  prompt: string;
  storyboard?: string;
  durationSec: 4 | 5 | 8 | 10;
  aspect: '16:9' | '9:16' | '1:1';
  sourceImages: string[];
  skuCode?: string;
  skuName?: string;
  status: VideoJobStatus;
  progress?: number;
  /** 样片确认后才进入正片 */
  draftConfirmed?: boolean;
  previewHint?: string;
  providerTaskId?: string;
  /** 样片视频 URL */
  draftVideoUrl?: string;
  /** 正片视频 URL */
  videoUrl?: string;
  error?: string;
  ownerUsername?: string;
  createdAt: number;
  updatedAt: number;
};

export type SiteSection = {
  id: string;
  kind: 'hero' | 'products' | 'features' | 'cta' | 'contact';
  title: string;
  body: string;
};

export type SiteProject = {
  id: string;
  title: string;
  brief: string;
  locale: 'zh' | 'en' | 'es' | 'ar';
  /** 内置模板 id，见 siteBuilderTemplates */
  templateId?: string;
  /** 参考站 URL（提示词粘贴解析） */
  referenceUrl?: string;
  referenceNotes?: string;
  /** 技术选型 */
  frontendId?: string;
  backendId?: string;
  databaseId?: string;
  /** 部署目标 */
  deployId?: string;
  /** HTML 已写入本机站点库（IndexedDB） */
  htmlPersisted?: boolean;
  lastPublishedAt?: number;
  skuCodes: string[];
  sections: SiteSection[];
  messages: Array<{ id: string; role: 'user' | 'agent'; text: string; at: number }>;
  published: boolean;
  ownerUsername?: string;
  createdAt: number;
  updatedAt: number;
};

export type SocialPlatform =
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'whatsapp'
  | 'x';

export type SocialPiece = {
  id: string;
  platform: SocialPlatform;
  title: string;
  caption: string;
  hashtags: string[];
  cta: string;
  size: string;
  skuCode?: string;
  skuName?: string;
  imageHint?: string;
  /** 最终成稿形态参考图（版式/风格） */
  referenceImageDataUrl?: string;
  /** 产品实拍/主图 */
  productImageDataUrl?: string;
  ownerUsername?: string;
  createdAt: number;
  updatedAt: number;
};

const LS_3D = 'trade_scout_design_3d_jobs_v1';
const LS_VIDEO = 'trade_scout_ai_video_jobs_v1';
const LS_SITE = 'trade_scout_site_projects_v1';
const LS_SOCIAL = 'trade_scout_social_pieces_v1';

const readArr = <T,>(key: string): T[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

const writeArr = (key: string, rows: unknown[]) => {
  localStorage.setItem(key, JSON.stringify(rows));
};

export const newCreativeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const loadModel3dJobs = (): Model3dJob[] => readArr(LS_3D);
export const saveModel3dJobs = (rows: Model3dJob[]) => writeArr(LS_3D, rows);

export const loadVideoJobs = (): VideoJob[] => readArr(LS_VIDEO);
export const saveVideoJobs = (rows: VideoJob[]) => writeArr(LS_VIDEO, rows);

export const loadSiteProjects = (): SiteProject[] => readArr(LS_SITE);
export const saveSiteProjects = (rows: SiteProject[]) => writeArr(LS_SITE, rows);

export const loadSocialPieces = (): SocialPiece[] => readArr(LS_SOCIAL);
export const saveSocialPieces = (rows: SocialPiece[]) => writeArr(LS_SOCIAL, rows);

export const SOCIAL_PLATFORM_META: Array<{
  id: SocialPlatform;
  label: string;
  size: string;
  tip: string;
}> = [
  { id: 'linkedin', label: 'LinkedIn', size: '1200×627', tip: 'B2B 长文案 + 产品卖点' },
  { id: 'instagram', label: 'Instagram', size: '1080×1080', tip: '方形主图 + 短 caption' },
  { id: 'facebook', label: 'Facebook', size: '1200×630', tip: '链接预览风格' },
  { id: 'tiktok', label: '短视频封面', size: '1080×1920', tip: '竖版封面文案' },
  { id: 'whatsapp', label: 'WhatsApp', size: '800×800', tip: '一句话询盘话术' },
  { id: 'x', label: 'X / Twitter', size: '1200×675', tip: '短句 + 话题标签' },
];

/** 根据简报生成独立站区块（本地模板，后续可接大模型） */
export const draftSiteSectionsFromBrief = (
  brief: string,
  skuLabels: string[]
): SiteSection[] => {
  const b = brief.trim() || '专业外贸货源站';
  const productsLine =
    skuLabels.length > 0
      ? `精选货号：${skuLabels.slice(0, 8).join(' · ')}`
      : '可从产品库挂接 SKU，一键生成画册区';
  return [
    {
      id: newCreativeId('sec'),
      kind: 'hero',
      title: b.slice(0, 48),
      body: '可靠货源 · 快速打样 · 全球发运。留下邮箱获取报价与目录。',
    },
    {
      id: newCreativeId('sec'),
      kind: 'products',
      title: '热门产品',
      body: productsLine,
    },
    {
      id: newCreativeId('sec'),
      kind: 'features',
      title: '为什么选择我们',
      body: '工厂直达 · MOQ 灵活 · 证书齐全 · 专属跟单。',
    },
    {
      id: newCreativeId('sec'),
      kind: 'cta',
      title: '获取报价',
      body: '告诉我们目标市场与数量，24 小时内回复。',
    },
    {
      id: newCreativeId('sec'),
      kind: 'contact',
      title: '联系我们',
      body: 'Email / WhatsApp 表单将回灌 CRM（发布后启用）。',
    },
  ];
};

/** 发文文案模板（本地；后续可接整理模型） */
export const draftSocialCopy = (opts: {
  platform: SocialPlatform;
  productName: string;
  highlight: string;
  locale: 'zh' | 'en';
}): { caption: string; hashtags: string[]; cta: string } => {
  const name = opts.productName || '我们的新品';
  const hi = opts.highlight || '高性价比 · 可定制';
  if (opts.locale === 'en') {
    const caption = `Discover ${name}. ${hi}. Ideal for importers & retailers looking for reliable OEM/ODM.`;
    return {
      caption,
      hashtags: ['#B2B', '#Wholesale', '#OEM', '#NewArrival'],
      cta: 'DM for catalog & quote',
    };
  }
  const byPlatform: Record<SocialPlatform, string> = {
    linkedin: `【新品推荐】${name}\n${hi}\n适合进口商 / 连锁零售 / 品牌商。欢迎索取目录与出厂价。`,
    instagram: `${name} ✨\n${hi}\n评论区留「目录」获取选品单`,
    facebook: `厂货直供 · ${name}\n${hi}\n支持打样与混装柜。`,
    tiktok: `3 秒看懂 ${name}｜${hi}`,
    whatsapp: `Hi, sharing our ${name}. ${hi}. May I send MOQ & price list?`,
    x: `${name}｜${hi}｜询盘开目录`,
  };
  return {
    caption: byPlatform[opts.platform],
    hashtags: ['#外贸', '#OEM', '#新品', '#选品'],
    cta: opts.platform === 'whatsapp' ? '回复 YES 发送报价' : '私信获取报价单',
  };
};
