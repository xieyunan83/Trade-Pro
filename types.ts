
export enum ModuleType {
  DISCOVERY = 'discovery',
  BACKGROUND = 'background',
  PRODUCTS = 'products',
  DECISION_MAKERS = 'decision_makers',
  STRATEGY = 'strategy',
  SIMILAR = 'similar',
  PROMO_GENERATOR = 'promo_generator',
  CLIENT_CRM = 'client_crm',
  EMAIL_CAMPAIGN = 'email_campaign' // New Module
}

export interface User {
  username: string;
  password?: string;
  role: 'admin' | 'user';
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
}

export interface Client {
  id: string;
  name: string;
  website?: string; 
  country: string;
  type: '进口商' | '零售商' | '批发商' | '分销商';
  status: '新建/潜在' | '已寄样' | '谈判中' | '已成交' | '流失/搁置';
  productType: string; 
  priceRange: string;
  isSampleNeeded: boolean;
  hasAnalyzed?: boolean; 
  lastOrderDate: string;
  lastContactSent: string;
  lastContactReceived: string;
  nextFollowUpDate: string;
  activityLog: string;
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
  imageUrl?: string;
  competitorLink?: string;
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
  targetAudience: string[];
  financials: {
    revenueEstimate: string;
    paymentTerms: string;
    ipInfo: string;
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
  strategy: {
    buyingOfficeLocation: string;
    actionPlan: string[];
  };
  similarCompanies: SimilarCompany[];
  generatedEmails?: MailGroup; 
}

export interface DecisionMaker {
  name: string;
  title: string;
  yearsActive?: string;
  emailGuess?: string;
  linkedin?: string;
  type: 'CEO' | 'Buyer' | 'Other';
  source: 'AI' | 'Hunter.io' | 'Findymail' | 'AnymailFinder';
  isVerified: boolean;
  confidence?: number;
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
  country: string;
  industry: string;
  clientType: string;
  results: ClientSearchResult[];
  hasSearched: boolean;
}

export interface KnowledgeFile {
  id: string;
  name: string;
  type: string;
  data: string;
  size: number;
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
