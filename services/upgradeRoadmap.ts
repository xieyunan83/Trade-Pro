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
  [ModuleType.PRODUCT_CATALOG]: {
    phase: 'P0',
    summary: '我方 SKU 主数据中台；可同步澄海小竹熊 / 霄鸟云货源。',
    bullets: [
      '统一字段：图、规格、MOQ、出厂价、包装、证书、厂家',
      '数据源：手工录入 + 小竹熊 / 霄鸟云授权同步',
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
      'Lovart 式设计 Agent：Skills 工作流 + 项目画布资产 + 确认卡生图；可挂产品库 SKU。',
    bullets: [
      'Agent 对话下指令',
      'Skills：主图 / Listing / 详情 / 社媒 / 展会封面',
      '画布资产沉淀与下载',
      '后台「设计 Agent」独立 API，未配则回退万相',
    ],
    inspiredBy: ['Lovart · AI Design Agent', 'TapNow'],
    providers: ['design_agent', 'wan'],
  },
  [ModuleType.PRODUCT_DESIGN_3D]: {
    phase: 'P1',
    summary: '图生 3D（Tripo / 混元等 API），GLB 预览与下载。',
    bullets: ['产品图 → GLB', '可选多视图', '后续可接打印'],
    inspiredBy: ['TapNow · 3D', 'Tripo / Hunyuan3D'],
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
    phase: 'P1',
    summary: '产品图 → 样片（Flash）→ 确认后正片；默认短时长控成本。',
    bullets: ['确认卡必选', '样片 / 正片分档', '挂产品库 SKU'],
    inspiredBy: ['TapNow · Video', '万相 i2v'],
    providers: ['wan_video', 'qwen'],
  },
  [ModuleType.SITE_BUILDER]: {
    phase: 'P1',
    summary: '产品库一键生成多语货源落地页 / 轻量独立站，询盘回灌 CRM。',
    bullets: ['SKU 画册页', '多语文案（Qwen）', '询盘表单 → CRM'],
    inspiredBy: ['全球搜 · 独立站', '网易 · AI 建站'],
    providers: ['qwen'],
  },
  [ModuleType.SOCIAL_CONTENT]: {
    phase: 'P1',
    summary: '从产品资产生成社媒发文图文 / 短视频封面。',
    bullets: ['多平台尺寸', '与创作 Agent 资产复用'],
    inspiredBy: ['网易 · 社媒', '全球搜 · SNS'],
    providers: ['wan', 'qwen'],
  },
  [ModuleType.EMAIL_SEQUENCE]: {
    phase: 'P1',
    summary: '多封序列开发信：打开/回复追踪、退订、时区定时。',
    bullets: ['3～5 封序列模板', '与 CRM / 策略模块联动', '额度与退订合规'],
    inspiredBy: ['网易外贸通 · 邮件', '苏维 · EDM'],
    providers: ['directmail'],
  },
  [ModuleType.WHATSAPP]: {
    phase: 'P1',
    summary: 'WhatsApp 深链 / Business API 会话与询盘回灌。',
    bullets: ['点击唤起', '会话记录进 CRM 时间线'],
    inspiredBy: ['网易 · WhatsApp', '全球搜'],
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

export const PHASE_LABEL: Record<RoadmapPhase, string> = {
  P0: '优先落地（约 90 天）',
  P1: '增强能力',
  P2: '生态扩展',
};
