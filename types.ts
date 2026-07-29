
export enum ModuleType {
  DISCOVERY = 'discovery',
  BACKGROUND = 'background',
  PRODUCTS = 'products',
  DECISION_MAKERS = 'decision_makers',
  STRATEGY = 'strategy',
  SIMILAR = 'similar',
  PROMO_GENERATOR = 'promo_generator',
  CLIENT_CRM = 'client_crm',
  EMAIL_CAMPAIGN = 'email_campaign',
  IMAGE_GENERATOR = 'image_generator',
}

/** 系统角色：管理员 / 部门主管 / 部门员工 */
export type UserRole = 'admin' | 'manager' | 'user';

/** 细粒度权限（模块 + 功能） */
export type PermissionKey =
  | 'module.discovery'
  | 'module.background'
  | 'module.products'
  | 'module.decision_makers'
  | 'module.strategy'
  | 'module.similar'
  | 'module.promo_generator'
  | 'module.client_crm'
  | 'module.email_campaign'
  | 'module.image_generator'
  | 'feature.search_clients'
  | 'feature.analyze_company'
  | 'feature.batch_analyze'
  | 'feature.dm_email_search'
  | 'feature.export_report'
  | 'feature.export_ppt'
  | 'feature.crm_manage'
  | 'feature.records_center'
  | 'feature.manage_team_users';

export interface Department {
  id: string;
  name: string;
  /** 部门主管用户名 */
  managerUsername?: string;
  createdAt: number;
}

export interface User {
  username: string;
  password?: string;
  role: UserRole;
  /** 所属部门 */
  departmentId?: string;
  /**
   * 显式授权列表；未设置时使用角色默认权限，空数组表示无任何额外授权。
   * 部门主管可调整下属的该字段（不能授予管理下属权限以外的管理权）。
   */
  permissions?: PermissionKey[];
  /** 停用后无法登录 */
  disabled?: boolean;
  isFirstLogin: boolean;
  createdAt: number;
}

// NEW: Global Configuration stored in GitHub
export interface GlobalConfig {
  lastUpdated: number;
  dailyLimits: {
    search: number;   // Max searches per day
    analysis: number; // Max deep analysis per day
  };
  systemNotice: string; // Admin message to users
  sharedApiKeys?: {
    google?: string;
    hunter?: string;
  }
}

// NEW: User Usage Tracking (Local)
export interface DailyUsage {
  date: string; // YYYY-MM-DD
  searchCount: number;
  analysisCount: number;
}

export interface HistoryItem {
  id: string;
  type: ModuleType;
  data: AnalysisResult;
  timestamp: number;
  domain: string;
  /** 搜索/开发时的产品关键词，便于归类 */
  keyword?: string;
  /** 目标国家 */
  country?: string;
  /** 来源标记 */
  source?: 'single' | 'batch' | 'discovery' | 'crm' | 'recover';
  /** 操作者用户名（用于权限隔离） */
  ownerUsername?: string;
  /** 操作者当时所属部门 */
  departmentId?: string;
}

/** 客户搜索归档（每次搜索一条） */
export interface DiscoveryArchiveItem {
  id: string;
  timestamp: number;
  product: string;
  countries: string[];
  industry: string;
  clientTypes: string[];
  results: ClientSearchResult[];
  country?: string;
  clientType?: string;
  ownerUsername?: string;
  departmentId?: string;
}

export interface MailGroup {
  analysis: string;
  email1: string;
  email2: string;
  email3: string;
}

export interface AutomationResult {
  id: string;
  clientName: string;
  website: string;
  country: string;
  status: 'pending' | 'analyzing' | 'generating_email' | 'completed' | 'failed';
  analysis?: AnalysisResult;
  mailGroup?: MailGroup;
  productContext?: string; 
  productImages?: string[]; 
  mode?: 'detailed' | 'economy';
  /** 关联关键词，便于任务归类 */
  keyword?: string;
  createdAt?: number;
  ownerUsername?: string;
  departmentId?: string;
}

export interface DecisionMaker {
  name: string;
  firstName?: string;
  lastName?: string;
  title: string;
  department?: string;
  yearsActive?: string;
  emailGuess?: string;
  phone?: string;
  linkedin?: string;
  type: 'CEO' | 'Buyer' | 'Other';
  /** 联系人发现来源（AI / 平台域名搜索等） */
  source: 'AI' | 'AI (Pattern Guess)' | 'Hunter.io' | 'Findymail' | 'AnymailFinder' | 'Manual';
  /** 邮箱具体来自哪个平台（展示用） */
  emailSource?: 'AnymailFinder' | 'Hunter.io' | 'Findymail' | 'AI (Pattern Guess)' | 'Manual' | string;
  /** Anymail / 平台返回的校验状态 */
  emailStatus?: 'valid' | 'risky' | 'invalid' | 'not_found' | 'unverified' | string;
  isVerified: boolean;
  confidence?: number;
  /** 采购决策权重 1-5，Buyer/CEO 通常更高 */
  influenceScore?: number;
  /** 最近一次邮箱查找/校验时间 */
  lastEmailCheckedAt?: number;
}

export interface TradeIntelligence {
  /** HS 海关编码（公开信息或合理推断） */
  hsCodes: string[];
  /** 主要进口品类 */
  importCategories: string[];
  /** 海关/提单公开信息摘要（ImportYeti、提单目录、新闻等） */
  customsSummary: string;
  /** 近两年公开进口线索 */
  recentShipments: string[];
  /** 主要采购来源国 */
  topSourceCountries: string[];
  /** 预估年进口额 */
  estimatedAnnualImport: string;
  /** 认证：CE / FDA / BSCI / ISO / REACH / UL 等 */
  certifications: string[];
  /** 合规与风险提示 */
  complianceNotes: string;
  preferredIncoterms: string;
  typicalMoq: string;
  buyingSeasons: string;
  /** 注册号/税号等公开标识（如有） */
  registrationId: string;
  /** 公司 LinkedIn / 官网关于页等 */
  companyLinkedin: string;
  /** 信用与风险简评 */
  riskLevel: '低' | '中' | '高' | '未知';
  riskNotes: string;
}

export interface Client {
  id: string;
  name: string;
  website?: string;
  country: string;
  type: '进口商' | '零售商' | '批发商' | '分销商';
  status: '新建/潜在' | '已寄样' | '谈判中' | '已成交' | '流失/搁置';
  productType: string;
  industry: string; // Added industry field
  priceRange: string;
  isSampleNeeded: boolean;
  hasAnalyzed?: boolean;
  hasBackgroundCheck?: boolean; // Added field
  lastOrderDate: string;
  lastContactSent: string;
  lastContactReceived: string;
  nextFollowUpDate: string;
  activityLog: string;
  contacts?: DecisionMaker[]; // Added contacts list
  /** 搜索来源关键词 */
  searchKeyword?: string;
  /** 管理标签 */
  tags?: string[];
  ownerUsername?: string;
  departmentId?: string;
}

// ... existing interfaces ...

export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface TrafficData {
  category: string;
  trafficType: 'Organic (SEO)' | 'Paid (SEM)' | 'Direct' | 'Social';
  topKeywords: string;
  volumeEst: 'High' | 'Medium' | 'Low';
}

export interface YearTrend {
  year: string;
  revenue: number;
  procurement: number;
}

export interface ProductAnalysis {
  name: string;
  retailPrice: string;
  retailPriceCNY: number;
  estimatedFOBPriceCNY: number;
  marginSpace?: 'High' | 'Medium' | 'Low';
  ratio?: string;
  pricingStrategy?: string;
  pitchPoint?: string;
  techSpecs?: string;
  features?: string;
  colors?: string;
  packaging?: string;
  imageUrl?: string;
  competitorLink?: string;
  /** 是否与搜索关键词强相关（产品分析优先展示） */
  keywordMatch?: boolean;
}

export interface WebsiteCategory {
  categoryName: string;
  items: string[];
}

export interface AnalysisResult {
  companyInfo: {
    name: string;
    headquarters: string;
    foundedYear: string;
    nature: string;
    scale: string;
    website: string;
    description: string;
    /** 员工数区间等 */
    employeeRange?: string;
    city?: string;
  };
  swot: SwotAnalysis;
  financialTrends: YearTrend[];
  trafficAnalysis: TrafficData[];
  websiteCategories: WebsiteCategory[];
  businessScope: {
    coreProducts: string[];
    relevantProducts: string[];
    brandPositioning: string;
    consumerGroup: string;
    productVariety: 'High' | 'Medium' | 'Low';
    priceSensitivity: string;
    websiteStructure: string;
  };
  businessModel: {
    channels: string[];
    hasDistributors: boolean;
    exhibitionHistory: string[];
    ecommercePresence: string[];
    procurementInfo: string;
  };
  supplyChain: {
    role: string;
    serviceType: string;
  };
  /** 外贸背调核心：贸易、海关、认证、合规 */
  tradeIntelligence?: TradeIntelligence;
  targetAudience: string[];
  financials: {
    revenueEstimate: string;
    paymentTerms: string;
    ipInfo: string;
  };
  productSummary?: {
    marketPreference: string;
    recommendedProducts: string;
    packagingAnalysis: string;
    colorPreference: string;
    featureAnalysis: string;
  };
  socials: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    similarWebTraffic?: string;
  };
  products: ProductAnalysis[];
  marketTrends: string;
  decisionMakers: DecisionMaker[];
  /** 最近一次「决策人邮箱搜索」完成时间 */
  decisionMakerEmailSearchAt?: number;
  /** 历次决策人邮箱搜索时间（保留，不清除） */
  decisionMakerEmailSearchHistory?: number[];
  /** 客户搜索来源关键词（用于历史归类与产品聚焦） */
  searchKeyword?: string;
  /** 搜索来源标签，如 关键词:xxx / 国家:xxx */
  searchTags?: string[];
  /** 搜索目标国家 */
  searchCountry?: string;
  strategy: {
    buyingOfficeLocation: string;
    actionPlan: string[];
  };
  similarCompanies: SimilarCompany[];
  generatedEmails?: MailGroup;
  /** 开发信生成并保存到报告的时间 */
  generatedEmailsAt?: number;
}

export interface SimilarCompany {
  name: string;
  website: string;
  country: string;
  mainProducts: string;
}

export interface ClientSearchResult {
  name: string;
  website: string;
  description: string;
  country: string;
  /** 进口商 / 分销商 / 批发商 / 零售商 / 品牌商 等 */
  clientType?: string;
  /** 主营产品匹配说明 */
  mainProducts?: string;
  /** 规模粗估 */
  estimatedScale?: string;
  city?: string;
  /** 公司 LinkedIn */
  linkedinCompanyUrl?: string;
  /** 联系页 / 通用邮箱线索 */
  contactHint?: string;
  /** 1-5 匹配度 */
  fitScore?: number;
  fitReason?: string;
  /** 搜索来源：产品关键词 */
  searchKeyword?: string;
  /** 搜索来源：目标国家（本次检索选定的国家） */
  searchCountry?: string;
  /** 管理标签，如 关键词:Car toy / 国家:Poland */
  searchTags?: string[];
  /** 所属搜索归档 ID */
  searchId?: string;
}

export interface EmailTemplateRequest {
  style: 'YIBING' | 'LIAOSHEN' | 'WANGSHENG';
  ourProducts: string;
  existingClients: string;
  advantages: string;
  extraInfo: string;
  sourceContext: string;
  painPoint: string;
  personalHook: string;
}

export interface DiscoveryState {
  product: string;
  /** @deprecated 兼容旧数据；优先用 countries */
  country: string;
  /** 多选目标国家（英文名，供搜索） */
  countries: string[];
  industry: string;
  /** @deprecated 兼容旧数据；优先用 clientTypes */
  clientType: string;
  /** 多选客户类型 */
  clientTypes: string[];
  results: ClientSearchResult[];
  hasSearched: boolean;
}

export const CLIENT_TYPE_OPTIONS = [
  { value: 'Importer', label: '进口商 (Importer)' },
  { value: 'Wholesaler', label: '批发商 (Wholesaler)' },
  { value: 'Retailer', label: '零售商 (Retailer)' },
  { value: 'Distributor', label: '分销商 (Distributor)' },
  { value: 'Brand', label: '品牌商 (Brand)' },
  { value: 'Buying Office', label: '采购办公室 (Buying Office)' },
] as const;

export interface KnowledgeFile {
  id: string;
  name: string;
  type: string;
  data: string;
  size: number;
  mimeType?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  attachments?: KnowledgeFile[];
  timestamp: number;
}

export interface KeywordExtractionResult {
  industryTerms: string[];
  tier1Keywords: string[];
  tier2Keywords: string[];
}

export type TaskType = 'default' | 'analysis' | 'search' | 'email' | 'keywords' | 'chat';

export interface ApiConfig {
    id: string;
    apiKey: string;
    baseUrl: string;
    modelId?: string;
    taskAssignment?: TaskType;
    priority?: number; // 1 = Highest, 2 = Backup, etc.
}

// --- NEW TYPES FOR EMAIL MODULE ---

export interface AliyunConfig {
    accessKeyId: string;
    accessKeySecret: string;
    accountName: string; // e.g. offer@service.babyworld.com
    fromAlias: string;   // e.g. Kevin from BabyWorld
    replyToAddress: boolean;
    addressType: 1 | 0; // 1: Random, 0: Fixed
    tagName: string; // Tag for tracking
    regionId: string; // cn-hangzhou, ap-southeast-1
}

export interface EmailTemplate {
    id: string;
    name: string;
    subject: string;
    senderName?: string; // New field for Sender Alias override
    body: string; // HTML content
    attachments?: string[]; // List of file names (visual only for now)
    lastUpdated: number;
}

export interface EmailTask {
    id: string;
    recipientEmail: string;
    recipientName: string;
    companyName: string;
    status: 'pending' | 'sending' | 'success' | 'failed';
    error?: string;
    sentAt?: number;
}
