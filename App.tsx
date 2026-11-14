
import React, { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { analyzeCompany, hasApiKeyConfigured, checkApiKeyAvailability, hydrateApiConfigsFromCloud, searchPotentialClients, enableTavilyGeminiQwenCascade, enableGeminiQwenParallelMerge, synthesizeInsightsFallback } from './services/geminiService';
import {
  withRateLimitRetry,
  isRateLimitError,
  isTransientAnalysisError,
  shortErrorMessage,
  noteRateLimited,
  getCooldownRemainingSec,
} from './services/rateLimitGate';
import { exportToPPT, exportAutomationReportToPPT, exportBatchAutomationReportsToPPT } from './services/exportService';
import { saveHistory, saveHistoryBulk, getHistory, getAllFilesFromDB, saveAutomationTask, getAutomationQueue, deleteAutomationTask, saveFileToDB, saveDiscoveryArchive, getDiscoveryArchives, deleteDiscoveryArchive, deleteHistoryItem } from './services/db';
import {
  getAutomationQueueSnapshot,
  replaceAutomationQueue,
  updateAutomationQueue,
  subscribeAutomationQueue,
} from './services/automationQueueStore';
import {
  configureCrmStorePersist,
  getCrmClientsSnapshot,
  patchCrmClient,
  replaceCrmClients,
  subscribeCrmClients,
  updateCrmClients,
} from './services/crmStore';
import {
  getHistorySnapshot,
  persistHistoryItemToDisk,
  replaceHistory,
  subscribeHistory,
  updateHistory,
  upsertHistoryItem,
} from './services/historyStore';
import { AppNavDock } from './components/AppNavDock';
import { CooldownOverlay } from './components/CooldownOverlay';
import { installForegroundGuard, setHeavyWorkSuspended } from './services/foregroundGuard';
import { installClientShield } from './services/clientShield';
import { isAutoBackgroundAllowed } from './services/autoBackgroundPolicy';
import {
  loadAndRepairAutomationQueue,
  mergeDecisionMakersIntoAutomationTasks,
  newAutomationTaskId,
} from './services/automationQueueRepair';
import { pullMergePushAutomationQueue } from './services/automationQueueCloud';
import {
  formatWorkspaceSyncReport,
  mergeClientsById,
  syncAllWorkspaceData,
} from './services/workspaceCloudSync';
import { enqueueCrmClientCloudPush } from './services/immediateCloudSync';
import { fetchGlobalConfig, fetchDocumentsFromRepo, backupUserHistory, fetchCRMFromCloud, saveCRMToCloud, fetchUserHistoryFromCloud, checkGitHubStatus, fetchApiConfigsFromCloud, setManualGitHubConfig } from './services/githubService';
import { isSupabaseConfigured, getKnowledgeFiles, getInvestigationHistory, saveInvestigationHistory, saveDiscoverySearch, getCrmClients, syncCrmClients, saveCrmClientsBulk, deleteCrmClient, deleteCrmClientsBulk, getDiscoverySearchArchives, deleteInvestigationHistory, deleteDiscoverySearchFromCloud, deleteDiscoverySearchesByMeta, getProductProfilesCloud } from './services/supabase';
import {
  indexAnalysisIntoProductCatalog,
  rebuildProductCatalogFromHistory,
  backfillProductCatalogFromHistory,
  loadProductCatalog,
  listBlankCrmClientsForDesignFill,
  hasRichProductCatalog,
  removeProductProfile,
  productCatalogDomainKey,
  buildProductProfileFromAnalysis,
} from './services/productCatalog';
import { saveProductProfilesBulk } from './services/db';
import { addCustomKeyword, addCustomCountry } from './services/taxonomyStore';
import {
  applyCatalogMatchTagsToClient,
  buildCrmCatalogMatchReport,
} from './services/crmCatalogMatch';
import {
  assignCategoriesFromSignals,
  idsFromAssignments,
} from './services/categoryTaxonomy';
import { normalizeCountryZh } from './utils/countryNormalize';
import { buildSearchTags, stampSearchResults } from './utils/searchTags';
import { mergeDiscoveryResultsIntoCrm, mergeHistoryItemsIntoCrm, findCrmIdsForHistoryItem, findCrmIdsForDiscoveryResults, lookupBackgroundCheck, formatBackgroundCheckTime, findHistoryForClient, clientPatchFromAnalysis, reconcileCrmProductTypesFromHistory, CRM_JUNE_2026_CUTOFF_MS, isSearchResultInCrm, normalizeCrmHost, mergeCrmClientsByDomain, findCrmClientIndex } from './utils/crmHistory';
import { remapEmailTaskClientIds } from './services/emailCampaignStore';
import {
  clearCrmTombstonesForClients,
  filterOutCrmTombstones,
  markCrmClientsDeleted,
  reconcileCrmTombstonesWithLiveClients,
} from './utils/crmTombstones';
import {
  buildJunkCleanupPlan,
  clearAutoPurgeNonToyJunkFlag,
  hasAutoPurgedNonToyJunk,
  isNonToyJunkBlob,
  junkCleanupPlanCount,
  markAutoPurgedNonToyJunk,
} from './utils/junkLeadCleanup';
import { checkLimit, incrementUsage, updateLocalConfig, resetDailyUsage, getDailyUsagePublic } from './services/limitService';
import { ModuleType, AnalysisResult, DiscoveryState, Client, User, HistoryItem, AutomationResult, ClientSearchResult, DiscoveryArchiveItem, DecisionMaker, Department, AutomationPipelineConfig, SimilarCompany } from './types';
import { ModuleBackground } from './components/ModuleBackground';
import { ModuleProducts } from './components/ModuleProducts';
import { ModuleDecisionMakers } from './components/ModuleDecisionMakers';
import { DmEmailSearchPanel } from './components/DmEmailSearchPanel';
import { ProductDigPanel } from './components/ProductDigPanel';
import { DesignSignalPanel } from './components/DesignSignalPanel';
import { EnrichmentPanel } from './components/EnrichmentPanel';
import {
  applyDmPersistToHistory,
  mergeHistoryPreferDmRich,
  upsertDmPersistRecord,
  findDmPersistForCompany,
} from './services/dmSearchPersist';
import { mergeDecisionMakers, mergeAnalysisWithPrevious } from './services/multiModelMerge';
import { companyNeedsAsyncDmFill } from './services/dmEnrichPolicy';
import { ensurePersonIdentity } from './services/personIdentity';
import {
  enqueueDmEmailSearch,
  getActiveDmJobForDomain,
  type DmEmailSearchJob,
} from './services/dmEmailSearchQueue';
import {
  gatherSilentCompanyChannelIntel,
  mergeSilentIntelIntoAnalysis,
} from './services/silentAcquisitionEngine';
import {
  pumpNightUpgrade,
  setNightSilentUpgradeEnabled,
  startNightSilentUpgrade,
  stopNightSilentUpgrade,
} from './services/nightSilentUpgrade';
import {
  isWorkerModeActive,
  markWorkerPromptAnswered,
  resolveWorkerParallelSlots,
  setWorkerModeActive,
  shouldWorkerRunHeavyAnalysisNow,
  subscribeWorkerMode,
} from './services/workerMode';
import { pickStickyPoolKey } from './services/apiKeyPool';
import { WorkerModeBadge, WorkerModePrompt } from './components/WorkerModePrompt';
import {
  enqueueProductDig,
  enqueueProductDigBatch,
  setProductDigHistoryResolver,
  stopProductDigQueue,
  subscribeProductDigJobs,
  getProductDigProgress,
  isProductDigQueueBusy,
} from './services/productDigQueue';
import { stopAllBackgroundWork } from './services/stopAllBackgroundWork';
import type { ProductDigCompletePayload } from './services/productDigQueue';
import {
  enqueueDesignSignalBatch,
  hydrateDesignSignalQueue,
  resumeDesignSignalQueue,
  setDesignSignalHistoryResolver,
  setDesignSignalOnComplete,
  type DesignSignalCompletePayload,
} from './services/designSignalQueue';
import {
  enqueueEnrichment,
  enqueueEnrichmentBatch,
  hydrateEnrichmentQueue,
  isEnrichmentQueueBusy,
  resumeEnrichmentQueue,
  setEnrichmentHistoryResolver,
  setEnrichmentOnComplete,
  type EnrichmentCompletePayload,
} from './services/analysisEnrichmentQueue';
import { crmTagsFromDecision } from './services/analysisDecisionEnrich';
import { ManagerSystemPanel } from './components/ManagerSystemPanel';
import { NightUpgradePanel } from './components/NightUpgradePanel';
import { SiteBuildPanel } from './components/SiteBuildPanel';
import {
  hydrateDeptApiKeysFromCloud,
  setKeyResolutionContext,
} from './services/deptApiKeys';
import { loadDepartmentsFromStorage } from './services/orgStore';
import {
  canAccessModule,
  canBrowseAllDepartments,
  canViewFullDecisionMakerEmails,
  canViewOwnedRecord,
  filterOwnedRecords,
  getDepartmentMemberUsernames,
  hasPermission,
} from './services/permissions';
import {
  archiveToDiscoveryState,
  emptyDiscoveryState,
  isDiscoverySessionArchiveId,
  hydrateCrmClientsCache,
  loadAllCrmClients,
  mergeSaveCrmClients,
  migrateLegacyCrmOwnership,
  migrateLegacyOwnership,
  purgeAllCrmClientsBeforeDate,
  purgeCrmListBeforeDate,
  previewPurgeCrmBeforeDate,
  resolveDiscoveryStateOnLogin,
  saveAllCrmClients,
  saveUserDiscoveryState,
} from './utils/workspaceScope';
import { ModuleStrategy } from './components/ModuleStrategy';
import { ReportEnrichmentPanel } from './components/ReportEnrichmentPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { extractHistoryAnalysis, normalizeAnalysisResult, websiteHref } from './services/analysisNormalize';
import { ModuleSimilar } from './components/ModuleSimilar';
import type { PromoListRow } from './utils/promoListRows';
import { ModuleComingSoon } from './components/ModuleComingSoon';
import { ModuleLandingHub } from './components/ModuleLandingHub';
import { TradeJourneyPanel } from './components/TradeJourneyPanel';
import { ModulePane } from './components/ModulePane';
import { MODULE_KEEP_ALIVE_BUDGET } from './services/moduleKeepAlive';
import { prefetchCoreModules, prefetchModule } from './services/modulePrefetch';
import { loadCatalogSkus } from './services/productCatalogTypes';
import { setPreferredAcquisitionCategories } from './services/acquisitionMethods';
import type { PlatformAcquisitionSearchRequest } from './components/AcquisitionMethodsPanel';
import type { SphereNavPhase } from './components/SphereNav';
import { lazyWithRetry } from './utils/lazyWithRetry';

/** 模块保活预算：提高后切换像本机多标签，而非网站整页重挂 */
const KA = MODULE_KEEP_ALIVE_BUDGET;

/** 同域名客户合并：邮件任务 clientId 重映射 + 云端删除被合并行 */
const applyCrmDomainDedupe = (
  clients: Client[],
  opts?: { deleteCloudLosers?: boolean }
): { clients: Client[]; removedCount: number; mergedGroups: number } => {
  const deduped = mergeCrmClientsByDomain(clients);
  if (deduped.removedCount > 0) {
    remapEmailTaskClientIds(deduped.remaps);
    if (opts?.deleteCloudLosers !== false) {
      const loserIds = Object.keys(deduped.remaps);
      void Promise.all(
        loserIds.map((id) =>
          deleteCrmClient(id).catch((e) =>
            console.warn('[CRM] cloud delete after domain merge failed', id, e)
          )
        )
      );
    }
  }
  return {
    clients: deduped.clients,
    removedCount: deduped.removedCount,
    mergedGroups: deduped.mergedGroups,
  };
};

/** 重模块按需加载；部署后旧 chunk 404 时自动强刷一次 */
const ModulePromoGenerator = lazyWithRetry(
  () => import('./components/ModulePromoGenerator').then((m) => ({ default: m.ModulePromoGenerator })),
  'promo'
);
const ModuleClientCRM = lazyWithRetry(
  () => import('./components/ModuleClientCRM').then((m) => ({ default: m.ModuleClientCRM })),
  'crm'
);
const ModuleProductMatch = lazyWithRetry(
  () => import('./components/ModuleProductMatch').then((m) => ({ default: m.ModuleProductMatch })),
  'match'
);
const ModuleEmailCampaign = lazyWithRetry(
  () => import('./components/ModuleEmailCampaign').then((m) => ({ default: m.ModuleEmailCampaign })),
  'email'
);
const ModuleImageGenerator = lazyWithRetry(
  () => import('./components/ModuleImageGenerator').then((m) => ({ default: m.ModuleImageGenerator })),
  'imggen'
);
const ModuleContactTools = lazyWithRetry(
  () => import('./components/ModuleContactTools').then((m) => ({ default: m.ModuleContactTools })),
  'contact'
);
const ModuleProductCatalog = lazyWithRetry(
  () => import('./components/ModuleProductCatalog').then((m) => ({ default: m.ModuleProductCatalog })),
  'catalog'
);
const ModuleProductQuote = lazyWithRetry(
  () => import('./components/ModuleProductQuote').then((m) => ({ default: m.ModuleProductQuote })),
  'quote'
);
const ModuleProductDesign2D = lazyWithRetry(
  () => import('./components/ModuleProductDesign2D').then((m) => ({ default: m.ModuleProductDesign2D })),
  'design2d'
);
const ModuleProductDesign3D = lazyWithRetry(
  () => import('./components/ModuleProductDesign3D').then((m) => ({ default: m.ModuleProductDesign3D })),
  'design3d'
);
const ModuleProductAiVideo = lazyWithRetry(
  () => import('./components/ModuleProductAiVideo').then((m) => ({ default: m.ModuleProductAiVideo })),
  'aivideo'
);
const ModuleProductPackaging = lazyWithRetry(
  () => import('./components/ModuleProductPackaging').then((m) => ({ default: m.ModuleProductPackaging })),
  'packaging'
);
const ModuleSiteBuilder = lazyWithRetry(
  () => import('./components/ModuleSiteBuilder').then((m) => ({ default: m.ModuleSiteBuilder })),
  'site'
);
const ModuleSocialContent = lazyWithRetry(
  () => import('./components/ModuleSocialContent').then((m) => ({ default: m.ModuleSocialContent })),
  'social'
);
const ClientFinder = lazyWithRetry(
  () => import('./components/ClientFinder').then((m) => ({ default: m.ClientFinder })),
  'finder'
);
import { BatchBackgroundExcelPanel } from './components/BatchBackgroundExcelPanel';
import {
  applyBatchSeedToClient,
  batchBgQueueTarget,
  seedFromBatchRow,
  type ClassifiedBatchBgRow,
} from './services/batchBackgroundExcel';
import { isQwenNightPromoWindow } from './services/qwenModelSchedule';
import { waitForLocalAiSlot, withHeavyJob, getHeavyJobCount } from './services/loadGovernor';
import {
  EXCEL_NIGHT_BATCH_THRESHOLD,
  getExcelNightBatch,
  isAutomationTaskRunnableNow,
  markExcelNightBatchNotified,
  newExcelNightBatchId,
  registerExcelNightBatch,
  summarizeExcelNightBatch,
} from './services/excelNightBatchStore';
import { RecordsPanel } from './components/RecordsPanel';
import { Login } from './components/Login';
import { AccessGate } from './components/AccessGate';
import { loadUsersWithMigration, loadUsersFromStorage, saveUsersToStorage, getUsersUpdatedAt } from './services/auth';
import {
  armDesktopSession,
  clearSession,
  restoreSessionUser,
  saveSession,
} from './services/sessionStore';
import { AdminDashboard } from './components/AdminDashboard';
import { 
  LayoutDashboard, PackageSearch, Users, PenTool, Network, Search, Loader2, Menu, Globe, Zap, FileSpreadsheet, History, Clock, ChevronRight, AlertTriangle, RefreshCw, LogOut, Briefcase, Ruler, CheckCircle2, Hourglass, StopCircle, PlayCircle, Layers, Mail, Cloud, Download, Info, Link2, X, Database, Image, Trash2, Ban, Target
} from 'lucide-react';
import { ALWAYS_ACTIVE_MODULES } from './services/moduleNav';
import {
  findSectionByModule,
  findNavItem,
  type PlatformSectionId,
} from './services/platformSections';
import { useModuleHashRoute } from './hooks/useModuleHashRoute';
import { setUsageScope } from './services/limitService';
import { appendClientActivity, markEmailSentOnClient } from './services/crmActivity';
import {
  addExcludedCompany,
  hydrateExcludedCompaniesFromCloud,
} from './services/excludedCompanies';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

type AppProps = {
  /** 由 LoginBoot 传入：已登录用户，跳过登录页 */
  bootUser?: User | null;
  /** 主动退出时通知 LoginBoot 卸掉 bootUser，避免又被会话拉回去 */
  onBootLogout?: () => void;
};

const App: React.FC<AppProps> = ({ bootUser = null, onBootLogout }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => bootUser ?? null);
  const intentionalLogoutRef = useRef(false);
  const [users, setUsers] = useState<User[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(() =>
    bootUser?.role === 'admin' ? true : null
  );
  
  const [domainInput, setDomainInput] = useState('');
  const [activeModule, setActiveModule] = useState<ModuleType>(ModuleType.HOME);
  /**
   * 侧栏切换必须是同步高优先级更新。
   * 若用 startTransition，会被登录后灌入的 CRM/历史/几千条作业队列饿死，表现为「菜单点了没反应」。
   */
  const navigateModule = useCallback((m: ModuleType) => {
    setActiveModule(m);
    // 同步切页；目标模块 chunk 走 idle 预热，不抢点击
    prefetchModule(m);
  }, []);
  const openRecordsPanel = useCallback(() => setHistoryOpen((v) => !v), []);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const exitAdminWorkspace = useCallback(() => setAdminInWorkspace(false), []);
  const openTeamManagePanel = useCallback(() => {
    setTeamManageOpen(true);
    setMobileMenuOpen(false);
  }, []);
  const [workspaceSyncStatus, setWorkspaceSyncStatus] = useState<string | null>(null);
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);
  /** 管理员进入与业务员相同的工作台（含今日看板） */
  const [adminInWorkspace, setAdminInWorkspace] = useState(false);
  /** admin 进业务页：是否弹出挂机确认 */
  const [workerPromptOpen, setWorkerPromptOpen] = useState(false);
  const [workerModeOn, setWorkerModeOn] = useState(() => isWorkerModeActive());
  /** 指挥舱任务流 → 营销工具剧本注入 */
  const [pendingPlaybookId, setPendingPlaybookId] = useState<string | null>(null);
  useModuleHashRoute(activeModule, navigateModule);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [crmNavOrder, setCrmNavOrder] = useState<{ clientId: string; historyId: string }[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  /** 球体导航相位：决定固定坞宽度（主区让位，滚动时坞始终贴边） */
  const [sphereNavPhase, setSphereNavPhase] = useState<SphereNavPhase>('start');
  const [sphereNavSectionId, setSphereNavSectionId] = useState<PlatformSectionId | null>(null);
  const sphereNavExpanded = sphereNavPhase !== 'start';
  /** 侧栏实际像素宽：主区用 calc(100% - 此值) 铺满，禁止再靠 flex 猜宽 */
  const sidebarWidth =
    sphereNavPhase === 'submenu'
      ? '15.5rem'
      : sphereNavPhase === 'sections'
        ? '4.5rem'
        : '4.25rem';
  const dockWidthClass =
    sphereNavPhase === 'submenu'
      ? 'w-[min(100vw-1rem,15.5rem)]'
      : sphereNavPhase === 'sections'
        ? 'w-[4.5rem]'
        : 'w-[4.25rem]';
  
  const [historyOpen, setHistoryOpen] = useState(false);
  const [departments, setDepartments] = useState<Department[]>(() => loadDepartmentsFromStorage());
  const [teamManageOpen, setTeamManageOpen] = useState(false);
  const [kbCount, setKbCount] = useState(0); 
  const [systemNotice, setSystemNotice] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isKBSyncing, setIsKBSyncing] = useState(false); 
  const [isGitHubConnected, setIsGitHubConnected] = useState(false);
  
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>(emptyDiscoveryState);
  const [discoveryArchives, setDiscoveryArchives] = useState<DiscoveryArchiveItem[]>([]);
  /** 营销工具获客公式 → 客户搜索自动开跑 */
  const [discoveryAutoSearchNonce, setDiscoveryAutoSearchNonce] = useState(0);

  /** 作业队列不进 App useState：见 automationQueueStore，避免 5k+ 条拖死侧栏 */
  const [isAutomating, setIsAutomating] = useState(false);
  
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<string[]>([]);
  const [pendingBatchContext, setPendingBatchContext] = useState<string>('');
  /** Per-domain country hints for batch 背调 (avoids hardcoding Global) */
  const [pendingBatchCountries, setPendingBatchCountries] = useState<Record<string, string>>({});
  /** 批量「再次背调」：不跳过库内已有，且任务 skipCache */
  const pendingBatchForceRef = useRef(false);
  /** Excel 批量背调面板 */
  const [excelBatchOpen, setExcelBatchOpen] = useState(false);
  /** 背调页排除/删除：用应用内确认，避免 window.confirm 被环境拦截 */
  const [reportConfirm, setReportConfirm] = useState<null | {
    type: 'exclude' | 'delete';
    title: string;
    message: string;
  }>(null);
  const [reportActionBusy, setReportActionBusy] = useState(false);
  const [productDigProgress, setProductDigProgress] = useState({
    total: 0,
    completed: 0,
    failed: 0,
    active: 0,
    runningName: '',
  });
  /** 背调后台进度（独立 state，避免仅靠 isAutomating + filter 导致进度条闪退） */
  const [batchProgress, setBatchProgress] = useState({
    active: false,
    total: 0,
    done: 0,
    failed: 0,
    currentName: '',
  });
  
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualOwner, setManualOwner] = useState('');
  const [manualRepo, setManualRepo] = useState('');
  const shouldStopRef = useRef(false);
  /** 禁止登录隐式续跑；仅挂机确认后由 kickWorker 拉起 */
  const autoResumeBatchOnceRef = useRef(false);
  const batchRunnerActiveRef = useRef(false);
  const batchSessionIdsRef = useRef<Set<string>>(new Set());
  /** 刚入队、React state / IndexedDB 可能尚未同步的任务，供队列 runner 兜底捞取 */
  const batchSeedByIdRef = useRef<Map<string, AutomationResult>>(new Map());
  const historyRef = useRef<HistoryItem[]>([]);
  const automationResultsRef = useRef<AutomationResult[]>([]);
  const crmClientsRef = useRef<Client[]>([]);
  /** 兼容旧 setState 写法：全部落到外置 store，不触发 App 重绘 */
  const setCrmClients = useCallback(
    (next: Client[] | ((prev: Client[]) => Client[])) => {
      if (typeof next === 'function') {
        const resolved = updateCrmClients(next);
        crmClientsRef.current = resolved;
        return;
      }
      replaceCrmClients(next);
      crmClientsRef.current = next;
    },
    []
  );
  const setHistory = useCallback(
    (next: HistoryItem[] | ((prev: HistoryItem[]) => HistoryItem[])) => {
      if (typeof next === 'function') {
        const resolved = updateHistory(next);
        historyRef.current = resolved;
        return;
      }
      replaceHistory(next);
      historyRef.current = next;
    },
    []
  );
  /** 渲染/查找用：始终读 store 快照（App 本身不订阅，避免整树重绘） */
  const crmClients = crmClientsRef.current;
  const history = historyRef.current;
  const viewingHistoryIdRef = useRef<string | null>(null);
  const analysisDataRef = useRef<AnalysisResult | null>(null);
  const userDataReadyRef = useRef(false);
  /** 当前搜索界面已从本机/归档正确恢复前，禁止把中间态写回 localStorage */
  const discoveryHydratedRef = useRef(false);
  /** 登录云端 CRM 合并完成前禁止 persist 写回，避免首屏按墓碑过滤后把全库冲掉 */
  const crmPersistReadyRef = useRef(false);

  const scheduleCrmClientPatch = useCallback((client: Client) => {
    patchCrmClient(client);
    crmClientsRef.current = getCrmClientsSnapshot();
  }, []);

  // 外置 store → ref，供 runner / 事件处理读取；不触发 App setState
  useEffect(() => {
    automationResultsRef.current = getAutomationQueueSnapshot();
    return subscribeAutomationQueue(() => {
      automationResultsRef.current = getAutomationQueueSnapshot();
    });
  }, []);

  useEffect(() => {
    crmClientsRef.current = getCrmClientsSnapshot();
    return subscribeCrmClients(() => {
      crmClientsRef.current = getCrmClientsSnapshot();
    });
  }, []);

  useEffect(() => {
    historyRef.current = getHistorySnapshot();
    return subscribeHistory(() => {
      historyRef.current = getHistorySnapshot();
    });
  }, []);

  useEffect(() => {
    configureCrmStorePersist({
      getViewer: () => currentUser,
      getUsers: () => users,
      getDepartments: () => departments,
      isReady: () => !!(userDataReadyRef.current && crmPersistReadyRef.current && currentUser),
      isGitHubConnected: () => isGitHubConnected,
    });
  }, [currentUser, users, departments, isGitHubConnected]);

  /** 大列表写入只更新 store，不 setState App（侧栏与主区解耦） */
  const setAutomationResultsDeferred = useCallback(
    (next: AutomationResult[] | ((prev: AutomationResult[]) => AutomationResult[])) => {
      const resolved =
        typeof next === 'function' ? next(getAutomationQueueSnapshot()) : next;
      automationResultsRef.current = resolved;
      // 只通知订阅方（营销工具/看板计数）；App 不订阅 → 侧栏不重渲染
      replaceAutomationQueue(resolved);
    },
    []
  );

  /** 同步写入内存队列（ref + store），避免入队后立刻跑 runner 时读到旧 ref */
  const syncAutomationResults = (
    updater: (prev: AutomationResult[]) => AutomationResult[]
  ) => {
    const next = updateAutomationQueue(updater);
    automationResultsRef.current = next;
    return next;
  };

  const refreshBatchProgressFromSession = (currentName?: string) => {
    const ids = batchSessionIdsRef.current;
    const list = automationResultsRef.current.filter((r) => ids.has(r.id));
    // 若 seed 里还有未进 memory 的，也计入总数
    for (const [id, seed] of batchSeedByIdRef.current) {
      if (!ids.has(id)) continue;
      if (!list.some((r) => r.id === id)) list.push(seed);
    }
    const done = list.filter((r) => r.status === 'completed').length;
    const failed = list.filter((r) => r.status === 'failed').length;
    const analyzing = list.find((r) => r.status === 'analyzing');
    const pendingLeft = list.some(
      (r) => r.status === 'pending' || r.status === 'analyzing'
    );
    setBatchProgress({
      active: pendingLeft || batchRunnerActiveRef.current,
      total: Math.max(list.length, ids.size),
      done,
      failed,
      currentName:
        currentName !== undefined
          ? currentName
          : analyzing?.clientName || analyzing?.website || '',
    });
  };
  useEffect(() => {
    const resolveHist = (clientId: string) => {
      if (clientId.startsWith('hist_')) {
        const hid = clientId.slice(5);
        return historyRef.current.find((h) => h.id === hid);
      }
      const client = crmClientsRef.current.find((c) => c.id === clientId);
      if (client) return findHistoryForClient(client, historyRef.current);
      // 营销工具临时 Client（id=任务 id）
      const task = automationResultsRef.current.find((t) => t.id === clientId);
      if (task?.analysis) {
        const byDomain = historyRef.current.find(
          (h) =>
            (h.domain || '').toLowerCase() === (task.website || '').toLowerCase() ||
            (h.data?.companyInfo?.website || '').toLowerCase() ===
              (task.analysis?.companyInfo?.website || '').toLowerCase()
        );
        if (byDomain) return byDomain;
        return {
          id: `task_${task.id}`,
          type: ModuleType.BACKGROUND,
          data: task.analysis,
          timestamp: task.completedAt || task.createdAt || Date.now(),
          domain: task.website || task.analysis.companyInfo?.website,
          keyword: task.keyword,
          country: task.country,
        } as HistoryItem;
      }
      return historyRef.current.find((h) => h.id === clientId);
    };
    setProductDigHistoryResolver(resolveHist);
    setDesignSignalHistoryResolver(resolveHist);
    setEnrichmentHistoryResolver(resolveHist);
    // 禁止进站自动预热补全队列（会复活后台泵）；仅挂机模式才 hydrate
    if (isAutoBackgroundAllowed()) {
      const hydrateLater = () => {
        try {
          hydrateDesignSignalQueue();
          hydrateEnrichmentQueue();
        } catch (e) {
          console.warn('[boot] hydrate queues failed', e);
        }
      };
      window.setTimeout(hydrateLater, 12_000);
    }
    return () => {
      setProductDigHistoryResolver(null);
      setDesignSignalHistoryResolver(null);
      setEnrichmentHistoryResolver(null);
    };
  }, []);

  useEffect(() => {
    return subscribeProductDigJobs(() => {
      setProductDigProgress(getProductDigProgress());
    });
  }, []);

  useEffect(() => subscribeWorkerMode((s) => setWorkerModeOn(s.active)), []);

  // 最小化 / 切应用返回：先恢复侧栏可点，并冷静期让路，避免定时器回补饿死菜单
  useEffect(() => installForegroundGuard(), []);

  /** 默认硬挂起一切自动后台；仅「挂机执行」才放开 */
  useEffect(() => {
    setHeavyWorkSuspended(!workerModeOn);
    if (!workerModeOn) {
      try {
        stopAllBackgroundWork();
      } catch {
        /* ignore */
      }
    }
    return () => setHeavyWorkSuspended(true);
  }, [workerModeOn]);

  /** 仅 admin 挂机端：静默补齐缺口（白天轻量 / 夜间重补全）；业务员本机绝不自动开跑 */
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin' || !workerModeOn) {
      stopNightSilentUpgrade();
          return;
      }
    startNightSilentUpgrade({
      getClients: () => crmClientsRef.current || [],
      getHistory: () => historyRef.current || [],
      canDm: () => hasPermission(currentUser, 'feature.dm_email_search'),
      canProduct: () => hasPermission(currentUser, 'feature.product_redig'),
      canEnrich: () =>
        hasPermission(currentUser, 'feature.product_redig') ||
        hasPermission(currentUser, 'feature.analyze_company'),
      onLinkedInDone: async ({ client, decisionMakers, historyId }) => {
        await persistDecisionMakerResearch(
          { decisionMakers },
          {
            historyId: historyId || null,
            domain: client.website,
            companyName: client.name,
          }
        );
      },
      enqueueDm: (client, hist) => {
        if (!hasPermission(currentUser, 'feature.dm_email_search')) return false;
        const domain = (
          client.website ||
          hist?.domain ||
          hist?.data?.companyInfo?.website ||
          ''
        ).trim();
        if (!domain.includes('.')) return false;
        const res = enqueueDmEmailSearch({
          domain,
          companyName: client.name || domain,
          historyId: hist?.id || null,
          companyLinkedin:
            hist?.data?.socials?.linkedin ||
            hist?.data?.tradeIntelligence?.companyLinkedin,
          deepDig: true,
          authorized: true,
          existingDecisionMakers: hist?.data?.decisionMakers || client.contacts || [],
          resolveExisting: () => {
            const h = findHistoryForClient(client, historyRef.current);
            return h?.data?.decisionMakers || client.contacts || [];
          },
          onComplete: async (job: DmEmailSearchJob) => {
            if (job.status !== 'completed' || !job.resultDecisionMakers || !job.searchedAt) return;
            const item = job.historyId
              ? historyRef.current.find((h) => h.id === job.historyId)
              : historyRef.current.find(
                  (h) => (h.domain || '').toLowerCase() === job.domain.toLowerCase()
                );
            const prevHistory = item?.data?.decisionMakerEmailSearchHistory || [];
            await persistDecisionMakerResearch(
              {
                decisionMakers: job.resultDecisionMakers,
                decisionMakerEmailSearchAt: job.searchedAt,
                decisionMakerEmailSearchHistory: [...prevHistory, job.searchedAt].slice(-30),
              },
              { historyId: job.historyId, domain: job.domain, companyName: job.companyName }
            );
          },
        });
        return !!res.ok;
      },
      enqueueProduct: (client) => {
        if (!hasPermission(currentUser, 'feature.product_redig')) return false;
        const res = enqueueProductDig({ client, authorized: true });
        return !!res.ok;
      },
      enqueueEnrichment: (client) => {
        const ok =
          hasPermission(currentUser, 'feature.product_redig') ||
          hasPermission(currentUser, 'feature.analyze_company');
        if (!ok) return false;
        const res = enqueueEnrichment({ client, authorized: true });
        return !!res.ok;
      },
      runCatalogMatch: async (client, hist) => {
        const analysis = hist?.data;
        const report = buildCrmCatalogMatchReport(client, analysis, {
          historyId: hist?.id,
          ownerUsername: currentUser.username,
          departmentId: currentUser.departmentId,
        });
        if (!report) return null;
        // 写入客户产品画像，供产品匹配模块使用
        if (analysis) {
          try {
            const profile = buildProductProfileFromAnalysis(analysis, {
              historyId: hist?.id,
              crmClientId: client.id,
              ownerUsername: client.ownerUsername || currentUser.username,
              departmentId: client.departmentId || currentUser.departmentId,
            });
            if (profile) {
              const { upsertProductProfile } = await import('./services/productCatalog');
              await upsertProductProfile(profile);
            }
          } catch {
            /* ignore */
          }
        }
        const tagged = applyCatalogMatchTagsToClient(client, report);
        scheduleCrmClientPatch(tagged);
        void enqueueCrmClientCloudPush(tagged);
        return { note: report.note };
      },
    });
    return () => stopNightSilentUpgrade();
  }, [currentUser?.username, workerModeOn, scheduleCrmClientPatch]);

  useEffect(() => {
    viewingHistoryIdRef.current = viewingHistoryId;
  }, [viewingHistoryId]);
  useEffect(() => {
    analysisDataRef.current = analysisData;
  }, [analysisData]);

  // 启用检索降级链；冷却 UI 由 CooldownOverlay 独立订阅，禁止在此 setState
  useEffect(() => {
    enableTavilyGeminiQwenCascade();
    enableGeminiQwenParallelMerge();
  }, []);

  const DISCOVERY_TOMBSTONE_KEY = 'trade_scout_discovery_deleted_ids';

  const readDiscoveryTombstones = (): Set<string> => {
    try {
      const raw = localStorage.getItem(DISCOVERY_TOMBSTONE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  };

  const addDiscoveryTombstone = (id: string, product?: string, country?: string) => {
    const set = readDiscoveryTombstones();
    set.add(id);
    if (product) set.add(`meta:${(product || '').toLowerCase()}|${(country || '').toLowerCase()}`);
    localStorage.setItem(DISCOVERY_TOMBSTONE_KEY, JSON.stringify([...set]));
  };

  const isDiscoveryTombstoned = (item: DiscoveryArchiveItem, tombs: Set<string>) => {
    if (tombs.has(item.id)) return true;
    const meta = `meta:${(item.product || '').toLowerCase()}|${(item.country || '').toLowerCase()}`;
    return tombs.has(meta);
  };

  const persistHistoryItem = async (item: HistoryItem) => {
    upsertHistoryItem(item);
    historyRef.current = getHistorySnapshot();
    await persistHistoryItemToDisk(item);
  };

  /** 给记录打上当前用户归属，用于部门权限隔离 */
  const stampOwnership = <T,>(item: T): T & { ownerUsername?: string; departmentId?: string } => {
    if (!currentUser) return item;
    return {
      ...item,
      ownerUsername: currentUser.username,
      departmentId: currentUser.departmentId,
    };
  };

  const scopeForUser = <T extends { ownerUsername?: string; departmentId?: string }>(
    items: T[],
    viewer: User | null = currentUser
  ): T[] => (viewer ? filterOwnedRecords(viewer, items, users, departments) : []);

  const scopeHistory = (items: HistoryItem[]) => scopeForUser(items);
  const scopeDiscovery = (items: DiscoveryArchiveItem[]) => scopeForUser(items);
  const scopeClients = (items: Client[]) => scopeForUser(items);
  const scopeAutomation = (items: AutomationResult[]) => scopeForUser(items);

  const resetWorkspaceForUserSwitch = () => {
    userDataReadyRef.current = false;
    discoveryHydratedRef.current = false;
    crmPersistReadyRef.current = false;
    setAnalysisData(null);
    setViewingHistoryId(null);
    setDomainInput('');
    setDiscoveryState(emptyDiscoveryState());
    setDiscoveryArchives([]);
    setHistory([]);
    replaceAutomationQueue([]);
    setCrmClients([]);
    setActiveModule(ModuleType.HOME);
    setWorkspaceSyncStatus(null);
    setWorkspaceSyncing(false);
    setHistoryOpen(false);
    setErrorMsg(null);
  };
  const handleDiscoveryStateChange = (state: DiscoveryState) => {
    const next: DiscoveryState = {
      ...state,
      updatedAt: Date.now(),
    };
    setDiscoveryState(next);
    // 搜索结果一变就立刻落盘，不等登录水合后的 effect（防关客户端丢结果）
    if (currentUser && discoveryHydratedRef.current) {
      saveUserDiscoveryState(currentUser.username, next);
    }
  };

  /** 营销工具五类公式：写入偏好类别 → 跳转客户搜索 → 自动开跑（平台内，不跳外网） */
  const handlePlatformAcquisitionSearch = useCallback(
    (req: PlatformAcquisitionSearchRequest) => {
      const kw = req.productKeyword.trim();
      const country = req.country.trim();
      if (!kw) {
        setSystemNotice('请先填写产品词');
        return;
      }
      if (req.category) {
        setPreferredAcquisitionCategories([req.category]);
      } else {
        setPreferredAcquisitionCategories([
          'linkedin',
          'social',
          'amazon',
          'local_lang',
          'pdf_lists',
        ]);
      }
      setDiscoveryState((prev) => ({
        ...prev,
        product: kw,
        country: country || prev.country,
        countries: country ? [country] : prev.countries?.length ? prev.countries : [],
        results: [],
        hasSearched: false,
      }));
      setDiscoveryAutoSearchNonce((n) => n + 1);
      navigateModule(ModuleType.DISCOVERY);
      setSystemNotice(
        req.formulaTitle
          ? `已按「${req.formulaTitle}」进入客户搜索并开始平台检索`
          : req.category
            ? `已按「获客公式组」进入客户搜索并开始平台检索`
            : '已进入客户搜索，正按五类获客公式做平台检索…'
      );
    },
    [navigateModule]
  );

  /** 可靠归档：每次按国搜索完成后立刻写入本地 + 云端 */
  const handleSearchArchived = (archive: DiscoveryArchiveItem) => {
    const stamped = stampOwnership(archive);
    if (stamped.product?.trim()) addCustomKeyword(stamped.product.trim());
    (stamped.countries || []).forEach((c) => {
      const zh = normalizeCountryZh(c);
      if (zh && zh !== '未分类') addCustomCountry(zh);
    });
    saveDiscoveryArchive(stamped).catch((e) => console.error('local discovery archive failed', e));
    // 会话快照不进「记录」列表，但仍写入 IndexedDB，供下次登录恢复
    setDiscoveryArchives((list) => {
      if (isDiscoverySessionArchiveId(stamped.id)) {
        return list;
      }
      const without = list.filter((x) => x.id !== stamped.id && !isDiscoverySessionArchiveId(x.id));
      return [stamped, ...without].slice(0, 200);
    });
    if (currentUser) {
      const asState = archiveToDiscoveryState(stamped);
      // 多国合并会话 / 单国归档都立刻固化到按用户隔离的 localStorage
      if (isDiscoverySessionArchiveId(stamped.id) || (stamped.results?.length || 0) > 0) {
        saveUserDiscoveryState(currentUser.username, asState);
      }
    }
    if (isSupabaseConfigured() && !isDiscoverySessionArchiveId(stamped.id)) {
      const stateForCloud: DiscoveryState = {
        product: stamped.product,
        country: stamped.country || (stamped.countries || []).join(', '),
        countries: stamped.countries || [],
        industry: stamped.industry,
        clientType: stamped.clientType || (stamped.clientTypes || []).join(', '),
        clientTypes: stamped.clientTypes || [],
        results: stamped.results || [],
        hasSearched: true,
        updatedAt: stamped.timestamp,
      };
      saveDiscoverySearch(stateForCloud).catch((e) => console.error('Supabase discovery save failed', e));
    }
  };

  useEffect(() => {
    // 一次性解除旧默认「每日 20 次」卡死：抬高限额（用量保留，500 内仍可继续）
    try {
      updateLocalConfig({
        lastUpdated: Date.now(),
        dailyLimits: { search: 500, analysis: 500 },
        systemNotice: '',
      });
      const usage = getDailyUsagePublic();
      // 若已顶满旧限额，清零今日计数以便立即继续批量
      if (usage.analysisCount >= 20) {
        resetDailyUsage();
      }
    } catch (e) {
      console.warn('limit migrate failed', e);
    }
  }, []);

  useEffect(() => {
    // 同步本地用户 → 立刻可登录；云端迁移不挡首屏
    try {
      const local = loadUsersFromStorage();
      if (local.length) setUsers(local);
      setDepartments(loadDepartmentsFromStorage());
      // 已有 bootUser / 内存会话时不要用 restore 覆盖；仅在空会话时恢复
      if (!bootUser) {
        const restored = restoreSessionUser(local);
        if (restored) {
          setUsageScope(restored.username);
          setCurrentUser(restored);
          if (restored.role === 'admin') setHasKey(true);
        }
      } else {
        setUsageScope(bootUser.username);
        if (bootUser.role === 'admin') setHasKey(true);
      }
    } catch (e) {
      console.warn('local users bootstrap failed', e);
    }
    const loadUsers = async () => {
      try {
        const loaded = await Promise.race([
          loadUsersWithMigration(),
          new Promise<User[]>((_, reject) =>
            setTimeout(() => reject(new Error('用户同步超时')), 12_000)
          ),
        ]);
        setUsers(loaded);
        setDepartments(loadDepartmentsFromStorage());
        // 云端用户表到位后：无内存会话则按持久化会话恢复；已登录仅在「确认停用」时退出
        // （列表缺人不踢，避免同步不全误回登录页）
        setCurrentUser((prev) => {
          if (!prev) {
            if (intentionalLogoutRef.current) return null;
            return bootUser ?? restoreSessionUser(loaded);
          }
          const fresh = loaded.find(
            (u) => u.username.trim().toLowerCase() === prev.username.trim().toLowerCase()
          );
          if (!fresh) return prev;
          if (fresh.disabled) {
            clearSession();
            intentionalLogoutRef.current = true;
            return null;
          }
          return fresh;
        });
      } catch (e) {
        console.error('Failed to load users', e);
        const fallback = loadUsersFromStorage();
        if (fallback.length) setUsers(fallback);
      }
    };
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅首屏引导一次
  }, []);

  // bootUser 在而内存会话被误清空时，拉回工作台（主动退出除外）
  useEffect(() => {
    if (intentionalLogoutRef.current) return;
    if (!currentUser && bootUser) {
      setCurrentUser(bootUser);
      setUsageScope(bootUser.username);
    }
  }, [currentUser, bootUser]);

  // 登录后安装客户端防护（水印 / 禁右键扒内容）；业务「复制」按钮不受影响
  useEffect(() => {
    if (!currentUser) return;
    const handle = installClientShield(currentUser.username, {
      isAdmin: currentUser.role === 'admin',
    });
    return () => handle.dispose();
  }, [currentUser?.username, currentUser?.role]);

  // 进站后阶梯预热高频模块 chunk（idle，不抢首屏点击）
  useEffect(() => {
    if (!currentUser) return;
    prefetchCoreModules();
  }, [currentUser?.username]);

  useEffect(() => {
    const checkKey = async () => {
      if (!currentUser || currentUser.role === 'admin') return;
      // 已探测成功则不要清成 null，否则权限同步时整页闪回加载态，像被踢下线
      setHasKey((prev) => (prev === true ? true : null));
      try {
        const ok = await Promise.race([
          checkApiKeyAvailability(),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(hasApiKeyConfigured()), 8_000)
          ),
        ]);
        setHasKey(ok);
      } catch {
        setHasKey(hasApiKeyConfigured());
      }
    };
    checkKey();
  }, [currentUser?.username, currentUser?.role]);

  const lastWorkspaceUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      userDataReadyRef.current = false;
      discoveryHydratedRef.current = false;
      crmPersistReadyRef.current = false;
      lastWorkspaceUserRef.current = null;
      return;
    }

    // 每次登录立刻安静：禁止任何自动后台（同步/队列/补全），除非用户之后手动开挂机
    shouldStopRef.current = true;
    autoResumeBatchOnceRef.current = false;
    setHeavyWorkSuspended(true);
    const quietStop = () => {
      try {
        setWorkerModeActive(false);
        setWorkerModeOn(false);
        stopAllBackgroundWork();
        setHeavyWorkSuspended(true);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('trade_scout_auto_resume_batch', '0');
        }
      } catch (e) {
        console.warn('[boot] quiet-stop failed', e);
      }
    };
    quietStop();
    const quietStopTimer = window.setTimeout(quietStop, 0);

    // 切换账号时清空工作区；同账号 StrictMode 二次挂载仍会重新拉取
    if (lastWorkspaceUserRef.current !== currentUser.username) {
      lastWorkspaceUserRef.current = currentUser.username;
      resetWorkspaceForUserSwitch();
    }

    let cancelled = false;
    /** 让出主线程，保证侧栏点击先被处理 */
    const yieldToUi = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.setTimeout(resolve, 0);
        });
      });
    /** 用户正在点选/打字时，登录后重同步必须停住，否则一分钟内整页假死 */
    const waitIfUserBusy = async (maxWaitMs = 120_000) => {
      try {
        const { waitUntilWorkAllowed } = await import('./services/backgroundWorkScheduler');
        await waitUntilWorkAllowed(() => cancelled, maxWaitMs);
      } catch {
        /* ignore */
      }
      await yieldToUi();
    };
    let lastSyncStatusAt = 0;
    const reportSyncStatus = (msg: string, force = false) => {
      if (cancelled) return;
      const now = Date.now();
      // 同步进度刷 App setState 会拖死当前模块（含产品 AI 视频）；节流
      if (!force && now - lastSyncStatusAt < 2800) return;
      lastSyncStatusAt = now;
      setWorkspaceSyncStatus(msg);
    };

    const depts = () => (departments.length ? departments : loadDepartmentsFromStorage());
    const scope = <T extends { ownerUsername?: string; departmentId?: string }>(items: T[]) =>
      filterOwnedRecords(currentUser, items, users, depts());

    const loadData = async () => {
        try {
            // 首帧先让出：侧栏必须可点，再慢慢灌本机数据
            await yieldToUi();
            if (cancelled) return;

            // 1. 本机数据优先上屏（CRM / 历史），云同步放到后面，避免登录空白卡顿
            // CRM：先 hydrate IndexedDB，避免同步 JSON.parse 大库卡死
            await hydrateCrmClientsCache();
            await yieldToUi();
            if (cancelled) return;
            const h = await getHistory();
            await yieldToUi();
            if (!cancelled) {
              try {
                const earlyCrm = filterOutCrmTombstones(loadAllCrmClients());
                await yieldToUi();
                if (cancelled) return;
                const migratedEarly = migrateLegacyCrmOwnership(earlyCrm, users, depts());
                // 进站跳过重的域名去重写盘；大列表降优先级，保证侧栏可点
                startTransition(() => {
                  setCrmClients(scope(migratedEarly.clients));
                });
              } catch (e) {
                console.warn('[CRM] cache-first paint failed', e);
              }
              await yieldToUi();
              if (cancelled) return;
              try {
                const restored = applyDmPersistToHistory(h);
                const migratedHistQuick = migrateLegacyOwnership(restored, users, depts());
                startTransition(() => {
                  setHistory(scope(migratedHistQuick.items));
                });
              } catch (e) {
                console.warn('[history] cache-first paint failed', e);
                if (!cancelled) {
                  startTransition(() => setHistory(scope(h)));
                }
              }
              await yieldToUi();
              if (cancelled) return;
              try {
                const tombs = readDiscoveryTombstones();
                const localDisc = await getDiscoveryArchives();
                const discLocal = localDisc
                  .filter((i) => !isDiscoveryTombstoned(i, tombs))
                  .sort((a, b) => b.timestamp - a.timestamp);
                const migratedDisc = migrateLegacyOwnership(discLocal, users, depts());
                const ownedLocal = scope(migratedDisc.items);
                const forUi = ownedLocal.filter((i) => !isDiscoverySessionArchiveId(i.id));
                setDiscoveryArchives(forUi);
                // 必须优先本机会话；禁止用旧归档覆盖并写回 localStorage
                const restored = resolveDiscoveryStateOnLogin(currentUser.username, ownedLocal);
                setDiscoveryState(restored);
                discoveryHydratedRef.current = true;
              } catch (e) {
                console.warn('[discovery] cache-first paint failed', e);
                try {
                  const restored = resolveDiscoveryStateOnLogin(currentUser.username, []);
                  setDiscoveryState(restored);
                } catch {
                  /* ignore */
                }
                discoveryHydratedRef.current = true;
              }
              userDataReadyRef.current = true;
              crmPersistReadyRef.current = true;
              reportSyncStatus('本机资料已就绪。云端同步请手动点「同步全部资料」。', true);
            }

            // 默认禁止登录后自动云同步 / FOB / 空闲整理（会卡死演示与日常操作）
            if (!isAutoBackgroundAllowed()) {
              try {
                const repairedLite = await loadAndRepairAutomationQueue(currentUser);
                if (!cancelled) setAutomationResultsDeferred(scope(repairedLite.tasks));
              } catch (e) {
                console.warn('[boot] local queue load skipped sync', e);
              }
              if (!cancelled) {
                setWorkspaceSyncing(false);
                stopAllBackgroundWork();
                setHeavyWorkSuspended(true);
              }
              return;
            }

            // —— 以下仅挂机模式才会跑 ——
            // 再让出一段时间，优先响应菜单（进站后前几秒几乎只服务点击）
            await new Promise<void>((r) => window.setTimeout(r, 4200));
            if (cancelled) return;
            await waitIfUserBusy();
            if (cancelled) return;

            const repaired = await loadAndRepairAutomationQueue(currentUser);
            if (repaired.repaired || repaired.claimed) {
              console.info(
                `[automation] repaired ids=${repaired.repaired}, claimed orphans=${repaired.claimed}, total=${repaired.tasks.length}`
              );
            }
            // 登录后延后全量云同步，避免堵死侧栏
            let queueTasks = repaired.tasks;
            /** workspace 一次 pull 已合并 CRM/历史时，跳过后面二次全量拉取 */
            let workspacePulledOk = false;
            if (!cancelled) setWorkspaceSyncing(true);
            if (isSupabaseConfigured()) {
              try {
                await waitIfUserBusy();
                if (cancelled) return;
                const ws = await syncAllWorkspaceData({
                  upload: false,
                  timeoutMs: 3 * 60_000,
                  onProgress: (msg) => {
                    reportSyncStatus(msg);
                  },
                });
                // 仅当 CRM/历史都合并成功时跳过二次全量拉取；有错则走后面兜底
                workspacePulledOk =
                  !ws.errors.some((e) => /CRM|背调历史/.test(e)) &&
                  (ws.crm.merged > 0 || ws.crm.local > 0 || ws.history.merged > 0 || ws.history.local > 0);
                console.info('[workspace-sync pull]\n' + formatWorkspaceSyncReport(ws));
                // 可选：合并云端「额度耗尽」指纹，避免多机抢同一把已尽 Key
                try {
                  const { refreshExhaustedFromCloud } = await import('./services/apiKeyPool');
                  await Promise.allSettled(
                    (['qwen', 'gemini', 'tavily', 'anymailfinder'] as const).map((p) =>
                      refreshExhaustedFromCloud(p)
                    )
                  );
                } catch {
                  /* ignore */
                }
                if (!cancelled) {
                  reportSyncStatus(
                    `已同步 CRM ${ws.crm.merged}（云 ${ws.crm.cloud}）· 作业 ${ws.automation.merged}（云 ${ws.automation.cloud}）· 历史 ${ws.history.merged}`,
                    true
                  );
                  await waitIfUserBusy();
                  if (cancelled) return;
                  // 云同步写入本机后，刷新 CRM / 作业 / 历史到界面（全量合并后再按权限过滤）
                  try {
                    const afterSyncAll = loadAllCrmClients();
                    reconcileCrmTombstonesWithLiveClients(afterSyncAll);
                    const afterSyncCrm = filterOutCrmTombstones(afterSyncAll);
                    const migratedAfter = migrateLegacyCrmOwnership(afterSyncCrm, users, depts());
                    startTransition(() => {
                      setCrmClients(scope(migratedAfter.clients));
                    });
                  } catch {
                    /* ignore */
                  }
                  try {
                    const histAfter = applyDmPersistToHistory(await getHistory());
                    const histScoped = scope(
                      migrateLegacyOwnership(histAfter, users, depts()).items
                    );
                    startTransition(() => {
                      setHistory(histScoped);
                    });
                  } catch {
                    /* ignore */
                  }
                }
                const qAfter = await getAutomationQueue();
                if (qAfter.length) queueTasks = qAfter;
                void syncAllWorkspaceData({
                  upload: true,
                  timeoutMs: 6 * 60_000,
                  onProgress: (msg) => {
                    reportSyncStatus(msg);
                  },
                })
                  .then(async (up) => {
                    console.info('[workspace-sync upload]\n' + formatWorkspaceSyncReport(up));
                    if (cancelled) return;
                    reportSyncStatus(
                      `资料已就绪 · CRM ${up.crm.merged} · 作业 ${up.automation.merged}（云端作业 ${up.automation.cloud}）`,
                      true
                    );
                    await waitIfUserBusy();
                    if (cancelled) return;
                    try {
                      const q = await getAutomationQueue();
                      setAutomationResultsDeferred(scope(q));
                    } catch {
                      /* ignore */
                    }
                    try {
                      const afterUp = filterOutCrmTombstones(loadAllCrmClients());
                      startTransition(() => {
                        setCrmClients(
                          scope(migrateLegacyCrmOwnership(afterUp, users, depts()).clients)
                        );
                      });
                    } catch {
                      /* ignore */
                    }
                  })
                  .catch((e) => console.warn('[workspace-sync upload] failed', e));
              } catch (e) {
                console.warn('[workspace-sync] failed, fallback automation-only', e);
                try {
                  const synced = await pullMergePushAutomationQueue({ upload: false });
                  queueTasks = synced.tasks;
                  reportSyncStatus(`作业队列已同步 ${synced.merged} 条`, true);
                } catch (e2) {
                  console.warn('[automation-cloud] sync failed', e2);
                  reportSyncStatus('云端同步稍后重试', true);
                }
              }
            } else if (!cancelled) {
              reportSyncStatus('本机模式（未配置云端）', true);
            }
            if (!cancelled) setWorkspaceSyncing(false);
            await waitIfUserBusy();
            if (cancelled) return;
            const scopedQueue = scope(queueTasks);
            // 大队列必须瘦身+降优先级，否则侧栏点击会被 React 更新饿死
            if (!cancelled) setAutomationResultsDeferred(scopedQueue);
            const files = await getAllFilesFromDB();
            if (!cancelled) setKbCount(files.length);

            // 搜索归档：本地 + 云端合并（排除已删除墓碑）→ 再按归属过滤
            let ownedArchives: DiscoveryArchiveItem[] = [];
            try {
              await waitIfUserBusy();
              if (cancelled) return;
              const tombs = readDiscoveryTombstones();
              const localDisc = await getDiscoveryArchives();
              let cloudDisc: DiscoveryArchiveItem[] = [];
              if (isSupabaseConfigured()) {
                cloudDisc = await getDiscoverySearchArchives();
              }
              const map = new Map<string, DiscoveryArchiveItem>();
              [...cloudDisc, ...localDisc]
                .filter((i) => !isDiscoveryTombstoned(i, tombs))
                .forEach((i) => map.set(i.id, i));
              const discAll = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
              const migratedDisc = migrateLegacyOwnership(discAll, users, depts());
              ownedArchives = scope(migratedDisc.items);
              if (!cancelled) {
                setDiscoveryArchives(
                  ownedArchives.filter((i) => !isDiscoverySessionArchiveId(i.id))
                );
              }
            } catch (e) {
              console.warn('discovery archives load failed', e);
            }

            // 恢复「当前用户自己的」搜索界面（禁止拉取全局 latest，避免串号）
            // 再次 resolve：合并云端后可能有更新；仍优先本机较新会话，避免旧云端结果盖掉
            if (!cancelled) {
              const restored = resolveDiscoveryStateOnLogin(currentUser.username, ownedArchives);
              setDiscoveryState(restored);
              discoveryHydratedRef.current = true;
            }

            // 背调归类修复：尽量从报告 searchKeyword 回填关键词；规范化国家为中文（不再强制 Car toy）
            await waitIfUserBusy();
            if (cancelled) return;
            addCustomCountry('波兰');
            addCustomCountry('荷兰');
            addCustomCountry('英国');
            addCustomCountry('美国');
            // 批量回填，避免登录时逐条 await IndexedDB 拖死主路径
            const fixedHistory: HistoryItem[] = [];
            const dirtyHistory: HistoryItem[] = [];
            for (const item of h) {
              const hq = item.data?.companyInfo?.headquarters || item.data?.companyInfo?.city || '';
              const normCountry = normalizeCountryZh(item.country || hq);
              const recoveredKw =
                item.keyword?.trim() ||
                item.data?.searchKeyword?.trim() ||
                '';
              if (recoveredKw) addCustomKeyword(recoveredKw);
              const needKeyword = !item.keyword?.trim() && !!recoveredKw;
              const needCountry = normCountry !== '未分类' && item.country !== normCountry;
              if (needKeyword || needCountry) {
                const next: HistoryItem = {
                  ...item,
                  keyword: item.keyword?.trim() || recoveredKw || undefined,
                  country: normCountry !== '未分类' ? normCountry : item.country,
                  data: item.data
                    ? {
                        ...item.data,
                        searchKeyword: item.data.searchKeyword || recoveredKw || undefined,
                      }
                    : item.data,
                };
                dirtyHistory.push(next);
                fixedHistory.push(next);
            } else {
                fixedHistory.push(item);
              }
            }
            if (dirtyHistory.length) {
              void saveHistoryBulk(dirtyHistory).catch((e) =>
                console.warn('history backfill bulk failed', e)
              );
            }
            const historyForRecover = fixedHistory;

            const knownDomains = new Set(
              historyForRecover.map((i) => (i.domain || i.data?.companyInfo?.website || '').toLowerCase()).filter(Boolean)
            );
            const recovered: HistoryItem[] = [];
            // 只从「当前用户可见」的任务队列回收历史，避免把别人的背调盖上自己名字
            let recoverYieldEvery = 0;
            for (const task of scopedQueue) {
              if (task.status !== 'completed' || !task.analysis) continue;
              const domain = (
                task.analysis.companyInfo?.website ||
                task.website ||
                task.clientName ||
                ''
              ).toLowerCase();
              if (!domain || knownDomains.has(domain)) continue;
              const hq = task.analysis.companyInfo?.headquarters || '';
              const kw = task.keyword || task.analysis.searchKeyword || '';
              if (kw) addCustomKeyword(kw);
              const item: HistoryItem = stampOwnership({
                id: `recover_${task.id}`,
                type: ModuleType.BACKGROUND,
                data: {
                  ...task.analysis,
                  searchKeyword: task.analysis.searchKeyword || kw || undefined,
                },
                timestamp: Date.now() - recovered.length,
                domain: task.analysis.companyInfo?.website || task.website || task.clientName,
                keyword: kw || undefined,
                country: normalizeCountryZh(task.country || hq),
                source: 'recover',
              });
              try {
                await persistHistoryItem(item);
                recovered.push(item);
                knownDomains.add(domain);
              } catch (e) {
                console.warn('Recover history failed', e);
              }
              recoverYieldEvery += 1;
              if (recoverYieldEvery % 8 === 0) {
                await waitIfUserBusy();
                if (cancelled) return;
              }
            }
            const recoveredAll = [...recovered, ...historyForRecover];
            const migratedHist = migrateLegacyOwnership(recoveredAll, users, depts());
            if (migratedHist.changed) {
              const before = new Map(recoveredAll.map((h) => [h.id, h]));
              for (const item of migratedHist.items) {
                const prev = before.get(item.id);
                if (
                  prev &&
                  ((prev.departmentId || '') !== (item.departmentId || '') ||
                    (prev.ownerUsername || '') !== (item.ownerUsername || ''))
                ) {
                  void persistHistoryItem(item).catch((e) =>
                    console.warn('history ownership backfill failed', e)
                  );
                }
              }
            }
            if (!cancelled) {
              const restored = applyDmPersistToHistory(migratedHist.items);
              // ledger 比本地新时回写 IndexedDB，刷新后仍保留「已挖」
              for (const item of restored) {
                const before = migratedHist.items.find((x) => x.id === item.id);
                if (
                  before &&
                  (item.data?.decisionMakerEmailSearchAt || 0) >
                    (before.data?.decisionMakerEmailSearchAt || 0)
                ) {
                  void persistHistoryItem(item).catch(() => undefined);
                }
              }
              setHistory(scope(restored));
            }

            const ghStatus = checkGitHubStatus();
            if (!cancelled) setIsGitHubConnected(ghStatus.ok);

            // 全量本机作合并底（勿先按墓碑裁剪，否则 saveAll 会把「误墓碑但仍在本机」的客户永久冲掉）
            let nextCrm: Client[] = loadAllCrmClients();

            if (currentUser && isSupabaseConfigured()) {
                // 管理员与员工均从云端拉 Key，避免桌面客户端 / 新浏览器看到空配置
                const apiReady = await hydrateApiConfigsFromCloud();
                if (!cancelled && currentUser.role !== 'admin' && apiReady) setHasKey(true);
                // 排除名单：管理员与普通用户都同步，搜索时跳过非目标客户
                hydrateExcludedCompaniesFromCloud().catch((e) =>
                  console.warn('excluded companies hydrate failed', e)
                );

                if (!cancelled) setIsKBSyncing(true);
                try {
                    const { files: cloudFiles, error } = await getKnowledgeFiles();
                    if (error) console.warn('KB cloud sync:', error);
                    if (cloudFiles.length > 0) {
                        for (const f of cloudFiles) { await saveFileToDB(f); }
                    }
                    const allFiles = await getAllFilesFromDB();
                    if (!cancelled) setKbCount(allFiles.length);
                } catch (e) {
                    console.error("Supabase KB Sync failed", e);
                } finally {
                    if (!cancelled) setIsKBSyncing(false);
                }

                // workspace 已 pull 过则跳过二次全量历史/CRM，只做本机 ledger 重放
                if (!workspacePulledOk) {
                  try {
                      const cloudHistory = await getInvestigationHistory();
                      if (cloudHistory.length > 0) {
                          const localNow = await getHistory();
                          const merged = migrateLegacyOwnership(
                            applyDmPersistToHistory(
                              mergeHistoryPreferDmRich(localNow, cloudHistory)
                            ),
                            users,
                            depts()
                          ).items;
                          const histRicher = (x?: HistoryItem | null, y?: HistoryItem | null) => {
                            if (!x) return false;
                            if (!y) return true;
                            const dmBetter =
                              (x.data?.decisionMakerEmailSearchAt || 0) >
                                (y.data?.decisionMakerEmailSearchAt || 0) ||
                              (x.data?.decisionMakers?.length || 0) >
                                (y.data?.decisionMakers?.length || 0);
                            const productBetter =
                              hasRichProductCatalog(x.data) && !hasRichProductCatalog(y.data);
                            const productMore =
                              (x.data?.products?.length || 0) > (y.data?.products?.length || 0) ||
                              (x.data?.websiteCategories?.length || 0) >
                                (y.data?.websiteCategories?.length || 0);
                            return dmBetter || productBetter || productMore;
                          };
                          for (const item of merged) {
                            const local = localNow.find((x) => x.id === item.id);
                            const cloud = cloudHistory.find((x) => x.id === item.id);
                            if (histRicher(item, local)) {
                              try {
                                await saveHistory(item);
                              } catch (e) {
                                console.warn('[history] merge save local failed', e);
                              }
                            }
                            if (cloud && histRicher(item, cloud) && isSupabaseConfigured()) {
                              void saveInvestigationHistory(item).catch((e) =>
                                console.warn('[history] merge save cloud failed', e)
                              );
                            }
                          }
                          if (!cancelled) {
                            setHistory(scope(merged));
                          }
                      } else {
                        const localNow = await getHistory();
                        if (!cancelled) {
                          setHistory(scope(applyDmPersistToHistory(localNow)));
                        }
                      }
                  } catch (e) {
                      console.error("Supabase history sync failed", e);
                  }
                } else {
                  try {
                    const localNow = await getHistory();
                    if (!cancelled) {
                      setHistory(scope(applyDmPersistToHistory(localNow)));
                    }
                  } catch {
                    /* ignore */
                  }
                }

                try {
                  const cloudProfiles = await getProductProfilesCloud();
                  if (cloudProfiles.length > 0) {
                    await saveProductProfilesBulk(cloudProfiles);
                  }
                } catch (e) {
                  console.warn('product profiles cloud sync failed', e);
                }

                // 注意：不再调用 getLatestDiscoverySearch()——那是全局最新一条，会造成跨用户串数据

                if (!workspacePulledOk) {
                  try {
                      const cloudCrm = await getCrmClients();
                      if (cloudCrm.length > 0) {
                        nextCrm = mergeClientsById(nextCrm, cloudCrm);
                        reconcileCrmTombstonesWithLiveClients(nextCrm);
                      }
                  } catch (e) {
                      console.error("Supabase CRM sync failed", e);
                  }
                }
            }

            // FOB / 产品画像：登录后至少 20 秒再跑，且必须等用户停手
            window.setTimeout(() => {
              if (cancelled) return;
              void (async () => {
                try {
                  await waitIfUserBusy();
                  if (cancelled) return;
                  const histNow = await getHistory();
                  if (!histNow.length) return;
                  try {
                    const { recomputeAllStoredFobPrices } = await import('./services/fobPriceRecompute');
                    const mig = await recomputeAllStoredFobPrices({
                      history: histNow,
                      onHistoryUpdated: (items) => {
                        if (!cancelled) setHistory(scope(items));
                      },
                    });
                    if (mig.historyTouched > 0) {
                      console.log(
                        `[fob] recompute done: history=${mig.historyTouched}, products=${mig.productsTouched}`
                      );
                    }
                  } catch (e) {
                    console.warn('FOB library recompute failed', e);
                  }
                  await waitIfUserBusy();
                  if (cancelled) return;
                  const histAfter = await getHistory();
                  const existingProfiles = await loadProductCatalog();
                  if (existingProfiles.length === 0) {
                    await rebuildProductCatalogFromHistory(histAfter, {
                      ownerUsername: currentUser.username,
                      departmentId: currentUser.departmentId,
                    });
                  } else {
                    await backfillProductCatalogFromHistory(histAfter, {
                      ownerUsername: currentUser.username,
                      departmentId: currentUser.departmentId,
                    });
                  }
                } catch (e) {
                  console.warn('product catalog bootstrap failed', e);
                }
              })();
            }, 20_000);

            if (ghStatus.ok && currentUser) {
                try {
                    const globalConfig = await fetchGlobalConfig();
                    if (globalConfig) {
                        updateLocalConfig(globalConfig);
                        if (!cancelled && globalConfig.systemNotice) setSystemNotice(globalConfig.systemNotice);
                    }
                } catch(e) {
                    console.warn("Failed to load global config", e);
                } 
                
                if (!isSupabaseConfigured()) {
                    if (!cancelled) setIsKBSyncing(true);
                try {
                    const cloudFiles = await fetchDocumentsFromRepo();
                    if (cloudFiles.length > 0) {
                        for (const f of cloudFiles) { await saveFileToDB(f); }
                        const allFiles = await getAllFilesFromDB();
                            if (!cancelled) setKbCount(allFiles.length);
                    }
                } catch (e) {
                    console.error("Auto KB Sync failed", e);
                } finally {
                        if (!cancelled) setIsKBSyncing(false);
                    }
                }

                try {
                const cloudCRM = await fetchCRMFromCloud();
                  if (cloudCRM.length > 0) {
                    nextCrm = mergeClientsById(nextCrm, cloudCRM);
                    reconcileCrmTombstonesWithLiveClients(nextCrm);
                  }
                } catch (e) {
                  console.warn('GitHub CRM sync failed', e);
                }

                try {
                  const historyUsers = new Set<string>([currentUser.username]);
                  if (canBrowseAllDepartments(currentUser)) {
                    users.forEach((u) => {
                      if ((u.username || '').trim()) historyUsers.add(u.username.trim());
                    });
                  } else if (currentUser.role === 'manager') {
                    const deptId =
                      currentUser.departmentId ||
                      departments.find((d) =>
                        (d.managerUsername || '').trim().toLowerCase() ===
                        currentUser.username.trim().toLowerCase()
                      )?.id;
                    getDepartmentMemberUsernames(deptId, users).forEach((u) => historyUsers.add(u));
                  }
                  const collected: HistoryItem[] = [];
                  for (const uname of historyUsers) {
                    try {
                      const part = await fetchUserHistoryFromCloud(uname);
                      if (part.length) collected.push(...part);
                    } catch (e) {
                      console.warn('GitHub history fetch failed for', uname, e);
                    }
                  }
                  if (collected.length > 0) {
                      const existingIds = new Set(
                        (historyRef.current.length ? historyRef.current : h).map((i) => i.id)
                      );
                      const byId = new Map<string, HistoryItem>();
                      collected.forEach((item) => {
                        if (!item?.id) return;
                        const prev = byId.get(item.id);
                        if (!prev || (item.timestamp || 0) >= (prev.timestamp || 0)) {
                          byId.set(item.id, item);
                        }
                      });
                      const newItems = [...byId.values()].filter((i) => !existingIds.has(i.id));
                    if (newItems.length > 0) {
                          const migratedNew = migrateLegacyOwnership(newItems, users, depts()).items;
                          for (const item of migratedNew) await persistHistoryItem(item);
                          if (!cancelled) {
                            setHistory((prev) =>
                              scope(
                                migrateLegacyOwnership([...migratedNew, ...prev], users, depts()).items
                              )
                            );
                          }
                      }
                  }
                } catch (e) {
                  console.warn('GitHub history sync failed', e);
                }
                
                try {
                const apiKeys = await fetchApiConfigsFromCloud();
                if (apiKeys.length > 0) {
                    localStorage.setItem('trade_scout_api_configs', JSON.stringify(apiKeys));
                      if (!cancelled) setHasKey(hasApiKeyConfigured());
                  }
                } catch (e) {
                  console.warn('GitHub API config sync failed', e);
                }
            }

            // 已禁用登录时自动清理（曾误用跟进日期导致全库被删）

            if (nextCrm.length === 0) {
              try {
                let recovered: Client[] = [];
                let source = '';
                try {
                  const ghCrm = await fetchCRMFromCloud();
                  if (ghCrm.length > 0) {
                    // CRM 已空：视为恢复场景，清墓碑后再用云端数据（避免误删墓碑挡恢复）
                    clearCrmTombstonesForClients(ghCrm);
                    recovered = ghCrm;
                    source = 'GitHub 云端备份';
                  }
                } catch (e) {
                  console.warn('[CRM] GitHub recovery fetch failed', e);
                }
                if (!recovered.length && isSupabaseConfigured()) {
                  try {
                    const sbCrm = await getCrmClients();
                    if (sbCrm.length > 0) {
                      clearCrmTombstonesForClients(sbCrm);
                      recovered = sbCrm;
                      source = 'Supabase 云端';
                    }
                  } catch (e) {
                    console.warn('[CRM] Supabase recovery fetch failed', e);
                  }
                }
                if (!recovered.length) {
                  const histNow = await getHistory();
                  if (histNow.length > 0) {
                    const rebuilt = mergeHistoryItemsIntoCrm([], histNow, stampOwnership);
                    if (rebuilt.clients.length > 0) {
                      clearCrmTombstonesForClients(rebuilt.clients);
                      recovered = rebuilt.clients;
                      source = '背调历史记录';
                    }
                  }
                }
                if (recovered.length > 0) {
                  console.info(`[CRM] auto-recovered ${recovered.length} clients from ${source}`);
                  nextCrm = recovered;
                }
              } catch (e) {
                console.warn('[CRM] auto recovery failed', e);
              }
            }

            // 合并后清误墓碑；展示层再挡「用户明确删除」的复活（不删云端）
            reconcileCrmTombstonesWithLiveClients(nextCrm);

            // 进站不做整表品类回填 / 域名去重（两千+ 客户会卡死主线程）；延后空闲整理
            if (!cancelled) {
              await waitIfUserBusy();
              if (cancelled) return;
              // 旧 CRM 回填部门，便于本部门主管按规则看到历史客户
              const migrated = migrateLegacyCrmOwnership(nextCrm, users, depts());
              nextCrm = migrated.clients;
              // 全库写入 union 结果（含曾被误墓碑隐藏的行）；禁止用可见切片覆盖全库
              if (nextCrm.length > 0) {
                saveAllCrmClients(nextCrm);
              }
              const filteredCrm = scope(filterOutCrmTombstones(nextCrm));
              setCrmClients(filteredCrm);
              crmPersistReadyRef.current = true;
              userDataReadyRef.current = true;

              const snapshotForIdle = nextCrm;
              window.setTimeout(() => {
                if (cancelled) return;
                void (async () => {
                  try {
                    await waitIfUserBusy();
                    if (cancelled) return;
                    const histForCrm = await getHistory();
                    const reconciled = reconcileCrmProductTypesFromHistory(
                      snapshotForIdle,
                      histForCrm
                    );
                    let idleCrm = reconciled.changed > 0 ? reconciled.clients : snapshotForIdle;
                    if (reconciled.changed > 0) {
                      console.info(
                        `[CRM] reconciled product types from history: ${reconciled.changed}`
                      );
                    }
                    // 大库跳过自动域名去重；仅中小库空闲合并
                    if (idleCrm.length <= 800) {
                      const deduped = applyCrmDomainDedupe(idleCrm, {
                        deleteCloudLosers: false,
                      });
                      if (deduped.removedCount > 0) {
                        console.info(
                          `[CRM] idle domain dedupe: groups=${deduped.mergedGroups} removed=${deduped.removedCount}`
                        );
                        idleCrm = deduped.clients;
                      }
                    }
                    if (cancelled) return;
                    if (idleCrm !== snapshotForIdle) {
                      saveAllCrmClients(idleCrm);
                      setCrmClients(scope(filterOutCrmTombstones(idleCrm)));
                    }
                  } catch (e) {
                    console.warn('[CRM] idle reconcile/dedupe failed', e);
                  }
                })();
              }, 45_000);
            }
        } catch (e) {
            console.error("Sync Error", e);
            if (!cancelled) {
              crmPersistReadyRef.current = true;
              userDataReadyRef.current = true;
            }
        }
    };

    void loadData();
    return () => {
      cancelled = true;
      window.clearTimeout(quietStopTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅账号切换时全量加载；users/depts 由下方重过滤
  }, [currentUser?.username]);

  // 组织架构变化后，按最新权限重过滤内存中的业务数据（不重新拉库，避免闪屏）
  // 注意：不得在过滤时丢掉「刚写入、尚未带归属字段」的本地新增；无归属项对非管理员会被隐藏，
  // 因此加载阶段已做认领修复。此处仅过滤，不写库。
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current) return;
    const depts = departments.length ? departments : loadDepartmentsFromStorage();
    setHistory((prev) =>
      filterOwnedRecords(
        currentUser,
        applyDmPersistToHistory(migrateLegacyOwnership(prev, users, depts).items),
        users,
        depts
      )
    );
    syncAutomationResults((prev) => {
      // 员工：无归属项打上本人以免被权限滤掉；admin/总管可看无归属，禁止改写成自己
      const stamped = canBrowseAllDepartments(currentUser)
        ? prev
        : prev.map((t) =>
            !t.ownerUsername && !t.departmentId
              ? { ...t, ownerUsername: currentUser.username, departmentId: currentUser.departmentId }
              : t
          );
      return filterOwnedRecords(
        currentUser,
        migrateLegacyOwnership(stamped, users, depts).items,
        users,
        depts
      );
    });
    setDiscoveryArchives((prev) =>
      filterOwnedRecords(
        currentUser,
        migrateLegacyOwnership(prev, users, depts).items,
        users,
        depts
      )
    );
    setCrmClients((prev) => filterOwnedRecords(currentUser, prev, users, depts));
  }, [users, departments, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const fresh = users.find(
      (u) => u.username.trim().toLowerCase() === currentUser.username.trim().toLowerCase()
    );
    if (!fresh) {
      // 用户表非空却找不到当前账号：可能是云端误覆盖，不立刻踢下线
      return;
    }
    if (fresh.disabled) {
      intentionalLogoutRef.current = true;
      clearSession();
      setCurrentUser(null);
      try {
        onBootLogout?.();
      } catch {
        /* ignore */
      }
      return;
    }
    // 仅在权限/设备相关字段变化时同步，避免与 currentUser 循环 setState 卡死
    const finger = (u: typeof fresh) =>
      [
        u.role,
        u.departmentId || '',
        u.disabled ? '1' : '0',
        u.deviceBindRequired === true ? '1' : u.deviceBindRequired === false ? '0' : 'd',
        JSON.stringify(u.permissions || []),
        JSON.stringify(u.boundDevices || []),
        JSON.stringify(u.accessSchedule || null),
      ].join('|');
    if (finger(fresh) !== finger(currentUser)) {
      setCurrentUser(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意不依赖 currentUser，防止同步循环
  }, [users]);

  useEffect(() => {
    if (!currentUser) {
      setKeyResolutionContext({});
      return;
    }
    setKeyResolutionContext({
      username: currentUser.username,
      role: currentUser.role,
      departmentId: currentUser.departmentId,
    });
    if (currentUser.departmentId) {
      void hydrateDeptApiKeysFromCloud(currentUser.departmentId);
    }
  }, [currentUser?.username, currentUser?.role, currentUser?.departmentId]);

  // CRM 落盘 / 云同步已迁入 crmStore idle writer

  // 按用户隔离保存当前搜索界面，避免换账号串结果（须等水合完成，防旧归档冲掉新结果）
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current || !discoveryHydratedRef.current) return;
    saveUserDiscoveryState(currentUser.username, discoveryState);
  }, [discoveryState, currentUser]);

  useEffect(() => {
      if (users.length > 0) {
          // 保持本地缓存；不 bump 时间戳，避免覆盖云端较新账号
          saveUsersToStorage(users, getUsersUpdatedAt() || Date.now());
          }
  }, [users]);

  const handleManualConnect = async () => {
      if (!manualToken || !manualOwner || !manualRepo) {
          alert("请填写所有字段 (Token, Owner, Repo)");
          return;
      }
      setManualGitHubConfig(manualToken, manualOwner, manualRepo);
      
      const check = checkGitHubStatus();
      if (check.ok) {
          alert("连接成功！即将同步数据...");
          setCloudModalOpen(false);
          window.location.reload(); 
      } else {
          alert("连接失败，请检查凭证。");
      }
  };

  const handleAnalyzeInput = (input: string = domainInput) => {
      if (!input.trim()) return;
      const lines = input.split(/[\n;]+/).map(s => s.trim()).filter(s => s.length > 0);
      if (lines.length === 1) {
          if (!hasPermission(currentUser, 'feature.analyze_company')) {
            alert('你没有「单次背调」权限，请联系管理员或部门主管开通。');
            return;
          }
          const limit = checkLimit('analysis');
          if (!limit.allowed) { alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`); return; }
          performSingleAnalysis(lines[0]);
      } else {
          if (!hasPermission(currentUser, 'feature.batch_analyze')) {
            alert('你没有「批量背调」权限，请联系管理员或部门主管开通。');
            return;
          }
          setPendingBatch(lines);
          setPendingBatchContext('Manual Input');
          setPendingBatchCountries({});
          setBatchModalOpen(true);
      }
  };

  /** 单次/再次背调：一律进后台队列，不挡当前页面操作 */
  const enqueueBackgroundAnalysis = async (
    domain: string,
    override?: {
      searchKeyword?: string;
      searchTags?: string[];
      searchCountry?: string;
      mode?: 'detailed' | 'economy';
      /** 用户已确认「再次背调」时跳过库内复用 */
      force?: boolean;
    }
  ) => {
    if (!hasPermission(currentUser, 'feature.analyze_company') && !hasPermission(currentUser, 'feature.batch_analyze')) {
      alert('你没有背调权限，请联系管理员或部门主管开通。');
      return;
    }
    const target = (domain || '').trim();
    if (!target) {
      alert('请先填写公司网址或名称');
      return;
    }

    // 库内已有背调：不重跑全量，仅提示；缺口交给夜间补全 / 产品深挖
    if (!override?.force) {
      const existing = lookupBackgroundCheck(
        target,
        target,
        historyRef.current,
        crmClientsRef.current
      );
      if (existing.checked) {
        const hist = existing.historyItem;
        if (hist?.data) {
          setCrmClients((prev) => mergeHistoryItemsIntoCrm(prev, [hist], stampOwnership).clients);
        }
        const when = existing.checkedAt
          ? new Date(existing.checkedAt).toLocaleDateString('zh-CN')
          : '较早前';
        alert(
          `「${target}」库内已有背调（${when}），已跳过全量分析以节省额度与时间。\n` +
            `如需补联系人/邮箱/品类，夜间 22:00–08:00 会自动补全；也可在客户管理中单独深挖。`
        );
        if (hist?.data) {
          const enriched = enrichAnalysisDecisionMakers(hist.data, { historyItem: hist });
          setAnalysisData(enriched);
          setViewingHistoryId(hist.id);
          maybeEnqueueLibraryFirstDmFill(enriched, hist.id);
        }
        return;
      }
    }

    const limit = checkLimit('analysis');
    if (!limit.allowed) {
      alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`);
      return;
    }
    const kw = (override?.searchKeyword || discoveryState.product || '').trim();
    if (kw) addCustomKeyword(kw);
    const countryHint = (
      override?.searchCountry ||
      discoveryState.countries?.[0] ||
      discoveryState.country ||
      ''
    ).trim();
    const specificCountry = /^(global|worldwide|international|国际|全球|不限)$/i.test(countryHint)
      ? ''
      : countryHint;
    const task = stampOwnership({
      id: newAutomationTaskId(),
      clientName: target,
      website: target,
      country: specificCountry || '',
      status: 'pending' as const,
      productContext: kw || 'Manual',
      productImages: [],
      mode: override?.mode || 'economy',
      /** 再次背调：绕过本地缓存，强制全量再跑 */
      skipCache: !!override?.force,
      keyword: kw || undefined,
      createdAt: Date.now(),
    });
    if (!batchRunnerActiveRef.current) {
      batchSessionIdsRef.current = new Set([task.id]);
    } else {
      batchSessionIdsRef.current.add(task.id);
    }
    batchSeedByIdRef.current.set(task.id, task);
    syncAutomationResults((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
    try {
      await saveAutomationTask(task);
    } catch (e) {
      console.warn('[batch] saveAutomationTask failed, runner will use in-memory seed', e);
    }
    refreshBatchProgressFromSession(target);
    shouldStopRef.current = false;
    void processBatchQueue([task]);
  };

  const performSingleAnalysis = (
    domain: string,
    override?: {
      searchKeyword?: string;
      searchTags?: string[];
      searchCountry?: string;
      force?: boolean;
    }
  ) => {
    void enqueueBackgroundAnalysis(domain, override);
  };

  /** 报告页决策人：合并历史 / CRM contacts / 挖掘账本；再次背调不得删已有联系人 */
  const enrichAnalysisDecisionMakers = (
    data: AnalysisResult,
    opts?: { historyItem?: HistoryItem | null; client?: Client | null }
  ): AnalysisResult => {
    const website = data.companyInfo?.website || opts?.historyItem?.domain || opts?.client?.website || '';
    const name = data.companyInfo?.name || opts?.client?.name || '';
    const client =
      opts?.client ||
      crmClientsRef.current.find((c) => {
        const cHost = (c.website || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        const dHost = (website || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        if (dHost && cHost && dHost === cHost) return true;
        const cn = (c.name || '').trim().toLowerCase();
        const dn = (name || '').trim().toLowerCase();
        return !!(cn && dn && cn === dn);
      });

    const ledger = findDmPersistForCompany(website, name);
    const priorPools: DecisionMaker[][] = [
      opts?.historyItem?.data?.decisionMakers || [],
      client?.contacts || [],
      ledger?.decisionMakers || [],
    ];
    const mergeOpts = { companyDomain: website };
    // 旧资料作底，新结果叠上去：只增改（库内优先：历史/CRM/账本在前）
    let dms = mergeDecisionMakers(
      priorPools.reduce(
        (acc, cur) => mergeDecisionMakers(acc, cur, mergeOpts),
        [] as DecisionMaker[]
      ),
      Array.isArray(data.decisionMakers) ? data.decisionMakers : [],
      mergeOpts
    ).map((d) => ensurePersonIdentity(d, { companyDomain: website }));

    const priorKey = new Set(
      priorPools
        .flat()
        .map((d) => {
          const email = (d.emailGuess || '').toLowerCase();
          if (email.includes('@')) return `e:${email}`;
          const li = (d.linkedin || '').toLowerCase();
          if (li) return `l:${li}`;
          const phone = (d.phone || d.whatsapp || '').trim();
          if (phone) return `p:${phone}`;
          return `n:${(d.name || '').toLowerCase()}|${(d.title || '').toLowerCase()}`;
        })
        .filter(Boolean)
    );
    const dmKey = (d: DecisionMaker) => {
      const email = (d.emailGuess || '').toLowerCase();
      if (email.includes('@')) return `e:${email}`;
      const li = (d.linkedin || '').toLowerCase();
      if (li) return `l:${li}`;
      const phone = (d.phone || d.whatsapp || '').trim();
      if (phone) return `p:${phone}`;
      return `n:${(d.name || '').toLowerCase()}|${(d.title || '').toLowerCase()}`;
    };
    // 已有联系人一律保留；新线索仍要求有邮箱/电话/姓名+职位或领英
    dms = dms.filter((d) => {
      if (priorKey.has(dmKey(d))) return true;
      const hasEmail = !!(d.emailGuess && String(d.emailGuess).includes('@'));
      const hasPhone = !!(d.phone || '').trim() || !!(d.whatsapp || '').trim();
      const hasName = !!(d.name || '').trim() && (d.name || '').trim() !== '公开信息未找到';
      return hasEmail || hasPhone || (hasName && !!(d.linkedin || d.title));
    });

    const hasEmailContact = dms.some((d) => !!(d.emailGuess && String(d.emailGuess).includes('@')));
    const effectiveAt =
      Math.max(
        data.decisionMakerEmailSearchAt || 0,
        opts?.historyItem?.data?.decisionMakerEmailSearchAt || 0,
        ledger?.searchedAt || 0
      ) ||
      (hasEmailContact ? data.decisionMakerEmailSearchAt || opts?.historyItem?.data?.decisionMakerEmailSearchAt || ledger?.searchedAt : undefined);

    const histTimes = [
      ...(data.decisionMakerEmailSearchHistory || []),
      ...(opts?.historyItem?.data?.decisionMakerEmailSearchHistory || []),
      ...(ledger?.searchHistory || []),
      effectiveAt,
    ].filter((n): n is number => typeof n === 'number' && n > 0);

    return {
      ...data,
      decisionMakers: dms,
      decisionMakerEmailSearchAt: effectiveAt || data.decisionMakerEmailSearchAt,
      decisionMakerEmailSearchHistory: [...new Set(histTimes)].slice(-30),
    };
  };

  const loadFromHistory = (item: HistoryItem) => {
    try {
      let data = extractHistoryAnalysis(item);
      if (!data) {
        const domainKey = (item.domain || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        const task = automationResultsRef.current.find((t) => {
          if (t.status !== 'completed' || !t.analysis) return false;
          const tw = (t.analysis.companyInfo?.website || t.website || '')
            .toLowerCase()
            .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
            .split('/')[0];
          return !!domainKey && tw === domainKey;
        });
        if (task?.analysis) data = normalizeAnalysisResult(task.analysis);
      }
      if (!data) {
        const fresh = historyRef.current.find((h) => h.id === item.id);
        data = extractHistoryAnalysis(fresh);
      }
      if (!data) {
        alert('该历史记录缺少有效背调数据，无法打开。可对该域名再次背调。');
        return;
      }
      // 旧报告 SWOT/渠道等常被模型留空：打开时本地启发式补全
      data = synthesizeInsightsFallback(data);
      // 关键决策人：CRM contacts + 挖掘账本（修复列表有数量、报告页为 0）
      data = enrichAnalysisDecisionMakers(data, { historyItem: item });
      setAnalysisData(data);
      setViewingHistoryId(item.id);
      setDomainInput(data.companyInfo.website !== 'N/A' ? data.companyInfo.website : item.domain || '');
      setActiveModule(ModuleType.BACKGROUND);
      setHistoryOpen(false);
      setMobileMenuOpen(false);
      setErrorMsg(null);
      setLoading(false);
      // 补全后写回（含恢复的决策人）
      void persistHistoryItem({ ...item, data }).catch(() => undefined);
      // 库内优先后：仅缺邮/低置信才异步补全
      maybeEnqueueLibraryFirstDmFill(data, item.id);
    } catch (e: any) {
      console.error('loadFromHistory failed', e);
      alert(`打开历史记录失败: ${e?.message || String(e)}`);
    }
  };

  /** CRM：无 HistoryItem 时从自动化队列或域名匹配恢复报告 */
  const openCrmClientReport = (client: Client) => {
    const hist = findHistoryForClient(client, historyRef.current);
    if (hist) {
      loadFromHistory(hist);
      return;
    }
    const host = (client.website || '')
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0];
    const nameKey = (client.name || '').trim().toLowerCase();
    const task = automationResultsRef.current.find((t) => {
      if (t.status !== 'completed' || !t.analysis) return false;
      const tw = (t.analysis.companyInfo?.website || t.website || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0];
      const tn = (t.analysis.companyInfo?.name || t.clientName || '').trim().toLowerCase();
      if (host && tw && host === tw) return true;
      if (nameKey && tn && nameKey === tn) return true;
      return false;
    });
    if (task?.analysis) {
      let data = synthesizeInsightsFallback(normalizeAnalysisResult(task.analysis));
      data = enrichAnalysisDecisionMakers(data, { client });
      setAnalysisData(data);
      setViewingHistoryId(null);
      setDomainInput(data.companyInfo?.website || client.website || '');
      setActiveModule(ModuleType.BACKGROUND);
      setHistoryOpen(false);
      setMobileMenuOpen(false);
      setErrorMsg(null);
      setLoading(false);
      void saveAnalysisToHistory(data, 'crm-recover').catch((e) =>
        console.warn('[crm] recover history save failed', e)
      );
      maybeEnqueueLibraryFirstDmFill(data, null);
      return;
    }
    // 无完整报告但有 CRM 联系人：至少进入决策人页可见联系人
    if (client.contacts?.length) {
      const stub = enrichAnalysisDecisionMakers(
        normalizeAnalysisResult({
          companyInfo: {
            name: client.name,
            website: client.website || '',
            headquarters: client.country || 'N/A',
            foundedYear: 'N/A',
            nature: client.type || 'N/A',
            scale: 'N/A',
            description: client.activityLog || 'N/A',
          },
          decisionMakers: client.contacts,
        }),
        { client }
      );
      const ready = synthesizeInsightsFallback(stub);
      setAnalysisData(ready);
      setViewingHistoryId(null);
      setDomainInput(client.website || '');
      setActiveModule(ModuleType.DECISION_MAKERS);
      setErrorMsg(null);
      setLoading(false);
      maybeEnqueueLibraryFirstDmFill(ready, null);
      return;
    }
    alert('未找到该客户的背调报告正文（可能曾被清理）。请点「再次背调」重新生成后即可查看。');
  };

  const resolveCrmNavIndex = (): number => {
    if (!crmNavOrder.length) return -1;
    if (viewingHistoryId) {
      const byId = crmNavOrder.findIndex((o) => o.historyId === viewingHistoryId);
      if (byId >= 0) return byId;
    }
    if (!analysisData) return -1;
    const lookup = lookupBackgroundCheck(
      analysisData.companyInfo?.website,
      analysisData.companyInfo?.name,
      history,
      crmClients
    );
    if (lookup.historyItem) {
      const byHistory = crmNavOrder.findIndex((o) => o.historyId === lookup.historyItem!.id);
      if (byHistory >= 0) return byHistory;
    }
    return -1;
  };

  const goToAdjacentCrmReport = (delta: number) => {
    const idx = resolveCrmNavIndex();
    if (idx < 0) return;
    const target = crmNavOrder[idx + delta];
    if (!target) return;
    const item = history.find((h) => h.id === target.historyId);
    if (item) loadFromHistory(item);
  };

  const similarCompanyLookup = (company: SimilarCompany) => {
    const lookup = lookupBackgroundCheck(
      company.website,
      company.name,
      getHistorySnapshot(),
      getCrmClientsSnapshot()
    );
    return {
      checked: lookup.checked,
      checkedAt: lookup.checkedAt,
      historyItem: lookup.historyItem,
      ownerUsername: lookup.ownerUsername || lookup.historyItem?.ownerUsername,
    };
  };

  /** 合并局部更新到当前背调报告并持久化到历史 */
  const patchAnalysisData = async (patch: Partial<AnalysisResult>) => {
    const prev = analysisDataRef.current;
    if (!prev) return;
    await persistCurrentAnalysis({ ...prev, ...patch });
  };

  /** 把当前报告写回历史（按 viewingHistoryId / 域名匹配，不新建记录） */
  const persistCurrentAnalysis = async (nextData: AnalysisResult) => {
    setAnalysisData(nextData);
    const matchId = viewingHistoryId;
    const domainKey = (nextData.companyInfo?.website || domainInput || '').toLowerCase();
    const nameKey = (nextData.companyInfo?.name || '').toLowerCase();

    setHistory((prev) => {
      let updatedItem: HistoryItem | null = null;
      const next = prev.map((h) => {
        const hit =
          (matchId && h.id === matchId) ||
          (!matchId &&
            ((h.domain || '').toLowerCase() === domainKey ||
              (h.data?.companyInfo?.name || '').toLowerCase() === nameKey));
        if (!hit) return h;
        updatedItem = { ...h, data: nextData };
        return updatedItem;
      });
      if (updatedItem) {
        persistHistoryItem(updatedItem).catch((e) =>
          console.error('persist analysis patch failed', e)
        );
        void indexAnalysisIntoProductCatalog(nextData, {
          historyId: updatedItem.id,
          ownerUsername: updatedItem.ownerUsername,
          departmentId: updatedItem.departmentId,
        }).catch((e) => console.warn('[productCatalog] reindex failed', e));
      } else if (matchId || domainKey) {
        // 无匹配历史时仍保留内存中的 analysisData；可选新建一条
        console.warn('[History] no matching report to update for decision maker research');
      }
      return next;
    });
  };

  const persistDecisionMakerResearch = async (patch: {
    decisionMakers: DecisionMaker[];
    decisionMakerEmailSearchAt?: number;
    decisionMakerEmailSearchHistory?: number[];
  }, opts?: { historyId?: string | null; domain?: string; companyName?: string }) => {
    const matchId = opts?.historyId ?? viewingHistoryIdRef.current;
    const cleanHost = (url?: string | null) =>
      (url || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0]
        .trim();
    const domainKey = cleanHost(opts?.domain || analysisDataRef.current?.companyInfo?.website || domainInput || '');
    const nameKey = (opts?.companyName || analysisDataRef.current?.companyInfo?.name || '').trim().toLowerCase();
    const companyLabel =
      opts?.companyName || analysisDataRef.current?.companyInfo?.name || '';
    // 入库前剔除「at 别家公司」的串公司脏数据，避免写回 CRM/历史
    const { filterDecisionMakersForCompany } = await import('./services/linkedinEmployeeLocator');
    const scopedIncoming = filterDecisionMakersForCompany(patch.decisionMakers || [], {
      companyName: companyLabel,
      domain: domainKey,
      mode: 'lenient',
    });
    // 与现有报告 / 历史 / 账本合并：再次背调或补全不得整表覆盖已有联系人
    const histHit =
      (matchId && historyRef.current.find((h) => h.id === matchId)) ||
      historyRef.current.find((h) => {
        const hHost = cleanHost(h.domain || h.data?.companyInfo?.website);
        const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
        return (
          (!!domainKey && !!hHost && domainKey === hHost) ||
          (!!nameKey && !!hName && nameKey === hName)
        );
      });
    const ledger = findDmPersistForCompany(domainKey, companyLabel);
    const mergeOpts = { companyDomain: domainKey };
    const existingDms = mergeDecisionMakers(
      mergeDecisionMakers(histHit?.data?.decisionMakers || [], ledger?.decisionMakers || [], mergeOpts),
      analysisDataRef.current &&
        (cleanHost(analysisDataRef.current.companyInfo?.website) === domainKey ||
          (analysisDataRef.current.companyInfo?.name || '').trim().toLowerCase() === nameKey)
        ? analysisDataRef.current.decisionMakers || []
        : [],
      mergeOpts
    );
    const mergedDms = mergeDecisionMakers(existingDms, scopedIncoming, mergeOpts);
    const safePatch = { ...patch, decisionMakers: mergedDms };

    // 1) 先写入耐久化 ledger（刷新后可恢复，避免积分白费）
    upsertDmPersistRecord({
      historyId: matchId,
      domain: domainKey,
      companyName: opts?.companyName || analysisDataRef.current?.companyInfo?.name,
      searchedAt: safePatch.decisionMakerEmailSearchAt,
      decisionMakers: safePatch.decisionMakers,
      searchHistory: safePatch.decisionMakerEmailSearchHistory,
    });

    setAnalysisData((prev) => {
      if (!prev) return prev;
      const sameView =
        (matchId && viewingHistoryIdRef.current === matchId) ||
        cleanHost(prev.companyInfo?.website) === domainKey ||
        (prev.companyInfo?.name || '').trim().toLowerCase() === nameKey;
      if (!sameView) return prev;
      return {
        ...prev,
        decisionMakers: mergeDecisionMakers(prev.decisionMakers || [], safePatch.decisionMakers),
        ...(safePatch.decisionMakerEmailSearchAt != null
          ? {
              decisionMakerEmailSearchAt: Math.max(
                prev.decisionMakerEmailSearchAt || 0,
                safePatch.decisionMakerEmailSearchAt
              ),
            }
          : {}),
        ...(safePatch.decisionMakerEmailSearchHistory
          ? {
              decisionMakerEmailSearchHistory: [
                ...new Set([
                  ...(prev.decisionMakerEmailSearchHistory || []),
                  ...safePatch.decisionMakerEmailSearchHistory,
                ]),
              ].slice(-30),
            }
          : {}),
      };
    });

    // 2) 同步更新 historyRef，避免批量并发 setState 丢写
    const list = historyRef.current;
    let updatedItem: HistoryItem | null = null;
    const next = list.map((h) => {
      const hHost = cleanHost(h.domain || h.data?.companyInfo?.website);
      const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
      const hit =
        (matchId && h.id === matchId) ||
        (!!domainKey && !!hHost && domainKey === hHost) ||
        (!!nameKey && !!hName && nameKey === hName);
      if (!hit) return h;
      if (!h.data) {
        // 极端情况：无 data 也要打上挖掘标记，避免显示「未挖」
        updatedItem = {
          ...h,
          data: {
            companyInfo: {
              name: opts?.companyName || h.domain || 'Unknown',
              headquarters: 'N/A',
              foundedYear: 'N/A',
              nature: 'N/A',
              scale: 'N/A',
              website: h.domain || domainKey || 'N/A',
              description: 'N/A',
            },
            decisionMakers: safePatch.decisionMakers,
            ...(safePatch.decisionMakerEmailSearchAt != null
              ? { decisionMakerEmailSearchAt: safePatch.decisionMakerEmailSearchAt }
              : {}),
            ...(safePatch.decisionMakerEmailSearchHistory
              ? { decisionMakerEmailSearchHistory: safePatch.decisionMakerEmailSearchHistory }
              : {}),
          } as AnalysisResult,
        };
        return updatedItem;
      }
      updatedItem = {
        ...h,
        data: {
          ...h.data,
          decisionMakers: mergeDecisionMakers(h.data.decisionMakers || [], safePatch.decisionMakers),
          ...(safePatch.decisionMakerEmailSearchAt != null
            ? {
                decisionMakerEmailSearchAt: Math.max(
                  h.data.decisionMakerEmailSearchAt || 0,
                  safePatch.decisionMakerEmailSearchAt
                ),
              }
            : {}),
          ...(safePatch.decisionMakerEmailSearchHistory
            ? {
                decisionMakerEmailSearchHistory: [
                  ...new Set([
                    ...(h.data.decisionMakerEmailSearchHistory || []),
                    ...safePatch.decisionMakerEmailSearchHistory,
                  ]),
                ].slice(-30),
              }
            : {}),
        },
      };
      return updatedItem;
    });

    if (updatedItem) {
      historyRef.current = next;
      setHistory(next);
      try {
        await persistHistoryItem(updatedItem);
      } catch (e) {
        console.error('persist decision maker research failed', e);
      }
    } else {
      console.warn(
        '[DM] persist: no matching history item',
        { matchId, domainKey, nameKey, historyLen: list.length }
      );
    }

    // 3) 同步 CRM 联系人，并即时上云（完成一条推一条）
    if (domainKey || nameKey) {
      const prevCrm = crmClientsRef.current || [];
      const touched: Client[] = [];
      const crmNext = prevCrm.map((c) => {
        const cHost = cleanHost(c.website);
        const cName = (c.name || '').trim().toLowerCase();
        const hit =
          (domainKey && cHost && domainKey === cHost) || (nameKey && cName && nameKey === cName);
        if (!hit) return c;
        const nextC = {
          ...c,
          contacts: safePatch.decisionMakers,
          activityLog:
            (c.activityLog || '') +
            ` [决策人挖掘 ${new Date(safePatch.decisionMakerEmailSearchAt || Date.now()).toLocaleString('zh-CN')}]`,
        };
        touched.push(nextC);
        return nextC;
      });
      if (touched.length) {
        crmClientsRef.current = crmNext;
        setCrmClients(crmNext);
        for (const c of touched) {
          try {
            await enqueueCrmClientCloudPush(c);
          } catch {
            /* 本机已更新 */
          }
        }
      }
    }

    // 4) 同步写回营销工具任务队列
    syncAutomationResults((prev) => {
      void mergeDecisionMakersIntoAutomationTasks(prev, {
        domain: domainKey || undefined,
        companyName: nameKey || undefined,
        decisionMakers: safePatch.decisionMakers,
        searchedAt: safePatch.decisionMakerEmailSearchAt,
        searchHistory: safePatch.decisionMakerEmailSearchHistory,
      }).then((merged) => { automationResultsRef.current = merged; replaceAutomationQueue(merged); });
      return prev;
    });
  };

  /** 仅排除：下次搜索跳过，不删除当前报告 */
  const executeExcludeCurrentCompany = async () => {
    const data = analysisDataRef.current || analysisData;
    const name = data?.companyInfo?.name || '';
    const website = data?.companyInfo?.website || domainInput || '';
    if (!name && !website) {
      alert('无法排除：缺少公司名称或网站。');
      return;
    }
    try {
      await addExcludedCompany({
        domain: website,
        name: name || website,
        reason: '非目标客户（背调页手动排除）',
      });
      alert('已加入排除名单。下次搜索将自动过滤；如需移除本页报告，请再点「删除」。');
    } catch (e: any) {
      alert(`排除失败: ${e?.message || String(e)}`);
    }
  };

  /** 仅删除当前背调报告（不加入排除名单）+ 同步 CRM */
  const executeDeleteCurrentReport = async () => {
    const data = analysisDataRef.current || analysisData;
    if (!data) {
      alert('当前没有可删除的背调报告。');
      return;
    }
    const website = data.companyInfo?.website || domainInput || '';

    const normalizeHost = (url?: string | null) =>
      (url || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0]
        .trim();

    const hid = viewingHistoryIdRef.current || viewingHistoryId;
    const domainKey = normalizeHost(website);
    const nameKey = (data.companyInfo?.name || '').trim().toLowerCase();
    const idsToDelete = new Set<string>();
    if (hid) idsToDelete.add(hid);
    for (const h of historyRef.current) {
      const hHost = normalizeHost(h.domain || h.data?.companyInfo?.website);
      const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
      if ((domainKey && hHost && domainKey === hHost) || (nameKey && hName && nameKey === hName)) {
        idsToDelete.add(h.id);
      }
    }

    const crmIds = new Set<string>();
    for (const id of idsToDelete) {
      const item = historyRef.current.find((h) => h.id === id);
      if (item) findCrmIdsForHistoryItem(item, crmClients).forEach((cid) => crmIds.add(cid));
    }
    findCrmIdsForHistoryItem({ domain: website, data }, crmClients).forEach((cid) =>
      crmIds.add(cid)
    );

    // 先清界面
    setAnalysisData(null);
    setViewingHistoryId(null);
    setDomainInput('');
    setActiveModule(ModuleType.DISCOVERY);
    if (idsToDelete.size > 0) {
      setHistory((prev) => prev.filter((h) => !idsToDelete.has(h.id)));
    }
    if (crmIds.size > 0) {
      setCrmClients((prev) => prev.filter((c) => !crmIds.has(c.id)));
    }

    for (const id of idsToDelete) {
      try {
        await deleteHistoryItem(id);
      } catch (e) {
        console.error('local history delete failed', id, e);
      }
      void deleteInvestigationHistory(id).catch((e) =>
        console.warn('cloud history delete failed', id, e)
      );
    }
    alert(
      idsToDelete.size > 0
        ? `已删除该背调报告${crmIds.size ? `，并同步移除 CRM ${crmIds.size} 条` : ''}。`
        : '已关闭当前报告（未找到对应历史记录，记录中心可能仍保留副本）。'
    );
  };

  const askExcludeCurrentCompany = () => {
    const data = analysisDataRef.current || analysisData;
    const name = data?.companyInfo?.name || '';
    const website = data?.companyInfo?.website || domainInput || '';
    if (!name && !website) {
      alert('无法排除：缺少公司名称或网站。');
      return;
    }
    setReportConfirm({
      type: 'exclude',
      title: '确认排除',
      message: `确认排除「${name || website}」？\n\n之后客户搜索会自动跳过该公司/域名。\n当前背调报告仍保留，可再点「删除」移除。`,
    });
  };

  const askDeleteCurrentReport = () => {
    const data = analysisDataRef.current || analysisData;
    if (!data) {
      alert('当前没有可删除的背调报告。');
      return;
    }
    const name =
      data.companyInfo?.name || data.companyInfo?.website || domainInput || '当前报告';
    setReportConfirm({
      type: 'delete',
      title: '确认删除',
      message: `确认删除「${name}」的背调报告？\n\n将同步删除 CRM 中匹配客户。\n不会加入排除名单，以后搜索仍可能再次出现。`,
    });
  };

  const handleReportConfirmOk = async () => {
    if (!reportConfirm || reportActionBusy) return;
    const type = reportConfirm.type;
    setReportConfirm(null);
    setReportActionBusy(true);
    try {
      if (type === 'exclude') await executeExcludeCurrentCompany();
      else await executeDeleteCurrentReport();
    } finally {
      setReportActionBusy(false);
    }
  };

  /** 将当前报告的决策人邮箱搜索加入后台队列（可并行、不挡浏览） */
  const enqueueCurrentDmEmailSearch = (
    fromData?: AnalysisResult | null,
    historyIdOverride?: string | null,
    opts?: { deepDig?: boolean; quiet?: boolean }
  ): { ok: boolean; message: string } => {
    if (!hasPermission(currentUser, 'feature.dm_email_search')) {
      return { ok: false, message: '你没有「决策人邮箱搜索」权限，请联系管理员或部门主管开通。' };
    }
    const src = fromData || analysisDataRef.current;
    if (!src) return { ok: false, message: '当前没有打开的背调报告' };
    const domain = src.companyInfo?.website || '';
    const companyName = src.companyInfo?.name || domain;
    const hid = historyIdOverride ?? viewingHistoryIdRef.current;
    const deepDig = opts?.deepDig !== false;

    const res = enqueueDmEmailSearch({
      domain,
      companyName,
      historyId: hid,
      deepDig,
      authorized: hasPermission(currentUser, 'feature.dm_email_search'),
      existingDecisionMakers: src.decisionMakers || [],
      resolveExisting: () => {
        const list = historyRef.current;
        if (hid) {
          const item = list.find((h) => h.id === hid);
          if (item?.data?.decisionMakers) return item.data.decisionMakers;
        }
        const key = domain.toLowerCase();
        const byDomain = list.find((h) => (h.domain || '').toLowerCase() === key);
        if (byDomain?.data?.decisionMakers) return byDomain.data.decisionMakers;
        return src.decisionMakers || [];
      },
      onComplete: async (job: DmEmailSearchJob) => {
        if (job.status !== 'completed' || !job.resultDecisionMakers || !job.searchedAt) return;
        const list = historyRef.current;
        let prevHistory: number[] = [];
        const matchId = job.historyId;
        if (matchId) {
          const item = list.find((h) => h.id === matchId);
          prevHistory = item?.data?.decisionMakerEmailSearchHistory || [];
        } else {
          const item = list.find((h) => (h.domain || '').toLowerCase() === job.domain.toLowerCase());
          prevHistory = item?.data?.decisionMakerEmailSearchHistory || [];
        }
        const searchHistory = [...prevHistory, job.searchedAt].slice(-30);
        await persistDecisionMakerResearch(
          {
            decisionMakers: job.resultDecisionMakers,
            decisionMakerEmailSearchAt: job.searchedAt,
            decisionMakerEmailSearchHistory: searchHistory,
          },
          { historyId: job.historyId, domain: job.domain, companyName: job.companyName }
        );
      },
    });

    if (res.ok === false) return { ok: false, message: res.reason };
    return {
      ok: true,
      message: opts?.quiet
        ? `已按需补全邮箱线索：${companyName}（后台进行，可继续浏览）`
        : `已加入后台队列：${companyName}（可继续浏览其它客户）`,
    };
  };

  /**
   * Phase B：打开报告后库内优先；仅缺邮/低置信时异步入队补全（不挡浏览）。
   * 不替代用户手动「深挖」；2 小时冷却，避免反复打开重复烧分。
   */
  const maybeEnqueueLibraryFirstDmFill = (
    data: AnalysisResult,
    historyId: string | null | undefined
  ) => {
    if (!hasPermission(currentUser, 'feature.dm_email_search')) return;
    const domain = data.companyInfo?.website || '';
    const host = domain
      .toLowerCase()
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0]
      .trim();
    if (!host || !host.includes('.')) return;
    if (getActiveDmJobForDomain(host)) return;
    if (
      !companyNeedsAsyncDmFill(data.decisionMakers || [], {
        lastSearchAt: data.decisionMakerEmailSearchAt,
      })
    ) {
      return;
    }
    enqueueCurrentDmEmailSearch(data, historyId ?? null, { deepDig: false, quiet: true });
  };
  const handleExportReport = () => {
    if (!hasPermission(currentUser, 'feature.export_ppt')) {
      alert('你没有「下载 PPT 报告」权限，请联系管理员或部门主管开通。');
      return;
    }
    if (analysisData) exportToPPT(analysisData);
  };
  
  const handleAddToCRM = () => { 
      if (!analysisData) return; 
      const website = analysisData.companyInfo.website;
      const patch: Partial<Client> = {
          name: analysisData.companyInfo.name, 
          website,
          country: analysisData.companyInfo.headquarters.split(',').pop()?.trim() || 'Global', 
          productType: analysisData.businessScope.coreProducts[0] || 'N/A', 
          industry: analysisData.companyInfo.nature || 'N/A',
          priceRange: analysisData.businessScope.priceSensitivity || 'Medium', 
          hasAnalyzed: true, 
          hasBackgroundCheck: true,
          contacts: analysisData.decisionMakers || [],
      };
      clearCrmTombstonesForClients([{ id: '', website, name: analysisData.companyInfo.name }]);
      setCrmClients(prev => {
          const idx = findCrmClientIndex(prev, website, analysisData.companyInfo.name);
          if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                  ...updated[idx],
                  ...patch,
                  activityLog:
                      (updated[idx].activityLog || '') +
                      ` [Synced from Deep Analysis ${new Date().toLocaleDateString()}]`,
              };
              return applyCrmDomainDedupe(updated).clients;
          }
          const newClient: Client = stampOwnership({
              id: Date.now().toString(),
              type: '进口商',
              status: '新建/潜在',
              isSampleNeeded: false,
          lastOrderDate: '', 
          lastContactSent: '', 
          lastContactReceived: '', 
          nextFollowUpDate: new Date().toISOString().split('T')[0], 
          activityLog: `Added from Deep Analysis. Rev: ${analysisData.financials.revenueEstimate}.`,
              ...patch,
          } as Client);
          return applyCrmDomainDedupe([newClient, ...prev]).clients;
      });
      alert("已加入客户管理（含背调标记与 " + (analysisData.decisionMakers?.length || 0) + " 位决策人）");
  };
  
  // RESTORED: Handle batch adding clients from Discovery
  const handleBatchAddToCRM = (results: ClientSearchResult[]) => { 
      if (!results || results.length === 0) return;
      const mapType = (t?: string): Client['type'] => {
          const s = (t || '').toLowerCase();
          if (s.includes('retail')) return '零售商';
          if (s.includes('wholesale')) return '批发商';
          if (s.includes('distribut')) return '分销商';
          return '进口商';
      };
      // 搜索线索入库时先挂靠官方品类（背调后再用官网/社交/电商证据精修）
      const seedSignals = [
        discoveryState.product,
        discoveryState.categoryL1,
        discoveryState.categoryL2,
        discoveryState.industry,
      ].filter(Boolean) as string[];
      const seedIds = idsFromAssignments(
        assignCategoriesFromSignals(seedSignals, { limit: 4, minScore: 18 })
      );
      const newClients: Client[] = results.map(r => {
        const rowSignals = [
          ...seedSignals,
          r.mainProducts || '',
          r.searchKeyword || '',
          r.description || '',
        ].filter(Boolean);
        const rowIds = [
          ...new Set([
            ...seedIds,
            ...idsFromAssignments(assignCategoriesFromSignals(rowSignals, { limit: 3, minScore: 20 })),
          ]),
        ].slice(0, 12);
        return stampOwnership({
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          name: r.name,
          website: r.website,
          country: r.country,
          type: mapType(r.clientType),
          status: '新建/潜在', 
          productType: discoveryState.product || r.mainProducts || r.searchKeyword || 'General', 
          industry: discoveryState.industry || 'Unknown',
          priceRange: r.estimatedScale || 'Unknown', 
          isSampleNeeded: false, 
          hasAnalyzed: false, 
          lastOrderDate: '', 
          lastContactSent: '', 
          lastContactReceived: '', 
          nextFollowUpDate: new Date().toISOString().split('T')[0], 
          activityLog: `Discovery 导入。匹配度:${r.fitScore ?? '-'}。标签:${(r.searchTags || []).join(' / ')}。${r.fitReason || r.description}`,
          contacts: [],
          searchKeyword: r.searchKeyword || discoveryState.product,
          tags: [
            ...(r.searchTags || []),
            ...rowIds.slice(0, 4).map((id) => `类目ID:${id}`),
          ],
          sellCategoryIds: rowIds.length ? rowIds : undefined,
      });
      });

      setCrmClients(prev => {
          let next = [...prev];
          let added = 0;
          let merged = 0;
          for (const c of newClients) {
            const idx = findCrmClientIndex(next, c.website, c.name);
            if (idx >= 0) {
              const cur = next[idx];
              next[idx] = {
                ...cur,
                tags: Array.from(new Set([...(cur.tags || []), ...(c.tags || [])])),
                searchedKeywords: Array.from(
                  new Set([...(cur.searchedKeywords || []), ...(c.searchedKeywords || []), c.searchKeyword].filter(Boolean) as string[])
                ),
                searchKeyword: cur.searchKeyword || c.searchKeyword,
                activityLog: `${cur.activityLog || ''}\n${c.activityLog || ''}`.trim(),
              };
              merged += 1;
            } else {
              next = [c, ...next];
              added += 1;
            }
          }
          const deduped = applyCrmDomainDedupe(next);
          window.setTimeout(() => {
            if (added > 0 || merged > 0 || deduped.removedCount > 0) {
              alert(
                `已导入 CRM：新增 ${added}${merged ? ` · 同域名更新 ${merged}` : ''}${
                  deduped.removedCount ? ` · 合并重复 ${deduped.removedCount}` : ''
                }`
              );
            } else {
              alert('所选客户已在 CRM 中（同域名视为同一家）');
            }
          }, 0);
          return deduped.clients;
      });
      // 对应搜索结果若整档已入 CRM，从记录中心剔除
      const mergedForPrune = [...newClients, ...crmClientsRef.current];
      void pruneDiscoveryArchivesAlreadyInCrm(null, mergedForPrune);
  };

  const handleBatchImportRecordsToCrm = (
    historyItems: HistoryItem[],
    archives: DiscoveryArchiveItem[]
  ) => {
    if (!canAccessModule(currentUser, ModuleType.CLIENT_CRM)) {
      alert('你没有「客户管理 CRM」权限，请联系管理员或部门主管开通。');
      return;
    }
    if ((!historyItems || historyItems.length === 0) && (!archives || archives.length === 0)) return;

    // 必须在 setState 外算合并结果：React 18 下 updater 内副作用变量读出来常仍是 0，会误报「没有可导入」
    const prev = crmClientsRef.current || [];
    let next = prev;
    let added = 0;
    let updated = 0;
    let skipped = 0;

    if (historyItems.length > 0) {
      const hist = mergeHistoryItemsIntoCrm(next, historyItems, stampOwnership);
      next = hist.clients;
      added += hist.stats.added;
      updated += hist.stats.updated;
      skipped += hist.stats.skipped;
    }
    for (const archive of archives) {
      const results = archive.results || [];
      if (!results.length) continue;
      const disc = mergeDiscoveryResultsIntoCrm(next, results, stampOwnership, {
        product: archive.product,
        industry: archive.industry,
      });
      next = disc.clients;
      added += disc.stats.added;
      skipped += disc.stats.skipped;
    }
    clearCrmTombstonesForClients(next);
    const deduped = applyCrmDomainDedupe(next, { deleteCloudLosers: false });
    const domainMerged = deduped.removedCount;
    next = deduped.clients;

    crmClientsRef.current = next;
    setCrmClients(next);
    // 立即落盘全库，避免仅改 React state、随后被「可见列表」合并逻辑冲掉新建客户
    try {
      if (currentUser) {
        mergeSaveCrmClients(currentUser, next, users, departments);
      }
    } catch (e) {
      console.warn('CRM batch import persist failed', e);
    }

    // 背调报告必须保留（CRM「查看报告」依赖 HistoryItem）；记录中心仅隐藏已入 CRM 项
    if (archives.length) {
      void pruneDiscoveryArchivesAlreadyInCrm(
        archives.map((a) => a.id),
        next
      );
    }

    const parts: string[] = [];
    if (added) parts.push(`新建 ${added}`);
    if (updated) parts.push(`更新资料 ${updated}`);
    if (skipped) parts.push(`跳过无效 ${skipped}`);
    if (domainMerged) parts.push(`同域名合并 ${domainMerged}`);
    alert(
      parts.length
        ? `CRM 导入完成：${parts.join('，')}`
        : '没有可导入的客户（请确认勾选的是已完成背调且带官网/公司名的任务）'
    );
  };

  /** 搜索归档：整份已入 CRM 则删；部分入 CRM 则剔除已入结果 */
  const pruneDiscoveryArchivesAlreadyInCrm = async (
    onlyIds: string[] | null,
    clients: Client[]
  ) => {
    if (!clients?.length) return;
    const idFilter = onlyIds ? new Set(onlyIds) : null;
    const archives = discoveryArchives.filter((d) => !idFilter || idFilter.has(d.id));
    const toDelete: string[] = [];
    const toPatch: DiscoveryArchiveItem[] = [];

    for (const arch of archives) {
      const results = arch.results || [];
      if (!results.length) continue;
      const kept = results.filter((r) => !isSearchResultInCrm(r, clients));
      if (kept.length === 0) toDelete.push(arch.id);
      else if (kept.length < results.length) toPatch.push({ ...arch, results: kept });
    }

    if (toDelete.length || toPatch.length) {
      setDiscoveryArchives((prev) =>
        prev
          .filter((d) => !toDelete.includes(d.id))
          .map((d) => {
            const p = toPatch.find((x) => x.id === d.id);
            return p || d;
          })
      );
    }
    for (const id of toDelete) {
      const target = archives.find((d) => d.id === id);
      try {
        await deleteDiscoveryArchive(id);
      } catch (e) {
        console.warn('[records] discovery delete failed', id, e);
      }
      addDiscoveryTombstone(id, target?.product, target?.country);
      if (isSupabaseConfigured()) {
        const looksUuid = /^[0-9a-f-]{36}$/i.test(id);
        if (looksUuid) void deleteDiscoverySearchFromCloud(id);
        if (target?.product) {
          void deleteDiscoverySearchesByMeta(target.product, target.country || '');
        }
      }
    }
    for (const arch of toPatch) {
      try {
        await saveDiscoveryArchive(arch);
      } catch (e) {
        console.warn('[records] discovery patch failed', arch.id, e);
      }
    }
  };

  /** 清理记录中心里「已入 CRM」的搜索归档（背调报告保留，供 CRM 查看） */
  const purgeRecordsAlreadyInCrm = async (opts?: { silent?: boolean }) => {
    const crm = crmClientsRef.current;
    await pruneDiscoveryArchivesAlreadyInCrm(null, crm);
    if (!opts?.silent) {
      alert('已同步：已入 CRM 的搜索归档已从记录中心清理；背调报告保留，可在客户管理中打开。');
    }
    return 0;
  };

  /** 背调完成后：已有则更新，没有则自动入库 CRM（批量/单次共用） */
  /** 背调完成后立刻更新本机 CRM，并 await 单条上云（完成一个同步一个） */
  const updateCrmStatus = async (analysis: AnalysisResult): Promise<Client | null> => {
      const now = Date.now();
      const kw = (analysis.searchKeyword || '').trim();
      const website = analysis.companyInfo?.website || '';
      const websiteKey = (website || '').toLowerCase();
      const nameKey = (analysis.companyInfo?.name || '').trim().toLowerCase();
      const patch = clientPatchFromAnalysis(analysis, website, now);
      clearCrmTombstonesForClients([{ id: '', website, name: analysis.companyInfo?.name || '' }]);

      const prev = crmClientsRef.current || [];
      const idx = prev.findIndex(
        (c) =>
          (websiteKey && (c.website || '').toLowerCase() === websiteKey) ||
          (nameKey && (c.name || '').trim().toLowerCase() === nameKey) ||
          (normalizeCrmHost(website) &&
            normalizeCrmHost(c.website) === normalizeCrmHost(website))
      );
      let touched: Client;
      let next: Client[];
      if (idx >= 0) {
        const searchedKeywords = Array.from(
          new Set(
            [...(prev[idx].searchedKeywords || []), prev[idx].searchKeyword, kw].filter(
              Boolean
            ) as string[]
          )
        );
        touched = {
          ...prev[idx],
          ...patch,
                  hasAnalyzed: true, 
          hasBackgroundCheck: true,
          lastBackgroundCheckAt: now,
          ownerUsername: prev[idx].ownerUsername || currentUser?.username,
          departmentId: prev[idx].departmentId || currentUser?.departmentId,
          contacts: mergeDecisionMakers(prev[idx].contacts || [], analysis.decisionMakers || []),
          searchKeyword: kw || prev[idx].searchKeyword,
          searchedKeywords,
          tags: analysis.searchTags || prev[idx].tags,
          activityLog:
            (prev[idx].activityLog || '') + ` [Analyzed ${new Date().toLocaleDateString()}]`,
        };
        next = [...prev];
        next[idx] = touched;
      } else {
        touched = stampOwnership({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: '进口商',
          status: '新建/潜在',
          isSampleNeeded: false,
          lastOrderDate: '',
          lastContactSent: '',
          lastContactReceived: '',
          nextFollowUpDate: new Date().toISOString().split('T')[0],
          activityLog: `Auto-added after background check ${new Date().toLocaleDateString()}.`,
          ...patch,
          name: analysis.companyInfo?.name || website || '未命名客户',
          website,
          searchKeyword: kw || patch.searchKeyword,
        } as Client);
        next = [touched, ...prev];
      }
      crmClientsRef.current = next;
      setCrmClients(next);
      try {
        await enqueueCrmClientCloudPush(touched);
      } catch (e) {
        console.warn('[crm] immediate cloud push failed', e);
      }
      return touched;
  };

  /**
   * 后台背调写完历史后：若用户正打开同一公司报告，立即替换 analysisData。
   * 旧逻辑只写 history/队列、不刷新当前页 → 看起来像「没完成」，强制刷新后才看见新资料。
   */
  const refreshOpenReportIfMatching = (saved: HistoryItem, analysis: AnalysisResult): boolean => {
    const cleanHost = (url?: string | null) =>
      (url || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0]
        .trim();
    const doneHost = cleanHost(saved.domain || analysis.companyInfo?.website);
    const doneName = (analysis.companyInfo?.name || saved.data?.companyInfo?.name || '')
      .trim()
      .toLowerCase();
    const open = analysisDataRef.current;
    if (!open) return false;
    const openHost = cleanHost(open.companyInfo?.website);
    const openName = (open.companyInfo?.name || '').trim().toLowerCase();
    const inputHost = cleanHost(domainInput);
    const sameCompany =
      (!!doneHost && !!openHost && doneHost === openHost) ||
      (!!doneName && !!openName && doneName === openName) ||
      (!!doneHost && !!inputHost && doneHost === inputHost);
    if (!sameCompany) return false;

    const next = enrichAnalysisDecisionMakers(normalizeAnalysisResult(analysis), {
      historyItem: saved,
    });
    analysisDataRef.current = next;
    viewingHistoryIdRef.current = saved.id;
    setAnalysisData(next);
    setViewingHistoryId(saved.id);
    console.info('[report] refreshed open report after background save', doneHost || doneName);
    return true;
  };

  /** 批量/单次分析完成后写入历史（IndexedDB + Supabase） */
  const saveAnalysisToHistory = async (result: AnalysisResult, source = 'batch'): Promise<HistoryItem> => {
      const domain = result.companyInfo?.website || result.companyInfo?.name || 'unknown';
      const country = normalizeCountryZh(
        result.searchCountry || result.companyInfo?.headquarters || result.companyInfo?.city || ''
      );
      const keyword =
        (result.searchKeyword || discoveryState.product || '').trim() || undefined;
      if (keyword) addCustomKeyword(keyword);

      // 再次背调：整份报告与旧资料合并（产品/品类/决策人只增改不删）
      const prevHistory = historyRef.current.find((h) => {
        const host = (h.domain || h.data?.companyInfo?.website || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        const dHost = (domain || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        return !!(host && dHost && host === dHost);
      });
      const mergedWithPrev = mergeAnalysisWithPrevious(prevHistory?.data, result);
      const enriched = enrichAnalysisDecisionMakers(mergedWithPrev, {
        historyItem: prevHistory,
      });

      const historyItem: HistoryItem = stampOwnership({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type: ModuleType.BACKGROUND,
          data: {
            ...enriched,
            searchKeyword: enriched.searchKeyword || keyword,
            searchTags:
              enriched.searchTags ||
              (keyword ? buildSearchTags(keyword, country !== '未分类' ? country : '') : undefined),
          },
          timestamp: Date.now(),
          domain,
          keyword,
          country: country !== '未分类' ? country : undefined,
          source: source as HistoryItem['source'],
      });
      await persistHistoryItem(historyItem);
      setHistory(prev => {
          const filtered = prev.filter(
              (h) => !(h.domain?.toLowerCase() === domain.toLowerCase() && Date.now() - h.timestamp < 60_000)
          );
          return [historyItem, ...filtered];
      });
      void indexAnalysisIntoProductCatalog(historyItem.data, {
        historyId: historyItem.id,
        ownerUsername: historyItem.ownerUsername,
        departmentId: historyItem.departmentId,
      }).catch((e) => console.warn('[productCatalog] index after history save failed', e));
      // 再次背调等后台完成后，当前报告页立刻换成新结果（不必关客户端强刷）
      refreshOpenReportIfMatching(historyItem, historyItem.data);
      console.log(`[History] saved (${source}):`, domain, 'keyword=', keyword, 'dms=', enriched.decisionMakers?.length || 0);
      return historyItem;
  };

  const handleViewAutomationResult = async (task: AutomationResult) => {
      if (!currentUser || !filterOwnedRecords(currentUser, [task], users, departments).length) {
        alert('无权查看该任务（不属于你或你的部门）。');
        return;
      }
      // 列表态可能是瘦身 analysis，打开报告时从本机队列取全文
      let full = task;
      const looksSlim =
        !!task.analysis &&
        !(task.analysis.products?.length) &&
        !(task.analysis.similarCompanies?.length);
      if (looksSlim || !task.analysis) {
        try {
          const q = await getAutomationQueue();
          const hit = q.find((t) => t.id === task.id);
          if (hit?.analysis) full = hit;
        } catch {
          /* ignore */
        }
      }
      if (!full.analysis) {
          alert('该任务尚无完整分析数据，请重新运行。');
          return;
      }
      setAnalysisData(normalizeAnalysisResult(full.analysis));
      const domainKey = (full.analysis.companyInfo?.website || full.website || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0];
      const nameKey = (full.analysis.companyInfo?.name || full.clientName || '').trim().toLowerCase();
      const matched = historyRef.current.find((h) => {
        const hHost = (h.domain || h.data?.companyInfo?.website || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
        return (
          (domainKey && hHost && domainKey === hHost) ||
          (nameKey && hName && nameKey === hName)
        );
      });
      setViewingHistoryId(matched?.id || null);
      setDomainInput(full.analysis.companyInfo?.website || full.website || '');
      setActiveModule(ModuleType.BACKGROUND);
      setErrorMsg(null);
      setMobileMenuOpen(false);
  };

  const handleDownloadAutomationResult = (task: AutomationResult) => {
      if (!hasPermission(currentUser, 'feature.export_ppt')) {
          alert('你没有「下载 PPT 报告」权限，请联系管理员或部门主管开通。');
          return;
      }
      if (!task.analysis) {
          alert('该任务尚无完整分析数据，无法下载。');
          return;
      }
      exportAutomationReportToPPT(task);
  };

  const handleDownloadAllCompleted = async () => {
      if (!hasPermission(currentUser, 'feature.export_ppt')) {
          alert('你没有「下载 PPT 报告」权限，请联系管理员或部门主管开通。');
          return;
      }
      const completed = getAutomationQueueSnapshot().filter((t) => t.status === 'completed' && t.analysis);
      if (completed.length === 0) {
          alert('暂无已完成的报告可下载');
          return;
      }
      await exportBatchAutomationReportsToPPT(completed);
  };

  const stopAutomation = () => {
    shouldStopRef.current = true;
    stopAllBackgroundWork({ keepNightEnabled: true });
    stopProductDigQueue();
    setIsAutomating(false);
    setBatchProgress((p) => ({ ...p, active: false, currentName: '' }));
  };

  /** 限制背调并行度，避免打爆限额 */
  const withConcurrency = <T,>(limit: number) => {
    let active = 0;
    const waiters: Array<() => void> = [];
    const acquire = () =>
      new Promise<void>((resolve) => {
        if (active < limit) {
          active += 1;
          resolve();
        } else {
          waiters.push(resolve);
        }
      });
    const release = () => {
      active -= 1;
      const next = waiters.shift();
      if (next) {
        active += 1;
        next();
      }
    };
    return async (fn: () => Promise<T>): Promise<T> => {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    };
  };

  const importAnalysisToCrmFromPipeline = async (analysis: AnalysisResult) => {
    const dms = analysis.decisionMakers || [];
    if (!dms.some((d) => d.name || d.emailGuess?.includes('@'))) return;
    if (!canAccessModule(currentUser, ModuleType.CLIENT_CRM)) return;
    const histItem: HistoryItem = stampOwnership({
      id: `auto_crm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: ModuleType.BACKGROUND,
      data: analysis,
      timestamp: Date.now(),
      domain: analysis.companyInfo?.website || analysis.companyInfo?.name || '',
      keyword: analysis.searchKeyword,
      country: normalizeCountryZh(
        analysis.searchCountry || analysis.companyInfo?.headquarters || analysis.companyInfo?.city || ''
      ),
      source: 'batch',
    });
    const merged = mergeHistoryItemsIntoCrm(
      crmClientsRef.current || [],
      [histItem],
      stampOwnership
    );
    crmClientsRef.current = merged.clients;
    setCrmClients(merged.clients);
    const host = normalizeCrmHost(analysis.companyInfo?.website || '');
    const name = (analysis.companyInfo?.name || '').trim().toLowerCase();
    const touched = merged.clients.find(
      (c) =>
        (host && normalizeCrmHost(c.website) === host) ||
        (name && (c.name || '').trim().toLowerCase() === name)
    );
    if (touched) {
      try {
        await enqueueCrmClientCloudPush(touched);
      } catch {
        /* 本机已合并 */
      }
    }
  };

  /** 单条背调（供流水线并行调用）；静默补全联系人 → 可选挖邮箱 / 入 CRM */
  const runOneAutomationAnalysis = async (
    task: AutomationResult,
    opts: Pick<
      AutomationPipelineConfig,
      'doLinkedInLocate' | 'doDmMine' | 'doCrmImport' | 'keyword'
    >
  ) => {
    if (shouldStopRef.current) return;
    const limit = checkLimit('analysis');
    if (!limit.allowed) {
      console.warn('analysis limit reached, skip', task.website);
      return;
    }

    syncAutomationResults((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: 'analyzing' } : t))
    );

    try {
      const kw = (task.keyword || opts.keyword || discoveryState.product || '').trim();
      if (kw) addCustomKeyword(kw);
      const analyzeOpts = {
        searchKeyword: kw || undefined,
        searchTags: kw ? buildSearchTags(kw, task.country || '') : undefined,
        searchCountry: task.country || undefined,
        skipCache: !!task.skipCache,
        forceProductDig: !!task.skipCache,
      };
      const preferredMode = task.mode || 'economy';
      const rawResult = await withRateLimitRetry(
        async () => {
          try {
            return await analyzeCompany(task.website, preferredMode, analyzeOpts);
          } catch (e) {
            // DETAILED 在弱网/Windows 工作站上更容易超时或坏 JSON → 降级 ECONOMY 再试一次
            if (preferredMode === 'detailed' && isTransientAnalysisError(e)) {
              console.warn('[pipeline] detailed failed, fallback economy', task.website, e);
              return await analyzeCompany(task.website, 'economy', analyzeOpts);
            }
            throw e;
          }
        },
        {
          maxAttempts: 4,
          baseWaitSec: 45,
          shouldStop: () => shouldStopRef.current,
          retryTransient: true,
        }
      );

      // 再次背调：先并入旧历史/账本决策人，避免任务态与静默补全只拿「新结果」冲掉已有联系人
      const domainForPrev = rawResult.companyInfo?.website || task.website || '';
      const nameForPrev = rawResult.companyInfo?.name || task.clientName || '';
      const prevHist = historyRef.current.find((h) => {
        const host = (h.domain || h.data?.companyInfo?.website || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        const dHost = (domainForPrev || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        return !!(host && dHost && host === dHost);
      });
      const ledgerPrev = findDmPersistForCompany(domainForPrev, nameForPrev);
      const result = enrichAnalysisDecisionMakers(
        mergeAnalysisWithPrevious(prevHist?.data, rawResult),
        { historyItem: prevHist }
      );

      const completedTask: AutomationResult = {
        ...task,
        clientName: result.companyInfo?.name || task.clientName,
        website: result.companyInfo?.website || task.website,
        // 保留搜索目标国在任务上；真实 HQ 在 analysis.companyInfo 里查看
        country: task.country,
        status: 'completed',
        completedAt: Date.now(),
        analysis: {
          ...result,
          searchKeyword: result.searchKeyword || kw || undefined,
          searchCountry: result.searchCountry || task.country || undefined,
        },
        mailGroup: undefined,
        keyword: kw || task.keyword,
        error: undefined,
        failedAt: undefined,
      };

      try {
        await saveAutomationTask(completedTask);
      } catch (saveErr) {
        console.error('流水线任务落盘失败（界面仍记为完成）', saveErr);
      }
      syncAutomationResults((prev) => prev.map((t) => (t.id === task.id ? completedTask : t)));

      let historyId: string | null = null;
      try {
        const saved = await saveAnalysisToHistory(result, 'batch');
        historyId = saved.id;
      } catch (histErr) {
        console.error('流水线结果写入历史失败', histErr);
      }

      incrementUsage('analysis');
      await updateCrmStatus(result);

      let enrichedResult = result;
      let seededDecisionMakers: DecisionMaker[] = mergeDecisionMakers(
        result.decisionMakers || [],
        ledgerPrev?.decisionMakers || []
      );
      const domain = result.companyInfo?.website || task.website || '';
      const companyName = result.companyInfo?.name || task.clientName || domain;

      // 背调后静默四通道补全（联系人 + 社媒主页），用户无感知
      if (opts.doLinkedInLocate && (domain || companyName)) {
        try {
          const intel = await gatherSilentCompanyChannelIntel({
            domain,
            companyName,
            productKeyword: opts.keyword || task.keyword || result.searchKeyword,
            country: task.country || result.searchCountry,
            existingDecisionMakers: seededDecisionMakers,
          });
          enrichedResult = mergeSilentIntelIntoAnalysis(result, intel);
          seededDecisionMakers = mergeDecisionMakers(
            seededDecisionMakers,
            enrichedResult.decisionMakers || []
          );
          enrichedResult = { ...enrichedResult, decisionMakers: seededDecisionMakers };
          if (seededDecisionMakers.length || intel.socials.facebook || intel.socials.linkedin) {
            await persistDecisionMakerResearch(
              { decisionMakers: seededDecisionMakers },
              { historyId: historyId || undefined, domain, companyName }
            );
            // 回写含社媒的报告
            if (historyId) {
              const histItem = historyRef.current.find((h) => h.id === historyId);
              if (histItem?.data) {
                const nextHist = {
                  ...histItem,
                  data: { ...enrichedResult, decisionMakers: seededDecisionMakers },
                };
                historyRef.current = historyRef.current.map((h) =>
                  h.id === historyId ? nextHist : h
                );
                setHistory(historyRef.current);
                await persistHistoryItem(nextHist).catch(() => undefined);
                // 静默补全后同样刷新当前打开的报告（否则社媒/联系人仍停在旧页）
                refreshOpenReportIfMatching(nextHist, nextHist.data);
              }
            }
            syncAutomationResults((prev) => {
              void mergeDecisionMakersIntoAutomationTasks(prev, {
                taskId: task.id,
                domain,
                companyName,
                decisionMakers: seededDecisionMakers,
                searchedAt: Date.now(),
              }).then((merged) => { automationResultsRef.current = merged; replaceAutomationQueue(merged); });
              return prev;
            });
            if (
              opts.doCrmImport &&
              !opts.doDmMine &&
              seededDecisionMakers.some(
                (d) =>
                  !!(d.name || '').trim() ||
                  /linkedin\.com\/in\//i.test(d.linkedin || '') ||
                  d.emailGuess?.includes('@')
              )
            ) {
              await importAnalysisToCrmFromPipeline({
                ...enrichedResult,
                decisionMakers: seededDecisionMakers,
              });
            }
          }
        } catch (liErr) {
          console.warn('[pipeline] silent channel intel skipped', domain, liErr);
        }
      }

      if (opts.doDmMine && hasPermission(currentUser, 'feature.dm_email_search')) {
        enqueueDmEmailSearch({
          domain,
          companyName,
          historyId,
          deepDig: true,
          authorized: true,
          existingDecisionMakers: seededDecisionMakers,
          resolveExisting: () => {
            if (historyId) {
              const item = historyRef.current.find((h) => h.id === historyId);
              if (item?.data?.decisionMakers?.length) return item.data.decisionMakers;
            }
            return seededDecisionMakers;
          },
          onComplete: async (job: DmEmailSearchJob) => {
            if (job.status !== 'completed' || !job.resultDecisionMakers || !job.searchedAt) return;
            const searchHistory = [
              ...((historyId
                ? historyRef.current.find((h) => h.id === historyId)?.data?.decisionMakerEmailSearchHistory
                : undefined) || []),
              job.searchedAt,
            ].slice(-30);
            await persistDecisionMakerResearch(
              {
                decisionMakers: job.resultDecisionMakers,
                decisionMakerEmailSearchAt: job.searchedAt,
                decisionMakerEmailSearchHistory: searchHistory,
              },
              { historyId: job.historyId, domain: job.domain, companyName: job.companyName }
            );
            // 明确按 taskId 写回队列并落盘（persistDecisionMakerResearch 也会按域名再合并一次）
            syncAutomationResults((prev) => {
              void mergeDecisionMakersIntoAutomationTasks(prev, {
                taskId: task.id,
                domain: job.domain,
                companyName: job.companyName,
                decisionMakers: job.resultDecisionMakers!,
                searchedAt: job.searchedAt!,
                searchHistory,
              }).then((merged) => { automationResultsRef.current = merged; replaceAutomationQueue(merged); });
              return prev;
            });
            if (
              opts.doCrmImport &&
              job.resultDecisionMakers.some((d) => d.name || d.emailGuess?.includes('@'))
            ) {
              await importAnalysisToCrmFromPipeline({
                ...enrichedResult,
                decisionMakers: job.resultDecisionMakers,
                decisionMakerEmailSearchAt: job.searchedAt,
              });
            }
          },
        });
      }
    } catch (e: any) {
      console.error(`Pipeline task ${task.id} failed`, e);
      const failedTask: AutomationResult = {
        ...task,
        status: 'failed',
        error: shortErrorMessage(e),
        failedAt: Date.now(),
      };
      try {
        await saveAutomationTask(failedTask);
      } catch {
        /* ignore */
      }
      syncAutomationResults((prev) => prev.map((t) => (t.id === task.id ? failedTask : t)));
      if (isRateLimitError(e)) {
        noteRateLimited(60);
      }
    }
  };

  /** 新版自动化：国家串行搜索 + 背调/决策人并行跟进 */
  const handleStartQueueGeneration = async (config: AutomationPipelineConfig) => {
    const kw = (config.keyword || '').trim();
    if (!kw) {
      alert('请填写搜索关键词');
      return;
    }
    if (!config.countries?.length) {
      alert('请选择至少一个目标国家');
      return;
    }

    shouldStopRef.current = false;
      setIsAutomating(true);
    addCustomKeyword(kw);
    setDiscoveryState((prev) => ({
      ...prev,
      product: kw,
      industry: config.industry || prev.industry,
      clientTypes: config.clientTypes?.length ? config.clientTypes : prev.clientTypes,
      clientType: (config.clientTypes || []).join(', '),
    }));

    const runLimited = withConcurrency<void>(2);
    const followUps: Promise<void>[] = [];
    let searchedCount = 0;
    const clientTypeArg = (config.clientTypes || []).join(', ');
    const perCountry = Math.min(Math.max(config.perCountryLimit || 5, 3), 20);

    try {
      for (const country of config.countries) {
        if (shouldStopRef.current) break;
        try {
          const raw = await withRateLimitRetry(
            () =>
              searchPotentialClients(
                kw,
                country,
                config.industry || '',
                clientTypeArg,
                perCountry
              ),
            {
              maxAttempts: 4,
              baseWaitSec: 40,
              shouldStop: () => shouldStopRef.current,
            }
          );
          const results = stampSearchResults(raw, {
            keyword: kw,
            targetCountry: country,
            clientTypes: config.clientTypes || [],
            searchId: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          });
          // 再保险：只入队目标国 + 有网站的结果（搜索层已过滤，这里防 stamp 边缘情况）
          const qualified = results.filter((res) => {
            if (!(res.website || '').trim()) return false;
            const c = (res.country || res.searchCountry || '').trim();
            if (!c) return true;
            const a = c.toLowerCase();
            const b = country.toLowerCase();
            return (
              a === b ||
              a.includes(b) ||
              b.includes(a) ||
              (res.searchCountry || '').toLowerCase() === b
            );
          });
          if (qualified.length < results.length) {
            console.warn(
              `[automation] ${country}: dropped ${results.length - qualified.length} off-market leads`
            );
          }
          const newTasks: AutomationResult[] = qualified.map((res) =>
            stampOwnership({
              id: newAutomationTaskId(),
                      clientName: res.name,
                      website: res.website,
              // 任务国家固定为「本次搜索目标国」，避免模型乱填其它国家带偏背调
              country: country,
              status: 'pending' as const,
              productContext: config.productContext,
              productImages: [],
              mode: 'economy' as const,
              keyword: res.searchKeyword || kw,
              createdAt: Date.now(),
            })
          );

          if (newTasks.length === 0) {
            console.warn(`[automation] ${country}: 无合格客户（产品/国家过滤后为空）`);
            continue;
          }
          searchedCount += newTasks.length;
          syncAutomationResults((prev) => [...prev, ...newTasks]);
          for (const task of newTasks) {
            await saveAutomationTask(task);
          }

          // 一国搜完立刻启动背调，不等其它国家 —— 与后续搜索并行
          if (config.doBackgroundCheck) {
            for (const task of newTasks) {
              followUps.push(
                runLimited(() =>
                  runOneAutomationAnalysis(task, {
                    // 背调开启即静默补全公司联系人（不在前台配置）
                    doLinkedInLocate: !!config.doBackgroundCheck,
                    doDmMine: config.doDmMine,
                    doCrmImport: config.doCrmImport,
                    keyword: kw,
                  })
                )
              );
            }
          }
        } catch (e) {
          console.error('automation search failed for', country, e);
        }
      }

      if (followUps.length) {
        await Promise.allSettled(followUps);
      }

      const parts = [`搜索入队 ${searchedCount} 家`];
      if (config.doBackgroundCheck) parts.push('背调已并行处理');
      else parts.push('未开启背调（可点「继续待处理任务」）');
      if (config.doDmMine) parts.push('决策人邮箱挖掘已后台排队');
      if (config.doCrmImport) parts.push('有决策人将自动入 CRM');
      alert(`自动化流程结束：${parts.join('；')}。`);
    } catch (e: any) {
      alert(`自动化失败: ${e?.message || String(e)}`);
    } finally {
      setIsAutomating(false);
    }
  };

  // RESTORED: Process Automation Queue（后台 drain，可与产品深挖并行）
  const processBatchQueue = async (tasksToRun?: AutomationResult[]) => {
      if (!hasApiKeyConfigured()) {
        setSystemNotice(
          '尚未检测到可用的 AI 密钥。请先在管理后台完成配置并等待同步，任务将保持待处理，不会标为失败。'
        );
        setIsAutomating(false);
        setBatchProgress((p) => ({ ...p, active: false }));
        return;
      }
      if (tasksToRun?.length) {
        if (!batchRunnerActiveRef.current) {
          // 新一轮后台波次：进度只统计本波任务，避免旧 session 把进度算乱
          batchSessionIdsRef.current = new Set(tasksToRun.map((t) => t.id));
        } else {
          for (const t of tasksToRun) batchSessionIdsRef.current.add(t.id);
        }
        for (const t of tasksToRun) {
          const pending = { ...t, status: 'pending' as const };
          batchSeedByIdRef.current.set(t.id, pending);
          if (!automationResultsRef.current.some((x) => x.id === t.id)) {
            syncAutomationResults((prev) => [pending, ...prev]);
          } else {
            syncAutomationResults((prev) =>
              prev.map((x) => (x.id === t.id && x.status !== 'analyzing' ? { ...x, status: 'pending' } : x))
            );
          }
        }
        refreshBatchProgressFromSession(tasksToRun[0]?.clientName || tasksToRun[0]?.website || '');
      }
      if (batchRunnerActiveRef.current) {
        // 已有后台 runner：新任务保持 pending，循环末尾会继续捞取
        setIsAutomating(true);
        setBatchProgress((p) => ({ ...p, active: true }));
        return;
      }

      // 已停止则绝不自动开跑；调用方若要重启须先把 shouldStopRef 置 false
      if (shouldStopRef.current) {
        batchRunnerActiveRef.current = false;
        setIsAutomating(false);
        setBatchProgress((p) => ({ ...p, active: false }));
        return;
      }
      batchRunnerActiveRef.current = true;
      setIsAutomating(true);
      setBatchProgress((p) => ({ ...p, active: true }));

      const inSession = (t: AutomationResult) =>
        batchSessionIdsRef.current.size === 0 || batchSessionIdsRef.current.has(t.id);

      const findNextPending = async (): Promise<AutomationResult | undefined> => {
        const inNight = isQwenNightPromoWindow();
        const runnable = (t: AutomationResult) =>
          inSession(t) && isAutomationTaskRunnableNow(t, inNight);

        const fromMem = automationResultsRef.current.find(runnable);
        if (fromMem) return fromMem;

        for (const id of batchSessionIdsRef.current) {
          const seed = batchSeedByIdRef.current.get(id);
          if (!seed || !isAutomationTaskRunnableNow(seed, inNight)) continue;
          const mem = automationResultsRef.current.find((t) => t.id === id);
          if (mem?.status === 'completed' || mem?.status === 'failed' || mem?.status === 'analyzing') {
            continue;
          }
          if (!mem) {
            syncAutomationResults((prev) => [seed, ...prev.filter((t) => t.id !== id)]);
          }
          return seed;
        }

        try {
          const q = await getAutomationQueue();
          return q.find((t) => runnable(t));
        } catch (e) {
          console.warn('[batch] getAutomationQueue failed', e);
          return undefined;
        }
      };

      const notifyExcelNightBatchIfDone = (batchId?: string) => {
        if (!batchId) return;
        const meta = getExcelNightBatch(batchId);
        if (!meta || meta.notifiedAt) return;
        const progress = summarizeExcelNightBatch(batchId, automationResultsRef.current);
        if (!progress?.done) return;
        markExcelNightBatchNotified(batchId);
        window.setTimeout(() => {
          alert(
            `Excel 夜间批量背调已全部完成。\n` +
              `成功 ${progress.completed} · 失败 ${progress.failed}（共 ${progress.total} 家）。\n` +
              `结果已写入客户管理；可在任务队列查看明细。`
          );
        }, 400);
      };

      try {
        // 挂机 + 多 Key：按 Key 数并行（最多 2），每路粘滞一把 Key
        const BATCH_ANALYZE_CONCURRENCY = isWorkerModeActive()
          ? resolveWorkerParallelSlots()
          : 2;
        const runOneBatchTask = async (task: AutomationResult, slotIndex = 0) => {
          const analyzingTask: AutomationResult = { ...task, status: 'analyzing' };
          batchSeedByIdRef.current.set(task.id, analyzingTask);
          syncAutomationResults((prev) =>
            prev.map((t) => (t.id === task.id ? analyzingTask : t))
          );
          refreshBatchProgressFromSession(task.clientName || task.website || '');
          void saveAutomationTask(analyzingTask).catch(() => undefined);

          try {
            await waitForLocalAiSlot(
              () => shouldStopRef.current,
              BATCH_ANALYZE_CONCURRENCY
            );
            if (shouldStopRef.current) {
              const paused: AutomationResult = { ...task, status: 'pending', error: undefined };
              batchSeedByIdRef.current.set(task.id, paused);
              syncAutomationResults((prev) => prev.map((t) => (t.id === task.id ? paused : t)));
              void saveAutomationTask(paused).catch(() => undefined);
              return;
            }

            const kw = (task.keyword || discoveryState.product || '').trim();
            if (kw) addCustomKeyword(kw);
            const stickyKey = pickStickyPoolKey('qwen', slotIndex);
            const analyzeOpts = {
              searchKeyword: kw || undefined,
              searchTags: kw ? buildSearchTags(kw, task.country || '') : undefined,
              searchCountry: task.country || undefined,
              qwenApiKey: stickyKey || undefined,
              skipCache: !!task.skipCache,
              forceProductDig: !!task.skipCache,
            };
            const preferredMode = task.mode || 'economy';
            const rawResult = await withHeavyJob('automation', () =>
              withRateLimitRetry(
                async () => {
                  try {
                    return await analyzeCompany(task.website, preferredMode, analyzeOpts);
                  } catch (e) {
                    if (preferredMode === 'detailed' && isTransientAnalysisError(e)) {
                      console.warn('[batch] detailed failed, fallback economy', task.website, e);
                      return await analyzeCompany(task.website, 'economy', analyzeOpts);
                    }
                    throw e;
                  }
                },
                {
                  maxAttempts: 4,
                  baseWaitSec: 45,
                  shouldStop: () => shouldStopRef.current,
                  retryTransient: true,
                }
              )
            );

            // 再次背调 / Excel 种子：旧报告 + 账本 + 导入联系人只合并不覆盖
            const domainForPrev = rawResult.companyInfo?.website || task.website || '';
            const nameForPrev = rawResult.companyInfo?.name || task.clientName || '';
            const prevHist = historyRef.current.find((h) => {
              const host = (h.domain || h.data?.companyInfo?.website || '')
                .toLowerCase()
                .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
                .split('/')[0];
              const dHost = (domainForPrev || '')
                .toLowerCase()
                .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
                .split('/')[0];
              return !!(host && dHost && host === dHost);
            });
            const seedContacts = task.importSeed?.contacts || [];
            const withPrev = mergeAnalysisWithPrevious(prevHist?.data, rawResult);
            const result = enrichAnalysisDecisionMakers(
              {
                ...withPrev,
                decisionMakers: mergeDecisionMakers(
                  withPrev.decisionMakers || [],
                  seedContacts
                ),
              },
              { historyItem: prevHist }
            );

              const completedTask: AutomationResult = { 
                  ...task, 
              clientName: result.companyInfo?.name || task.clientName,
              website: result.companyInfo?.website || task.website,
              country: result.companyInfo?.headquarters?.split(',').pop()?.trim() || task.country,
                  status: 'completed', 
              completedAt: Date.now(),
                  analysis: result, 
              mailGroup: undefined,
              keyword: kw || task.keyword || discoveryState.product,
              error: undefined,
              failedAt: undefined,
              };
              
            batchSeedByIdRef.current.set(task.id, completedTask);
            // 先更新 UI，再落盘：避免 IndexedDB 配额失败把已成功的背调标成 FAILED
            syncAutomationResults((prev) => prev.map((t) => (t.id === task.id ? completedTask : t)));
            refreshBatchProgressFromSession('');
            try {
              await saveAutomationTask(completedTask);
            } catch (saveErr) {
              console.error('批量任务落盘失败（界面仍记为完成）', saveErr);
            }

            let histId: string | null = null;
            try {
              const saved = await saveAnalysisToHistory(result, 'batch');
              histId = saved.id;
            } catch (histErr) {
              console.error('批量结果写入历史失败，但任务队列已保存', histErr);
            }

            // 挂机端常规补全；用户「再次背调」即使在业务员本机也跑四通道（领英对齐/社媒等）
            if (isWorkerModeActive() || task.skipCache) {
              try {
                const domain = result.companyInfo?.website || task.website || '';
                const companyName = result.companyInfo?.name || task.clientName || domain;
                if (domain || companyName) {
                  const intel = await gatherSilentCompanyChannelIntel({
                    domain,
                    companyName,
                    productKeyword: kw || task.keyword || result.searchKeyword,
                    country: task.country || result.searchCountry,
                    existingDecisionMakers: result.decisionMakers || [],
                  });
                  const mergedAnalysis = {
                    ...mergeSilentIntelIntoAnalysis(result, intel),
                    decisionMakers: mergeDecisionMakers(
                      result.decisionMakers || [],
                      intel.decisionMakers || []
                    ),
                  };
                  if (
                    intel.decisionMakers.length ||
                    intel.socials.facebook ||
                    intel.socials.linkedin
                  ) {
                    await persistDecisionMakerResearch(
                      { decisionMakers: mergedAnalysis.decisionMakers || [] },
                      { historyId: histId, domain, companyName }
                    );
                    const withContacts: AutomationResult = {
                      ...completedTask,
                      analysis: mergedAnalysis,
                    };
                    batchSeedByIdRef.current.set(task.id, withContacts);
                    syncAutomationResults((prev) =>
                      prev.map((t) => (t.id === task.id ? withContacts : t))
                    );
                    await saveAutomationTask(withContacts).catch(() => undefined);
                    try {
                      const savedAgain = await saveAnalysisToHistory(mergedAnalysis, 'batch');
                      histId = savedAgain.id;
                    } catch {
                      /* 队列已含补全结果 */
                    }
                  }
                }
              } catch (seedErr) {
                console.warn('[batch] silent channel intel skipped', seedErr);
              }
            }

            incrementUsage('analysis');
            await updateCrmStatus(result);
            // Excel 行业/品类/备注等非联系人字段补进 CRM
            if (task.importSeed) {
              const seed = {
                contacts: [] as NonNullable<typeof task.importSeed.contacts>,
                industry: task.importSeed.industry || '',
                clientType: task.importSeed.clientType || '',
                productType: task.importSeed.productType || '',
                note: task.importSeed.note || '',
                profile: task.importSeed.profile || '',
                address: task.importSeed.address || '',
                postalCode: task.importSeed.postalCode || '',
                fax: task.importSeed.fax || '',
              };
              if (
                seed.industry ||
                seed.clientType ||
                seed.productType ||
                seed.note ||
                seed.profile ||
                seed.address ||
                seed.postalCode ||
                seed.fax
              ) {
                const prev = crmClientsRef.current || [];
                const idx = findCrmClientIndex(
                  prev,
                  result.companyInfo?.website || task.website,
                  result.companyInfo?.name || task.clientName
                );
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = applyBatchSeedToClient(next[idx], seed);
                  crmClientsRef.current = next;
                  setCrmClients(next);
                  try {
                    await enqueueCrmClientCloudPush(next[idx]);
                  } catch {
                    /* 本机已写 */
                  }
                }
              }
            }
            notifyExcelNightBatchIfDone(task.nightBatchId);
          } catch (e: any) {
            if (shouldStopRef.current) {
              const paused: AutomationResult = {
                ...task,
                status: 'pending',
                error: undefined,
              };
              batchSeedByIdRef.current.set(task.id, paused);
              syncAutomationResults((prev) =>
                prev.map((t) => (t.id === task.id ? paused : t))
              );
              void saveAutomationTask(paused).catch(() => undefined);
              return;
            }
              console.error(`Task ${task.id} failed`, e);
            const failedTask: AutomationResult = {
              ...task,
              status: 'failed',
              error: shortErrorMessage(e),
              failedAt: Date.now(),
            };
            batchSeedByIdRef.current.set(task.id, failedTask);
            syncAutomationResults((prev) => prev.map((t) => (t.id === task.id ? failedTask : t)));
            refreshBatchProgressFromSession('');
            void saveAutomationTask(failedTask).catch(() => undefined);
            if (isRateLimitError(e)) {
              noteRateLimited(75);
            }
            notifyExcelNightBatchIfDone(task.nightBatchId);
          }
        };

        while (!shouldStopRef.current) {
          // 挂机模式：全量背调只在夜间优惠窗跑；白天把算力留给轻量补全
          if (isWorkerModeActive() && !shouldWorkerRunHeavyAnalysisNow()) {
            setSystemNotice(
              '挂机模式：全量背调安排在夜间 22:00–08:00（优惠时段）；白天本机只跑轻量补全。'
            );
            break;
          }
          const inNight = isQwenNightPromoWindow();
          const wave: AutomationResult[] = [];
          const concurrency = BATCH_ANALYZE_CONCURRENCY;
          for (let i = 0; i < concurrency; i++) {
            const limit = checkLimit('analysis');
            if (!limit.allowed) {
              if (wave.length === 0) {
                setSystemNotice(
                  `今日背调次数已达上限（${limit.current}/${limit.max}），批量任务已暂停。可稍后点「继续待处理任务」，或联系管理员提高限额。`
                );
              }
              break;
            }
            const task = await findNextPending();
            if (!task) break;
            // 立刻占位，避免并行波次重复捞到同一任务
            const claiming: AutomationResult = { ...task, status: 'analyzing' };
            batchSeedByIdRef.current.set(task.id, claiming);
            syncAutomationResults((prev) =>
              prev.map((t) => (t.id === task.id ? claiming : t))
            );
            wave.push(task);
          }
          if (!wave.length) break;

          await Promise.all(wave.map((t, i) => runOneBatchTask(t, i)));
          if (shouldStopRef.current) break;

          // 已离开夜间窗口：本波结束后停泵，剩余 nightWindowOnly 保持 pending
          if (!isQwenNightPromoWindow() && wave.some((t) => t.nightWindowOnly)) {
            const moreDay = await findNextPending();
            if (!moreDay) break;
          }

          const night = isQwenNightPromoWindow();
          const cool = getCooldownRemainingSec() > 0;
          const peerBusy = getHeavyJobCount('ai') > 0;
          const gap = cool ? 5000 : night || peerBusy ? 3500 : 1500;
          await new Promise((r) => setTimeout(r, gap));
        }
      } finally {
        batchRunnerActiveRef.current = false;
        const stillPending = await findNextPending();
        if (stillPending && !shouldStopRef.current) {
          void processBatchQueue();
          return;
      }
      setIsAutomating(false);
        refreshBatchProgressFromSession('');
        setBatchProgress((p) => ({ ...p, active: false, currentName: '' }));
        const sessionIds = batchSessionIdsRef.current;
        try {
          const q = await getAutomationQueue();
          const completedNow = q.filter(
            (t) => sessionIds.has(t.id) && t.status === 'completed' && t.analysis
          ).length;
          if (completedNow > 0 && sessionIds.size > 0) {
            console.info(`[batch] 后台背调完成 ${completedNow} 条`);
          }
          // 夜间批次可能跨会话完成：再扫一次通知
          const batchIds = new Set(
            q.map((t) => t.nightBatchId).filter(Boolean) as string[]
          );
          for (const bid of batchIds) notifyExcelNightBatchIfDone(bid);
        } catch {
          /* ignore */
        }
      }
  };

  /** 关页/刷新前提示，避免误停批量背调 */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const busy =
        isAutomating ||
        batchProgress.active ||
        automationResultsRef.current.some((t) => t.status === 'pending' || t.status === 'analyzing');
      if (!busy) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isAutomating, batchProgress.active]);

  /** admin 挂机端：每晚 22:00 进入窗口时自动续跑背调（含 Excel 夜间限定） */
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin' || !workerModeOn) return;
    let wasInNight = isQwenNightPromoWindow();
    const wakeNightExcelBatch = () => {
      const inNight = isQwenNightPromoWindow();
      const entered = inNight && !wasInNight;
      wasInNight = inNight;
      if (!inNight) return;
      if (batchRunnerActiveRef.current || shouldStopRef.current) return;
      if (!hasApiKeyConfigured()) return;
      const pendingNight = (automationResultsRef.current || []).filter((t) =>
        isAutomationTaskRunnableNow(t, true)
      );
      if (!pendingNight.length) return;
      if (entered || pendingNight.length > 0) {
        console.info(`[batch] night-window wake tasks=${pendingNight.length}`);
        void processBatchQueue(pendingNight);
      }
    };
    const interval = window.setInterval(wakeNightExcelBatch, 60_000);
    const boot = window.setTimeout(wakeNightExcelBatch, 8_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(boot);
    };
  }, [currentUser?.username, workerModeOn]);

  const handleBatchAnalyzeExisting = async (results: ClientSearchResult[]) => { 
      if (!results || results.length === 0) return;
      // 保留关键词标签到批量上下文
      const kw = results[0]?.searchKeyword || discoveryState.product || 'Discovery Batch';
      setPendingBatch(results.map(r => r.website)); 
      setPendingBatchContext(kw);
      const countryMap: Record<string, string> = {};
      for (const r of results) {
        const key = (r.website || '').toLowerCase();
        const c = (r.country || r.searchCountry || '').trim();
        if (key && c && !/^(global|worldwide|international|国际|全球|不限)$/i.test(c)) {
          countryMap[key] = c;
        }
      }
      setPendingBatchCountries(countryMap);
      setBatchModalOpen(true); 
  };
  
  const handleBatchAnalyzeFromCRM = async (clients: Client[]) => { 
      if (!clients || clients.length === 0) return;
      const targets = clients.map(c => c.website || c.name); 
      const kw = clients.find((c) => c.searchKeyword)?.searchKeyword || discoveryState.product || 'CRM Batch';
      setPendingBatch(targets); 
      setPendingBatchContext(kw);
      const countryMap: Record<string, string> = {};
      for (const c of clients) {
        const key = (c.website || c.name || '').toLowerCase();
        const country = (c.country || '').trim();
        if (key && country && !/^(global|worldwide|international|国际|全球|不限)$/i.test(country)) {
          countryMap[key] = country;
        }
      }
      setPendingBatchCountries(countryMap);
      if (kw && kw !== 'CRM Batch') {
        setDiscoveryState((prev) => ({ ...prev, product: kw }));
        addCustomKeyword(kw);
      }
      setBatchModalOpen(true); 
  };

  /** CRM：批量产品深挖 → 后台队列（可与批量背调同时进行） */
  const handleProductDigComplete = async (payload: ProductDigCompletePayload) => {
    const { clientId, domain, result, previousHistoryId } = payload;
    const client = crmClientsRef.current.find((c) => c.id === clientId);
    const hist = client
      ? findHistoryForClient(client, historyRef.current)
      : previousHistoryId
        ? historyRef.current.find((h) => h.id === previousHistoryId)
        : undefined;
    const historyItem: HistoryItem = stampOwnership({
      id: hist?.id || previousHistoryId || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: ModuleType.BACKGROUND,
      data: result,
      timestamp: Date.now(),
      domain: result.companyInfo?.website || domain,
      keyword: result.searchKeyword || hist?.keyword,
      country: result.searchCountry || hist?.country || client?.country,
      source: 'product_redig',
    });
    try {
      await persistHistoryItem(historyItem);
      setHistory((prev) => {
        const rest = prev.filter((h) => h.id !== historyItem.id);
        return [historyItem, ...rest];
      });
      await indexAnalysisIntoProductCatalog(result, {
        historyId: historyItem.id,
        crmClientId: clientId,
        ownerUsername: historyItem.ownerUsername,
        departmentId: historyItem.departmentId,
      });
      const patch = clientPatchFromAnalysis(result, domain, Date.now());
      setCrmClients((prev) => prev.map((c) => (c.id !== clientId ? c : { ...c, ...patch })));
    } catch (e) {
      console.error('[productDig] persist failed', domain, e);
    }
  };

  /** 背调补全：品类/设计信号 + 决策模型 → 写历史 / 画像 / CRM */
  const handleEnrichmentComplete = async (payload: EnrichmentCompletePayload) => {
    const { clientId, domain, result, previousHistoryId } = payload;
    const client = crmClientsRef.current.find((c) => c.id === clientId);
    const hist = client
      ? findHistoryForClient(client, historyRef.current)
      : previousHistoryId
        ? historyRef.current.find((h) => h.id === previousHistoryId)
        : undefined;
    const historyItem: HistoryItem = stampOwnership({
      id: hist?.id || previousHistoryId || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: ModuleType.BACKGROUND,
      data: result,
      timestamp: Date.now(),
      domain: result.companyInfo?.website || domain,
      keyword: result.searchKeyword || hist?.keyword,
      country: result.searchCountry || hist?.country || client?.country,
      source: 'analysis_enrichment',
    });
    try {
      await persistHistoryItem(historyItem);
      setHistory((prev) => {
        const rest = prev.filter((h) => h.id !== historyItem.id);
        return [historyItem, ...rest];
      });
      await indexAnalysisIntoProductCatalog(result, {
        historyId: historyItem.id,
        crmClientId: clientId,
        ownerUsername: historyItem.ownerUsername,
        departmentId: historyItem.departmentId,
      });
      const patch = clientPatchFromAnalysis(result, domain, Date.now());
      const decisionTags = crmTagsFromDecision(result.decisionEnrichment);
      setCrmClients((prev) =>
        prev.map((c) => {
          if (c.id !== clientId) return c;
          const tags = [...new Set([...(c.tags || []), ...(patch.tags || []), ...decisionTags])].slice(
            0,
            48
          );
          return {
            ...c,
            ...patch,
            tags,
            productType:
              !c.productType || c.productType === 'N/A'
                ? patch.productType || c.productType
                : c.productType,
            hasBackgroundCheck: true,
            hasAnalyzed: true,
          };
        })
      );
      // 同步更新自动化队列里同域名任务的 analysis（若有）
      syncAutomationResults((prev) =>
        prev.map((t) => {
          if (t.status !== 'completed' || !t.analysis) return t;
          const same =
            (t.website || '').toLowerCase().includes((domain || '').toLowerCase()) ||
            (t.analysis.companyInfo?.website || '').toLowerCase() ===
              (result.companyInfo?.website || '').toLowerCase();
          if (!same) return t;
          return { ...t, analysis: result, completedAt: Date.now() };
        })
      );
    } catch (e) {
      console.error('[enrichment] persist failed', domain, e);
    }
  };

  const handleBatchAnalysisEnrichmentFromCRM = (clients: Client[]) => {
    if (!clients?.length) {
      alert('没有可补全的客户（请选择已背调客户，或确保库中有已背调记录）');
      return;
    }
    const authorized =
      hasPermission(currentUser, 'feature.product_redig') ||
      hasPermission(currentUser, 'feature.analyze_company');
    if (!authorized) {
      alert('你没有背调补全权限，请联系管理员开通。');
      return;
    }
    const withSite = clients.filter((c) => (c.website || c.name || '').trim());
    if (!withSite.length) {
      alert('所选客户缺少官网或公司名');
      return;
    }
    if (
      !confirm(
        `将对 ${withSite.length} 家客户做「背调补全」：按需补采品类与设计信号，并用结构化决策判定渠道/适市/匹配就绪度。\n请保持本页打开。继续？`
      )
    ) {
      return;
    }
    const { queued, skipped, reasons } = enqueueEnrichmentBatch(withSite, { authorized: true });
    if (queued === 0) {
      alert(reasons[0] || '没有任务可加入队列');
      return;
    }
    alert(
      skipped > 0
        ? `已加入背调补全 ${queued} 家（跳过 ${skipped}）。左下角可看进度。`
        : `已加入背调补全 ${queued} 家。左下角可看进度。`
    );
  };

  const handleBatchAnalysisEnrichmentFromPromo = (rows: PromoListRow[]) => {
    const clients: Client[] = [];
    for (const r of rows) {
      if (r.client) {
        clients.push(r.client);
        continue;
      }
      if (r.task?.analysis || r.intel?.crmClient) {
        const c = r.intel.crmClient;
        if (c) {
          clients.push(c);
          continue;
        }
        // 仅队列任务：构造临时 Client 以便入队（完成时写历史）
        clients.push({
          id: r.task?.id || r.id,
          name: r.clientName,
          website: r.website === '—' ? '' : r.website,
          country: r.country,
          type: '进口商',
          status: '新建/潜在',
          productType: r.keywords[0] || '',
          industry: r.industry,
          priceRange: '',
          isSampleNeeded: false,
          hasBackgroundCheck: true,
          hasAnalyzed: true,
          lastOrderDate: '',
          lastContactSent: '',
          lastContactReceived: '',
          nextFollowUpDate: '',
          activityLog: '',
          contacts: [],
          searchKeyword: r.keywords[0],
        });
      }
    }
    handleBatchAnalysisEnrichmentFromCRM(clients);
  };

  /** 阶段 C：设计信号轻量补全完成 → 写历史 / 画像 / CRM */
  const handleDesignSignalComplete = async (payload: DesignSignalCompletePayload) => {
    const { clientId, domain, result, previousHistoryId } = payload;
    const client = crmClientsRef.current.find((c) => c.id === clientId);
    const hist = client
      ? findHistoryForClient(client, historyRef.current)
      : previousHistoryId
        ? historyRef.current.find((h) => h.id === previousHistoryId)
        : undefined;
    const historyItem: HistoryItem = stampOwnership({
      id: hist?.id || previousHistoryId || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: ModuleType.BACKGROUND,
      data: result,
      timestamp: Date.now(),
      domain: result.companyInfo?.website || domain,
      keyword: result.searchKeyword || hist?.keyword,
      country: result.searchCountry || hist?.country || client?.country,
      source: 'design_signal_fill',
    });
    try {
      await persistHistoryItem(historyItem);
      setHistory((prev) => {
        const rest = prev.filter((h) => h.id !== historyItem.id);
        return [historyItem, ...rest];
      });
      await indexAnalysisIntoProductCatalog(result, {
        historyId: historyItem.id,
        crmClientId: clientId,
        ownerUsername: historyItem.ownerUsername,
        departmentId: historyItem.departmentId,
      });
      const patch = clientPatchFromAnalysis(result, domain, Date.now());
      setCrmClients((prev) =>
        prev.map((c) => {
          if (c.id !== clientId) return c;
          const tags = [...new Set([...(c.tags || []), ...(patch.tags || [])])].slice(0, 48);
          return {
            ...c,
            ...patch,
            tags,
            productType:
              !c.productType || c.productType === 'N/A'
                ? patch.productType || c.productType
                : c.productType,
          };
        })
      );
    } catch (e) {
      console.error('[designSignal] persist failed', domain, e);
    }
  };

  const handleStartDesignFill = async (blankClients?: Client[]) => {
    const authorized =
      hasPermission(currentUser, 'feature.product_redig') ||
      hasPermission(currentUser, 'feature.analyze_company');
    if (!authorized) {
      alert('你没有补全权限，请联系管理员开通。');
      return;
    }
    let targets = blankClients;
    if (!targets) {
      const profiles = await loadProductCatalog();
      targets = listBlankCrmClientsForDesignFill(crmClientsRef.current, profiles);
    }
    if (!targets.length) {
      alert('CRM 中暂无需要补全的空白客户（须有官网，且缺产品/设计标签）。');
      return;
    }
    if (
      !confirm(
        `将对 CRM 中 ${targets.length} 家空白客户做轻量设计信号补全（包装/配色/价带等）。\n` +
          `请保持本页打开、电脑勿睡眠；刷新后队列会继续。\n通宵建议在常开电脑上运行。继续？`
      )
    ) {
      return;
    }
    const { queued, skipped, reasons } = enqueueDesignSignalBatch(targets, { authorized: true });
    if (queued === 0) {
      alert(reasons[0] || '没有任务可加入队列');
      return;
    }
    alert(
      skipped > 0
        ? `已加入补全队列 ${queued} 家（跳过 ${skipped}）。左下角可看进度。`
        : `已加入补全队列 ${queued} 家。左下角可看进度。`
    );
  };

  useEffect(() => {
    setDesignSignalOnComplete(handleDesignSignalComplete);
    setEnrichmentOnComplete(handleEnrichmentComplete);
    return () => {
      setDesignSignalOnComplete(null);
      setEnrichmentOnComplete(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.username, currentUser?.departmentId]);

  const handleBatchProductDigFromCRM = (clients: Client[]) => {
    if (!clients?.length) return;
    const authorized =
      hasPermission(currentUser, 'feature.product_redig') ||
      hasPermission(currentUser, 'feature.analyze_company');
    if (!authorized) {
      alert('你没有「产品品类深挖」权限，请联系管理员开通。');
      return;
    }

    // 仅补做「已背调但缺少全站品类/价格」的旧报告；新背调已在背调流程内自动采集
    const needRedig: Client[] = [];
    const alreadyRich: string[] = [];
    const noHistory: string[] = [];
    for (const c of clients) {
      const hist = findHistoryForClient(c, historyRef.current);
      if (!hist?.data) {
        noHistory.push(c.name || c.website || c.id);
        continue;
      }
      if (hasRichProductCatalog(hist.data)) {
        alreadyRich.push(c.name || c.website || c.id);
        continue;
      }
      needRedig.push(c);
    }

    if (!needRedig.length) {
      const parts: string[] = [];
      if (alreadyRich.length) parts.push(`${alreadyRich.length} 家已有完整品类数据（新背调已含，无需再挖）`);
      if (noHistory.length) parts.push(`${noHistory.length} 家尚无背调报告，请先做背调`);
      alert(parts.join('\n') || '所选客户均无需补做产品品类。');
      return;
    }

    const skipNote =
      alreadyRich.length || noHistory.length
        ? `\n（已跳过：已有品类 ${alreadyRich.length} 家，无背调 ${noHistory.length} 家）`
        : '';
    if (
      !confirm(
        `将对 ${needRedig.length} 家「旧背调缺品类」客户在后台补采全站品类与价格区间。${skipNote}\n新背调无需此项——背调时已自动采集。继续？`
      )
    ) {
      return;
    }
    const { queued, skipped, reasons } = enqueueProductDigBatch(needRedig, {
      authorized: true,
      onComplete: handleProductDigComplete,
    });
    if (queued === 0) {
      alert(reasons[0] || '没有任务可加入队列');
      return;
    }
    alert(
      skipped > 0
        ? `已加入后台补做品类 ${queued} 家（跳过 ${skipped}）。左下角可看进度。`
        : `已加入后台补做品类 ${queued} 家。左下角可看进度。`
    );
  };

  /** 同类公司多选 → 批量背调队列 */
  const handleBatchAnalyzeSimilar = (companies: SimilarCompany[]) => {
      if (!companies?.length) return;
      if (!hasPermission(currentUser, 'feature.batch_analyze')) {
        alert('你没有「批量背调」权限，请联系管理员或部门主管开通。');
        return;
      }
      const targets = companies
        .map((c) => (c.website || c.name || '').trim())
        .filter(Boolean);
      if (!targets.length) {
        alert('所选同类公司缺少有效网址/名称');
        return;
      }
      const kw =
        analysisData?.searchKeyword ||
        discoveryState.product ||
        analysisData?.companyInfo?.name ||
        'Similar Batch';
      setPendingBatch(targets);
      setPendingBatchContext(kw);
      const countryMap: Record<string, string> = {};
      for (const c of companies) {
        const key = (c.website || c.name || '').toLowerCase();
        const country = (c.country || '').trim();
        if (key && country && !/^(global|worldwide|international|国际|全球|不限)$/i.test(country)) {
          countryMap[key] = country;
        }
      }
      setPendingBatchCountries(countryMap);
      if (kw && !['Similar Batch', 'CRM Batch', 'Discovery Batch', 'Manual Input'].includes(kw)) {
        setDiscoveryState((prev) => ({ ...prev, product: kw }));
        addCustomKeyword(kw);
      }
      setBatchModalOpen(true);
  };

  /** Excel 批量背调：库内已有→合并补充；历史补 CRM；新客户入队全量背调 */
  const handleExcelBatchStart = (payload: {
    toAnalyze: ClassifiedBatchBgRow[];
    toMergeUpdate: ClassifiedBatchBgRow[];
    toCrmFromHistory: ClassifiedBatchBgRow[];
    stats: {
      needAnalyze: number;
      mergeUpdate: number;
      skipCrm: number;
      skipHistory: number;
      invalid: number;
      total: number;
    };
    mode: 'economy' | 'detailed';
  }) => {
    if (!hasPermission(currentUser, 'feature.batch_analyze')) {
      alert('你没有「批量背调」权限，请联系管理员或部门主管开通。');
      return;
    }

    let crmAdded = 0;
    let crmUpdated = 0;
    let mergeCount = 0;

    // 1) 仅有历史报告、尚未入 CRM → 补入
    if (payload.toCrmFromHistory.length) {
      const items = payload.toCrmFromHistory
        .map((r) => r.historyItem)
        .filter((h): h is HistoryItem => !!h?.data);
      if (items.length) {
        setCrmClients((prev) => {
          const { clients, stats } = mergeHistoryItemsIntoCrm(prev, items, stampOwnership);
          crmAdded = stats.added;
          crmUpdated = stats.updated;
          return clients;
        });
      }
    }

    // 2) 库内已有：合并 Excel 联系人/行业等，不烧 Token
    if (payload.toMergeUpdate.length) {
      setCrmClients((prev) => {
        let next = [...prev];
        for (const row of payload.toMergeUpdate) {
          const seed = seedFromBatchRow(row);
          const hist = row.historyItem;
          if (hist?.data) {
            const merged = mergeHistoryItemsIntoCrm(next, [hist], stampOwnership);
            next = merged.clients;
            crmAdded += merged.stats.added;
            crmUpdated += merged.stats.updated;
          }
          const idx = findCrmClientIndex(next, row.website, row.companyName);
          if (idx >= 0) {
            next[idx] = applyBatchSeedToClient(next[idx], seed);
            mergeCount += 1;
            // 同步联系人进历史报告
            if (seed.contacts.length && hist?.id) {
              void persistDecisionMakerResearch(
                { decisionMakers: mergeDecisionMakers(hist.data?.decisionMakers || [], seed.contacts) },
                {
                  historyId: hist.id,
                  domain: row.website || hist.domain,
                  companyName: row.companyName || hist.data?.companyInfo?.name,
                }
              );
            }
          } else if (hist?.data) {
            // 刚从历史补入，再找一次
            const idx2 = findCrmClientIndex(next, row.website, row.companyName);
            if (idx2 >= 0) {
              next[idx2] = applyBatchSeedToClient(next[idx2], seed);
              mergeCount += 1;
            }
          } else {
            // 无历史仅有 CRM 标记：按种子建/并
            const idx3 = findCrmClientIndex(next, row.website, row.companyName);
            if (idx3 >= 0) {
              next[idx3] = applyBatchSeedToClient(next[idx3], seed);
              mergeCount += 1;
            }
          }
        }
        return next;
      });
    }

    if (!payload.toAnalyze.length) {
      alert(
        `Excel 批量完成：无需新背调。\n` +
          `信息补充 ${mergeCount} 家 · 跳过（CRM 已有） ${payload.stats.skipCrm} 家 · ` +
          `历史补 CRM ${crmAdded + crmUpdated} 家（新增 ${crmAdded} / 更新 ${crmUpdated}）。`
      );
      return;
    }

    const limit = checkLimit('analysis');
    if (!limit.allowed) {
      alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`);
      return;
    }

    const analyzeCount = payload.toAnalyze.length;
    let useNightWindow = false;
    if (analyzeCount > EXCEL_NIGHT_BATCH_THRESHOLD) {
      useNightWindow = confirm(
        `本次需背调 ${analyzeCount} 家（超过 ${EXCEL_NIGHT_BATCH_THRESHOLD}），是否改为夜间静默执行以节省算力？\n\n` +
          `确定：每晚 22:00 起自动跑到次日 08:00，未完成的次日 22:00 继续，直到全部处理完并通知你。\n` +
          `取消：立即开始背调。`
      );
    }

    const nightBatchId = useNightWindow ? newExcelNightBatchId() : undefined;
    if (nightBatchId) {
      registerExcelNightBatch({
        id: nightBatchId,
        total: analyzeCount,
        mode: payload.mode,
      });
    }

    const newTasks: AutomationResult[] = payload.toAnalyze.map((row) => {
      const target = batchBgQueueTarget(row);
      const kw = (row.keyword || '').trim();
      if (kw) addCustomKeyword(kw);
      const country = (row.country || '').trim();
      const specificCountry = /^(global|worldwide|international|国际|全球|不限)$/i.test(country)
        ? ''
        : country;
      const seed = seedFromBatchRow(row);
      return stampOwnership({
        id: newAutomationTaskId(),
        clientName: row.companyName || target,
        website: target,
        country: specificCountry,
        status: 'pending' as const,
        productContext: kw || 'Excel Batch',
        productImages: [],
        mode: payload.mode,
        keyword: kw || undefined,
        createdAt: Date.now(),
        importSeed:
          seed.contacts.length ||
          seed.industry ||
          seed.clientType ||
          seed.productType ||
          seed.note ||
          seed.profile ||
          seed.address ||
          seed.postalCode ||
          seed.fax
            ? seed
            : undefined,
        nightWindowOnly: useNightWindow || undefined,
        nightBatchId,
      });
    });

    for (const t of newTasks) {
      batchSeedByIdRef.current.set(t.id, t);
    }
    syncAutomationResults((prev) => {
      const ids = new Set(newTasks.map((t) => t.id));
      return [...newTasks, ...prev.filter((t) => !ids.has(t.id))];
    });
    void (async () => {
      for (const task of newTasks) {
        try {
          await saveAutomationTask(task);
        } catch (e) {
          console.warn('[excel-batch] saveAutomationTask failed', e);
        }
      }
      // 夜间模式：仅在窗口内开泵；白天只入队，等 22:00 自动续跑
      if (!useNightWindow || isQwenNightPromoWindow()) {
        shouldStopRef.current = false;
        void processBatchQueue(newTasks);
      }
    })();

    if (useNightWindow) {
      const inNight = isQwenNightPromoWindow();
      alert(
        `已安排 Excel 夜间静默背调 ${newTasks.length} 家（${payload.mode === 'detailed' ? '详细' : '经济'}模式）。\n` +
          (inNight
            ? `当前已在夜间窗口，正在后台执行；08:00 将自动暂停，次日 22:00 续跑。\n`
            : `将于每晚 22:00 自动开始，08:00 暂停；请保持客户端在线挂机。\n`) +
          `全部完成后会弹窗通知。信息补充 ${mergeCount} · 跳过 CRM ${payload.stats.skipCrm}。`
      );
    } else {
      alert(
        `已启动 Excel 批量：新背调 ${newTasks.length} 家（${payload.mode === 'detailed' ? '详细' : '经济'}模式）。\n` +
          `信息补充 ${mergeCount} · 跳过 CRM ${payload.stats.skipCrm} · 历史补 CRM ${crmAdded + crmUpdated} · 无效 ${payload.stats.invalid}。\n` +
          `夜间补全继续运行，系统会自动错峰；可在任务队列查看进度。`
      );
    }
  };

  const confirmBatchStart = async (mode: 'detailed' | 'economy') => { 
      if (!hasPermission(currentUser, 'feature.batch_analyze')) {
        alert('你没有「批量背调」权限，请联系管理员或部门主管开通。');
        return;
      }
      setBatchModalOpen(false); 
      
      const kw = (discoveryState.product || pendingBatchContext || '').trim();
      if (kw && kw !== 'Manual Input' && kw !== 'CRM Batch' && kw !== 'Discovery Batch') {
        addCustomKeyword(kw);
      }
      const discoveryCountry = (discoveryState.countries?.[0] || discoveryState.country || '').trim();
      const fallbackCountry =
        discoveryCountry && !/^(global|worldwide|international|国际|全球|不限)$/i.test(discoveryCountry)
          ? discoveryCountry
          : '';

      // 库内已有 → 跳过全量背调，只补 CRM；「再次背调」批量则强制重跑
      const forceReanalyze = pendingBatchForceRef.current;
      pendingBatchForceRef.current = false;
      const toQueue: string[] = [];
      let skippedExisting = 0;
      const histToCrm: HistoryItem[] = [];
      for (const target of pendingBatch) {
        const lookup = lookupBackgroundCheck(
          target,
          target,
          historyRef.current,
          crmClientsRef.current
        );
        if (!forceReanalyze && lookup.checked) {
          skippedExisting += 1;
          if (lookup.historyItem?.data) histToCrm.push(lookup.historyItem);
          continue;
        }
        toQueue.push(target);
      }
      if (histToCrm.length) {
        setCrmClients((prev) => mergeHistoryItemsIntoCrm(prev, histToCrm, stampOwnership).clients);
      }
      if (!toQueue.length) {
        alert(
          `所选 ${pendingBatch.length} 家均已在库中有背调，已跳过全量分析（补 CRM ${histToCrm.length}）。\n` +
            `缺口由夜间 22:00–08:00 静默补全，或在客户管理中单独深挖。`
        );
        setPendingBatchCountries({});
        return;
      }

      const newTasks: AutomationResult[] = toQueue.map(target => stampOwnership({ 
          id: newAutomationTaskId(), 
          clientName: target, 
          website: target, 
          country: pendingBatchCountries[target.toLowerCase()] || fallbackCountry || '', 
          status: 'pending', 
          productContext: pendingBatchContext, 
          productImages: [], 
          mode: mode,
          skipCache: forceReanalyze,
          keyword: kw || undefined,
          createdAt: Date.now(),
      }));
      setPendingBatchCountries({}); 
      
      for (const t of newTasks) {
        batchSeedByIdRef.current.set(t.id, t);
      }
      syncAutomationResults((prev) => {
        const ids = new Set(newTasks.map((t) => t.id));
        return [...newTasks, ...prev.filter((t) => !ids.has(t.id))];
      });
      for (const task of newTasks) { 
          await saveAutomationTask(task); 
      } 
      
      // 后台执行；夜间补全不停，共享 AI 槽错峰
      shouldStopRef.current = false;
      void processBatchQueue(newTasks);
      if (skippedExisting > 0) {
        alert(
          `已入队新背调 ${newTasks.length} 家；跳过库内已有 ${skippedExisting} 家。\n夜间补全继续并行。`
        );
      }
  };

  const handleRunPending = async () => { 
      const pending = getAutomationQueueSnapshot().filter((t) => t.status === 'pending' || t.status === 'failed');
      if (!pending.length) return;
      const resetFailed = pending.map((t) =>
        t.status === 'failed' ? { ...t, status: 'pending' as const } : t
      );
      for (const t of resetFailed) {
        batchSeedByIdRef.current.set(t.id, { ...t, status: 'pending' });
      }
      syncAutomationResults((prev) =>
        prev.map((t) => {
          const hit = resetFailed.find((p) => p.id === t.id);
          return hit ? { ...t, status: 'pending' as const } : t;
        })
      );
      for (const t of resetFailed) {
        if (t.status === 'pending') await saveAutomationTask({ ...t, status: 'pending' });
      }
      shouldStopRef.current = false;
      void processBatchQueue(resetFailed.map((t) => ({ ...t, status: 'pending' as const })));
  };
  
  const handleRunSingle = async (id: string) => { 
      const task = getAutomationQueueSnapshot().find((t) => t.id === id);
      if (!task) return;
      shouldStopRef.current = false;
      if (task.status === 'failed' || task.status === 'completed') {
        const reset = { ...task, status: 'pending' as const, analysis: undefined };
        await saveAutomationTask(reset);
        batchSeedByIdRef.current.set(reset.id, reset);
        syncAutomationResults((prev) => prev.map((t) => (t.id === id ? reset : t)));
        void processBatchQueue([reset]);
        return;
      }
      batchSeedByIdRef.current.set(task.id, { ...task, status: 'pending' });
      void processBatchQueue([{ ...task, status: 'pending' }]);
  };

  const REANALYZE_MERGE_HINT =
    '将在原有资料基础上全面再分析并补充，尤其加强品类、类目与产品全站采集；已有内容会保留，只更新或新增。';

  /** 已完成任务：重置后再次背调 */
  const handleRerunCompletedTask = async (id: string) => {
      const task = getAutomationQueueSnapshot().find((t) => t.id === id);
      if (!task) return;
      if (!hasPermission(currentUser, 'feature.batch_analyze') && !hasPermission(currentUser, 'feature.analyze_company')) {
        alert('你没有背调权限，请联系管理员或部门主管开通。');
        return;
      }
      const timeLabel = formatBackgroundCheckTime(task.completedAt || task.createdAt);
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？\n\n${REANALYZE_MERGE_HINT}`
        : `是否对该客户再次背调？\n\n${REANALYZE_MERGE_HINT}`;
      if (!confirm(tip)) return;
      const reset: AutomationResult = {
        ...task,
        status: 'pending',
        analysis: undefined,
        mailGroup: undefined,
        completedAt: undefined,
        skipCache: true,
      };
      await saveAutomationTask(reset);
      batchSeedByIdRef.current.set(reset.id, reset);
      syncAutomationResults((prev) => prev.map((t) => (t.id === id ? reset : t)));
      shouldStopRef.current = false;
      void processBatchQueue([reset]);
  };

  /** 当前报告页：再次背调 */
  const handleReanalyzeCurrent = () => {
      const data = analysisDataRef.current || analysisData;
      if (!data) return;
      if (!hasPermission(currentUser, 'feature.analyze_company')) {
        alert('你没有「单次背调」权限，请联系管理员或部门主管开通。');
        return;
      }
      const domain = data.companyInfo?.website || domainInput;
      if (!domain?.trim()) {
        alert('缺少公司网址，无法再次背调。');
        return;
      }
      const hist =
        (viewingHistoryId && history.find((h) => h.id === viewingHistoryId)) ||
        lookupBackgroundCheck(
          domain,
          data.companyInfo?.name,
          getHistorySnapshot(),
          getCrmClientsSnapshot()
        ).historyItem;
      const timeLabel = formatBackgroundCheckTime(hist?.timestamp);
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？\n\n${REANALYZE_MERGE_HINT}`
        : `是否再次背调以更新该公司信息？\n\n${REANALYZE_MERGE_HINT}`;
      if (!confirm(tip)) return;
      const limit = checkLimit('analysis');
      if (!limit.allowed) {
        alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`);
        return;
      }
      setDomainInput(domain);
      performSingleAnalysis(domain, {
        searchKeyword: data.searchKeyword || discoveryState.product || undefined,
        searchTags: data.searchTags,
        searchCountry: data.searchCountry || undefined,
        force: true,
      });
  };

  /** CRM：单客户再次背调（全量再分析 + 与旧资料合并，不走「跳过库内已有」） */
  const handleReanalyzeCrmClient = (client: Client) => {
      const domain = (client.website || client.name || '').trim();
      if (!domain) {
        alert('缺少公司网址，无法再次背调。');
        return;
      }
      if (!hasPermission(currentUser, 'feature.analyze_company') && !hasPermission(currentUser, 'feature.batch_analyze')) {
        alert('你没有背调权限，请联系管理员或部门主管开通。');
        return;
      }
      const hist = findHistoryForClient(client, getHistorySnapshot());
      const timeLabel = formatBackgroundCheckTime(
        hist?.timestamp || client.lastBackgroundCheckAt
      );
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？\n\n${REANALYZE_MERGE_HINT}`
        : `是否对该客户再次背调？\n\n${REANALYZE_MERGE_HINT}`;
      if (!confirm(tip)) return;
      const limit = checkLimit('analysis');
      if (!limit.allowed) {
        alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`);
        return;
      }
      setDomainInput(domain);
      performSingleAnalysis(domain, {
        searchKeyword: client.searchKeyword || discoveryState.product || undefined,
        searchCountry: client.country || undefined,
        force: true,
      });
  };

  const handleOpenExistingFromSearch = (result: ClientSearchResult) => {
      const lookup = lookupBackgroundCheck(
        result.website,
        result.name,
        getHistorySnapshot(),
        getCrmClientsSnapshot()
      );
      if (lookup.historyItem) {
        loadFromHistory(lookup.historyItem);
        setHistoryOpen(false);
        setMobileMenuOpen(false);
        return;
      }
      alert('未找到本地背调报告。可点击「再次背调」重新生成。');
  };

  const handleReanalyzeHistoryItem = (item: HistoryItem) => {
      const domain = item.domain || item.data?.companyInfo?.website || '';
      if (!domain) {
        alert('该记录缺少网址，无法再次背调。');
        return;
      }
      const timeLabel = formatBackgroundCheckTime(item.timestamp);
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？\n\n${REANALYZE_MERGE_HINT}`
        : `是否再次背调？\n\n${REANALYZE_MERGE_HINT}`;
      if (!confirm(tip)) return;
      if (!hasPermission(currentUser, 'feature.analyze_company')) {
        alert('你没有「单次背调」权限，请联系管理员或部门主管开通。');
        return;
      }
      const limit = checkLimit('analysis');
      if (!limit.allowed) {
        alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`);
        return;
      }
      setHistoryOpen(false);
      setDomainInput(domain);
      performSingleAnalysis(domain, {
        searchKeyword: item.keyword || item.data?.searchKeyword || undefined,
        searchTags: item.data?.searchTags,
        searchCountry: item.country || item.data?.searchCountry || undefined,
        force: true,
      });
  };

  const handleDeleteTask = async (id: string) => { 
      if(confirm("Delete?")) { 
          await deleteAutomationTask(id); 
          syncAutomationResults((prev) => prev.filter(t => t.id !== id)); 
      } 
  };

  const handleReloadAutomationQueue = async () => {
    if (!currentUser) return;
    if (workspaceSyncing) {
      setSystemNotice('同步已在进行中，请看顶部状态，勿重复点击。');
      return;
    }
    setWorkspaceSyncing(true);
    setWorkspaceSyncStatus('同步中：准备…');
    setSystemNotice('正在同步全部资料，请勿关闭页面…');
    try {
      const repaired = await loadAndRepairAutomationQueue(currentUser);
      let tasks = repaired.tasks;
      let cloudNote = '';
      let syncOk = true;
      let needMore = false;
      if (isSupabaseConfigured()) {
        const ws = await syncAllWorkspaceData({
          upload: true,
          timeoutMs: 8 * 60_000,
          autoContinueRounds: 15,
          totalTimeoutMs: 40 * 60_000,
          onProgress: (msg) => {
            setWorkspaceSyncStatus(msg);
            setSystemNotice(msg);
          },
        });
        cloudNote = '\n' + formatWorkspaceSyncReport(ws);
        syncOk = !!ws.ok;
        needMore = /仍有剩余差量|云端多出|待传约|请再点同步续传/.test(cloudNote);
        tasks = await getAutomationQueue();
        const deptsNow = departments.length ? departments : loadDepartmentsFromStorage();
        setCrmClients(
          filterOwnedRecords(
            currentUser,
            filterOutCrmTombstones(loadAllCrmClients()),
            users,
            deptsNow
          )
        );
        setHistory(
          filterOwnedRecords(currentUser, await getHistory(), users, deptsNow)
        );
        setWorkspaceSyncStatus(
          syncOk && !needMore
            ? `同步完成 · CRM ${ws.crm.merged} · 历史 ${ws.history.merged}`
            : needMore
              ? `同步已尽量对齐 · 仍有剩余可再点一次（会自动多轮）`
              : `同步结束 · CRM ${ws.crm.merged} · 历史 ${ws.history.merged}`
        );
      } else {
        setWorkspaceSyncStatus('本机模式（未配置云端）');
      }
      const scoped = filterOwnedRecords(
        currentUser,
        tasks,
        users,
        departments.length ? departments : loadDepartmentsFromStorage()
      );
      setAutomationResultsDeferred(scoped);
      const allZero =
        /本机 0 \/ 云端 0 → 合并 0/.test(cloudNote) &&
        (cloudNote.match(/本机 0 \/ 云端 0 → 合并 0/g) || []).length >= 3;
      alert(
        (syncOk && !needMore
          ? `已同步业务资料（支持自动多轮续传，无需反复手点）。`
          : `已自动多轮续传，仍有剩余差量（不是失败清空）。\n可再点一次「同步全部资料」，仍会自动续传。`) +
          (repaired.repaired || repaired.claimed
            ? `\n队列修复：短ID ${repaired.repaired}，认领 ${repaired.claimed}`
            : '') +
          cloudNote +
          (allZero
            ? `\n\n注意：若本机 CRM/作业列表其实有数据，却显示全 0，多半是卡在连云端；请检查网络后重试。数据不会因超时被清空。`
            : '') +
          `\n\n说明：一次点击会自动连续多轮（约最长 40 分钟）；请保持窗口打开，可照常查看列表。`
      );
    } catch (e: any) {
      setWorkspaceSyncStatus(`同步失败：${e?.message || String(e)}`);
      alert(`同步失败：${e?.message || String(e)}`);
    } finally {
      setWorkspaceSyncing(false);
    }
  };

  const handleClearCompletedTasks = async () => {
      if (!confirm('清除所有已完成的任务？（背调历史仍会保留在记录中心）')) return;
      const done = getAutomationQueueSnapshot().filter((t) => t.status === 'completed');
      for (const t of done) {
        await deleteAutomationTask(t.id);
      }
      syncAutomationResults((prev) => prev.filter((t) => t.status !== 'completed'));
      alert(`已清除 ${done.length} 条已完成任务`);
  };

  const handleClearAllTasks = async () => {
      if (!confirm('清空自己的任务队列？此操作不可恢复（背调历史仍保留在记录中心）。不会删除其他用户的任务。')) return;
      for (const t of getAutomationQueueSnapshot()) {
        await deleteAutomationTask(t.id);
      }
      replaceAutomationQueue([]);
      alert('任务队列已清空');
  };

  const handleLogout = () => {
    intentionalLogoutRef.current = true;
    shouldStopRef.current = true;
    stopAllBackgroundWork();
    setWorkerModeActive(false);
    setWorkerModeOn(false);
    clearSession();
    resetWorkspaceForUserSwitch();
    lastWorkspaceUserRef.current = null;
    setUsageScope(null);
    setKeyResolutionContext({});
    setHasKey(null);
    setCurrentUser(null);
    try {
      onBootLogout?.();
    } catch {
      /* ignore */
    }
  };
  const handleSyncToGitHub = async () => {
    if (!currentUser) return;
    setIsSyncing(true);
    try {
      // 本机为空时 backup/saveCRM 内部会拒绝覆盖云端文件，避免把备份写成 []
      if (history.length > 0) await backupUserHistory(currentUser.username, history);
      // 全量本机 upsert 合并进云端备份（saveCRMToCloud 内会与远端 union，不会冲掉在线行）
      const allCrm = loadAllCrmClients();
      if (allCrm.length > 0) await saveCRMToCloud(allCrm);
      else if (crmClients.length === 0) {
        alert('本机客户/历史为空，已跳过云端覆盖，避免清空在线备份。请先从云端恢复。');
        return;
      }
      alert('数据同步成功!');
    } catch (e: any) {
      alert('同步失败: ' + e.message);
    } finally {
      setIsSyncing(false);
    }
  };
  const handleAddClients = (newClients: Client[]) => {
    const stamped = newClients.map(stampOwnership);
    clearCrmTombstonesForClients(stamped);
    setCrmClients((prev) => {
      let next = [...prev];
      let added = 0;
      let updated = 0;
      for (const c of stamped) {
        const idx = findCrmClientIndex(next, c.website, c.name);
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            ...c,
            id: next[idx].id,
            contacts:
              (c.contacts?.length || 0) >= (next[idx].contacts?.length || 0)
                ? c.contacts
                : next[idx].contacts,
            tags: Array.from(new Set([...(next[idx].tags || []), ...(c.tags || [])])),
          };
          updated += 1;
        } else {
          next = [c, ...next];
          added += 1;
        }
      }
      const deduped = applyCrmDomainDedupe(next);
      window.setTimeout(() => {
        alert(
          `已导入客户：新增 ${added} · 更新 ${updated}${
            deduped.removedCount ? ` · 同域名合并 ${deduped.removedCount}` : ''
          }`
        );
      }, 0);
      return deduped.clients;
    });
  };

  const handleBatchDeleteClients = async (clients: Client[]) => {
    if (!clients?.length) return;
    if (!hasPermission(currentUser, 'feature.crm_manage')) {
      alert('你没有 CRM 编辑权限，无法删除客户。');
      return;
    }
    if (!confirm(`确定删除选中的 ${clients.length} 个客户？\n此操作不可恢复（仅删 CRM 条目，背调历史仍保留在记录中心）。`)) {
      return;
    }
    markCrmClientsDeleted(clients);
    const ids = new Set(clients.map((c) => c.id));
    setCrmClients((prev) => prev.filter((c) => !ids.has(c.id)));
    for (const id of ids) {
      void deleteCrmClient(id).catch((e) => console.warn('[CRM] cloud delete failed', id, e));
    }
  };

  /** 单条删除 CRM（与批量一致：墓碑 + 云端） */
  const handleDeleteClient = async (clientOrId: Client | string) => {
    const client =
      typeof clientOrId === 'string'
        ? crmClientsRef.current.find((c) => c.id === clientOrId) ||
          loadAllCrmClients().find((c) => c.id === clientOrId)
        : clientOrId;
    if (!client) {
      // 仍尝试按 id 本地移除
      const id = typeof clientOrId === 'string' ? clientOrId : '';
      if (id) setCrmClients((prev) => prev.filter((c) => c.id !== id));
      return;
    }
    if (!hasPermission(currentUser, 'feature.crm_manage')) {
      alert('你没有 CRM 编辑权限，无法删除客户。');
      return;
    }
    if (!confirm(`确定删除客户「${client.name}」？\n仅删 CRM 条目；背调历史仍保留。删除后不会在登录时从云端复活。`)) {
      return;
    }
    markCrmClientsDeleted([client]);
    setCrmClients((prev) => prev.filter((c) => c.id !== client.id));
    void deleteCrmClient(client.id).catch((e) => console.warn('[CRM] cloud delete failed', client.id, e));
  };

  /**
   * 清理跨品类垃圾客户（IT 咨询 / 快递 / 食品等与玩具主业不符）
   * 同步删除：背调历史、CRM、搜索归档、产品库（本地 + 云端）
   */
  const handlePurgeNonToyJunkLeads = async (opts?: { silentIfEmpty?: boolean; skipConfirm?: boolean }) => {
    const hist = historyRef.current;
    const crm = crmClientsRef.current;
    const disc = discoveryArchives;
    const plan = buildJunkCleanupPlan(hist, crm, disc);
    const total = junkCleanupPlanCount(plan);
    if (total === 0) {
      if (!opts?.silentIfEmpty) {
        alert('未发现需要清理的跨品类垃圾客户（IT/快递/食品等）。');
      }
      markAutoPurgedNonToyJunk();
      return { deleted: 0 };
    }
    if (!opts?.skipConfirm) {
      const ok = confirm(
        `将永久清理与玩具主业不符的资料：\n` +
          `· 背调 ${plan.historyIds.length} 条\n` +
          `· CRM ${plan.crmIds.length} 条\n` +
          `· 搜索归档删除 ${plan.discoveryIds.length} 条 / 精简 ${plan.discoveryPatches.length} 条\n\n` +
          `本地 + 云端同步删除，不可恢复。继续？`
      );
      if (!ok) return { deleted: 0 };
    }

    const histSet = new Set(plan.historyIds);
    const crmSet = new Set(plan.crmIds);
    const discDel = new Set(plan.discoveryIds);
    const patchMap = new Map(plan.discoveryPatches.map((p) => [p.id, p.results]));

    const doomedCrm = crm.filter((c) => crmSet.has(c.id));
    if (doomedCrm.length) markCrmClientsDeleted(doomedCrm);

    setHistory((prev) => prev.filter((h) => !histSet.has(h.id)));
    setCrmClients((prev) => prev.filter((c) => !crmSet.has(c.id)));
    setDiscoveryArchives((prev) =>
      prev
        .filter((d) => !discDel.has(d.id))
        .map((d) => {
          const nextResults = patchMap.get(d.id);
          return nextResults ? { ...d, results: nextResults } : d;
        })
    );
    syncAutomationResults((prev) => {
      const kept: typeof prev = [];
      for (const t of prev) {
        const blob = [
          t.clientName,
          t.website,
          t.keyword,
          t.analysis?.companyInfo?.name,
          t.analysis?.companyInfo?.description,
          t.analysis?.companyInfo?.nature,
          t.analysis?.businessScope?.coreProducts?.join(' '),
          Array.isArray(t.analysis?.strategy?.actionPlan) ? t.analysis!.strategy!.actionPlan!.join(' ') : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const kw = t.keyword || t.analysis?.searchKeyword || '';
        if (isNonToyJunkBlob(blob, kw)) {
          void deleteAutomationTask(t.id).catch(() => undefined);
          continue;
        }
        kept.push(t);
      }
      return kept;
    });

    if (viewingHistoryId && histSet.has(viewingHistoryId)) {
      setAnalysisData(null);
      setViewingHistoryId(null);
    }

    for (const id of plan.historyIds) {
      try {
        await deleteHistoryItem(id);
      } catch (e) {
        console.warn('[junk-purge] local history', id, e);
      }
      void deleteInvestigationHistory(id).catch((e) =>
        console.warn('[junk-purge] cloud history', id, e)
      );
    }
    if (plan.crmIds.length) {
      void deleteCrmClientsBulk(plan.crmIds).catch((e) =>
        console.warn('[junk-purge] cloud crm bulk', e)
      );
    }
    for (const id of plan.discoveryIds) {
      const target = disc.find((d) => d.id === id);
      try {
        await deleteDiscoveryArchive(id);
      } catch (e) {
        console.warn('[junk-purge] local discovery', id, e);
      }
      addDiscoveryTombstone(id, target?.product, target?.country);
      if (isSupabaseConfigured()) {
        const looksUuid = /^[0-9a-f-]{36}$/i.test(id);
        if (looksUuid) void deleteDiscoverySearchFromCloud(id);
        if (target?.product) {
          void deleteDiscoverySearchesByMeta(target.product, target.country || '');
        }
      }
    }
    for (const patch of plan.discoveryPatches) {
      const arch = disc.find((d) => d.id === patch.id);
      if (!arch) continue;
      const next = { ...arch, results: patch.results };
      try {
        await saveDiscoveryArchive(next);
      } catch (e) {
        console.warn('[junk-purge] patch discovery', patch.id, e);
      }
    }

    // 产品库：按垃圾域名清理
    try {
      const profiles = await loadProductCatalog();
      const junkHosts = new Set<string>();
      for (const h of hist) {
        if (!histSet.has(h.id)) continue;
        const host = productCatalogDomainKey(h.domain || h.data?.companyInfo?.website);
        if (host) junkHosts.add(host);
      }
      for (const c of doomedCrm) {
        const host = productCatalogDomainKey(c.website);
        if (host) junkHosts.add(host);
      }
      for (const p of profiles) {
        const host = productCatalogDomainKey(p.website);
        if (host && junkHosts.has(host)) {
          await removeProductProfile(p.id);
        }
      }
    } catch (e) {
      console.warn('[junk-purge] product catalog', e);
    }

    // 刷新本地 CRM 全库合并视图
    try {
      const depts = departments.length ? departments : loadDepartmentsFromStorage();
      if (currentUser) {
        mergeSaveCrmClients(
          currentUser,
          crmClientsRef.current.filter((c) => !crmSet.has(c.id)),
          users,
          depts
        );
      }
    } catch (e) {
      console.warn('[junk-purge] mergeSaveCrm', e);
    }

    markAutoPurgedNonToyJunk();
    if (!opts?.silentIfEmpty) {
      alert(
        `已清理跨品类垃圾：背调 ${plan.historyIds.length}、CRM ${plan.crmIds.length}、` +
          `搜索归档删 ${plan.discoveryIds.length}/精简 ${plan.discoveryPatches.length}。云端同步中。`
      );
    }
    return { deleted: total };
  };

  // 登录加载完成后：自动清理一次跨品类垃圾（玩具主业噪音：IT/快递/食品等）
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current) return;
    if (hasAutoPurgedNonToyJunk()) return;
    const hist = getHistorySnapshot();
    const crm = getCrmClientsSnapshot();
    if (!hist.length && !crm.length && !discoveryArchives.length) {
      markAutoPurgedNonToyJunk();
      return;
    }
    const plan = buildJunkCleanupPlan(hist, crm, discoveryArchives);
    if (junkCleanupPlanCount(plan) === 0) {
      markAutoPurgedNonToyJunk();
      return;
    }
    markAutoPurgedNonToyJunk();
    void handlePurgeNonToyJunkLeads({ skipConfirm: true, silentIfEmpty: true }).then((res) => {
      if (res.deleted > 0) {
        alert(
          `已自动清理 ${res.deleted} 处与玩具主业不符的资料（IT咨询/快递/食品等），本地与云端已同步删除。`
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.username, discoveryArchives.length]);

  // 记录中心：仅清理已入 CRM 的搜索归档；背调 History 保留（CRM 打开报告需要）
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current) return;
    const crmNow = getCrmClientsSnapshot();
    if (!crmNow.length || !discoveryArchives.length) return;
    const hasFullyInDiscovery = discoveryArchives.some((d) => {
      const results = d.results || [];
      if (!results.length) return false;
      return results.every((r) => isSearchResultInCrm(r, crmNow));
    });
    const hasPartialDiscovery = discoveryArchives.some((d) => {
      const results = d.results || [];
      if (!results.length) return false;
      const inCount = results.filter((r) => isSearchResultInCrm(r, crmNow)).length;
      return inCount > 0 && inCount < results.length;
    });
    if (!hasFullyInDiscovery && !hasPartialDiscovery) return;
    void purgeRecordsAlreadyInCrm({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.username, discoveryArchives.length]);

  /** 手动清理 2026-06 前 CRM（本地 + 云端，保守日期规则） */
  const handlePurgeCrmBeforeJune2026 = async () => {
    if (!hasPermission(currentUser, 'feature.crm_manage')) {
      alert('你没有 CRM 编辑权限。');
      return;
    }
    const all = loadAllCrmClients();
    const preview = previewPurgeCrmBeforeDate(all, CRM_JUNE_2026_CUTOFF_MS);
    if (!preview.removed) {
      alert('没有找到 2026年6月之前的 CRM 记录（或已全部清理）。');
      return;
    }
    if (
      !confirm(
        `将永久删除 ${preview.removed} 条 2026年6月前的客户（保留 ${preview.kept} 条）。\n仅依据背调/入库时间，不含跟进日期。\n背调历史仍保留在记录中心。继续？`
      )
    ) {
      return;
    }
    const { kept, removedIds } = purgeCrmListBeforeDate(all, CRM_JUNE_2026_CUTOFF_MS);
    if (isSupabaseConfigured()) {
      await deleteCrmClientsBulk(removedIds);
    }
    const depts = departments.length ? departments : loadDepartmentsFromStorage();
    const scoped = filterOwnedRecords(currentUser, kept, users, depts);
    setCrmClients(scoped);
    mergeSaveCrmClients(currentUser, scoped, users, depts);
    alert(`已清理 ${removedIds.length} 条旧记录，全库剩余 ${kept.length} 条。`);
  };

  /** 从 GitHub / Supabase / 背调历史恢复 CRM */
  const handleRecoverCrm = async () => {
    if (!hasPermission(currentUser, 'feature.crm_manage')) {
      alert('你没有 CRM 编辑权限。');
      return;
    }
    let recovered: Client[] = [];
    let source = '';
    try {
      const ghCrm = await fetchCRMFromCloud();
      if (ghCrm.length > 0) {
        recovered = ghCrm;
        source = 'GitHub 云端备份 (crm.json)';
      }
    } catch (e) {
      console.warn('[CRM] GitHub recovery failed', e);
    }
    if (!recovered.length && isSupabaseConfigured()) {
      try {
        const sbCrm = await getCrmClients();
        if (sbCrm.length > 0) {
          recovered = sbCrm;
          source = 'Supabase 云端';
        }
      } catch (e) {
        console.warn('[CRM] Supabase recovery failed', e);
      }
    }
    if (!recovered.length) {
      const histNow = await getHistory();
      if (histNow.length > 0) {
        const rebuilt = mergeHistoryItemsIntoCrm([], histNow, stampOwnership);
        recovered = rebuilt.clients;
        if (recovered.length > 0) source = '背调历史记录';
      }
    }
    if (!recovered.length) {
      alert('未找到可恢复的 CRM 数据（GitHub、Supabase、背调历史均无可用记录）。');
      return;
    }
    if (!confirm(`从「${source}」恢复 ${recovered.length} 条客户到 CRM？\n将覆盖当前空列表并同步到云端。`)) {
      return;
    }
    clearCrmTombstonesForClients(recovered);
    const depts = departments.length ? departments : loadDepartmentsFromStorage();
    const migrated = migrateLegacyCrmOwnership(recovered, users, depts);
    saveAllCrmClients(migrated.clients);
    const scoped = filterOwnedRecords(currentUser, migrated.clients, users, depts);
    setCrmClients(scoped);
    mergeSaveCrmClients(currentUser, scoped, users, depts);
    if (isSupabaseConfigured()) {
      await saveCrmClientsBulk(migrated.clients);
    }
    if (isGitHubConnected) {
      await saveCRMToCloud(migrated.clients);
    }
    alert(`已从「${source}」恢复 ${migrated.clients.length} 条客户（您可见 ${scoped.length} 条）。`);
  };

  /** 记录中心：批量再次背调 */
  const handleBatchReanalyzeFromRecords = (items: HistoryItem[]) => {
    if (!items?.length) return;
    if (!hasPermission(currentUser, 'feature.batch_analyze') && !hasPermission(currentUser, 'feature.analyze_company')) {
      alert('你没有背调权限，请联系管理员或部门主管开通。');
      return;
    }
    const targets = items
      .map((h) => (h.domain || h.data?.companyInfo?.website || h.data?.companyInfo?.name || '').trim())
      .filter(Boolean);
    if (!targets.length) {
      alert('所选记录缺少网址/名称，无法背调。');
      return;
    }
    if (
      !confirm(
        `将对选中的 ${targets.length} 条记录再次背调。\n\n${REANALYZE_MERGE_HINT}`
      )
    ) {
      return;
    }
    const kw =
      items.find((h) => h.keyword || h.data?.searchKeyword)?.keyword ||
      items.find((h) => h.data?.searchKeyword)?.data?.searchKeyword ||
      discoveryState.product ||
      'Records Batch';
    pendingBatchForceRef.current = true;
    setPendingBatch(targets);
    setPendingBatchContext(kw);
    const countryMap: Record<string, string> = {};
    for (const h of items) {
      const key = (h.domain || h.data?.companyInfo?.website || h.data?.companyInfo?.name || '').toLowerCase();
      const country = (h.country || h.data?.searchCountry || '').trim();
      if (key && country && !/^(global|worldwide|international|国际|全球|不限)$/i.test(country)) {
        countryMap[key] = country;
      }
    }
    setPendingBatchCountries(countryMap);
    if (kw && !['Records Batch', 'CRM Batch', 'Discovery Batch', 'Manual Input'].includes(kw)) {
      setDiscoveryState((prev) => ({ ...prev, product: kw }));
      addCustomKeyword(kw);
    }
    setHistoryOpen(false);
    setBatchModalOpen(true);
  };

  /** 记录中心：批量决策人挖掘 */
  const handleBatchDmSearchFromRecords = (items: HistoryItem[]) => {
    if (!items?.length) return;
    if (!hasPermission(currentUser, 'feature.dm_email_search')) {
      alert('你没有「决策人邮箱搜索」权限，请联系管理员或部门主管开通。');
      return;
    }
    if (
      !confirm(
        `将为 ${items.length} 条背调记录加入「决策人邮箱深挖」后台队列（请保持本页打开）。继续？`
      )
    ) {
      return;
    }
    let queued = 0;
    let skipped = 0;
    const skipSamples: string[] = [];
    for (const hist of items) {
      const domain = (hist.domain || hist.data?.companyInfo?.website || '').trim();
      if (!domain || !domain.includes('.')) {
        skipped += 1;
        continue;
      }
      const companyName = hist.data?.companyInfo?.name || domain;
      const res = enqueueDmEmailSearch({
        domain,
        companyName,
        historyId: hist.id,
        companyLinkedin:
          hist.data?.socials?.linkedin || hist.data?.tradeIntelligence?.companyLinkedin,
        deepDig: true,
        authorized: true,
        existingDecisionMakers: hist.data?.decisionMakers || [],
        resolveExisting: () => {
          const h = historyRef.current.find((x) => x.id === hist.id);
          return h?.data?.decisionMakers || [];
        },
        onComplete: async (job: DmEmailSearchJob) => {
          if (job.status !== 'completed' || !job.resultDecisionMakers || !job.searchedAt) return;
          const list = historyRef.current;
          let prevHistory: number[] = [];
          const matchId = job.historyId;
          if (matchId) {
            const item = list.find((h) => h.id === matchId);
            prevHistory = item?.data?.decisionMakerEmailSearchHistory || [];
          }
          const searchHistory = [...prevHistory, job.searchedAt].slice(-30);
          await persistDecisionMakerResearch(
            {
              decisionMakers: job.resultDecisionMakers,
              decisionMakerEmailSearchAt: job.searchedAt,
              decisionMakerEmailSearchHistory: searchHistory,
            },
            { historyId: job.historyId, domain: job.domain, companyName: job.companyName }
          );
        },
      });
      if (res.ok) queued += 1;
      else {
        skipped += 1;
        if (skipSamples.length < 4) {
          skipSamples.push(`${companyName}: ${'reason' in res ? res.reason : '跳过'}`);
        }
      }
    }
    alert(
      `决策人挖掘：已加入队列 ${queued} 家` +
        (skipped ? `，跳过 ${skipped} 家` : '') +
        (skipSamples.length ? `\n\n${skipSamples.join('\n')}` : '') +
        `\n\n请保持页面打开，左侧/决策人页可看进度。`
    );
  };

  /** 记录中心：批量产品品类补做 */
  const handleBatchProductDigFromRecords = (items: HistoryItem[]) => {
    if (!items?.length) return;
    const authorized =
      hasPermission(currentUser, 'feature.product_redig') ||
      hasPermission(currentUser, 'feature.analyze_company');
    if (!authorized) {
      alert('你没有「产品品类深挖」权限，请联系管理员开通。');
      return;
    }

    const alreadyRich: HistoryItem[] = [];
    const needRedig: Array<{
      id: string;
      name: string;
      website: string;
      country: string;
      searchKeyword: string;
    }> = [];
    for (const h of items) {
      if (hasRichProductCatalog(h.data)) {
        alreadyRich.push(h);
        continue;
      }
      const website = (h.domain || h.data?.companyInfo?.website || '').trim();
      if (!website) continue;
      const crmHit = crmClientsRef.current.find((c) => {
        const host = (c.website || '').toLowerCase().replace(/^www\./, '');
        const hHost = website.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').split('/')[0];
        return host && hHost && (host.includes(hHost) || hHost.includes(host.replace(/^https?:\/\//, '').split('/')[0]));
      });
      needRedig.push({
        id: crmHit?.id || `hist_${h.id}`,
        name: h.data?.companyInfo?.name || website,
        website,
        country: h.country || h.data?.searchCountry || crmHit?.country || '',
        searchKeyword: h.keyword || h.data?.searchKeyword || crmHit?.searchKeyword || '',
      });
    }

    if (!needRedig.length) {
      alert(
        alreadyRich.length
          ? `${alreadyRich.length} 条已有完整品类数据，无需再挖。`
          : '所选记录均无法补做产品品类。'
      );
      return;
    }
    if (
      !confirm(
        `将对 ${needRedig.length} 条缺品类背调在后台补采全站品类与价格。${
          alreadyRich.length ? `\n（已跳过已有品类 ${alreadyRich.length} 条）` : ''
        }\n请保持本页打开。继续？`
      )
    ) {
      return;
    }
    const { queued, skipped, reasons } = enqueueProductDigBatch(needRedig, {
      authorized: true,
      onComplete: handleProductDigComplete,
    });
    if (queued === 0) {
      alert(reasons[0] || '没有任务可加入队列');
      return;
    }
    alert(
      skipped > 0
        ? `已加入后台补做品类 ${queued} 条（跳过 ${skipped}）。左下角可看进度。`
        : `已加入后台补做品类 ${queued} 条。左下角可看进度。`
    );
  };

  /** CRM 多选：批量决策人邮箱深挖（后台队列） */
  const handleBatchDmSearchFromCRM = (clients: Client[]) => {
    if (!clients?.length) return;
    if (!hasPermission(currentUser, 'feature.dm_email_search')) {
      alert('你没有「决策人邮箱搜索」权限，请联系管理员或部门主管开通。');
      return;
    }
    if (
      !confirm(
        `将为 ${clients.length} 家客户加入「决策人邮箱深挖」后台队列（并行运行，可继续浏览页面）。\n已有结果的客户会更新联系人。继续？`
      )
    ) {
      return;
    }
    let queued = 0;
    let skipped = 0;
    const skipSamples: string[] = [];
    for (const client of clients) {
      const hist = findHistoryForClient(client, historyRef.current);
      const domain = (
        client.website ||
        hist?.domain ||
        hist?.data?.companyInfo?.website ||
        ''
      ).trim();
      if (!domain || !domain.includes('.')) {
        skipped += 1;
        continue;
      }
      const res = enqueueDmEmailSearch({
        domain,
        companyName: client.name || domain,
        historyId: hist?.id || null,
        companyLinkedin:
          hist?.data?.socials?.linkedin ||
          hist?.data?.tradeIntelligence?.companyLinkedin,
        deepDig: true,
        authorized: true,
        existingDecisionMakers: hist?.data?.decisionMakers || client.contacts || [],
        resolveExisting: () => {
          const h = findHistoryForClient(client, historyRef.current);
          return h?.data?.decisionMakers || client.contacts || [];
        },
        onComplete: async (job: DmEmailSearchJob) => {
          if (job.status !== 'completed' || !job.resultDecisionMakers || !job.searchedAt) return;
          const list = historyRef.current;
          let prevHistory: number[] = [];
          const matchId = job.historyId;
          if (matchId) {
            const item = list.find((h) => h.id === matchId);
            prevHistory = item?.data?.decisionMakerEmailSearchHistory || [];
          } else {
            const item = list.find(
              (h) => (h.domain || '').toLowerCase() === job.domain.toLowerCase()
            );
            prevHistory = item?.data?.decisionMakerEmailSearchHistory || [];
          }
          const searchHistory = [...prevHistory, job.searchedAt].slice(-30);
          await persistDecisionMakerResearch(
            {
              decisionMakers: job.resultDecisionMakers,
              decisionMakerEmailSearchAt: job.searchedAt,
              decisionMakerEmailSearchHistory: searchHistory,
            },
            { historyId: job.historyId, domain: job.domain, companyName: job.companyName }
          );
        },
      });
      if (res.ok) queued += 1;
      else {
        skipped += 1;
        if (skipSamples.length < 4) {
          skipSamples.push(`${client.name}: ${'reason' in res ? res.reason : '跳过'}`);
        }
      }
    }
    alert(
      `决策人挖掘：已加入队列 ${queued} 家` +
        (skipped ? `，跳过 ${skipped} 家` : '') +
        (skipSamples.length ? `\n\n${skipSamples.join('\n')}` : '') +
        `\n\n可在「决策人挖掘」页查看进度。`
    );
  };

  /** 营销工具：批量决策人挖掘（与 CRM / 记录中心同一队列） */
  const handleBatchDmSearchFromPromo = (rows: PromoListRow[]) => {
    if (!rows?.length) return;
    const clients: Client[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.client) {
        if (!seen.has(row.client.id)) {
          seen.add(row.client.id);
          clients.push(row.client);
        }
        continue;
      }
      const website =
        (row.website && row.website !== '—' ? row.website : '') ||
        row.task?.website ||
        row.intel.historyItem?.domain ||
        row.intel.bestAnalysis?.companyInfo?.website ||
        '';
      const key = (normalizeCrmHost(website) || row.clientName || row.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clients.push({
        id: `promo_dm_${row.id}`,
        name: row.clientName !== '—' ? row.clientName : website || '未知公司',
        website: website || undefined,
        country: row.country || '',
        type: '进口商',
        status: '新建/潜在',
        productType: '',
        industry: row.industry || '',
        priceRange: '',
        isSampleNeeded: false,
        lastOrderDate: '',
        lastContactSent: '',
        lastContactReceived: '',
        nextFollowUpDate: '',
        activityLog: '',
        contacts: row.contact ? [row.contact] : row.intel.bestAnalysis?.decisionMakers || [],
        searchKeyword: row.keywords[0],
        ownerUsername: row.owner || undefined,
      });
    }
    handleBatchDmSearchFromCRM(clients);
  };

  /** 营销工具：批量补做品类 */
  const handleBatchProductDigFromPromo = (rows: PromoListRow[]) => {
    if (!rows?.length) return;
    const clients: Client[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.client) {
        if (!seen.has(row.client.id)) {
          seen.add(row.client.id);
          clients.push(row.client);
        }
        continue;
      }
      const website =
        (row.website && row.website !== '—' ? row.website : '') ||
        row.task?.website ||
        row.intel.historyItem?.domain ||
        '';
      const key = (normalizeCrmHost(website) || row.clientName || row.id).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      clients.push({
        id: `promo_pd_${row.id}`,
        name: row.clientName !== '—' ? row.clientName : website || '未知公司',
        website: website || undefined,
        country: row.country || '',
        type: '进口商',
        status: '新建/潜在',
        productType: '',
        industry: row.industry || '',
        priceRange: '',
        isSampleNeeded: false,
        lastOrderDate: '',
        lastContactSent: '',
        lastContactReceived: '',
        nextFollowUpDate: '',
        activityLog: '',
        searchKeyword: row.keywords[0],
        ownerUsername: row.owner || undefined,
      });
    }
    handleBatchProductDigFromCRM(clients);
  };

  /** 营销工具：批量加入 CRM（已完成队列且未入 CRM；按官网去重，避免队列重复行虚增） */
  const handleBatchAddToCrmFromPromo = (tasks: AutomationResult[]) => {
    if (!tasks?.length) return;
    if (!canAccessModule(currentUser, ModuleType.CLIENT_CRM)) {
      alert('你没有「客户管理 CRM」权限，请联系管理员或部门主管开通。');
      return;
    }
    const crmNow = crmClientsRef.current || [];
    const historyItems: HistoryItem[] = [];
    const seenHosts = new Set<string>();
    const seenNames = new Set<string>();
    let alreadyInCrm = 0;
    let dupTasks = 0;
    let noAnalysis = 0;

    for (const task of tasks) {
      if (!task.analysis) {
        noAnalysis += 1;
        continue;
      }
      const website =
        task.analysis.companyInfo?.website || task.website || '';
      const companyName =
        task.analysis.companyInfo?.name || task.clientName || '';
      const domainKey = normalizeCrmHost(website);
      const nameKey = companyName.trim().toLowerCase();

      // 与列表「未入 CRM」同一套匹配：已在 CRM 的仍可带入做资料更新
      const inCrmIdx = findCrmClientIndex(crmNow, website, companyName);
      if (inCrmIdx >= 0) alreadyInCrm += 1;

      if (domainKey && seenHosts.has(domainKey)) {
        dupTasks += 1;
        continue;
      }
      if (!domainKey && nameKey && seenNames.has(nameKey)) {
        dupTasks += 1;
        continue;
      }
      if (domainKey) seenHosts.add(domainKey);
      if (nameKey) seenNames.add(nameKey);

      // 始终以队列报告为准生成导入项（避免匹配到的历史记录缺 domain 导致整批被跳过）
      const matched = historyRef.current.find((h) => {
        const hHost = normalizeCrmHost(h.domain || h.data?.companyInfo?.website);
        const hName = (h.data?.companyInfo?.name || '').trim().toLowerCase();
        return (
          (domainKey && hHost && domainKey === hHost) ||
          (!domainKey && nameKey && hName && nameKey === hName)
        );
      });
      const data = task.analysis || matched?.data;
      if (!data) continue;
      historyItems.push(
        stampOwnership({
          id: matched?.id || `promo_crm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          type: ModuleType.BACKGROUND,
          data,
          timestamp: matched?.timestamp || task.completedAt || Date.now(),
          domain:
            website ||
            matched?.domain ||
            data.companyInfo?.website ||
            task.clientName ||
            '',
          keyword: task.keyword || data.searchKeyword || matched?.keyword,
          country: normalizeCountryZh(
            task.country ||
              data.searchCountry ||
              data.companyInfo?.headquarters ||
              matched?.country ||
              ''
          ),
          source: matched?.source || 'batch',
        })
      );
    }
    if (!historyItems.length) {
      alert(
        noAnalysis
          ? '所选任务没有背调报告，无法导入。请先完成背调。'
          : '没有可导入的报告数据（已按官网去重）'
      );
      return;
    }
    const hints: string[] = [];
    if (tasks.length > historyItems.length) {
      hints.push(`队列 ${tasks.length} 条 → 公司 ${historyItems.length} 家（去重 ${dupTasks}）`);
    }
    if (alreadyInCrm > 0) {
      hints.push(`其中约 ${Math.min(alreadyInCrm, historyItems.length)} 家已在 CRM，将更新资料`);
    }
    const willNew = Math.max(0, historyItems.length - Math.min(alreadyInCrm, historyItems.length));
    if (willNew > 0) hints.push(`预计新建约 ${willNew} 家`);
    const dupHint = hints.length ? `\n${hints.join('；')}` : '';
    if (!confirm(`将把 ${historyItems.length} 家公司写入客户管理？${dupHint}`)) return;
    handleBatchImportRecordsToCrm(historyItems, []);
  };

  if (!currentUser) {
    return (
      <Login
        onLogin={(u) => {
          saveSession(u.username);
          armDesktopSession();
          setUsageScope(u.username);
          // 禁止登录预取模块；需要时点进模块再加载
          if (u.role === 'admin') setHasKey(true);
          startTransition(() => {
            setCurrentUser(u);
          });
        }}
        onUsersChange={(next) => setUsers(next)}
      />
    );
  }

  /** 挂机确认 / 进业务页：续跑补全队列 + 重新打开静默补全泵 */
  const kickWorkerTaskResume = () => {
    shouldStopRef.current = false;
    setNightSilentUpgradeEnabled(true);
    resumeEnrichmentQueue();
    resumeDesignSignalQueue();
    window.setTimeout(() => void pumpNightUpgrade(), 800);
  };

  const handleWorkerConfirm = () => {
    markWorkerPromptAnswered();
    setWorkerPromptOpen(false);
    setWorkerModeActive(true);
    setWorkerModeOn(true);
    setSystemNotice(
      '已开启挂机执行：白天轻量补全；夜间 22:00–08:00 双 Key 并行背调。请保持本页打开、电脑不休眠。'
    );
    kickWorkerTaskResume();
    // 若已在夜间窗，立刻拉起待处理背调
    window.setTimeout(() => {
      if (!shouldWorkerRunHeavyAnalysisNow()) return;
      const pending = (automationResultsRef.current || []).filter((t) =>
        isAutomationTaskRunnableNow(t, true)
      );
      if (pending.length) void processBatchQueue(pending);
    }, 1500);
  };

  const handleWorkerDecline = () => {
    markWorkerPromptAnswered();
    setWorkerPromptOpen(false);
    setWorkerModeActive(false);
    setWorkerModeOn(false);
    shouldStopRef.current = true;
    stopAllBackgroundWork();
    setSystemNotice('未开启挂机。本机仅作业务浏览；重任务请在专用挂机端确认执行。');
  };

  if (currentUser.role === 'admin' && !adminInWorkspace) {
    return (
      <AdminDashboard 
        onLogout={handleLogout} 
        currentUser={currentUser} 
        users={users}
        setUsers={setUsers}
        onEnterWorkspace={() => {
          setAdminInWorkspace(true);
          setActiveModule(ModuleType.HOME);
          // 每次进入业务台都询问是否挂机（不因本机会话/上次已开而静默跳过）
          setWorkerPromptOpen(true);
        }}
      />
    );
  }

  // 密钥探测在后台进行；禁止整页转圈挡住侧栏（否则菜单会出现但点不动）
  const alwaysActiveModules = ALWAYS_ACTIVE_MODULES;
  const activeSectionMeta = findSectionByModule(activeModule, sphereNavSectionId);
  const activeNavItem = findNavItem(activeModule, sphereNavSectionId);

  return (
    <AccessGate user={currentUser} onLogout={handleLogout}>
    <div
      className={`tp-app tp-shield-content min-h-screen min-h-[100dvh] w-full max-w-none ${
        sphereNavExpanded ? 'is-nav-expanded' : ''
      } ${sphereNavPhase === 'submenu' ? 'is-nav-submenu' : ''}`}
      style={{ ['--tp-sidebar-w' as string]: sidebarWidth }}
      data-tp-shield="1"
    >
      {/* Mobile sidebar backdrop */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-ink-950/50 backdrop-blur-sm z-30 md:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}
      <AppNavDock
        currentUser={currentUser}
        activeModule={activeModule}
        analysisData={analysisData}
        historyOpen={historyOpen}
        sphereNavPhase={sphereNavPhase}
        dockWidthClass={dockWidthClass}
        mobileMenuOpen={mobileMenuOpen}
        adminInWorkspace={adminInWorkspace}
        isAutomating={isAutomating}
        batchProgress={batchProgress}
        productDigActive={productDigProgress.active}
        onPhaseChange={setSphereNavPhase}
        onSectionChange={setSphereNavSectionId}
        onSelectModule={navigateModule}
        onOpenRecords={openRecordsPanel}
        onOpenTeamManage={
          currentUser.role === 'manager' ? openTeamManagePanel : undefined
        }
        onLogout={handleLogout}
        onStopAutomation={stopAutomation}
        onExitAdminWorkspace={exitAdminWorkspace}
        onCloseMobileMenu={closeMobileMenu}
      />
      
      {historyOpen && (
        <RecordsPanel
          history={history}
          discoveryArchives={discoveryArchives}
          crmClients={crmClients}
          onClose={() => setHistoryOpen(false)}
          onOpenHistory={loadFromHistory}
          onDownloadHistory={(item) => {
            if (!hasPermission(currentUser, 'feature.export_ppt')) {
              alert('你没有「下载 PPT 报告」权限，请联系管理员或部门主管开通。');
              return;
            }
            if (item.data) exportToPPT(item.data);
          }}
          canExportPpt={hasPermission(currentUser, 'feature.export_ppt')}
          canImportCrm={canAccessModule(currentUser, ModuleType.CLIENT_CRM)}
          showOwnerFilter={
            !!currentUser &&
            (canBrowseAllDepartments(currentUser) || currentUser.role === 'manager')
          }
          onPurgeNonToyJunk={async () => {
            clearAutoPurgeNonToyJunkFlag();
            await handlePurgeNonToyJunkLeads({ skipConfirm: false });
            return;
          }}
          onBatchImportToCrm={handleBatchImportRecordsToCrm}
          onBatchReanalyze={handleBatchReanalyzeFromRecords}
          onBatchDmSearch={
            hasPermission(currentUser, 'feature.dm_email_search')
              ? handleBatchDmSearchFromRecords
              : undefined
          }
          onBatchProductDig={
            hasPermission(currentUser, 'feature.product_redig') ||
            hasPermission(currentUser, 'feature.analyze_company')
              ? handleBatchProductDigFromRecords
              : undefined
          }
          onRestoreDiscovery={(archive) => {
            handleDiscoveryStateChange({
              ...archiveToDiscoveryState(archive),
              updatedAt: Date.now(),
            });
            setActiveModule(ModuleType.DISCOVERY);
            setHistoryOpen(false);
            setMobileMenuOpen(false);
          }}
          onDeleteHistory={async (id) => {
            const item = historyRef.current.find((h) => h.id === id) || history.find((h) => h.id === id);
            const crmIds = item ? findCrmIdsForHistoryItem(item, crmClients) : [];
            // 先更新界面，避免云端 await 卡住导致批量删除「没反应」
            setHistory((prev) => prev.filter((h) => h.id !== id));
            if (crmIds.length) {
              const doomed = crmClientsRef.current.filter((c) => crmIds.includes(c.id));
              markCrmClientsDeleted(doomed);
              setCrmClients((prev) => prev.filter((c) => !crmIds.includes(c.id)));
              for (const cid of crmIds) {
                void deleteCrmClient(cid).catch((e) => console.warn('[CRM] cloud delete failed', cid, e));
              }
            }
            if (viewingHistoryIdRef.current === id || viewingHistoryId === id) {
              setAnalysisData(null);
              setViewingHistoryId(null);
            }
            try {
              await deleteHistoryItem(id);
            } catch (e) {
              console.error('local history delete failed', id, e);
            }
            void deleteInvestigationHistory(id).catch((e) =>
              console.warn('cloud history delete failed', id, e)
            );
          }}
          onDeleteDiscovery={async (id) => {
            const target = discoveryArchives.find((d) => d.id === id);
            const crmIds = findCrmIdsForDiscoveryResults(target?.results, crmClients);
            setDiscoveryArchives((prev) => prev.filter((d) => d.id !== id));
            if (crmIds.length) {
              const doomed = crmClientsRef.current.filter((c) => crmIds.includes(c.id));
              markCrmClientsDeleted(doomed);
              setCrmClients((prev) => prev.filter((c) => !crmIds.includes(c.id)));
              for (const cid of crmIds) {
                void deleteCrmClient(cid).catch((e) => console.warn('[CRM] cloud delete failed', cid, e));
              }
            }
            await deleteDiscoveryArchive(id).catch((e) => console.error(e));
            addDiscoveryTombstone(id, target?.product, target?.country);
            if (isSupabaseConfigured()) {
              const looksUuid = /^[0-9a-f-]{36}$/i.test(id);
              if (looksUuid) void deleteDiscoverySearchFromCloud(id);
              if (target?.product) {
                void deleteDiscoverySearchesByMeta(target.product, target.country || '');
              }
            }
          }}
          onPatchHistory={async (id, patch) => {
            setHistory((prev) => {
              const next = prev.map((h) => (h.id === id ? { ...h, ...patch } : h));
              const item = next.find((h) => h.id === id);
              if (item) persistHistoryItem(item).catch(console.error);
              return next;
            });
          }}
          onBulkPatchHistory={async (ids, patch) => {
            const idSet = new Set(ids);
            setHistory((prev) => {
              const next = prev.map((h) => (idSet.has(h.id) ? { ...h, ...patch } : h));
              next.filter((h) => idSet.has(h.id)).forEach((item) => {
                persistHistoryItem(item).catch(console.error);
              });
              return next;
            });
          }}
          onReanalyzeHistory={handleReanalyzeHistoryItem}
        />
      )}

      {/* Cloud Connect Modal */}
      {cloudModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
              <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md animate-fade-in">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Cloud size={18}/> 连接 GitHub 云端数据库</h3>
                      <button onClick={() => setCloudModalOpen(false)}><X size={20} className="text-slate-400"/></button>
                  </div>
                  <div className="space-y-4">
                      <p className="text-xs text-slate-500">请输入管理员提供的 GitHub Token 以同步知识库、配置和 CRM 数据。</p>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1">GitHub Token (ghp_...)</label>
                          <input type="password" value={manualToken} onChange={e => setManualToken(e.target.value)} className="w-full p-2 border rounded-xl" placeholder="ghp_xxxxxxxxxxxx" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-slate-500 mb-1">Owner</label>
                              <input type="text" value={manualOwner} onChange={e => setManualOwner(e.target.value)} className="w-full p-2 border rounded-xl" placeholder="Repo Owner" />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-slate-500 mb-1">Repo</label>
                              <input type="text" value={manualRepo} onChange={e => setManualRepo(e.target.value)} className="w-full p-2 border rounded-xl" placeholder="Repo Name" />
                          </div>
                      </div>
                      <button onClick={handleManualConnect} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700">连接并同步 (Connect & Sync)</button>
                  </div>
              </div>
          </div>
      )}

      {/* 主区：margin 让开固定侧栏，宽度 calc(100% - 侧栏) 保证满屏 */}
      <div className="tp-workspace min-w-0 max-w-none flex flex-col">
      <main className="tp-app-main flex-1 flex flex-col relative min-w-0 w-full max-w-none">
        <header
          className={`tp-header w-full max-w-none px-3 sm:px-5 z-10 ${
            activeModule === ModuleType.DISCOVERY || activeModule === ModuleType.BACKGROUND
              ? 'py-3 sm:py-4 flex flex-col gap-3'
              : 'py-2 sm:py-2.5 flex flex-col gap-0 tp-header--slim'
          }`}
        >
          {activeModule === ModuleType.HOME || activeModule === ModuleType.SMART_TASKS ? (
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(true)} className="md:hidden p-2 text-slate-500 flex-shrink-0 touch-manipulation" aria-label="打开菜单"><Menu size={24} /></button>
              <div className="text-[11px] font-bold text-slate-500">
                <span className="uppercase tracking-[0.16em] text-cyan-700/80">指挥舱</span>
                <span className="text-slate-300 mx-2">/</span>
                <span className="text-slate-800">
                  {activeModule === ModuleType.SMART_TASKS ? '智能任务' : '今日看板'}
                </span>
              </div>
            </div>
          ) : activeModule === ModuleType.DISCOVERY || activeModule === ModuleType.BACKGROUND ? (
            <>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-3 sm:contents">
                  <button onClick={() => setMobileMenuOpen(true)} className="md:hidden p-2 text-slate-500 flex-shrink-0 touch-manipulation" aria-label="打开菜单"><Menu size={24} /></button>
                  <div className="flex-1 relative group min-w-0 sm:order-none">
                    <Search className="absolute left-3 sm:left-4 top-3 sm:top-5 text-signal-500/70 pointer-events-none" size={20} />
                    <textarea
                      className="tp-scan-input w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-3 sm:py-4 rounded-2xl text-slate-950 font-semibold text-sm sm:text-base focus:outline-none transition-all resize-none overflow-hidden min-h-[48px] sm:min-h-[56px] focus:min-h-[100px] sm:focus:min-h-[120px] z-20 relative placeholder:text-slate-500"
                      placeholder="输入目标网址或公司名称..."
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAnalyzeInput();
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto flex-shrink-0">
                  {hasPermission(currentUser, 'feature.batch_analyze') && (
                    <button
                      type="button"
                      onClick={() => setExcelBatchOpen(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-2xl border border-teal-200 bg-teal-50 hover:bg-teal-100 text-teal-900 px-4 sm:px-5 py-3 text-sm font-extrabold touch-manipulation"
                      title="下载模板并上传 Excel，批量背调与产品分析"
                    >
                      <FileSpreadsheet size={18} /> Excel 批量
                    </button>
                  )}
                  <button
                    onClick={() => handleAnalyzeInput()}
                    disabled={loading || !domainInput.trim()}
                    className="tp-btn-primary text-white px-6 sm:px-8 py-3 rounded-2xl font-extrabold disabled:opacity-50 w-full sm:w-auto sm:min-w-[140px] flex justify-center items-center touch-manipulation"
                  >
                    {loading ? <Loader2 className="animate-spin" size={20} /> : '深度调查'}
                  </button>
                </div>
              </div>
              {(activeSectionMeta || activeNavItem) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500">
                  <span className="uppercase tracking-[0.16em] text-cyan-700/80">板块</span>
                  <span className="text-slate-800">{activeSectionMeta?.label || '—'}</span>
                  <span className="text-slate-300">/</span>
                  <span className="text-slate-700">{activeNavItem?.label || activeModule}</span>
                  {activeNavItem?.comingSoon && (
                    <span className="text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-md">
                      框架占位
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setMobileMenuOpen(true)} className="md:hidden p-2 text-slate-500 flex-shrink-0 touch-manipulation" aria-label="打开菜单"><Menu size={24} /></button>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-500 min-w-0">
                <span className="uppercase tracking-[0.16em] text-cyan-700/80">板块</span>
                <span className="text-slate-800">{activeSectionMeta?.label || '—'}</span>
                <span className="text-slate-300">/</span>
                <span className="text-slate-700 truncate">{activeNavItem?.label || activeModule}</span>
                {activeNavItem?.comingSoon && (
                  <span className="text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-md">
                    框架占位
                  </span>
                )}
              </div>
            </div>
          )}
        </header>

        <div className="tp-main-stage flex-1 overflow-x-hidden p-3 sm:p-4 md:p-5 relative w-full max-w-none min-w-0">
          <CooldownOverlay />

          {loading && (
            <div className="absolute inset-0 bg-mist-50/90 z-50 flex flex-col items-center justify-center backdrop-blur-md animate-fade-in">
              <div className="relative mb-6">
                <div className="absolute inset-0 rounded-full bg-signal-400/20 blur-xl animate-pulse" />
                <Loader2 className="relative animate-spin w-16 h-16 text-signal-500" />
              </div>
              <h3 className="text-2xl font-extrabold text-ink-900 tracking-tight">正在深度挖掘情报...</h3>
              <p className="text-slate-500 mt-2 font-medium text-center px-4">正在联网检索官网、贸易线索、认证信息与决策人邮箱...</p>
            </div>
          )}
          
          {errorMsg && (
              <div className="max-w-xl mx-auto mt-20 text-center p-8 bg-white rounded-3xl border border-red-100 shadow-xl">
                  <div className="bg-red-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500"><AlertTriangle size={40} /></div>
                  <h3 className="text-xl font-black text-slate-800 mb-2">Oops! 分析遇到问题</h3>
                  <div className="bg-slate-100 p-4 rounded-xl text-xs font-mono text-left mb-6 break-words border border-slate-200 text-slate-600">{errorMsg}</div>
                  <button onClick={() => handleAnalyzeInput()} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors flex items-center gap-2 mx-auto">
                      <RefreshCw size={18} /> 重新尝试
                  </button>
              </div>
          )}

          {!loading && !errorMsg && (
            <>
                <ModulePane id={ModuleType.HOME} activeId={activeModule} maxAlive={KA} label="今日看板">
                  <ErrorBoundary label="今日看板">
                    <ModuleLandingHub
                      currentUser={currentUser}
                      history={history}
                      syncStatus={workspaceSyncStatus}
                      syncing={workspaceSyncing}
                      onEnterWorkspace={() => navigateModule(ModuleType.DISCOVERY)}
                      onNavigateModule={(mod) => {
                        // 报告类模块依赖当前 analysisData；未打开报告时改走作业列表，避免空白页
                        const needsReport = (
                          [
                            ModuleType.BACKGROUND,
                            ModuleType.PRODUCTS,
                            ModuleType.DECISION_MAKERS,
                            ModuleType.SIMILAR,
                          ] as ModuleType[]
                        ).includes(mod);
                        if (needsReport && !analysisData) {
                          navigateModule(ModuleType.PROMO_GENERATOR);
                          setSystemNotice(
                            '请先在「营销工具 / 背调作业」打开一条已完成报告，再查看背调详情。'
                          );
                          return;
                        }
                        navigateModule(mod);
                      }}
                      journeyProgress={{
                        skuCount: loadCatalogSkus().length,
                        pendingTasks: 0,
                        failedTasks: 0,
                        completedBg: 0,
                        crmCount: crmClients.length,
                      }}
                    />
                  </ErrorBoundary>
                </ModulePane>
                <ModulePane id={ModuleType.SMART_TASKS} activeId={activeModule} maxAlive={KA}>
                  <ErrorBoundary label="智能任务">
                    <div className="w-full max-w-none min-w-0 space-y-3">
                      <div className="rounded-2xl border border-cyan-100 bg-cyan-50/50 px-4 py-3">
                        <div className="text-sm font-black text-slate-900">智能任务</div>
                        <p className="text-xs text-slate-600 font-medium mt-1 leading-relaxed">
                          按七步推进选品、报价、设计、获客、背调、触达与成交；可点步骤直接进入对应功能。
                        </p>
                      </div>
                      <TradeJourneyPanel
                        progressHint={{
                          skuCount: loadCatalogSkus().length,
                          pendingTasks: 0,
                          failedTasks: 0,
                          completedBg: history.length,
                          crmCount: crmClients.length,
                        }}
                        onNavigate={(mod) => {
                          const needsReport = (
                            [
                              ModuleType.BACKGROUND,
                              ModuleType.PRODUCTS,
                              ModuleType.DECISION_MAKERS,
                              ModuleType.SIMILAR,
                            ] as ModuleType[]
                          ).includes(mod);
                          if (needsReport && !analysisData) {
                            navigateModule(ModuleType.PROMO_GENERATOR);
                            setSystemNotice(
                              '请先在「营销工具 / 背调作业」打开一条已完成报告，再查看背调详情。'
                            );
                            return;
                          }
                          navigateModule(mod);
                        }}
                        onStartPlaybook={(playbookId) => {
                          setPendingPlaybookId(playbookId);
                          navigateModule(ModuleType.PROMO_GENERATOR);
                        }}
                      />
                    </div>
                  </ErrorBoundary>
                </ModulePane>
                <ModulePane id={ModuleType.DISCOVERY} activeId={activeModule} maxAlive={KA}>
                    <ClientFinder 
                        state={discoveryState} 
                        onStateChange={handleDiscoveryStateChange}
                        username={currentUser.username}
                        discoveryArchives={discoveryArchives}
                        history={history}
                        crmClients={crmClients}
                        onSearchArchived={handleSearchArchived}
                        onSelect={(item) => {
                          const domain = typeof item === 'string' ? item : (item.website || item.name);
                          const kw =
                            typeof item === 'string'
                              ? discoveryState.product
                              : (item.searchKeyword || discoveryState.product);
                          // Prefer company country from the search hit; avoid "Global" masking Poland etc.
                          const countryFromItem =
                            typeof item === 'string'
                              ? ''
                              : (item.country || item.searchCountry || item.city || '').trim();
                          const tags =
                            typeof item === 'string' ? undefined : item.searchTags;
                          if (kw && kw !== discoveryState.product) {
                            setDiscoveryState((prev) => ({ ...prev, product: kw }));
                          }
                          setDomainInput(domain);
                          if (!hasPermission(currentUser, 'feature.analyze_company')) {
                            alert('你没有「单次背调」权限，请联系管理员或部门主管开通。');
                            return;
                          }
                          const limit = checkLimit('analysis');
                          if (!limit.allowed) {
                            alert(`今日背调次数已达上限（${limit.current}/${limit.max}）。请联系管理员提高限额，或明日再试。`);
                            return;
                          }
                          const alreadyChecked = lookupBackgroundCheck(
                            domain,
                            typeof item === 'string' ? domain : item.name,
                            getHistorySnapshot(),
                            getCrmClientsSnapshot()
                          ).checked;
                          performSingleAnalysis(domain, {
                            searchKeyword: kw || undefined,
                            searchCountry: countryFromItem || undefined,
                            searchTags: tags,
                            force: alreadyChecked,
                          });
                        }}
                        onOpenExistingReport={handleOpenExistingFromSearch}
                        onBatchAddToCRM={handleBatchAddToCRM}
                        onBatchAnalyze={handleBatchAnalyzeExisting}
                        autoSearchNonce={discoveryAutoSearchNonce}
                        onAutoSearchConsumed={() => setDiscoveryAutoSearchNonce(0)}
                    />
                </ModulePane>
                <ModulePane id={ModuleType.CLIENT_CRM} activeId={activeModule} maxAlive={KA}>
                    <ModuleClientCRM 
                        clients={crmClients} 
                        setClients={setCrmClients} 
                        onBatchAnalyze={handleBatchAnalyzeFromCRM} 
                        onBatchDmSearch={handleBatchDmSearchFromCRM}
                        onBatchDelete={handleBatchDeleteClients}
                        onDeleteClient={handleDeleteClient}
                        onBatchProductDig={handleBatchProductDigFromCRM}
                        onBatchDesignSignalFill={handleStartDesignFill}
                        onBatchAnalysisEnrichment={handleBatchAnalysisEnrichmentFromCRM}
                        analysisEnrichmentBusy={isEnrichmentQueueBusy()}
                        designSignalBusy={false}
                        onPurgeBeforeJune2026={handlePurgeCrmBeforeJune2026}
                        onPurgeNonToyJunk={async () => {
                          clearAutoPurgeNonToyJunkFlag();
                          await handlePurgeNonToyJunkLeads({ skipConfirm: false });
                          return;
                        }}
                        onRecoverCrm={handleRecoverCrm}
                        productDigBusy={isProductDigQueueBusy() || productDigProgress.active > 0}
                        onReanalyze={handleReanalyzeCrmClient}
                        history={history}
                        onOpenHistory={loadFromHistory}
                        onOpenClientReport={openCrmClientReport}
                        onNavOrderChange={setCrmNavOrder}
                    />
                </ModulePane>
                <ModulePane id={ModuleType.PRODUCT_MATCH} activeId={activeModule} maxAlive={KA} label="产品匹配">
                    <ModuleProductMatch
                        history={history}
                        crmClients={crmClients}
                        currentUser={currentUser}
                        focusAnalysis={analysisData}
                        onCrmClientsChange={setCrmClients}
                        onStartDesignFill={handleStartDesignFill}
                        onOpenHistory={loadFromHistory}
                        onGoCrm={() => navigateModule(ModuleType.CLIENT_CRM)}
                        onNavigateModule={navigateModule}
                        onBackToReport={() => navigateModule(ModuleType.BACKGROUND)}
                    />
                </ModulePane>
                <ModulePane
                  id={ModuleType.EMAIL_CAMPAIGN}
                  activeId={activeModule}
                  maxAlive={KA}
                  label="邮件营销"
                  loadingText="邮件营销加载中…"
                >
                        <ModuleEmailCampaign
                          crmClients={crmClients}
                          onAddClients={handleAddClients}
                          currentUser={currentUser}
                          users={users}
                          departments={departments}
                          onEmailsSent={(rows) => {
                            setCrmClients((prev) => {
                              let next = prev;
                              for (const row of rows) {
                                next = next.map((c) => {
                                  if (row.clientId && c.id === row.clientId) {
                                    return markEmailSentOnClient(c, {
                                      to: row.to,
                                      subject: row.subject,
                                      by: currentUser.username,
                                    });
                                  }
                                  const nameHit =
                                    row.companyName &&
                                    (c.name || '').toLowerCase() === row.companyName.toLowerCase();
                                  if (!row.clientId && nameHit) {
                                    return markEmailSentOnClient(c, {
                                      to: row.to,
                                      subject: row.subject,
                                      by: currentUser.username,
                                    });
                                  }
                                  return c;
                                });
                              }
                              return next;
                            });
                          }}
                        />
                </ModulePane>
                <ModulePane id={ModuleType.IMAGE_GENERATOR} activeId={activeModule} maxAlive={KA} label="生图">
                    <ModuleImageGenerator />
                </ModulePane>
                {currentUser && (
                  <>
                    <ModulePane id={ModuleType.PRODUCT_CATALOG} activeId={activeModule} maxAlive={KA} label="产品库">
                      <ModuleProductCatalog currentUser={currentUser} />
                    </ModulePane>
                    <ModulePane id={ModuleType.PRODUCT_QUOTE} activeId={activeModule} maxAlive={KA} label="报价选品">
                      <ModuleProductQuote currentUser={currentUser} />
                    </ModulePane>
                    <ModulePane id={ModuleType.PRODUCT_DESIGN_2D} activeId={activeModule} maxAlive={KA}>
                      <ModuleProductDesign2D
                        currentUser={currentUser}
                        onNavigateModule={navigateModule}
                      />
                    </ModulePane>
                    <ModulePane id={ModuleType.PRODUCT_DESIGN_3D} activeId={activeModule} maxAlive={KA}>
                      <ModuleProductDesign3D
                        currentUser={currentUser}
                        onNavigateModule={navigateModule}
                      />
                    </ModulePane>
                    <ModulePane id={ModuleType.PRODUCT_AI_VIDEO} activeId={activeModule} maxAlive={KA}>
                      <ModuleProductAiVideo
                        currentUser={currentUser}
                        onNavigateModule={navigateModule}
                      />
                    </ModulePane>
                    <ModulePane id={ModuleType.PRODUCT_PACKAGING} activeId={activeModule} maxAlive={KA}>
                      <ModuleProductPackaging
                        currentUser={currentUser}
                        onNavigateModule={navigateModule}
                      />
                    </ModulePane>
                    <ModulePane id={ModuleType.SITE_BUILDER} activeId={activeModule} maxAlive={KA}>
                      <ModuleSiteBuilder currentUser={currentUser} />
                    </ModulePane>
                    <ModulePane id={ModuleType.SOCIAL_CONTENT} activeId={activeModule} maxAlive={KA}>
                      <ModuleSocialContent currentUser={currentUser} />
                    </ModulePane>
                    <ModulePane id={ModuleType.WHATSAPP} activeId={activeModule} maxAlive={KA}>
                      <ModuleContactTools currentUser={currentUser} crmClients={crmClients} />
                    </ModulePane>
                  </>
                )}
                {(
                  [
                    ModuleType.PRODUCT_3D_PRINT,
                    ModuleType.ECO_PARTS,
                    ModuleType.ECO_MERCH,
                    ModuleType.ECO_CERT,
                    ModuleType.ECO_AUDIT,
                    ModuleType.ECO_DELIVERY,
                  ] as ModuleType[]
                ).includes(activeModule) && <ModuleComingSoon module={activeModule} />}
                <ModulePane id={ModuleType.PROMO_GENERATOR} activeId={activeModule} maxAlive={KA}>
                    <ModulePromoGenerator 
                        onStartAutomation={handleStartQueueGeneration} 
                        onPlatformAcquisitionSearch={handlePlatformAcquisitionSearch}
                        initialPlaybookId={pendingPlaybookId}
                        onInitialPlaybookConsumed={() => setPendingPlaybookId(null)}
crmClients={crmClients}
                        history={history}
                        isAutomating={isAutomating} 
                        onRunPending={handleRunPending}
                        onRunSingle={handleRunSingle}
                        onRerunCompleted={handleRerunCompletedTask}
                        onDelete={handleDeleteTask}
                        onViewResult={handleViewAutomationResult}
                        onOpenClient={openCrmClientReport}
                        onOpenHistoryItem={loadFromHistory}
                        onDownloadResult={handleDownloadAutomationResult}
                        onDownloadAll={handleDownloadAllCompleted}
                        canExportPpt={hasPermission(currentUser, 'feature.export_ppt')}
                        canDmMine={hasPermission(currentUser, 'feature.dm_email_search')}
                        canCrmImport={canAccessModule(currentUser, ModuleType.CLIENT_CRM)}
                        canProductDig={
                          hasPermission(currentUser, 'feature.product_redig') ||
                          hasPermission(currentUser, 'feature.analyze_company')
                        }
                        onBatchDmSearch={handleBatchDmSearchFromPromo}
                        onBatchAddToCrm={handleBatchAddToCrmFromPromo}
                        onBatchProductDig={handleBatchProductDigFromPromo}
                        canAnalysisEnrichment={
                          hasPermission(currentUser, 'feature.product_redig') ||
                          hasPermission(currentUser, 'feature.analyze_company')
                        }
                        onBatchAnalysisEnrichment={handleBatchAnalysisEnrichmentFromPromo}
                        analysisEnrichmentBusy={isEnrichmentQueueBusy()}
                        onClearCompleted={handleClearCompletedTasks}
                        onClearAll={handleClearAllTasks}
                        onReloadQueue={handleReloadAutomationQueue}
                        queueSyncing={workspaceSyncing}
                        queueSyncStatus={workspaceSyncStatus}
                        canViewEmails={canViewFullDecisionMakerEmails(currentUser)}
                    />
                </ModulePane>
                <ModulePane id={ModuleType.STRATEGY} activeId={activeModule} maxAlive={KA}>
                    <div className="animate-fade-in w-full pb-10">
                        {analysisData && (
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 rounded-2xl border border-slate-200 shadow-sm">
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-600 shrink-0">Strategy</span>
                                  <h2 className="text-sm sm:text-base font-extrabold text-slate-900 truncate">{analysisData.companyInfo?.name}</h2>
                                  <span className="text-[10px] text-slate-400 font-semibold shrink-0">深度调查</span>
                            </div>
                    </div>
                )}
                        <ModuleStrategy
                          data={analysisData}
                          history={history}
                          discoveryArchives={discoveryArchives}
                          onNavigateModule={navigateModule}
                          onSaveGeneratedEmails={async (emails, forCompany) => {
                            const target = forCompany || analysisDataRef.current;
                            if (!target) return;
                            const nextData: AnalysisResult = {
                              ...target,
                              generatedEmails: emails,
                              generatedEmailsAt: Date.now(),
                            };
                            // 仅记录「已生成」活动，不改 lastContactSent（未真实发送）
                            const cName = (nextData.companyInfo?.name || '').toLowerCase();
                            const cSite = (nextData.companyInfo?.website || '')
                              .toLowerCase()
                              .replace(/^https?:\/\//, '');
                            setCrmClients((prev) =>
                              prev.map((c) => {
                                const hit =
                                  (c.name || '').toLowerCase() === cName ||
                                  (!!cSite &&
                                    (c.website || '')
                                      .toLowerCase()
                                      .replace(/^https?:\/\//, '')
                                      .includes(cSite));
                                if (!hit) return c;
                                return appendClientActivity(c, {
                                  kind: 'mail_group',
                                  summary: '已生成开发信（尚未发送）',
                                  detail: emails.sendTip || emails.analysis?.slice(0, 120),
                                  by: currentUser.username,
                                });
                              })
                            );
                            const domainKey = (nextData.companyInfo?.website || '').toLowerCase();
                            const nameKey = (nextData.companyInfo?.name || '').toLowerCase();
                            const currentKey = (
                              analysisDataRef.current?.companyInfo?.website ||
                              analysisDataRef.current?.companyInfo?.name ||
                              ''
                            ).toLowerCase();
                            const isCurrent =
                              !!analysisDataRef.current &&
                              (domainKey ===
                                (analysisDataRef.current.companyInfo?.website || '').toLowerCase() ||
                                nameKey ===
                                  (analysisDataRef.current.companyInfo?.name || '').toLowerCase() ||
                                domainKey === currentKey ||
                                nameKey === currentKey);

                            if (isCurrent) {
                              await persistCurrentAnalysis(nextData);
                              return;
                            }

                            setHistory((prev) => {
                              let updatedItem: HistoryItem | null = null;
                              const next = prev.map((h) => {
                                const hit =
                                  (h.domain || '').toLowerCase() === domainKey ||
                                  (h.data?.companyInfo?.website || '').toLowerCase() === domainKey ||
                                  (h.data?.companyInfo?.name || '').toLowerCase() === nameKey;
                                if (!hit) return h;
                                updatedItem = { ...h, data: { ...h.data, ...nextData } };
                                return updatedItem;
                              });
                              if (updatedItem) {
                                persistHistoryItem(updatedItem).catch(console.error);
                              }
                              return next;
                            });
                          }}
                        />
                    </div>
                </ModulePane>
                {analysisData && !alwaysActiveModules.includes(activeModule) && (
                    <ErrorBoundary label="背调报告">
                    <div className="animate-fade-in w-full pb-10">
                    <div className="mb-6 sm:mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-panel">
                        <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-600 mb-1">Target Profile</div>
                            <div className="flex items-start gap-2 sm:gap-3 flex-wrap">
                              <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight break-words min-w-0">
                                {analysisData.companyInfo?.name || '未知公司'}
                              </h2>
                              {crmNavOrder.length > 0 && (
                                <div className="mt-1 sm:mt-2 flex items-center gap-1.5 flex-shrink-0">
                                  <button
                                    type="button"
                                    disabled={resolveCrmNavIndex() <= 0}
                                    onClick={() => goToAdjacentCrmReport(-1)}
                                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 text-xs font-black touch-manipulation disabled:opacity-40"
                                  >
                                    前一个
                                  </button>
                                  <span className="text-xs font-black text-slate-500 tabular-nums px-1">
                                    {resolveCrmNavIndex() >= 0
                                      ? `${resolveCrmNavIndex() + 1} / ${crmNavOrder.length}`
                                      : `— / ${crmNavOrder.length}`}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={
                                      resolveCrmNavIndex() < 0 ||
                                      resolveCrmNavIndex() >= crmNavOrder.length - 1
                                    }
                                    onClick={() => goToAdjacentCrmReport(1)}
                                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 text-xs font-black touch-manipulation disabled:opacity-40"
                                  >
                                    后一个
                                  </button>
                        </div>
                              )}
                              <div className="mt-1 sm:mt-2 flex items-center gap-2 flex-shrink-0 relative z-10">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    askExcludeCurrentCompany();
                                  }}
                                  disabled={reportActionBusy}
                                  title="仅排除：下次搜索跳过，报告仍保留"
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 px-3 py-1.5 text-xs font-black touch-manipulation disabled:opacity-50"
                                >
                                  <Ban size={14} /> 排除
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    askDeleteCurrentReport();
                                  }}
                                  disabled={reportActionBusy}
                                  title="仅删除本报告：同步删除 CRM 匹配客户"
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 px-3 py-1.5 text-xs font-black touch-manipulation disabled:opacity-50"
                                >
                                  <Trash2 size={14} /> 删除
                                </button>
                    </div>
                    </div>
                            <a href={websiteHref(analysisData.companyInfo?.website)} target="_blank" rel="noreferrer" className="text-cyan-600 font-semibold mt-2 hover:underline text-sm sm:text-base break-all">{analysisData.companyInfo?.website || '—'}</a>
                            {(() => {
                              const bgMeta = lookupBackgroundCheck(
                                analysisData.companyInfo?.website,
                                analysisData.companyInfo?.name,
                                history,
                                crmClients
                              );
                              const histTs =
                                (viewingHistoryId && history.find((h) => h.id === viewingHistoryId)?.timestamp) ||
                                bgMeta.checkedAt;
                              const timeLabel = formatBackgroundCheckTime(histTs);
                              const kws = Array.from(
                                new Set(
                                  [
                                    analysisData.searchKeyword,
                                    ...bgMeta.keywords,
                                    ...(analysisData.searchTags || [])
                                      .filter((t) => t.startsWith('关键词:'))
                                      .map((t) => t.replace(/^关键词:/, '')),
                                  ].filter(Boolean) as string[]
                                )
                              );
                              const otherTags = (analysisData.searchTags || []).filter(
                                (t) => !t.startsWith('关键词:') && !t.startsWith('搜索来源')
                              );
                              return (
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                  <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg border border-emerald-100">
                                    已背调{timeLabel ? ` · ${timeLabel}` : ''}
                                  </span>
                                  {(bgMeta.ownerUsername ||
                                    (viewingHistoryId &&
                                      history.find((h) => h.id === viewingHistoryId)?.ownerUsername)) && (
                                    <span className="text-[10px] font-black bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg border border-indigo-100">
                                      拥有人 ·{' '}
                                      {bgMeta.ownerUsername ||
                                        history.find((h) => h.id === viewingHistoryId)?.ownerUsername}
                                    </span>
                                  )}
                                  {kws.map((kw) => (
                                    <span
                                      key={kw}
                                      className="text-[10px] font-black bg-amber-50 text-amber-700 px-2 py-1 rounded-lg"
                                    >
                                      关键词: {kw}
                                    </span>
                                  ))}
                                  {otherTags.slice(0, 6).map((t) => (
                                    <span
                                      key={t}
                                      className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded-lg"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto flex-shrink-0">
                          {hasPermission(currentUser, 'feature.analyze_company') && (
                            <button
                              type="button"
                              onClick={handleReanalyzeCurrent}
                              disabled={loading}
                              className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 transition-colors text-white px-4 sm:px-6 py-3 rounded-2xl font-semibold shadow-lg touch-manipulation"
                            >
                              <RefreshCw size={18} /> 再次背调
                            </button>
                          )}
                          {hasPermission(currentUser, 'feature.dm_email_search') && (
                            <button
                              type="button"
                              onClick={() => {
                                const res = enqueueCurrentDmEmailSearch(analysisData, viewingHistoryId);
                                if (res.message) alert(res.message);
                              }}
                              className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 transition-colors text-white px-4 sm:px-6 py-3 rounded-2xl font-semibold shadow-signal touch-manipulation"
                            >
                              <Users size={18} />{' '}
                              {analysisData.decisionMakerEmailSearchAt ||
                              (analysisData.decisionMakers || []).some(
                                (d) => !!(d.emailGuess && String(d.emailGuess).includes('@'))
                              )
                                ? '再次深挖决策人邮箱'
                                : '后台搜索决策人邮箱'}
                            </button>
                          )}
                          {hasPermission(currentUser, 'feature.export_ppt') && (
                            <button onClick={handleExportReport} className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-blue-600 transition-colors text-white px-4 sm:px-6 py-3 rounded-2xl font-bold shadow-lg touch-manipulation"><FileSpreadsheet size={18} /> 下载 PPT 报告</button>
                          )}
                        </div>
                    </div>
                    {analysisData.generatedEmails && (
                      <div className="mb-6">
                        <ReportEnrichmentPanel
                          data={analysisData}
                          showDecisionMakers={false}
                          canViewEmails={canViewFullDecisionMakerEmails(currentUser)}
                        />
                      </div>
                    )}
                    {activeModule === ModuleType.BACKGROUND && (
                      <ModuleBackground
                        data={analysisData}
                        onAddToCRM={handleAddToCRM}
                        onEnqueueDmEmailSearch={
                          hasPermission(currentUser, 'feature.dm_email_search')
                            ? () => enqueueCurrentDmEmailSearch(analysisData, viewingHistoryId)
                            : undefined
                        }
                        hasPriorDmSearch={
                          !!analysisData.decisionMakerEmailSearchAt ||
                          (analysisData.decisionMakers || []).some(
                            (d) => !!(d.emailGuess && String(d.emailGuess).includes('@'))
                          )
                        }
                        onReanalyze={
                          hasPermission(currentUser, 'feature.analyze_company')
                            ? handleReanalyzeCurrent
                            : undefined
                        }
                        backgroundCheckedAt={
                          (viewingHistoryId && history.find((h) => h.id === viewingHistoryId)?.timestamp) ||
                          lookupBackgroundCheck(
                            analysisData.companyInfo?.website,
                            analysisData.companyInfo?.name,
                            history,
                            crmClients
                          ).checkedAt
                        }
                        onAnalyzeSimilar={(domain) => handleAnalyzeInput(domain)}
                        onBatchAnalyzeSimilar={handleBatchAnalyzeSimilar}
                        lookupChecked={similarCompanyLookup}
                        onOpenReport={loadFromHistory}
                      />
                    )}
                    {activeModule === ModuleType.PRODUCTS && (
                      <ModuleProducts
                        data={analysisData}
                        onAddToCRM={handleAddToCRM}
                        onUpdateProductSummary={(summary) => {
                          const next = { ...analysisData, productSummary: summary };
                          persistCurrentAnalysis(next).catch(console.error);
                        }}
                      />
                    )}
                    {activeModule === ModuleType.DECISION_MAKERS && (
                      <ModuleDecisionMakers
                        data={analysisData}
                        historyId={viewingHistoryId}
                        onAddToCRM={handleAddToCRM}
                        canDmEmailSearch={hasPermission(currentUser, 'feature.dm_email_search')}
                        canExportExcel={hasPermission(currentUser, 'feature.export_report')}
                        canViewEmails={canViewFullDecisionMakerEmails(currentUser)}
                        onUpdate={(dms, meta) => {
                          const next = {
                            ...analysisData,
                            decisionMakers: dms,
                            ...(meta?.decisionMakerEmailSearchAt != null
                              ? { decisionMakerEmailSearchAt: meta.decisionMakerEmailSearchAt }
                              : {}),
                            ...(meta?.decisionMakerEmailSearchHistory
                              ? { decisionMakerEmailSearchHistory: meta.decisionMakerEmailSearchHistory }
                              : {}),
                          };
                          persistCurrentAnalysis(next).catch(console.error);
                        }}
                        onEnqueueEmailSearch={
                          hasPermission(currentUser, 'feature.dm_email_search')
                            ? () => enqueueCurrentDmEmailSearch(analysisData, viewingHistoryId)
                            : undefined
                        }
                      />
                    )}
                    {activeModule === ModuleType.SIMILAR && (
                      <ModuleSimilar
                        data={analysisData}
                        onAnalyze={handleAnalyzeInput}
                        onBatchAnalyze={handleBatchAnalyzeSimilar}
                        lookupChecked={similarCompanyLookup}
                        onOpenReport={loadFromHistory}
                      />
                    )}
                    </div>
                    </ErrorBoundary>
                )}
            </>
          )}
        </div>
      </main>
      </div>
      
      <BatchBackgroundExcelPanel
        open={excelBatchOpen}
        onClose={() => setExcelBatchOpen(false)}
        history={history}
        crmClients={crmClients}
        onStart={handleExcelBatchStart}
      />
      
      {/* Batch Modal */}
      {batchModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl animate-fade-in">
                  <div className="p-8 border-b border-slate-100 text-center">
                      <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 text-blue-600"><Layers size={32}/></div>
                      <h3 className="text-2xl font-black text-slate-800 mb-2">批量分析策略</h3>
                      <p className="text-slate-500 font-medium">已选择 {pendingBatch.length} 个潜在客户。</p>
                  </div>
                  <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                      <button onClick={() => confirmBatchStart('detailed')} className="p-6 border-2 border-slate-200 rounded-2xl hover:border-purple-500 hover:bg-purple-50 group text-left transition-all">
                          <div className="font-bold text-slate-800 text-lg mb-2 group-hover:text-purple-700">详细模式</div>
                          <ul className="text-xs text-slate-500 space-y-2">
                              <li>✅ 逐个进行背景调查</li>
                              <li>✅ 每个客户单独生成 PPT</li>
                              <li>ℹ️ 开发信请在策略模块手动生成</li>
                          </ul>
                      </button>
                      <button onClick={() => confirmBatchStart('economy')} className="p-6 border-2 border-slate-200 rounded-2xl hover:border-green-500 hover:bg-green-50 group text-left transition-all">
                          <div className="font-bold text-slate-800 text-lg mb-2 group-hover:text-green-700">经济模式 (省流)</div>
                          <ul className="text-xs text-slate-500 space-y-2">
                              <li>✅ 逐个进行背景调查</li>
                              <li>✅ 1 份合并 PPT</li>
                              <li>ℹ️ 开发信请在策略模块手动生成</li>
                              <li>⚡️ 快速高效</li>
                          </ul>
                      </button>
                  </div>
                  <div className="p-6 border-t border-slate-100 flex justify-center">
                      <button onClick={() => setBatchModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold text-sm">取消操作</button>
                  </div>
              </div>
          </div>
      )}

      {/* 后台任务条统一放左下：避让侧栏宽度，避免挡住圆形菜单与 CRM 表格 */}
      <div
        className="fixed bottom-4 z-[60] flex flex-col-reverse gap-3 w-[min(100vw-2rem,22rem)] pointer-events-none [&>*]:pointer-events-auto left-4 md:left-[calc(var(--tp-sidebar-w)+1rem)]"
      >
        {hasPermission(currentUser, 'feature.dm_email_search') && <DmEmailSearchPanel />}
        <SiteBuildPanel />
        <DesignSignalPanel />
        <ProductDigPanel />
        <EnrichmentPanel />
        <NightUpgradePanel />
        <WorkerModeBadge
          onStop={() => {
            setWorkerModeActive(false);
            setWorkerModeOn(false);
            shouldStopRef.current = true;
            stopAllBackgroundWork();
            setSystemNotice('已停止本机挂机及全部后台任务。');
          }}
        />
    </div>

      {currentUser.role === 'admin' && (
        <WorkerModePrompt
          open={workerPromptOpen}
          onConfirm={handleWorkerConfirm}
          onDecline={handleWorkerDecline}
          onDismiss={() => setWorkerPromptOpen(false)}
        />
      )}

      {reportConfirm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 sm:p-6 animate-fade-in">
            <h3
              className={`text-lg font-black mb-3 ${
                reportConfirm.type === 'delete' ? 'text-rose-700' : 'text-amber-800'
              }`}
            >
              {reportConfirm.title}
            </h3>
            <p className="text-sm font-medium text-slate-600 whitespace-pre-wrap leading-relaxed mb-6">
              {reportConfirm.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setReportConfirm(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleReportConfirmOk()}
                disabled={reportActionBusy}
                className={`px-4 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50 ${
                  reportConfirm.type === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {reportActionBusy ? '处理中…' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {teamManageOpen && currentUser.role === 'manager' && (
        <ManagerSystemPanel
          currentUser={currentUser}
          users={users}
          setUsers={setUsers}
          departments={departments}
          setDepartments={setDepartments}
          onClose={() => setTeamManageOpen(false)}
        />
      )}

    </div>{/* .tp-app */}
    </AccessGate>
  );
};
export default App;
