/**
 * 平台升级路线图元数据：供 Coming Soon 页与后台「数据接入」展示。
 * 具体业务实现按阶段迭代，本文件只描述规划，不触发真实调用。
 */
import { ModuleType } from '../types';

export type RoadmapPhase = 'P0' | 'P1' | 'P2';

export type ModuleRoadmap = {
  phase: RoadmapPhase;
  summary: string;
  bullets: string[];
  /** 对标竞品能力（便于内部对齐） */
  inspiredBy?: string[];
  /** 依赖的数据提供商 id（见 dataProviders） */
  providers?: string[];
};

/** 指挥舱任务流与适市闭环（跨模块，非独立 ModuleType） */
export const JOURNEY_ROADMAP_NOTE = {
  phase: 'P0' as const,
  summary:
    '澄海玩具出口任务流：选品适市 → 设计 → 市调专家/产品经理 → 客户匹配 → 开发信组 → CRM；指挥舱一站推进。',
  bullets: [
    '双专家：全球市调定国家趋势，产品经理定定位与设计要点',
    '设计完成后匹配 CRM / 背调客户库，并输出专业匹配理由',
    '一键生成可复制的 3 封开发信组（单客 + 批量模板）',
    '与产品库、创作流水线、CRM 联动「下一步」',
    '接通商机证据后：生产/销售建议带货架价带与进口行为硬支撑',
  ],
};

export const MODULE_ROADMAP: Partial<Record<ModuleType, ModuleRoadmap>> = {
  [ModuleType.BUYER_LIBRARY]: {
    phase: 'P0',
    summary:
      '后台数据库（前台隐藏）：客户搜索按产品关键词命中时优先调用；不足再联网补搜。',
    bullets: [
      '前台无独立导航；管理入口在「系统管理 → 数据接入」',
      '入库：黄页/政府名录/历史背调/海关沉淀',
      '客户搜索：与关键词相关才展示；库内公司不重复联网',
      '与 CRM、决策人邮箱缓存打通（后续）',
    ],
    inspiredBy: ['苏维智搜 · 客户资源库', '网易 · 企业库'],
    providers: ['yellow_pages', 'tavily', 'anysearch'],
  },
  [ModuleType.CUSTOMS_INTEL]: {
    phase: 'P0',
    summary:
      '后台海关/提单缓存（前台隐藏）：客户搜索命中相关贸易记录时直接调用。',
    bullets: [
      '前台无独立导航；管理入口在「系统管理 → 数据接入」',
      '按 HS / 品名 / 公司名与搜索关键词关联',
      '命中公司优先用缓存字段，跳过互联网重复取证',
      '明细外呼计入企业配额（接通数据商后）',
    ],
    inspiredBy: ['网易外贸通 · 海关', '腾道 / ImportGenius'],
    providers: ['customs'],
  },
  [ModuleType.MARKET_EVIDENCE]: {
    phase: 'P1',
    summary:
      '商机证据层（后台）：线上货架品类机会 × 线下进口行为，对齐后驱动生产与销售建议。',
    bullets: [
      '前台无独立导航；管理入口在「系统管理 → 数据接入」',
      '线上：平台类目价带 / 需求热度 / 评论痛点（可接选品类 API）',
      '线下：海关进口频次 / HS / 来源国，与公司域名对齐',
      '证据分级 A/B/C；仅硬证据进入匹配理由与适市建议',
      '输出「机会卡 + 买家行为 + 我方 SKU」三件套',
    ],
    inspiredBy: ['卖家精灵 / Keepa（站内切片）', '腾道 / ImportGenius（贸易行为）'],
    providers: ['marketplace_intel', 'customs'],
  },
  [ModuleType.PRODUCT_CATALOG]: {
    phase: 'P0',
    summary: '产品库 SKU 主数据中台；小竹熊 / 霄鸟云由管理后台对接同步。',
    bullets: [
      '统一字段：图、规格、MOQ、出厂价、包装、证书、厂家',
      '前台：手工录入 / 导入 JSON；同步入口仅在管理后台',
      '供报价单、新品匹配、创作 Agent、货源站共用',
      '支持二次设计结果回写为新 SKU',
    ],
    inspiredBy: ['小竹熊', '霄鸟云', '孚盟 · 产品档案'],
    providers: ['toysbear', 'skybird'],
  },
  [ModuleType.PRODUCT_QUOTE]: {
    phase: 'P0',
    summary: '从产品库一键生成报价单 / 选品单 / PI 草稿。',
    bullets: [
      '多币种、加点比例、客户可见价',
      '导出 PDF / Excel / 在线链接',
      '关联 CRM 客户与跟进记录',
      '后续：样品单与简单订单状态',
    ],
    inspiredBy: ['小竹熊 · 报价', '霄鸟云 · 一键报价', '孚盟 · 报价'],
    providers: ['toysbear', 'skybird'],
  },
  [ModuleType.PRODUCT_DESIGN_2D]: {
    phase: 'P0',
    summary:
      '设计 Agent：Skills + 结构化 Brief + 确认卡；大脑/画笔可插拔，不绑死单一模型。',
    bullets: [
      'Skill 定义专业度（主图 / Listing / 详情 / 社媒 / 展会 / 多角度）',
      '编排层输出确认 Brief + 质检清单，再调用生图工具',
      '对话模型可换成开源/自研；生图工具可换供应商',
      '画布资产沉淀，可交接 3D / 视频',
    ],
    providers: ['design_agent', 'wan'],
  },
  [ModuleType.PRODUCT_PACKAGING]: {
    phase: 'P0',
    summary:
      '包装设计 Agent：玩具包装形态 × 卖场适配 × 色彩气质；确认后出包装视觉。',
    bullets: [
      '开窗/闭窗/吸塑/礼盒/PDQ/铁盒/环保/盲盒等 Skills',
      '内置卖场与配色方向',
      '可挂产品库与平面主图',
      '创作流水线第 4 步',
    ],
    providers: ['design_agent', 'wan'],
  },
  [ModuleType.PRODUCT_DESIGN_3D]: {
    phase: 'P0',
    summary: '图/文生 3D 工作室：高细节与引擎就绪两档，导出 GLB/OBJ/STL；后台配置供应商 API。',
    bullets: ['图生 / 文生', '品质分档', '项目库与产品库挂接', 'API 接通后下载真实网格'],
    providers: ['tripo', 'hunyuan3d'],
  },
  [ModuleType.PRODUCT_3D_PRINT]: {
    phase: 'P2',
    summary: '3D 模型转打印交付（STL / 工艺说明）。',
    bullets: ['从 3D 资产导出打印文件', '对接本地打印服务商（生态）'],
    inspiredBy: ['产业带打印服务'],
    providers: ['tripo'],
  },
  [ModuleType.PRODUCT_AI_VIDEO]: {
    phase: 'P0',
    summary: '文/图/多参考生视频；分镜与画幅；样片确认后再渲正片。',
    bullets: ['三种生成模式', '样片 → 正片控成本', '挂产品库 SKU', '后台配置视频 API'],
    providers: ['wan_video', 'qwen'],
  },
  [ModuleType.SITE_BUILDER]: {
    phase: 'P0',
    summary: '网站设计开发：对话描述即构建；内置模板；实时预览与导出 HTML。',
    bullets: ['对话描述即构建', '内置外贸/品牌模板', '桌面/手机预览', '挂产品库 · 导出 HTML'],
    providers: ['qwen'],
  },
  [ModuleType.SOCIAL_CONTENT]: {
    phase: 'P0',
    summary: '按渠道尺寸生成文案 / 话题 / CTA，素材库沉淀，可挂产品库。',
    bullets: ['LinkedIn / IG / FB / 短视频封面 / WhatsApp / X', '中英切换', '一键复制', '与平面设计配图联动'],
    providers: ['wan', 'qwen'],
  },
  [ModuleType.EMAIL_SEQUENCE]: {
    phase: 'P1',
    summary: '已并入「开发策略」生成开发信，本入口已下线。',
    bullets: ['请使用开发策略 · 生成开发信'],
  },
  [ModuleType.WHATSAPP]: {
    phase: 'P0',
    summary: '联系工具：登录本人 WhatsApp / Skype / 微信等官方网页端。',
    bullets: ['官方窗口真实登录', 'CRM 电话一键发起会话', '不代持账号密码'],
  },
  [ModuleType.ECO_PARTS]: {
    phase: 'P2',
    summary: '产业带配件供应商撮合（生态）。',
    bullets: ['配件目录', '询价协同'],
  },
  [ModuleType.ECO_MERCH]: {
    phase: 'P2',
    summary: '产品周边 / 礼品配套。',
    bullets: ['周边 SKU', '与主产品打包报价'],
  },
  [ModuleType.ECO_CERT]: {
    phase: 'P2',
    summary: '认证机构与证书档案。',
    bullets: ['CE / ASTM 等指引', '证书附件挂 SKU'],
  },
  [ModuleType.ECO_AUDIT]: {
    phase: 'P2',
    summary: '验厂机构对接。',
    bullets: ['预约与报告存档'],
  },
  [ModuleType.ECO_DELIVERY]: {
    phase: 'P2',
    summary: '交付出货协同（轻量，非全量 ERP）。',
    bullets: ['出货状态', '与订单草稿联动'],
    inspiredBy: ['孚盟 · 出运'],
  },
};

/** CRM 增强（挂在已有模块上，非独立导航） */
export const CRM_ENHANCEMENT_ROADMAP: ModuleRoadmap = {
  phase: 'P0',
  summary: '公海 / 私海、智能查重、跟进任务与逾期提醒（对标小满最小集）。',
  bullets: [
    '公海领取与回收规则',
    '公司名 / 域名 / 邮箱查重',
    '跟进任务与主管监控',
    '与背调、邮件时间线打通',
  ],
  inspiredBy: ['小满 OKKI · CRM'],
};

/** 商机证据增强（挂数据接入；非独立前台导航） */
export const MARKET_EVIDENCE_ROADMAP: ModuleRoadmap = {
  phase: 'P1',
  summary:
    '把「线上货架机会」与「线下进口/批发零售行为」对齐，让生产与销售建议有可核对的数据支撑。',
  bullets: [
    '对齐键：公司名 / 域名 / 品牌 / HS / 平台商品 ID',
    '线上机会卡 + 进口行为卡 → 商机证据包',
    '证据分级：结构化源优先于公开页，公开页优先于推断',
    '接通后回写适市建议、产品匹配理由与开发信卖点',
  ],
  inspiredBy: ['卖家精灵（站内）', '海关数据商（贸易）'],
  providers: ['marketplace_intel', 'customs'],
};

export const PHASE_LABEL: Record<RoadmapPhase, string> = {
  P0: '优先落地（约 90 天）',
  P1: '增强能力',
  P2: '生态扩展',
};
