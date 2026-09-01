
import React, { useState, useEffect, useRef } from 'react';
import { analyzeCompany, hasApiKeyConfigured, checkApiKeyAvailability, hydrateApiConfigsFromCloud, searchPotentialClients, enableTavilyGeminiQwenCascade } from './services/geminiService';
import {
  subscribeCooldown,
  withRateLimitRetry,
  isRateLimitError,
  noteRateLimited,
  getCooldownRemainingSec,
} from './services/rateLimitGate';
import { exportToPPT, exportAutomationReportToPPT, exportBatchAutomationReportsToPPT } from './services/exportService';
import { saveHistory, getHistory, getAllFilesFromDB, saveAutomationTask, getAutomationQueue, deleteAutomationTask, saveFileToDB, saveDiscoveryArchive, getDiscoveryArchives, deleteDiscoveryArchive, deleteHistoryItem } from './services/db';
import {
  loadAndRepairAutomationQueue,
  mergeDecisionMakersIntoAutomationTasks,
  newAutomationTaskId,
} from './services/automationQueueRepair';
import { fetchGlobalConfig, fetchDocumentsFromRepo, backupUserHistory, fetchCRMFromCloud, saveCRMToCloud, fetchUserHistoryFromCloud, checkGitHubStatus, fetchApiConfigsFromCloud, setManualGitHubConfig } from './services/githubService';
import { isSupabaseConfigured, getKnowledgeFiles, getInvestigationHistory, saveInvestigationHistory, saveDiscoverySearch, getCrmClients, syncCrmClients, saveCrmClientsBulk, deleteCrmClient, deleteCrmClientsBulk, getDiscoverySearchArchives, deleteInvestigationHistory, deleteDiscoverySearchFromCloud, deleteDiscoverySearchesByMeta, getProductProfilesCloud } from './services/supabase';
import {
  indexAnalysisIntoProductCatalog,
  rebuildProductCatalogFromHistory,
  loadProductCatalog,
  hasRichProductCatalog,
} from './services/productCatalog';
import { saveProductProfilesBulk } from './services/db';
import { addCustomKeyword, addCustomCountry } from './services/taxonomyStore';
import { normalizeCountryZh } from './utils/countryNormalize';
import { buildSearchTags, stampSearchResults } from './utils/searchTags';
import { mergeDiscoveryResultsIntoCrm, mergeHistoryItemsIntoCrm, findCrmIdsForHistoryItem, findCrmIdsForDiscoveryResults, lookupBackgroundCheck, formatBackgroundCheckTime, findHistoryForClient, clientPatchFromAnalysis, CRM_JUNE_2026_CUTOFF_MS } from './utils/crmHistory';
import { checkLimit, incrementUsage, updateLocalConfig, resetDailyUsage, getDailyUsagePublic } from './services/limitService';
import { ModuleType, AnalysisResult, DiscoveryState, Client, User, HistoryItem, AutomationResult, ClientSearchResult, DiscoveryArchiveItem, DecisionMaker, Department, AutomationPipelineConfig, SimilarCompany } from './types';
import { ModuleBackground } from './components/ModuleBackground';
import { ModuleProducts } from './components/ModuleProducts';
import { ModuleDecisionMakers } from './components/ModuleDecisionMakers';
import { DmEmailSearchPanel } from './components/DmEmailSearchPanel';
import { ProductDigPanel } from './components/ProductDigPanel';
import { enqueueDmEmailSearch, type DmEmailSearchJob } from './services/dmEmailSearchQueue';
import {
  enqueueProductDigBatch,
  setProductDigHistoryResolver,
  stopProductDigQueue,
  subscribeProductDigJobs,
  getProductDigProgress,
  isProductDigQueueBusy,
} from './services/productDigQueue';
import type { ProductDigCompletePayload } from './services/productDigQueue';
import { OrgPermissionPanel } from './components/OrgPermissionPanel';
import { loadDepartmentsFromStorage } from './services/orgStore';
import {
  canAccessModule,
  canViewFullDecisionMakerEmails,
  canViewOwnedRecord,
  filterOwnedRecords,
  hasPermission,
} from './services/permissions';
import {
  emptyDiscoveryState,
  loadAllCrmClients,
  loadUserDiscoveryState,
  mergeSaveCrmClients,
  migrateLegacyCrmOwnership,
  purgeAllCrmClientsBeforeDate,
  purgeCrmListBeforeDate,
  previewPurgeCrmBeforeDate,
  saveAllCrmClients,
  saveUserDiscoveryState,
} from './utils/workspaceScope';
import { ModuleStrategy } from './components/ModuleStrategy';
import { ReportEnrichmentPanel } from './components/ReportEnrichmentPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { extractHistoryAnalysis, normalizeAnalysisResult, websiteHref } from './services/analysisNormalize';
import { ModuleSimilar } from './components/ModuleSimilar';
import { ModulePromoGenerator } from './components/ModulePromoGenerator';
import { ModuleClientCRM } from './components/ModuleClientCRM';
import { ModuleProductMatch } from './components/ModuleProductMatch';
import { ModuleEmailCampaign } from './components/ModuleEmailCampaign'; 
import { ModuleImageGenerator } from './components/ModuleImageGenerator';
import { ClientFinder } from './components/ClientFinder';
import { RecordsPanel, archiveToDiscoveryState } from './components/RecordsPanel';
import { Login } from './components/Login';
import { AccessGate } from './components/AccessGate';
import { loadUsersWithMigration, loadUsersFromStorage, saveUsersToStorage, getUsersUpdatedAt } from './services/auth';
import { AdminDashboard } from './components/AdminDashboard';
import { 
  LayoutDashboard, PackageSearch, Users, PenTool, Network, Search, Loader2, Menu, Globe, Zap, FileSpreadsheet, History, Clock, ChevronRight, AlertTriangle, RefreshCw, LogOut, Briefcase, Ruler, CheckCircle2, Hourglass, StopCircle, PlayCircle, Layers, Mail, Cloud, Download, Info, Link2, X, Database, Github, Image, Trash2, Ban, Target
} from 'lucide-react';
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

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  
  const [domainInput, setDomainInput] = useState('');
  const [activeModule, setActiveModule] = useState<ModuleType>(ModuleType.DISCOVERY);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [crmNavOrder, setCrmNavOrder] = useState<{ clientId: string; historyId: string }[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>(() => loadDepartmentsFromStorage());
  const [teamManageOpen, setTeamManageOpen] = useState(false);
  const [crmClients, setCrmClients] = useState<Client[]>([]);
  const [kbCount, setKbCount] = useState(0); 
  const [systemNotice, setSystemNotice] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isKBSyncing, setIsKBSyncing] = useState(false); 
  const [isGitHubConnected, setIsGitHubConnected] = useState(false);
  
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>(emptyDiscoveryState);
  const [discoveryArchives, setDiscoveryArchives] = useState<DiscoveryArchiveItem[]>([]);

  const [automationResults, setAutomationResults] = useState<AutomationResult[]>([]);
  const [isAutomating, setIsAutomating] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(0);
  
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<string[]>([]);
  const [pendingBatchContext, setPendingBatchContext] = useState<string>('');
  /** Per-domain country hints for batch 背调 (avoids hardcoding Global) */
  const [pendingBatchCountries, setPendingBatchCountries] = useState<Record<string, string>>({});
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
  
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualOwner, setManualOwner] = useState('');
  const [manualRepo, setManualRepo] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const shouldStopRef = useRef(false);
  const batchRunnerActiveRef = useRef(false);
  const batchSessionIdsRef = useRef<Set<string>>(new Set());
  const historyRef = useRef<HistoryItem[]>([]);
  const automationResultsRef = useRef<AutomationResult[]>([]);
  const crmClientsRef = useRef<Client[]>([]);
  const viewingHistoryIdRef = useRef<string | null>(null);
  const analysisDataRef = useRef<AnalysisResult | null>(null);
  const userDataReadyRef = useRef(false);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    automationResultsRef.current = automationResults;
  }, [automationResults]);

  useEffect(() => {
    crmClientsRef.current = crmClients;
  }, [crmClients]);

  useEffect(() => {
    setProductDigHistoryResolver((clientId) => {
      const client = crmClientsRef.current.find((c) => c.id === clientId);
      if (!client) return undefined;
      return findHistoryForClient(client, historyRef.current);
    });
    return () => setProductDigHistoryResolver(null);
  }, []);

  useEffect(() => {
    return subscribeProductDigJobs(() => {
      setProductDigProgress(getProductDigProgress());
    });
  }, []);
  useEffect(() => {
    viewingHistoryIdRef.current = viewingHistoryId;
  }, [viewingHistoryId]);
  useEffect(() => {
    analysisDataRef.current = analysisData;
  }, [analysisData]);

  // 启用 Tavily → Gemini → 千问 降级链；订阅全局限流冷却 UI
  useEffect(() => {
    enableTavilyGeminiQwenCascade();
    return subscribeCooldown((sec) => setCooldownTime(sec));
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
    await saveHistory(item);
    if (isSupabaseConfigured()) {
      saveInvestigationHistory(item).catch(e => console.error('Supabase history save failed', e));
    }
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
    setAnalysisData(null);
    setViewingHistoryId(null);
    setDomainInput('');
    setDiscoveryState(emptyDiscoveryState());
    setDiscoveryArchives([]);
    setHistory([]);
    setAutomationResults([]);
    setCrmClients([]);
    setActiveModule(ModuleType.DISCOVERY);
    setHistoryOpen(false);
    setErrorMsg(null);
  };
  const handleDiscoveryStateChange = (state: DiscoveryState) => {
    setDiscoveryState(state);
  };

  /** 可靠归档：每次按国搜索完成后立刻写入本地 + 云端 */
  const handleSearchArchived = (archive: DiscoveryArchiveItem) => {
    const stamped = stampOwnership(archive);
    if (stamped.product?.trim()) addCustomKeyword(stamped.product.trim());
    (stamped.countries || []).forEach((c) => {
      const zh = normalizeCountryZh(c);
      if (zh && zh !== '未分类') addCustomCountry(zh);
    });
    saveDiscoveryArchive(stamped).catch((e) => console.error('local discovery archive failed', e));
    setDiscoveryArchives((list) => {
      const without = list.filter((x) => x.id !== stamped.id);
      return [stamped, ...without].slice(0, 200);
    });
    if (isSupabaseConfigured()) {
      const stateForCloud: DiscoveryState = {
        product: stamped.product,
        country: stamped.country || (stamped.countries || []).join(', '),
        countries: stamped.countries || [],
        industry: stamped.industry,
        clientType: stamped.clientType || (stamped.clientTypes || []).join(', '),
        clientTypes: stamped.clientTypes || [],
        results: stamped.results || [],
        hasSearched: true,
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
      } catch (e) {
        console.error('Failed to load users', e);
        const fallback = loadUsersFromStorage();
        if (fallback.length) setUsers(fallback);
      } finally {
        setAuthReady(true);
      }
    };
    loadUsers();
  }, []);

  useEffect(() => {
    const checkKey = async () => {
      if (!currentUser || currentUser.role === 'admin') return;
      setHasKey(null);
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
  }, [currentUser]);

  const lastWorkspaceUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentUser) {
      userDataReadyRef.current = false;
      lastWorkspaceUserRef.current = null;
      return;
    }

    // 切换账号时清空工作区；同账号 StrictMode 二次挂载仍会重新拉取
    if (lastWorkspaceUserRef.current !== currentUser.username) {
      lastWorkspaceUserRef.current = currentUser.username;
      resetWorkspaceForUserSwitch();
    }

    let cancelled = false;

    const depts = () => (departments.length ? departments : loadDepartmentsFromStorage());
    const scope = <T extends { ownerUsername?: string; departmentId?: string }>(items: T[]) =>
      filterOwnedRecords(currentUser, items, users, depts());

    const loadData = async () => {
        try {
            // 1. Load Local DB Data First
            const h = await getHistory();
            const repaired = await loadAndRepairAutomationQueue(currentUser);
            if (repaired.repaired || repaired.claimed) {
              console.info(
                `[automation] repaired ids=${repaired.repaired}, claimed orphans=${repaired.claimed}, total=${repaired.tasks.length}`
              );
            }
            const scopedQueue = scope(repaired.tasks);
            if (!cancelled) setAutomationResults(scopedQueue);
            const files = await getAllFilesFromDB();
            if (!cancelled) setKbCount(files.length);

            // 搜索归档：本地 + 云端合并（排除已删除墓碑）→ 再按归属过滤
            let ownedArchives: DiscoveryArchiveItem[] = [];
            try {
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
              ownedArchives = scope(discAll);
              if (!cancelled) setDiscoveryArchives(ownedArchives);
            } catch (e) {
              console.warn('discovery archives load failed', e);
            }

            // 恢复「当前用户自己的」搜索界面（禁止拉取全局 latest，避免串号）
            if (!cancelled) {
              const savedState = loadUserDiscoveryState(currentUser.username);
              if (savedState?.hasSearched && (savedState.results?.length || 0) > 0) {
                setDiscoveryState(savedState);
              } else if (ownedArchives[0]) {
                setDiscoveryState(archiveToDiscoveryState(ownedArchives[0]));
              } else {
                setDiscoveryState(emptyDiscoveryState());
              }
            }

            // 背调归类修复：尽量从报告 searchKeyword 回填关键词；规范化国家为中文（不再强制 Car toy）
            addCustomCountry('波兰');
            addCustomCountry('荷兰');
            addCustomCountry('英国');
            addCustomCountry('美国');
            const fixedHistory = await (async () => {
              const out: HistoryItem[] = [];
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
                  try {
                    await persistHistoryItem(next);
                  } catch (e) {
                    console.warn('history backfill failed', e);
                  }
                  out.push(next);
                } else {
                  out.push(item);
                }
              }
              return out;
            })();
            const historyForRecover = fixedHistory;

            const knownDomains = new Set(
              historyForRecover.map((i) => (i.domain || i.data?.companyInfo?.website || '').toLowerCase()).filter(Boolean)
            );
            const recovered: HistoryItem[] = [];
            // 只从「当前用户可见」的任务队列回收历史，避免把别人的背调盖上自己名字
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
            }
            const recoveredAll = [...recovered, ...historyForRecover];
            if (!cancelled) {
              setHistory(scope(recoveredAll));
            }

            const ghStatus = checkGitHubStatus();
            if (!cancelled) setIsGitHubConnected(ghStatus.ok);

            let nextCrm: Client[] = loadAllCrmClients();

            if (currentUser && isSupabaseConfigured()) {
                if (currentUser.role !== 'admin') {
                    const apiReady = await hydrateApiConfigsFromCloud();
                    if (!cancelled && apiReady) setHasKey(true);
                }
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

                try {
                    const cloudHistory = await getInvestigationHistory();
                    if (cloudHistory.length > 0) {
                        const existingIds = new Set(h.map(i => i.id));
                        const newItems = cloudHistory.filter(i => !existingIds.has(i.id));
                        for (const item of newItems) { await saveHistory(item); }
                        const merged = [...newItems, ...h].sort((a, b) => b.timestamp - a.timestamp);
                        if (!cancelled) {
                          setHistory(scope(merged));
                        }
                    }
                } catch (e) {
                    console.error("Supabase history sync failed", e);
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

                try {
                    const cloudCrm = await getCrmClients();
                    if (cloudCrm.length > 0) {
                      // 云端全量与本地合并（按 id），展示时再过滤
                      const byId = new Map<string, Client>();
                      [...nextCrm, ...cloudCrm].forEach((c) => byId.set(c.id, c));
                      nextCrm = Array.from(byId.values());
                    }
                } catch (e) {
                    console.error("Supabase CRM sync failed", e);
                }
            }

            // 产品库为空时，用本机背调历史静默重建一次
            try {
              const existingProfiles = await loadProductCatalog();
              if (existingProfiles.length === 0) {
                const histNow = await getHistory();
                if (histNow.length) {
                  await rebuildProductCatalogFromHistory(histNow, {
                    ownerUsername: currentUser.username,
                    departmentId: currentUser.departmentId,
                  });
                }
              }
            } catch (e) {
              console.warn('product catalog bootstrap failed', e);
            }

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
                    const byId = new Map<string, Client>();
                    [...nextCrm, ...cloudCRM].forEach((c) => byId.set(c.id, c));
                    nextCrm = Array.from(byId.values());
                  }
                } catch (e) {
                  console.warn('GitHub CRM sync failed', e);
                }

                try {
                  const cloudHistory = await fetchUserHistoryFromCloud(currentUser.username);
                  if (cloudHistory.length > 0) {
                      const existingIds = new Set(h.map(i => i.id));
                      const newItems = cloudHistory.filter(i => !existingIds.has(i.id));
                      if (newItems.length > 0) {
                          for(const item of newItems) await persistHistoryItem(item);
                          if (!cancelled) setHistory(prev => scope([...newItems, ...prev]));
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

            if (!cancelled) {
              // 旧 CRM 回填部门，便于本部门主管按规则看到历史客户
              const migrated = migrateLegacyCrmOwnership(nextCrm, users, depts());
              nextCrm = migrated.clients;
              const filteredCrm = scope(nextCrm);
              setCrmClients(filteredCrm);
              mergeSaveCrmClients(currentUser, filteredCrm, users, depts());
              userDataReadyRef.current = true;
            }
        } catch (e) {
            console.error("Sync Error", e);
            if (!cancelled) userDataReadyRef.current = true;
        }
    };

    loadData();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅账号切换时全量加载；users/depts 由下方重过滤
  }, [currentUser?.username]);

  // 组织架构变化后，按最新权限重过滤内存中的业务数据（不重新拉库，避免闪屏）
  // 注意：不得在过滤时丢掉「刚写入、尚未带归属字段」的本地新增；无归属项对非管理员会被隐藏，
  // 因此加载阶段已做认领修复。此处仅过滤，不写库。
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current) return;
    const depts = departments.length ? departments : loadDepartmentsFromStorage();
    setHistory((prev) => filterOwnedRecords(currentUser, prev, users, depts));
    setAutomationResults((prev) => {
      // 先给无归属的内存项打上当前用户，避免重过滤后「突然消失」
      const stamped = prev.map((t) =>
        !t.ownerUsername && !t.departmentId
          ? { ...t, ownerUsername: currentUser.username, departmentId: currentUser.departmentId }
          : t
      );
      return filterOwnedRecords(currentUser, stamped, users, depts);
    });
    setDiscoveryArchives((prev) => filterOwnedRecords(currentUser, prev, users, depts));
    setCrmClients((prev) => filterOwnedRecords(currentUser, prev, users, depts));
  }, [users, departments, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const fresh = users.find(
      (u) => u.username.trim().toLowerCase() === currentUser.username.trim().toLowerCase()
    );
    if (!fresh) return;
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
      if (!currentUser || !userDataReadyRef.current) return;
      const before = loadAllCrmClients();
      const prevVisibleIds = new Set(
        before
          .filter((c) => canViewOwnedRecord(currentUser, c, users, departments))
          .map((c) => c.id)
      );
      mergeSaveCrmClients(currentUser, crmClients, users, departments);
      const nowIds = new Set(crmClients.map((c) => c.id));
      const removedIds = [...prevVisibleIds].filter((id) => !nowIds.has(id));

      if (isSupabaseConfigured()) {
          // 只 upsert 当前可见列表；删除走单条 delete，避免空视图把云端全库清空
          if (crmClients.length > 0) {
            syncCrmClients(crmClients).catch(e => console.error("Supabase CRM sync failed", e));
          }
          for (const id of removedIds) {
            deleteCrmClient(id).catch((e) => console.error('CRM delete sync failed', id, e));
          }
      } else if (isGitHubConnected && crmClients.length > 0) {
          saveCRMToCloud(crmClients).catch(e => console.error("Auto CRM sync failed", e));
      }
  }, [crmClients, isGitHubConnected, currentUser, users, departments]);

  // 按用户隔离保存当前搜索界面，避免换账号串结果
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current) return;
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

  const performSingleAnalysis = async (
    domain: string,
    override?: { searchKeyword?: string; searchTags?: string[]; searchCountry?: string }
  ) => {
    setLoading(true); setErrorMsg(null); setActiveModule(ModuleType.BACKGROUND); setMobileMenuOpen(false);
    try {
      const keyword = (override?.searchKeyword || discoveryState.product || '').trim();
      if (keyword) addCustomKeyword(keyword);
      const countryHint = (
        override?.searchCountry ||
        discoveryState.countries?.[0] ||
        discoveryState.country ||
        ''
      ).trim();
      const specificCountry = /^(global|worldwide|international|国际|全球|不限)$/i.test(countryHint)
        ? ''
        : countryHint;
      const tags =
        override?.searchTags?.length
          ? override.searchTags
          : keyword
            ? buildSearchTags(keyword, specificCountry)
            : undefined;
      const result = await analyzeCompany(domain, 'economy', {
        searchKeyword: keyword || undefined,
        searchTags: tags,
        searchCountry: specificCountry || undefined,
      });
      setAnalysisData(result);
      incrementUsage('analysis');
      const saved = await saveAnalysisToHistory(result, keyword ? 'discovery' : 'single');
      setViewingHistoryId(saved.id);
      updateCrmStatus(result);
    } catch (e: any) { setErrorMsg(`Error: ${e.message}`); } finally { setLoading(false); }
  };

  const loadFromHistory = (item: HistoryItem) => {
    try {
      const data = extractHistoryAnalysis(item);
      if (!data) {
        setErrorMsg('该历史记录缺少有效背调数据，无法打开。可重新对该域名做一次深度调查。');
        setHistoryOpen(false);
        return;
      }
      setAnalysisData(data);
      setViewingHistoryId(item.id);
      setDomainInput(data.companyInfo.website !== 'N/A' ? data.companyInfo.website : item.domain || '');
      setActiveModule(ModuleType.BACKGROUND);
      setHistoryOpen(false);
      setMobileMenuOpen(false);
      setErrorMsg(null);
    } catch (e: any) {
      console.error('loadFromHistory failed', e);
      setErrorMsg(`打开历史记录失败: ${e?.message || String(e)}`);
      setHistoryOpen(false);
    }
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
    const lookup = lookupBackgroundCheck(company.website, company.name, history, crmClients);
    return {
      checked: lookup.checked,
      checkedAt: lookup.checkedAt,
      historyItem: lookup.historyItem,
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
    decisionMakerEmailSearchAt: number;
    decisionMakerEmailSearchHistory: number[];
  }, opts?: { historyId?: string | null; domain?: string; companyName?: string }) => {
    const matchId = opts?.historyId ?? viewingHistoryIdRef.current;
    const domainKey = (opts?.domain || analysisDataRef.current?.companyInfo?.website || domainInput || '').toLowerCase();
    const nameKey = (opts?.companyName || analysisDataRef.current?.companyInfo?.name || '').toLowerCase();

    setAnalysisData((prev) => {
      if (!prev) return prev;
      const sameView =
        (matchId && viewingHistoryIdRef.current === matchId) ||
        (prev.companyInfo?.website || '').toLowerCase() === domainKey ||
        (prev.companyInfo?.name || '').toLowerCase() === nameKey;
      if (!sameView) return prev;
      return {
        ...prev,
        decisionMakers: patch.decisionMakers,
        decisionMakerEmailSearchAt: patch.decisionMakerEmailSearchAt,
        decisionMakerEmailSearchHistory: patch.decisionMakerEmailSearchHistory,
      };
    });

    setHistory((prev) => {
      let updatedItem: HistoryItem | null = null;
      const next = prev.map((h) => {
        const hit =
          (matchId && h.id === matchId) ||
          (!matchId &&
            ((h.domain || '').toLowerCase() === domainKey ||
              (h.data?.companyInfo?.name || '').toLowerCase() === nameKey));
        if (!hit || !h.data) return h;
        updatedItem = {
          ...h,
          data: {
            ...h.data,
            decisionMakers: patch.decisionMakers,
            decisionMakerEmailSearchAt: patch.decisionMakerEmailSearchAt,
            decisionMakerEmailSearchHistory: patch.decisionMakerEmailSearchHistory,
          },
        };
        return updatedItem;
      });
      if (updatedItem) {
        persistHistoryItem(updatedItem).catch((e) =>
          console.error('persist decision maker research failed', e)
        );
      }
      return next;
    });

    // 同步写回营销工具任务队列（IndexedDB），避免刷新后联系人变「暂无」
    setAutomationResults((prev) => {
      void mergeDecisionMakersIntoAutomationTasks(prev, {
        domain: domainKey || undefined,
        companyName: nameKey || undefined,
        decisionMakers: patch.decisionMakers,
        searchedAt: patch.decisionMakerEmailSearchAt,
        searchHistory: patch.decisionMakerEmailSearchHistory,
      }).then((merged) => setAutomationResults(merged));
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
  const enqueueCurrentDmEmailSearch = (fromData?: AnalysisResult | null, historyIdOverride?: string | null): { ok: boolean; message: string } => {
    if (!hasPermission(currentUser, 'feature.dm_email_search')) {
      return { ok: false, message: '你没有「决策人邮箱搜索」权限，请联系管理员或部门主管开通。' };
    }
    const src = fromData || analysisDataRef.current;
    if (!src) return { ok: false, message: '当前没有打开的背调报告' };
    const domain = src.companyInfo?.website || '';
    const companyName = src.companyInfo?.name || domain;
    const hid = historyIdOverride ?? viewingHistoryIdRef.current;

    const res = enqueueDmEmailSearch({
      domain,
      companyName,
      historyId: hid,
      deepDig: true,
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
    return { ok: true, message: `已加入后台队列：${companyName}（可继续浏览其它客户）` };
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
      const websiteKey = (website || '').toLowerCase();
      const nameKey = (analysisData.companyInfo.name || '').trim().toLowerCase();
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
      setCrmClients(prev => {
          const idx = prev.findIndex(c =>
              (websiteKey && (c.website || '').toLowerCase() === websiteKey) ||
              (nameKey && (c.name || '').trim().toLowerCase() === nameKey)
          );
          if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                  ...updated[idx],
                  ...patch,
                  activityLog:
                      (updated[idx].activityLog || '') +
                      ` [Synced from Deep Analysis ${new Date().toLocaleDateString()}]`,
              };
              return updated;
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
          return [newClient, ...prev];
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
      const newClients: Client[] = results.map(r => stampOwnership({
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
          tags: r.searchTags || [],
      }));

      setCrmClients(prev => {
          const existingWebsites = new Set(prev.map(c => c.website?.toLowerCase()));
          const unique = newClients.filter(c => !c.website || !existingWebsites.has(c.website?.toLowerCase()));
          if (unique.length > 0) alert(`已导入 ${unique.length} 个新客户到 CRM`);
          else alert("所选客户已在 CRM 中");
          return [...unique, ...prev];
      });
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

    let added = 0;
    let updated = 0;
    let skipped = 0;

    setCrmClients((prev) => {
      let next = prev;
      added = 0;
      updated = 0;
      skipped = 0;

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
      return next;
    });

    const parts: string[] = [];
    if (added) parts.push(`新建 ${added}`);
    if (updated) parts.push(`更新 ${updated}`);
    if (skipped) parts.push(`跳过已存在 ${skipped}`);
    alert(parts.length ? `CRM 导入完成：${parts.join('，')}` : '没有可导入的客户');
  };

  // RESTORED: Update CRM status if re-analyzed
  const updateCrmStatus = (analysis: AnalysisResult) => { 
      const now = Date.now();
      const kw = (analysis.searchKeyword || '').trim();
      setCrmClients(prev => prev.map(c => {
          if (c.website?.toLowerCase() === analysis.companyInfo.website?.toLowerCase() || c.name === analysis.companyInfo.name) {
              const searchedKeywords = Array.from(
                new Set([...(c.searchedKeywords || []), c.searchKeyword, kw].filter(Boolean) as string[])
              );
              return { 
                  ...c, 
                  hasAnalyzed: true,
                  hasBackgroundCheck: true,
                  lastBackgroundCheckAt: now,
                  industry: analysis.companyInfo?.nature || c.industry,
                  contacts: (analysis.decisionMakers?.length
                    ? analysis.decisionMakers
                    : c.contacts) || [],
                  searchKeyword: kw || c.searchKeyword,
                  searchedKeywords,
                  tags: analysis.searchTags || c.tags,
                  activityLog: c.activityLog + ` [Analyzed ${new Date().toLocaleDateString()}]`,
              };
          }
          return c;
      }));
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
      const historyItem: HistoryItem = stampOwnership({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type: ModuleType.BACKGROUND,
          data: {
            ...result,
            searchKeyword: result.searchKeyword || keyword,
            searchTags:
              result.searchTags ||
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
      console.log(`[History] saved (${source}):`, domain, 'keyword=', keyword);
      return historyItem;
  };

  const handleViewAutomationResult = (task: AutomationResult) => {
      if (!currentUser || !filterOwnedRecords(currentUser, [task], users, departments).length) {
        alert('无权查看该任务（不属于你或你的部门）。');
        return;
      }
      if (!task.analysis) {
          alert('该任务尚无完整分析数据，请重新运行。');
          return;
      }
      setAnalysisData(normalizeAnalysisResult(task.analysis));
      const domainKey = (task.analysis.companyInfo?.website || task.website || '')
        .toLowerCase()
        .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
        .split('/')[0];
      const nameKey = (task.analysis.companyInfo?.name || task.clientName || '').trim().toLowerCase();
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
      setDomainInput(task.analysis.companyInfo?.website || task.website || '');
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
      const completed = automationResults.filter((t) => t.status === 'completed' && t.analysis);
      if (completed.length === 0) {
          alert('暂无已完成的报告可下载');
          return;
      }
      await exportBatchAutomationReportsToPPT(completed);
  };

  const stopAutomation = () => {
    shouldStopRef.current = true;
    stopProductDigQueue();
    setIsAutomating(false);
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

  const importAnalysisToCrmFromPipeline = (analysis: AnalysisResult) => {
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
    setCrmClients((prev) => mergeHistoryItemsIntoCrm(prev, [histItem], stampOwnership).clients);
  };

  /** 单条背调（供流水线并行调用）；可选后续挖决策人 / 入 CRM */
  const runOneAutomationAnalysis = async (
    task: AutomationResult,
    opts: Pick<AutomationPipelineConfig, 'doDmMine' | 'doCrmImport' | 'keyword'>
  ) => {
    if (shouldStopRef.current) return;
    const limit = checkLimit('analysis');
    if (!limit.allowed) {
      console.warn('analysis limit reached, skip', task.website);
      return;
    }

    setAutomationResults((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: 'analyzing' } : t))
    );

    try {
      const kw = (task.keyword || opts.keyword || discoveryState.product || '').trim();
      if (kw) addCustomKeyword(kw);
      const result = await withRateLimitRetry(
        () =>
          analyzeCompany(task.website, task.mode || 'economy', {
            searchKeyword: kw || undefined,
            searchTags: kw ? buildSearchTags(kw, task.country || '') : undefined,
            searchCountry: task.country || undefined,
          }),
        {
          maxAttempts: 4,
          baseWaitSec: 45,
          shouldStop: () => shouldStopRef.current,
        }
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
      };

      await saveAutomationTask(completedTask);
      setAutomationResults((prev) => prev.map((t) => (t.id === task.id ? completedTask : t)));

      let historyId: string | null = null;
      try {
        const saved = await saveAnalysisToHistory(result, 'batch');
        historyId = saved.id;
      } catch (histErr) {
        console.error('流水线结果写入历史失败', histErr);
      }

      incrementUsage('analysis');
      updateCrmStatus(result);

      if (opts.doDmMine && hasPermission(currentUser, 'feature.dm_email_search')) {
        const domain = result.companyInfo?.website || task.website || '';
        const companyName = result.companyInfo?.name || task.clientName || domain;
        enqueueDmEmailSearch({
          domain,
          companyName,
          historyId,
          deepDig: true,
          authorized: true,
          existingDecisionMakers: result.decisionMakers || [],
          resolveExisting: () => {
            if (historyId) {
              const item = historyRef.current.find((h) => h.id === historyId);
              if (item?.data?.decisionMakers) return item.data.decisionMakers;
            }
            return result.decisionMakers || [];
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
            setAutomationResults((prev) => {
              void mergeDecisionMakersIntoAutomationTasks(prev, {
                taskId: task.id,
                domain: job.domain,
                companyName: job.companyName,
                decisionMakers: job.resultDecisionMakers!,
                searchedAt: job.searchedAt!,
                searchHistory,
              }).then((merged) => setAutomationResults(merged));
              return prev;
            });
            if (
              opts.doCrmImport &&
              job.resultDecisionMakers.some((d) => d.name || d.emailGuess?.includes('@'))
            ) {
              importAnalysisToCrmFromPipeline({
                ...result,
                decisionMakers: job.resultDecisionMakers,
                decisionMakerEmailSearchAt: job.searchedAt,
              });
            }
          },
        });
      }
    } catch (e: any) {
      console.error(`Pipeline task ${task.id} failed`, e);
      const failedTask: AutomationResult = { ...task, status: 'failed' };
      await saveAutomationTask(failedTask);
      setAutomationResults((prev) => prev.map((t) => (t.id === task.id ? failedTask : t)));
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

    const runLimited = withConcurrency<void>(1);
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
          setAutomationResults((prev) => [...prev, ...newTasks]);
          for (const task of newTasks) {
            await saveAutomationTask(task);
          }

          // 一国搜完立刻启动背调，不等其它国家 —— 与后续搜索并行
          if (config.doBackgroundCheck) {
            for (const task of newTasks) {
              followUps.push(
                runLimited(() =>
                  runOneAutomationAnalysis(task, {
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
      if (config.doDmMine) parts.push('决策人挖掘已后台排队');
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
      if (tasksToRun?.length) {
        for (const t of tasksToRun) {
          batchSessionIdsRef.current.add(t.id);
        }
      }
      if (batchRunnerActiveRef.current) {
        // 已有后台 runner：新任务保持 pending，循环末尾会继续捞取
        setIsAutomating(true);
        return;
      }

      batchRunnerActiveRef.current = true;
      setIsAutomating(true);
      shouldStopRef.current = false;

      try {
        while (!shouldStopRef.current) {
          const fromMem = automationResultsRef.current.find(
            (t) =>
              t.status === 'pending' &&
              (batchSessionIdsRef.current.size === 0 || batchSessionIdsRef.current.has(t.id))
          );
          let task = fromMem;
          if (!task) {
            try {
              const q = await getAutomationQueue();
              task = q.find(
                (t) =>
                  t.status === 'pending' &&
                  (batchSessionIdsRef.current.size === 0 || batchSessionIdsRef.current.has(t.id))
              );
            } catch {
              break;
            }
          }
          if (!task) break;

          const limit = checkLimit('analysis');
          if (!limit.allowed) {
              alert(`今日背调次数已达上限（${limit.current}/${limit.max}），批量任务已暂停。可稍后继续，或联系管理员提高限额。`);
              break;
          }

          setAutomationResults((prev) =>
            prev.map((t) => (t.id === task!.id ? { ...t, status: 'analyzing' } : t))
          );

          try {
              const kw = (task.keyword || discoveryState.product || '').trim();
              if (kw) addCustomKeyword(kw);
              const result = await withRateLimitRetry(
                () =>
                  analyzeCompany(task!.website, task!.mode || 'economy', {
                    searchKeyword: kw || undefined,
                    searchTags: kw ? buildSearchTags(kw, task!.country || '') : undefined,
                    searchCountry: task!.country || undefined,
                  }),
                {
                  maxAttempts: 4,
                  baseWaitSec: 45,
                  shouldStop: () => shouldStopRef.current,
                }
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
              };

              await saveAutomationTask(completedTask);
              setAutomationResults((prev) => prev.map((t) => (t.id === task!.id ? completedTask : t)));

              try {
                  await saveAnalysisToHistory(result, 'batch');
              } catch (histErr) {
                  console.error('批量结果写入历史失败，但任务队列已保存', histErr);
              }

              incrementUsage('analysis');
              updateCrmStatus(result);
          } catch (e: any) {
              console.error(`Task ${task.id} failed`, e);
              const failedTask: AutomationResult = { ...task, status: 'failed' };
              await saveAutomationTask(failedTask);
              setAutomationResults((prev) => prev.map((t) => (t.id === task!.id ? failedTask : t)));
              if (isRateLimitError(e)) {
                  noteRateLimited(75);
              }
          }

          const gap = getCooldownRemainingSec() > 0 ? 5000 : 2500;
          await new Promise((r) => setTimeout(r, gap));
        }
      } finally {
        batchRunnerActiveRef.current = false;
        const stillPending = automationResultsRef.current.some(
          (t) =>
            t.status === 'pending' &&
            (batchSessionIdsRef.current.size === 0 || batchSessionIdsRef.current.has(t.id))
        );
        if (stillPending && !shouldStopRef.current) {
          void processBatchQueue();
          return;
        }
        setIsAutomating(false);
        const sessionIds = batchSessionIdsRef.current;
        try {
          const q = await getAutomationQueue();
          const completedNow = q.filter(
            (t) => sessionIds.has(t.id) && t.status === 'completed' && t.analysis
          ).length;
          if (completedNow > 0 && sessionIds.size > 0) {
            // 非阻塞提示：不打断当前页面
            console.info(`[batch] 后台背调完成 ${completedNow} 条`);
          }
        } catch {
          /* ignore */
        }
      }
  };

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
      const newTasks: AutomationResult[] = pendingBatch.map(target => stampOwnership({ 
          id: newAutomationTaskId(), 
          clientName: target, 
          website: target, 
          country: pendingBatchCountries[target.toLowerCase()] || fallbackCountry || '', 
          status: 'pending', 
          productContext: pendingBatchContext, 
          productImages: [], 
          mode: mode,
          keyword: kw || undefined,
          createdAt: Date.now(),
      }));
      setPendingBatchCountries({}); 
      
      for (const t of newTasks) batchSessionIdsRef.current.add(t.id);
      setAutomationResults(prev => [...prev, ...newTasks]); 
      for (const task of newTasks) { 
          await saveAutomationTask(task); 
      } 
      
      // 后台执行，不阻塞当前页面；可同时开产品深挖
      void processBatchQueue(newTasks);
      alert(`已加入后台批量背调 ${newTasks.length} 家。可继续操作，左侧栏可查看进度。`);
  };

  const handleRunPending = async () => { 
      const pending = automationResults.filter((t) => t.status === 'pending' || t.status === 'failed');
      if (!pending.length) return;
      const resetFailed = pending.filter((t) => t.status === 'failed');
      if (resetFailed.length) {
        setAutomationResults((prev) =>
          prev.map((t) => (t.status === 'failed' && pending.some((p) => p.id === t.id) ? { ...t, status: 'pending' } : t))
        );
        for (const t of resetFailed) {
          await saveAutomationTask({ ...t, status: 'pending' });
        }
      }
      for (const t of pending) batchSessionIdsRef.current.add(t.id);
      void processBatchQueue(pending.map((t) => ({ ...t, status: 'pending' as const })));
  };
  
  const handleRunSingle = async (id: string) => { 
      const task = automationResults.find((t) => t.id === id);
      if (!task) return;
      if (task.status === 'failed' || task.status === 'completed') {
        const reset = { ...task, status: 'pending' as const, analysis: undefined };
        await saveAutomationTask(reset);
        setAutomationResults((prev) => prev.map((t) => (t.id === id ? reset : t)));
        void processBatchQueue([reset]);
        return;
      }
      void processBatchQueue([task]);
  };

  /** 已完成任务：重置后再次背调 */
  const handleRerunCompletedTask = async (id: string) => {
      const task = automationResults.find((t) => t.id === id);
      if (!task) return;
      if (!hasPermission(currentUser, 'feature.batch_analyze') && !hasPermission(currentUser, 'feature.analyze_company')) {
        alert('你没有背调权限，请联系管理员或部门主管开通。');
        return;
      }
      const timeLabel = formatBackgroundCheckTime(task.completedAt || task.createdAt);
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？`
        : '是否对该客户再次背调？';
      if (!confirm(tip)) return;
      const reset: AutomationResult = {
        ...task,
        status: 'pending',
        analysis: undefined,
        mailGroup: undefined,
        completedAt: undefined,
      };
      await saveAutomationTask(reset);
      setAutomationResults((prev) => prev.map((t) => (t.id === id ? reset : t)));
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
        lookupBackgroundCheck(domain, data.companyInfo?.name, history, crmClients).historyItem;
      const timeLabel = formatBackgroundCheckTime(hist?.timestamp);
      const tip = timeLabel
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？`
        : '是否再次背调以更新该公司信息？';
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
      });
  };

  const handleOpenExistingFromSearch = (result: ClientSearchResult) => {
      const lookup = lookupBackgroundCheck(result.website, result.name, history, crmClients);
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
        ? `该公司已于 ${timeLabel} 完成背调。是否再次背调以更新信息？`
        : '是否再次背调？';
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
      });
  };

  const handleDeleteTask = async (id: string) => { 
      if(confirm("Delete?")) { 
          await deleteAutomationTask(id); 
          setAutomationResults(prev => prev.filter(t => t.id !== id)); 
      } 
  };

  const handleReloadAutomationQueue = async () => {
    if (!currentUser) return;
    try {
      const repaired = await loadAndRepairAutomationQueue(currentUser);
      const scoped = filterOwnedRecords(
        currentUser,
        repaired.tasks,
        users,
        departments.length ? departments : loadDepartmentsFromStorage()
      );
      setAutomationResults(scoped);
      alert(
        `已从本机重新加载任务队列：可见 ${scoped.length} 条` +
          (repaired.repaired || repaired.claimed
            ? `（修复短ID ${repaired.repaired}，认领无归属 ${repaired.claimed}）`
            : '') +
          `\n提示：被「清空列表/清除已完成」删掉的无法恢复；背调正文仍在「记录中心」。`
      );
    } catch (e: any) {
      alert(`重新加载失败：${e?.message || String(e)}`);
    }
  };

  const handleClearCompletedTasks = async () => {
      if (!confirm('清除所有已完成的任务？（背调历史仍会保留在记录中心）')) return;
      const done = automationResults.filter((t) => t.status === 'completed');
      for (const t of done) {
        await deleteAutomationTask(t.id);
      }
      setAutomationResults((prev) => prev.filter((t) => t.status !== 'completed'));
      alert(`已清除 ${done.length} 条已完成任务`);
  };

  const handleClearAllTasks = async () => {
      if (!confirm('清空自己的任务队列？此操作不可恢复（背调历史仍保留在记录中心）。不会删除其他用户的任务。')) return;
      for (const t of automationResults) {
        await deleteAutomationTask(t.id);
      }
      setAutomationResults([]);
      alert('任务队列已清空');
  };

  const handleLogout = () => {
    resetWorkspaceForUserSwitch();
    lastWorkspaceUserRef.current = null;
    setCurrentUser(null);
  };
  const handleSyncToGitHub = async () => { if(!currentUser) return; setIsSyncing(true); try { await backupUserHistory(currentUser.username, history); await saveCRMToCloud(crmClients); alert("数据同步成功!"); } catch (e: any) { alert("同步失败: " + e.message); } finally { setIsSyncing(false); } };
  const handleAddClients = (newClients: Client[]) => { setCrmClients(prev => [...prev, ...newClients.map(stampOwnership)]); alert(`已成功导入 ${newClients.length} 个客户资料！`); };

  const handleBatchDeleteClients = async (clients: Client[]) => {
    if (!clients?.length) return;
    if (!hasPermission(currentUser, 'feature.crm_manage')) {
      alert('你没有 CRM 编辑权限，无法删除客户。');
      return;
    }
    if (!confirm(`确定删除选中的 ${clients.length} 个客户？\n此操作不可恢复（仅删 CRM 条目，背调历史仍保留在记录中心）。`)) {
      return;
    }
    const ids = new Set(clients.map((c) => c.id));
    setCrmClients((prev) => prev.filter((c) => !ids.has(c.id)));
    for (const id of ids) {
      void deleteCrmClient(id).catch((e) => console.warn('[CRM] cloud delete failed', id, e));
    }
  };

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

  if (!currentUser) {
    if (!authReady) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;
    return (
      <Login
        onLogin={setCurrentUser}
        onUsersChange={(next) => setUsers(next)}
      />
    );
  }

  if (currentUser.role === 'admin') {
    return (
      <AdminDashboard 
        onLogout={handleLogout} 
        currentUser={currentUser} 
        users={users}
        setUsers={setUsers}
      />
    );
  }

  if (hasKey === null) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;

  if (hasKey === false) {
      return (
          <div className="min-h-screen min-h-[100dvh] flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
              <div className="bg-red-100 p-4 rounded-full text-red-600 mb-4"><AlertTriangle size={32}/></div>
              <h2 className="text-xl font-bold text-slate-800">系统尚未配置 API 密钥</h2>
              <p className="text-slate-500 mt-2 max-w-md text-sm sm:text-base">请联系管理员在控制台保存千问 API 配置（将同步至云端），然后重新登录。</p>
              <button onClick={handleLogout} className="mt-6 text-blue-600 hover:underline touch-manipulation">返回登录</button>
          </div>
      );
  }

  const alwaysActiveModules = [ModuleType.DISCOVERY, ModuleType.PROMO_GENERATOR, ModuleType.CLIENT_CRM, ModuleType.PRODUCT_MATCH, ModuleType.STRATEGY, ModuleType.EMAIL_CAMPAIGN, ModuleType.IMAGE_GENERATOR];
  const navModules = [
            { id: ModuleType.DISCOVERY, label: '客户搜索', sub: 'Discovery', icon: Globe },
            { id: ModuleType.BACKGROUND, label: '背景调查', sub: 'Background', icon: LayoutDashboard },
            { id: ModuleType.PRODUCTS, label: '产品分析', sub: 'Products', icon: PackageSearch },
            { id: ModuleType.DECISION_MAKERS, label: '决策人挖掘', sub: 'Contacts', icon: Users },
            { id: ModuleType.STRATEGY, label: '开发策略', sub: 'Strategy', icon: PenTool },
            { id: ModuleType.SIMILAR, label: '同类推荐', sub: 'Similar', icon: Network },
            { id: ModuleType.PRODUCT_MATCH, label: '新品匹配', sub: 'Match', icon: Target },
            { id: ModuleType.CLIENT_CRM, label: '客户管理', sub: 'CRM', icon: Briefcase },
            { id: ModuleType.EMAIL_CAMPAIGN, label: '邮件营销', sub: 'DirectMail', icon: Mail }, 
            { id: ModuleType.IMAGE_GENERATOR, label: '海报/生图', sub: 'Poster', icon: Image },
            { id: ModuleType.PROMO_GENERATOR, label: '营销工具', sub: 'Tools', icon: Ruler },
          ].filter((item) => canAccessModule(currentUser, item.id));

  return (
    <AccessGate user={currentUser} onLogout={handleLogout}>
    <div className="tp-app flex min-h-screen min-h-[100dvh] overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-ink-950/60 backdrop-blur-sm z-20 md:hidden" onClick={() => setMobileMenuOpen(false)} />
      )}
      <aside className={`tp-sidebar fixed md:static z-30 h-full w-[min(100vw-3rem,18rem)] md:w-72 border-r transition-transform duration-300 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} flex flex-col`}>
        <div className="p-6 border-b border-white/5 flex items-center gap-3">
            <div className="tp-brand-mark p-2.5 rounded-xl text-white"><Zap size={20} /></div>
            <div>
                <h1 className="text-lg font-extrabold text-white tracking-tight leading-tight">楠哥的小助理 <span className="text-signal-400">Pro</span></h1>
                <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-[0.14em] mt-1 flex items-center gap-1.5">
                  <span className="tp-live-dot w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  {currentUser.username}
                  {currentUser.role === 'director'
                    ? ' · 总管'
                    : currentUser.role === 'manager'
                      ? ' · 主管'
                      : ''}
                </div>
            </div>
        </div>
        
        {systemNotice && (
            <div className="bg-amber-400/10 p-3 mx-4 mt-4 rounded-xl border border-amber-300/25 text-amber-100 text-xs font-semibold flex items-start gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5 text-amber-300"/>
                {systemNotice}
            </div>
        )}

        {(isAutomating || productDigProgress.active > 0) && (
            <div className="mx-4 mt-4 p-3 bg-slate-900 rounded-xl border border-slate-800 shadow-lg text-white space-y-3">
                {isAutomating && (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-green-400 flex items-center gap-1">
                          <Loader2 className="animate-spin" size={10}/> 批量背调进行中
                        </span>
                        <span className="text-[10px] text-slate-400">后台运行</span>
                    </div>
                    {(() => {
                      const session = automationResults.filter(
                        (r) => batchSessionIdsRef.current.has(r.id) || r.status === 'analyzing' || r.status === 'pending'
                      );
                      const list = session.length ? session : automationResults;
                      const done = list.filter((r) => r.status === 'completed').length;
                      const failed = list.filter((r) => r.status === 'failed').length;
                      const analyzing = list.find((r) => r.status === 'analyzing');
                      const total = list.length;
                      const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
                      return (
                        <>
                          <div className="text-xs font-bold mb-1">
                            {done + failed} / {total} 已处理
                            {failed > 0 ? `（失败 ${failed}）` : ''}
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden mb-2">
                            <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          {analyzing && (
                            <div className="text-[10px] text-slate-400 truncate mb-2">
                              当前：{analyzing.clientName || analyzing.website}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                {productDigProgress.active > 0 && (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                          <Loader2 className="animate-spin" size={10}/> 品类补做进行中
                        </span>
                        <span className="text-[10px] text-slate-400">后台运行</span>
                    </div>
                    <div className="text-xs font-bold mb-1">
                      {productDigProgress.completed + productDigProgress.failed} / {productDigProgress.total} 已处理
                      {productDigProgress.failed > 0 ? `（失败 ${productDigProgress.failed}）` : ''}
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden mb-2">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{
                          width: `${
                            productDigProgress.total
                              ? Math.round(
                                  ((productDigProgress.completed + productDigProgress.failed) /
                                    productDigProgress.total) *
                                    100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    {productDigProgress.runningName && (
                      <div className="text-[10px] text-slate-400 truncate mb-2">
                        当前：{productDigProgress.runningName}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={stopAutomation} className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1 transition-colors">
                    <StopCircle size={12} /> 停止后台任务
                </button>
            </div>
        )}

        <nav className="p-3 sm:p-4 space-y-1 flex-1 overflow-y-auto custom-scrollbar">
          {navModules.map(item => (
            <button key={item.id} onClick={() => { setActiveModule(item.id); setMobileMenuOpen(false); }} disabled={!analysisData && !alwaysActiveModules.includes(item.id)} className={`tp-nav-item w-full flex items-center gap-3 px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl text-sm font-semibold transition-all touch-manipulation disabled:opacity-30 ${activeModule === item.id ? 'is-active' : ''}`}>
              <item.icon size={18} className={`flex-shrink-0 ${activeModule === item.id ? 'text-signal-300' : 'text-slate-500'}`} />
              <span className="truncate"><span className="md:hidden">{item.label}</span><span className="hidden md:inline">{item.label} <span className="text-[10px] font-medium opacity-50">({item.sub})</span></span></span>
            </button>
          ))}
          {hasPermission(currentUser, 'feature.manage_team_users') && currentUser.role === 'manager' && (
            <button
              type="button"
              onClick={() => { setTeamManageOpen(true); setMobileMenuOpen(false); }}
              className="tp-nav-item w-full flex items-center gap-3 px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl text-sm font-semibold touch-manipulation"
            >
              <Users size={18} className="flex-shrink-0 text-signal-400" />
              <span>团队权限</span>
            </button>
          )}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-2">
            {isGitHubConnected && (
                <div className="w-full flex items-center gap-2 px-4 py-2 bg-signal-500/10 text-signal-300 rounded-xl text-xs font-semibold mb-2 border border-signal-500/20">
                    <Github size={14} /> GitHub Auto-Sync Active
                </div>
            )}
            
            <div 
                className={`px-4 py-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 flex items-center gap-2 mb-2 cursor-pointer hover:bg-emerald-400/15 transition-colors ${isKBSyncing ? 'opacity-70' : ''}`}
            >
                {isKBSyncing ? <Loader2 size={16} className="text-emerald-300 animate-spin" /> : <CheckCircle2 size={16} className="text-emerald-300" />}
                <div>
                    <div className="text-[10px] font-bold text-emerald-200 uppercase tracking-[0.12em]">System Files Loaded</div>
                    <div className="text-[10px] text-emerald-300/80 font-medium">
                        {kbCount} Files Ready to Use
                    </div>
                </div>
            </div>
            <button
              onClick={() => {
                if (!hasPermission(currentUser, 'feature.records_center')) {
                  alert('你没有「记录中心」权限，请联系管理员或部门主管开通。');
                  return;
                }
                setHistoryOpen(!historyOpen);
              }}
              className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 text-slate-200 rounded-xl text-sm font-semibold transition-colors border border-white/5"
            >
                <span className="flex items-center gap-2"><History size={18} className="text-signal-400" /> 记录中心</span><ChevronRight size={16} className={`transition-transform text-slate-500 ${historyOpen ? 'rotate-90' : ''}`} />
            </button>
            <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-3 text-rose-300 hover:bg-rose-500/10 rounded-xl text-sm font-semibold transition-colors"><LogOut size={18} /> 退出登录</button>
            <div className="px-4 pt-1 text-[9px] font-semibold text-slate-600 text-center select-all tracking-wide">
              版本 v20260804t · 客户搜索优先Tavily
            </div>
        </div>
      </aside>
      
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
          onBatchImportToCrm={handleBatchImportRecordsToCrm}
          onRestoreDiscovery={(archive) => {
            setDiscoveryState(archiveToDiscoveryState(archive));
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
              setCrmClients((prev) => prev.filter((c) => !crmIds.includes(c.id)));
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
              setCrmClients((prev) => prev.filter((c) => !crmIds.includes(c.id)));
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

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        <header className="tp-header px-3 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 z-10">
          <div className="flex items-center gap-3 sm:contents">
            <button onClick={() => setMobileMenuOpen(true)} className="md:hidden p-2 text-slate-500 flex-shrink-0 touch-manipulation" aria-label="打开菜单"><Menu size={24} /></button>
            <div className="flex-1 relative group min-w-0 sm:order-none">
              <Search className="absolute left-3 sm:left-4 top-3 sm:top-5 text-signal-500/70 pointer-events-none" size={20} />
              <textarea 
                  className="tp-scan-input w-full pl-10 sm:pl-12 pr-3 sm:pr-4 py-3 sm:py-4 rounded-2xl text-slate-950 font-semibold text-sm sm:text-base focus:outline-none transition-all resize-none overflow-hidden min-h-[48px] sm:min-h-[56px] focus:min-h-[100px] sm:focus:min-h-[120px] z-20 relative placeholder:text-slate-500" 
                  placeholder="输入目标网址或公司名称..." 
                  value={domainInput} 
                  onChange={e => setDomainInput(e.target.value)} 
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnalyzeInput(); } }}
              />
            </div>
          </div>
          <button onClick={() => handleAnalyzeInput()} disabled={loading || !domainInput.trim()} className="tp-btn-primary text-white px-6 sm:px-8 py-3 rounded-2xl font-extrabold disabled:opacity-50 w-full sm:w-auto sm:min-w-[140px] flex justify-center items-center touch-manipulation flex-shrink-0">
            {loading ? <Loader2 className="animate-spin" size={20} /> : '深度调查'}
          </button>
        </header>

        <div className="tp-main-stage flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 relative custom-scrollbar">
          {cooldownTime > 0 && (
              <div className="absolute inset-0 bg-mist-50/85 z-50 flex flex-col items-center justify-center backdrop-blur-md animate-fade-in cursor-wait">
                  <div className="relative"><Hourglass size={64} className="text-signal-500 animate-pulse" /><div className="absolute -top-2 -right-2 bg-rose-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs">{cooldownTime}</div></div>
                  <h3 className="text-2xl font-extrabold text-ink-900 mt-6 tracking-tight">API 冷却中</h3>
                  <p className="text-slate-500 mt-2 font-medium max-w-md text-center">千问配额恢复中，倒计时结束后会自动继续当前任务（无需反复点击）。可点左侧 STOP 暂停。</p>
              </div>
          )}

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
                {activeModule === ModuleType.DISCOVERY && (
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
                          performSingleAnalysis(domain, {
                            searchKeyword: kw || undefined,
                            searchCountry: countryFromItem || undefined,
                            searchTags: tags,
                          });
                        }}
                        onOpenExistingReport={handleOpenExistingFromSearch}
                        onBatchAddToCRM={handleBatchAddToCRM}
                        onBatchAnalyze={handleBatchAnalyzeExisting}
                    />
                )}
                {activeModule === ModuleType.CLIENT_CRM && (
                    <ModuleClientCRM 
                        clients={crmClients} 
                        setClients={setCrmClients} 
                        onBatchAnalyze={handleBatchAnalyzeFromCRM}
                        onBatchDmSearch={handleBatchDmSearchFromCRM}
                        onBatchDelete={handleBatchDeleteClients}
                        onBatchProductDig={handleBatchProductDigFromCRM}
                        onPurgeBeforeJune2026={handlePurgeCrmBeforeJune2026}
                        onRecoverCrm={handleRecoverCrm}
                        productDigBusy={isProductDigQueueBusy() || productDigProgress.active > 0}
                        onReanalyze={(client) => void handleBatchAnalyzeFromCRM([client])}
                        history={history}
                        onOpenHistory={loadFromHistory}
                        onNavOrderChange={setCrmNavOrder}
                    />
                )}
                {activeModule === ModuleType.PRODUCT_MATCH && (
                    <ModuleProductMatch
                        history={history}
                        onOpenHistory={loadFromHistory}
                        onGoCrm={() => setActiveModule(ModuleType.CLIENT_CRM)}
                    />
                )}
                {activeModule === ModuleType.EMAIL_CAMPAIGN && (
                    <ModuleEmailCampaign crmClients={crmClients} onAddClients={handleAddClients} />
                )}
                {activeModule === ModuleType.IMAGE_GENERATOR && (
                    <ModuleImageGenerator />
                )}
                {activeModule === ModuleType.PROMO_GENERATOR && (
                    <ModulePromoGenerator 
                        onStartAutomation={handleStartQueueGeneration} 
                        automationResults={automationResults} 
                        isAutomating={isAutomating} 
                        onRunPending={handleRunPending}
                        onRunSingle={handleRunSingle}
                        onRerunCompleted={handleRerunCompletedTask}
                        onDelete={handleDeleteTask}
                        onViewResult={handleViewAutomationResult}
                        onDownloadResult={handleDownloadAutomationResult}
                        onDownloadAll={handleDownloadAllCompleted}
                        canExportPpt={hasPermission(currentUser, 'feature.export_ppt')}
                        canDmMine={hasPermission(currentUser, 'feature.dm_email_search')}
                        canCrmImport={canAccessModule(currentUser, ModuleType.CLIENT_CRM)}
                        onClearCompleted={handleClearCompletedTasks}
                        onClearAll={handleClearAllTasks}
                        onReloadQueue={handleReloadAutomationQueue}
                        canViewEmails={canViewFullDecisionMakerEmails(currentUser)}
                    />
                )}
                {activeModule === ModuleType.STRATEGY && (
                    <div className="animate-fade-in max-w-7xl mx-auto pb-10">
                        {analysisData && (
                            <div className="mb-6 sm:mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-panel">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-600 mb-1">Strategy Context</div>
                                  <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight truncate">{analysisData.companyInfo?.name}</h2>
                                  <div className="text-xs sm:text-sm text-slate-500 font-semibold mt-2">上下文：深度调查报告</div>
                                </div>
                            </div>
                        )}
                        <ModuleStrategy
                          data={analysisData}
                          history={history}
                          discoveryArchives={discoveryArchives}
                          onSaveGeneratedEmails={async (emails, forCompany) => {
                            const target = forCompany || analysisDataRef.current;
                            if (!target) return;
                            const nextData: AnalysisResult = {
                              ...target,
                              generatedEmails: emails,
                              generatedEmailsAt: Date.now(),
                            };
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
                )}
                {analysisData && !alwaysActiveModules.includes(activeModule) && (
                    <ErrorBoundary label="背调报告">
                    <div className="animate-fade-in max-w-7xl mx-auto pb-10">
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
                              {analysisData.decisionMakerEmailSearchAt ? '再次深挖决策人邮箱' : '后台搜索决策人邮箱'}
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
                        hasPriorDmSearch={!!analysisData.decisionMakerEmailSearchAt}
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

      {/* 后台任务条统一放左下，避免挡住 CRM 右下角翻页 */}
      <div className="fixed bottom-4 left-4 md:left-[17.5rem] z-[60] flex flex-col-reverse gap-3 w-[min(100vw-2rem,22rem)] pointer-events-none [&>*]:pointer-events-auto">
        {hasPermission(currentUser, 'feature.dm_email_search') && <DmEmailSearchPanel />}
        <ProductDigPanel />
      </div>

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
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50">
          <div className="bg-[#F0F2F5] w-full sm:max-w-5xl sm:rounded-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-base font-black text-slate-800">团队权限管理</div>
                <div className="text-[11px] font-bold text-slate-400">仅可管理本部门普通员工；各部门数据互不共享</div>
              </div>
              <button type="button" onClick={() => setTeamManageOpen(false)} className="text-slate-400 hover:text-slate-700 font-black px-3 py-2">关闭</button>
            </div>
            <div className="p-4">
              <OrgPermissionPanel
                currentUser={currentUser}
                users={users}
                setUsers={setUsers}
                departments={departments}
                setDepartments={setDepartments}
                mode="manager"
              />
            </div>
          </div>
        </div>
      )}

    </div>
    </AccessGate>
  );
};
export default App;
