
import React, { useState, useEffect, useRef } from 'react';
import { analyzeCompany, hasApiKeyConfigured, checkApiKeyAvailability, hydrateApiConfigsFromCloud, searchPotentialClients } from './services/geminiService';
import { exportToPPT, exportAutomationReportToPPT, exportBatchAutomationReportsToPPT } from './services/exportService';
import { saveHistory, getHistory, getAllFilesFromDB, saveAutomationTask, getAutomationQueue, deleteAutomationTask, saveFileToDB, saveDiscoveryArchive, getDiscoveryArchives, deleteDiscoveryArchive, deleteHistoryItem } from './services/db';
import { fetchGlobalConfig, fetchDocumentsFromRepo, backupUserHistory, fetchCRMFromCloud, saveCRMToCloud, fetchUserHistoryFromCloud, checkGitHubStatus, fetchApiConfigsFromCloud, setManualGitHubConfig } from './services/githubService';
import { isSupabaseConfigured, getKnowledgeFiles, getInvestigationHistory, saveInvestigationHistory, saveDiscoverySearch, getCrmClients, syncCrmClients, deleteCrmClient, getDiscoverySearchArchives, deleteInvestigationHistory, deleteDiscoverySearchFromCloud, deleteDiscoverySearchesByMeta } from './services/supabase';
import { addCustomKeyword, addCustomCountry } from './services/taxonomyStore';
import { normalizeCountryZh } from './utils/countryNormalize';
import { buildSearchTags, stampSearchResults } from './utils/searchTags';
import { mergeDiscoveryResultsIntoCrm, mergeHistoryItemsIntoCrm } from './utils/crmHistory';
import { checkLimit, incrementUsage, updateLocalConfig, resetDailyUsage, getDailyUsagePublic } from './services/limitService';
import { ModuleType, AnalysisResult, DiscoveryState, Client, User, HistoryItem, AutomationResult, ClientSearchResult, DiscoveryArchiveItem, DecisionMaker, Department } from './types';
import { ModuleBackground } from './components/ModuleBackground';
import { ModuleProducts } from './components/ModuleProducts';
import { ModuleDecisionMakers } from './components/ModuleDecisionMakers';
import { DmEmailSearchPanel } from './components/DmEmailSearchPanel';
import { enqueueDmEmailSearch, type DmEmailSearchJob } from './services/dmEmailSearchQueue';
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
  saveUserDiscoveryState,
} from './utils/workspaceScope';
import { ModuleStrategy } from './components/ModuleStrategy';
import { ReportEnrichmentPanel } from './components/ReportEnrichmentPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { extractHistoryAnalysis, websiteHref } from './services/analysisNormalize';
import { ModuleSimilar } from './components/ModuleSimilar';
import { ModulePromoGenerator } from './components/ModulePromoGenerator';
import { ModuleClientCRM } from './components/ModuleClientCRM';
import { ModuleEmailCampaign } from './components/ModuleEmailCampaign'; 
import { ModuleImageGenerator } from './components/ModuleImageGenerator';
import { ClientFinder } from './components/ClientFinder';
import { RecordsPanel, archiveToDiscoveryState } from './components/RecordsPanel';
import { Login } from './components/Login';
import { AccessGate } from './components/AccessGate';
import { loadUsersWithMigration, loadUsersFromStorage, saveUsersToStorage, getUsersUpdatedAt } from './services/auth';
import { AdminDashboard } from './components/AdminDashboard';
import { 
  LayoutDashboard, PackageSearch, Users, PenTool, Network, Search, Loader2, Menu, Globe, Zap, FileSpreadsheet, History, Clock, ChevronRight, AlertTriangle, RefreshCw, LogOut, Briefcase, Ruler, CheckCircle2, Hourglass, StopCircle, PlayCircle, Layers, Mail, Cloud, Download, Info, Link2, X, Database, Github, Image, Trash2, Ban
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
  
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualOwner, setManualOwner] = useState('');
  const [manualRepo, setManualRepo] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const shouldStopRef = useRef(false);
  const historyRef = useRef<HistoryItem[]>([]);
  const viewingHistoryIdRef = useRef<string | null>(null);
  const analysisDataRef = useRef<AnalysisResult | null>(null);
  const userDataReadyRef = useRef(false);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    viewingHistoryIdRef.current = viewingHistoryId;
  }, [viewingHistoryId]);
  useEffect(() => {
    analysisDataRef.current = analysisData;
  }, [analysisData]);

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
            const q = await getAutomationQueue();
            const scopedQueue = scope(q);
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
  useEffect(() => {
    if (!currentUser || !userDataReadyRef.current) return;
    const depts = departments.length ? departments : loadDepartmentsFromStorage();
    setHistory((prev) => filterOwnedRecords(currentUser, prev, users, depts));
    setAutomationResults((prev) => filterOwnedRecords(currentUser, prev, users, depts));
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
  };

  /** 仅排除：下次搜索跳过，不删除当前报告 */
  const handleExcludeCurrentCompany = async () => {
    const data = analysisDataRef.current;
    if (!data?.companyInfo) return;
    const name = data.companyInfo.name || '';
    const website = data.companyInfo.website || domainInput || '';
    const ok = window.confirm(
      `确认排除「${name || website}」？\n\n之后客户搜索会自动跳过该公司/域名，避免浪费 Token。\n当前背调报告仍保留，可自行再点「删除」。`
    );
    if (!ok) return;
    try {
      await addExcludedCompany({
        domain: website,
        name,
        reason: '非目标客户（背调页手动排除）',
      });
      alert('已加入排除名单。下次搜索将自动过滤；如需移除本页报告，请再点「删除」。');
    } catch (e: any) {
      alert(`排除失败: ${e?.message || String(e)}`);
    }
  };

  /** 仅删除当前背调报告（不加入排除名单） */
  const handleDeleteCurrentReport = async () => {
    const data = analysisDataRef.current;
    if (!data?.companyInfo) return;
    const name = data.companyInfo.name || data.companyInfo.website || '当前报告';
    const website = data.companyInfo.website || domainInput || '';
    const ok = window.confirm(
      `确认删除「${name}」的背调报告？\n\n不会加入排除名单，以后搜索仍可能再次出现。`
    );
    if (!ok) return;
    try {
      const hid = viewingHistoryIdRef.current;
      if (hid) {
        await deleteHistoryItem(hid);
        try {
          await deleteInvestigationHistory(hid);
        } catch {
          /* cloud optional */
        }
        setHistory((prev) => prev.filter((h) => h.id !== hid));
      } else {
        const domainKey = (website || '')
          .toLowerCase()
          .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
          .split('/')[0];
        const match = historyRef.current.find(
          (h) =>
            (h.domain || '')
              .toLowerCase()
              .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
              .split('/')[0] === domainKey
        );
        if (match) {
          await deleteHistoryItem(match.id);
          try {
            await deleteInvestigationHistory(match.id);
          } catch {
            /* ignore */
          }
          setHistory((prev) => prev.filter((h) => h.id !== match.id));
        }
      }
      setAnalysisData(null);
      setViewingHistoryId(null);
      setDomainInput('');
      setActiveModule(ModuleType.DISCOVERY);
      alert('已删除该背调报告。');
    } catch (e: any) {
      alert(`删除失败: ${e?.message || String(e)}`);
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
      setCrmClients(prev => prev.map(c => {
          if (c.website?.toLowerCase() === analysis.companyInfo.website?.toLowerCase() || c.name === analysis.companyInfo.name) {
              return { 
                  ...c, 
                  hasAnalyzed: true,
                  hasBackgroundCheck: true,
                  activityLog: c.activityLog + ` [Analyzed ${new Date().toLocaleDateString()}]`,
                  contacts: (c.contacts && c.contacts.length > 0) ? c.contacts : (analysis.decisionMakers || [])
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
      setAnalysisData(task.analysis);
      setViewingHistoryId(null);
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

  const stopAutomation = () => { shouldStopRef.current = true; setIsAutomating(false); };
  
  // RESTORED: Generate Tasks Logic
  const handleStartQueueGeneration = async (keyword: string, productContext: string, countries: string[], productImages: string[], clientType: string) => { 
      await generateQueue(keyword, productContext, countries, productImages, clientType); 
      const freshQueue = await getAutomationQueue(); 
      const pending = freshQueue.filter(t => t.status === 'pending'); 
      await processBatchQueue(pending); 
  };

  const generateQueue = async (keyword: string, productContext: string, countries: string[], productImages: string[], clientType: string) => { 
      setBatchModalOpen(false); 
      setIsAutomating(true);
      const newTasks: AutomationResult[] = [];
      const kw = (keyword || '').trim();
      if (kw) {
        addCustomKeyword(kw);
        setDiscoveryState((prev) => ({ ...prev, product: kw }));
      }
      
      for (const country of countries) {
          try {
              // Quick search (limit 5 per country for automation demo)
              const raw = await searchPotentialClients(keyword, country, '', clientType, 5);
              const results = stampSearchResults(raw, {
                keyword: kw,
                targetCountry: country,
                clientTypes: clientType ? [clientType] : [],
                searchId: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              });
              for (const res of results) {
                  newTasks.push(stampOwnership({
                      id: Math.random().toString(36).substr(2, 9),
                      clientName: res.name,
                      website: res.website,
                      country: res.country,
                      status: 'pending',
                      productContext: productContext,
                      productImages: productImages,
                      mode: 'economy',
                      keyword: res.searchKeyword || kw || undefined,
                      createdAt: Date.now(),
                  }));
              }
          } catch(e) { console.error(e); }
      }
      
      setAutomationResults(prev => [...prev, ...newTasks]);
      for (const task of newTasks) { await saveAutomationTask(task); }
      setIsAutomating(false);
      return newTasks;
  };

  // RESTORED: Process Automation Queue
  const processBatchQueue = async (tasksToRun: AutomationResult[]) => { 
      if (tasksToRun.length === 0) return;
      setIsAutomating(true);
      shouldStopRef.current = false;

      for (const task of tasksToRun) {
          if (shouldStopRef.current) break;
          
          // Check limits before running
          const limit = checkLimit('analysis');
          if (!limit.allowed) {
              alert(`今日背调次数已达上限（${limit.current}/${limit.max}），批量任务已暂停。可在刷新后继续，或联系管理员提高限额。`);
              break;
          }

          // Update Status to Analyzing
          setAutomationResults(prev => prev.map(t => t.id === task.id ? { ...t, status: 'analyzing' } : t));

          try {
              // 1. Analyze — 带上搜索关键词，产品分析聚焦该关键词
              const kw = (task.keyword || discoveryState.product || '').trim();
              if (kw) addCustomKeyword(kw);
              const result = await analyzeCompany(task.website, task.mode || 'economy', {
                searchKeyword: kw || undefined,
                searchTags: kw ? buildSearchTags(kw, task.country || '') : undefined,
                searchCountry: task.country || undefined,
              });

              // 2. Complete — 立刻落盘任务 + 写入历史（开发信请稍后在策略模块手动生成）
              const completedTask: AutomationResult = { 
                  ...task,
                  clientName: result.companyInfo?.name || task.clientName,
                  website: result.companyInfo?.website || task.website,
                  country: result.companyInfo?.headquarters?.split(',').pop()?.trim() || task.country,
                  status: 'completed', 
                  analysis: result, 
                  mailGroup: undefined,
                  keyword: kw || task.keyword || discoveryState.product,
              };
              
              await saveAutomationTask(completedTask);
              setAutomationResults(prev => prev.map(t => t.id === task.id ? completedTask : t));

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
              setAutomationResults(prev => prev.map(t => t.id === task.id ? failedTask : t));
              
              // Simple Rate Limit Handling
              if (e.message && e.message.includes('429')) {
                  setCooldownTime(60);
                  for(let i=60; i>0; i--) {
                      if (shouldStopRef.current) break;
                      setCooldownTime(i);
                      await new Promise(r => setTimeout(r, 1000));
                  }
                  setCooldownTime(0);
              }
          }
          
          // Safety delay
          await new Promise(r => setTimeout(r, 2000));
      }
      setIsAutomating(false);

      const done = tasksToRun.filter((t) => {
        const latest = automationResults.find((x) => x.id === t.id);
        return latest?.status === 'completed' || t.status === 'completed';
      }).length;
      // 用队列最新状态统计（state 可能滞后，再读一遍本地库更准）
      try {
        const q = await getAutomationQueue();
        const completedNow = q.filter(
          (t) => tasksToRun.some((r) => r.id === t.id) && t.status === 'completed' && t.analysis
        ).length;
        if (completedNow > 0) {
          alert(`批量背调完成 ${completedNow} 条。结果已写入「历史记录」与任务队列，可查看并下载 PPT。`);
        }
      } catch {
        if (done > 0) alert('批量背调已结束，请到历史记录或自动化队列查看结果。');
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

  const confirmBatchStart = async (mode: 'detailed' | 'economy') => { 
      if (!hasPermission(currentUser, 'feature.batch_analyze')) {
        alert('你没有「批量背调」权限，请联系管理员或部门主管开通。');
        return;
      }
      setBatchModalOpen(false); 
      setActiveModule(ModuleType.PROMO_GENERATOR); 
      
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
          id: Math.random().toString(36).substr(2, 9), 
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
      
      setAutomationResults(prev => [...prev, ...newTasks]); 
      for (const task of newTasks) { 
          await saveAutomationTask(task); 
      } 
      
      await processBatchQueue(newTasks); 
  };

  const handleRunPending = async () => { 
      const pending = automationResults.filter(t => t.status === 'pending' || t.status === 'failed'); 
      await processBatchQueue(pending); 
  };
  
  const handleRunSingle = async (id: string) => { 
      const task = automationResults.find(t => t.id === id);
      if(task) await processBatchQueue([task]);
  };

  const handleDeleteTask = async (id: string) => { 
      if(confirm("Delete?")) { 
          await deleteAutomationTask(id); 
          setAutomationResults(prev => prev.filter(t => t.id !== id)); 
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

  const alwaysActiveModules = [ModuleType.DISCOVERY, ModuleType.PROMO_GENERATOR, ModuleType.CLIENT_CRM, ModuleType.STRATEGY, ModuleType.EMAIL_CAMPAIGN, ModuleType.IMAGE_GENERATOR];
  const navModules = [
            { id: ModuleType.DISCOVERY, label: '客户搜索', sub: 'Discovery', icon: Globe },
            { id: ModuleType.BACKGROUND, label: '背景调查', sub: 'Background', icon: LayoutDashboard },
            { id: ModuleType.PRODUCTS, label: '产品分析', sub: 'Products', icon: PackageSearch },
            { id: ModuleType.DECISION_MAKERS, label: '决策人挖掘', sub: 'Contacts', icon: Users },
            { id: ModuleType.STRATEGY, label: '开发策略', sub: 'Strategy', icon: PenTool },
            { id: ModuleType.SIMILAR, label: '同类推荐', sub: 'Similar', icon: Network },
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

        {isAutomating && (
            <div className="mx-4 mt-4 p-3 bg-slate-900 rounded-xl border border-slate-800 shadow-lg text-white animate-pulse">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-green-400 flex items-center gap-1"><Loader2 className="animate-spin" size={10}/> RUNNING</span>
                    <span className="text-[10px] text-slate-400">Processing...</span>
                </div>
                <div className="text-xs font-bold mb-3">{automationResults.filter(r => r.status === 'completed').length} / {automationResults.length} Completed</div>
                <button onClick={stopAutomation} className="w-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1 transition-colors">
                    <StopCircle size={12} /> STOP NOW
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
              版本 v20260803c · 记录中心批量导入CRM
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
            await deleteHistoryItem(id);
            if (isSupabaseConfigured()) await deleteInvestigationHistory(id);
            setHistory(prev => prev.filter(h => h.id !== id));
          }}
          onDeleteDiscovery={async (id) => {
            const target = discoveryArchives.find((d) => d.id === id);
            await deleteDiscoveryArchive(id);
            addDiscoveryTombstone(id, target?.product, target?.country);
            if (isSupabaseConfigured()) {
              const looksUuid = /^[0-9a-f-]{36}$/i.test(id);
              if (looksUuid) await deleteDiscoverySearchFromCloud(id);
              if (target?.product) {
                await deleteDiscoverySearchesByMeta(target.product, target.country || '');
              }
            }
            setDiscoveryArchives((prev) => prev.filter((d) => d.id !== id));
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
                  <p className="text-slate-500 mt-2 font-medium max-w-md text-center">正在等待 API 配额恢复。</p>
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
                        onBatchAddToCRM={handleBatchAddToCRM}
                        onBatchAnalyze={handleBatchAnalyzeExisting}
                    />
                )}
                {activeModule === ModuleType.CLIENT_CRM && (
                    <ModuleClientCRM 
                        clients={crmClients} 
                        setClients={setCrmClients} 
                        onBatchAnalyze={handleBatchAnalyzeFromCRM} 
                        history={history}
                        onOpenHistory={loadFromHistory}
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
                        onDelete={handleDeleteTask}
                        onViewResult={handleViewAutomationResult}
                        onDownloadResult={handleDownloadAutomationResult}
                        onDownloadAll={handleDownloadAllCompleted}
                        canExportPpt={hasPermission(currentUser, 'feature.export_ppt')}
                        onClearCompleted={handleClearCompletedTasks}
                        onClearAll={handleClearAllTasks}
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
                          onSaveGeneratedEmails={async (emails) => {
                            await patchAnalysisData({
                              generatedEmails: emails,
                              generatedEmailsAt: Date.now(),
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
                              <div className="mt-1 sm:mt-2 flex items-center gap-2 flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => void handleExcludeCurrentCompany()}
                                  title="仅排除：下次搜索跳过，报告仍保留"
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 px-3 py-1.5 text-xs font-black touch-manipulation"
                                >
                                  <Ban size={14} /> 排除
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteCurrentReport()}
                                  title="仅删除本报告：不加入排除名单"
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 px-3 py-1.5 text-xs font-black touch-manipulation"
                                >
                                  <Trash2 size={14} /> 删除
                                </button>
                              </div>
                            </div>
                            <a href={websiteHref(analysisData.companyInfo?.website)} target="_blank" rel="noreferrer" className="text-cyan-600 font-semibold mt-2 hover:underline text-sm sm:text-base break-all">{analysisData.companyInfo?.website || '—'}</a>
                            {(analysisData.searchKeyword || analysisData.searchTags?.length) && (
                              <div className="flex flex-wrap gap-1.5 mt-3">
                                {analysisData.searchKeyword && (
                                  <span className="text-[10px] font-black bg-amber-50 text-amber-700 px-2 py-1 rounded-lg">
                                    搜索来源: {analysisData.searchKeyword}
                                  </span>
                                )}
                                {(analysisData.searchTags || []).slice(0, 4).map((t) => (
                                  <span key={t} className="text-[10px] font-black bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto flex-shrink-0">
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
                        {(analysisData.decisionMakers?.some((d) => d.emailGuess) ||
                          analysisData.generatedEmails) && (
                          <div className="mb-4">
                            <ReportEnrichmentPanel
                              data={analysisData}
                              showDecisionMakers={canViewFullDecisionMakerEmails(currentUser)}
                              canViewEmails={canViewFullDecisionMakerEmails(currentUser)}
                            />
                          </div>
                        )}
                    </div>
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
                      />
                    )}
                    {activeModule === ModuleType.PRODUCTS && (
                      <ModuleProducts
                        data={analysisData}
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
                    {activeModule === ModuleType.SIMILAR && <ModuleSimilar data={analysisData} onAnalyze={handleAnalyzeInput} />}
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

      {hasPermission(currentUser, 'feature.dm_email_search') && <DmEmailSearchPanel />}

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
