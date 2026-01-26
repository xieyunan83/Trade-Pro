
import React, { useState, useEffect, useRef } from 'react';
import { analyzeCompany, getGeminiConfig, searchPotentialClients, generateMailGroupStrategy } from './services/geminiService';
import { exportToPPT } from './services/exportService';
import { saveHistory, getHistory, getAllFilesFromDB, saveAutomationTask, getAutomationQueue, deleteAutomationTask, saveFileToDB } from './services/db';
import { fetchGlobalConfig, fetchSharedKnowledgeBase, backupUserHistory, fetchCRMFromCloud, saveCRMToCloud, fetchUserHistoryFromCloud, checkGitHubStatus, fetchApiConfigsFromCloud, setManualGitHubConfig } from './services/githubService';
import { checkLimit, incrementUsage, updateLocalConfig } from './services/limitService';
import { ModuleType, AnalysisResult, DiscoveryState, Client, User, HistoryItem, AutomationResult, ClientSearchResult } from './types';
import { ModuleBackground } from './components/ModuleBackground';
import { ModuleProducts } from './components/ModuleProducts';
import { ModuleDecisionMakers } from './components/ModuleDecisionMakers';
import { ModuleStrategy } from './components/ModuleStrategy';
import { ModuleSimilar } from './components/ModuleSimilar';
import { ModulePromoGenerator } from './components/ModulePromoGenerator';
import { ModuleClientCRM } from './components/ModuleClientCRM';
import { ClientFinder } from './components/ClientFinder';
import { Login } from './components/Login';
import { AdminDashboard } from './components/AdminDashboard';
import { 
  LayoutDashboard, PackageSearch, Users, PenTool, Network, Search, Loader2, Menu, Globe, Zap, FileSpreadsheet, History, Clock, ChevronRight, AlertTriangle, RefreshCw, LogOut, Briefcase, Ruler, CheckCircle2, Hourglass, StopCircle, PlayCircle, Layers, Mail, Cloud, Download, Info, Link2, X, Database
} from 'lucide-react';

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
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  
  const [domainInput, setDomainInput] = useState('');
  const [activeModule, setActiveModule] = useState<ModuleType>(ModuleType.DISCOVERY);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisResult | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [crmClients, setCrmClients] = useState<Client[]>([]);
  const [kbCount, setKbCount] = useState(0); 
  const [systemNotice, setSystemNotice] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isKBSyncing, setIsKBSyncing] = useState(false); // Specific loading state for KB
  
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({
    product: '', country: '', industry: '', clientType: '', results: [], hasSearched: false
  });

  const [automationResults, setAutomationResults] = useState<AutomationResult[]>([]);
  const [isAutomating, setIsAutomating] = useState(false);
  const [cooldownTime, setCooldownTime] = useState(0);
  
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<string[]>([]);
  const [pendingBatchContext, setPendingBatchContext] = useState<string>('');
  
  // Cloud Connect Modal for Users
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualOwner, setManualOwner] = useState('');
  const [manualRepo, setManualRepo] = useState('');

  const shouldStopRef = useRef(false);

  useEffect(() => {
    const checkKey = async () => {
      const configs = getGeminiConfig();
      if (configs.length > 0 && configs[0].apiKey) {
          setHasKey(true);
          return;
      }
      if (window.aistudio?.hasSelectedApiKey) {
        const studioKey = await window.aistudio.hasSelectedApiKey();
        if (studioKey) { setHasKey(true); return; }
      } 
      setHasKey(false);
    };
    checkKey();
  }, [currentUser]);

  useEffect(() => {
    const loadData = async () => {
        try {
            // 1. Load Local DB Data First
            const h = await getHistory(); setHistory(h);
            const q = await getAutomationQueue(); setAutomationResults(q);
            const files = await getAllFilesFromDB(); setKbCount(files.length);
            
            // 2. Sync from GitHub if connected
            if (checkGitHubStatus().ok && currentUser) {
                // Config
                const globalConfig = await fetchGlobalConfig();
                if (globalConfig) {
                    updateLocalConfig(globalConfig);
                    if(globalConfig.systemNotice) setSystemNotice(globalConfig.systemNotice);
                }
                
                // KB (Only if local is empty, auto-sync)
                if (files.length === 0) {
                    await handleManualKBSync();
                }

                // CRM
                const cloudCRM = await fetchCRMFromCloud();
                if(cloudCRM.length > 0) {
                    setCrmClients(cloudCRM);
                    localStorage.setItem('tradeScoutClients', JSON.stringify(cloudCRM));
                }

                // History
                const cloudHistory = await fetchUserHistoryFromCloud(currentUser.username);
                if(cloudHistory.length > 0) {
                    const existingIds = new Set(h.map(i => i.id));
                    const newItems = cloudHistory.filter(i => !existingIds.has(i.id));
                    if (newItems.length > 0) {
                        for(const item of newItems) await saveHistory(item);
                        setHistory(prev => [...newItems, ...prev]);
                    }
                }
                
                const apiKeys = await fetchApiConfigsFromCloud();
                if (apiKeys.length > 0) {
                    localStorage.setItem('trade_scout_api_configs', JSON.stringify(apiKeys));
                }
            }
        } catch (e) {
            console.error("Sync Error", e);
        }
    };
    
    if (currentUser) loadData();
    
    const savedClients = localStorage.getItem('tradeScoutClients');
    if (savedClients && crmClients.length === 0) { try { setCrmClients(JSON.parse(savedClients)); } catch(e) {} }
  }, [currentUser]); 

  useEffect(() => {
      if (crmClients.length > 0) localStorage.setItem('tradeScoutClients', JSON.stringify(crmClients));
  }, [crmClients]);

  const handleManualConnect = async () => {
      if (!manualToken || !manualOwner || !manualRepo) {
          alert("请填写所有字段 (Token, Owner, Repo)");
          return;
      }
      setManualGitHubConfig(manualToken, manualOwner, manualRepo);
      
      const check = checkGitHubStatus();
      if (check.ok) {
          alert("连接成功！即将同步数据...");
          await handleManualKBSync();
          setCloudModalOpen(false);
          window.location.reload(); 
      } else {
          alert("连接失败，请检查凭证。");
      }
  };

  const handleManualKBSync = async () => {
      if (!checkGitHubStatus().ok) return;
      setIsKBSyncing(true);
      try {
          const sharedKB = await fetchSharedKnowledgeBase();
          if (sharedKB && sharedKB.length > 0) {
              for (const f of sharedKB) { await saveFileToDB(f); }
              setKbCount(sharedKB.length);
          }
      } catch (e) {
          console.error("KB Sync Failed", e);
      } finally {
          setIsKBSyncing(false);
      }
  };

  const handleAnalyzeInput = (input: string = domainInput) => {
      if (!input.trim()) return;
      const lines = input.split(/[\n;]+/).map(s => s.trim()).filter(s => s.length > 0);
      if (lines.length === 1) {
          const limit = checkLimit('analysis');
          if (!limit.allowed) { alert(`Daily Analysis Limit Reached (${limit.max}).`); return; }
          performSingleAnalysis(lines[0]);
      } else {
          setPendingBatch(lines); setPendingBatchContext('Manual Input'); setBatchModalOpen(true);
      }
  };
  const performSingleAnalysis = async (domain: string) => {
    setLoading(true); setErrorMsg(null); setActiveModule(ModuleType.BACKGROUND); setMobileMenuOpen(false);
    try {
      const result = await analyzeCompany(domain, 'detailed'); setAnalysisData(result); incrementUsage('analysis');
      const historyItem: HistoryItem = { id: Date.now().toString(), type: ModuleType.BACKGROUND, data: result, timestamp: Date.now(), domain: result.companyInfo.website };
      await saveHistory(historyItem); setHistory(prev => [historyItem, ...prev]); updateCrmStatus(result);
    } catch (e: any) { setErrorMsg(`Error: ${e.message}`); } finally { setLoading(false); }
  };
  const loadFromHistory = (item: HistoryItem) => { setAnalysisData(item.data); setDomainInput(item.domain); setActiveModule(ModuleType.BACKGROUND); setHistoryOpen(false); setErrorMsg(null); };
  const handleExportReport = () => { if (analysisData) exportToPPT(analysisData); };
  const handleAddToCRM = () => { if (!analysisData) return; const newClient: Client = { id: Date.now().toString(), name: analysisData.companyInfo.name, website: analysisData.companyInfo.website, country: analysisData.companyInfo.headquarters.split(',').pop()?.trim() || 'Global', type: '进口商', status: '新建/潜在', productType: analysisData.businessScope.coreProducts[0] || 'N/A', priceRange: analysisData.businessScope.priceSensitivity || 'Medium', isSampleNeeded: false, hasAnalyzed: true, lastOrderDate: '', lastContactSent: '', lastContactReceived: '', nextFollowUpDate: new Date().toISOString().split('T')[0], activityLog: `Added from Deep Analysis. Rev: ${analysisData.financials.revenueEstimate}.` }; setCrmClients(prev => [newClient, ...prev]); alert("Added to CRM!"); };
  const handleBatchAddToCRM = (results: ClientSearchResult[]) => { /* ... existing ... */ };
  const updateCrmStatus = (analysis: AnalysisResult) => { /* ... existing ... */ };
  const stopAutomation = () => { shouldStopRef.current = true; setIsAutomating(false); };
  const handleStartQueueGeneration = async (keyword: string, productContext: string, countries: string[], productImages: string[], clientType: string) => { await generateQueue(keyword, productContext, countries, productImages, clientType); const freshQueue = await getAutomationQueue(); const pending = freshQueue.filter(t => t.status === 'pending'); await processBatchQueue(pending); };
  const generateQueue = async (keyword: string, productContext: string, countries: string[], productImages: string[], clientType: string) => { /* ... existing ... */ return []; };
  const processBatchQueue = async (tasks: AutomationResult[]) => { /* ... existing ... */ };
  const handleBatchAnalyzeExisting = async (results: ClientSearchResult[]) => { setPendingBatch(results.map(r => r.website)); setPendingBatchContext('Discovery Batch'); setBatchModalOpen(true); };
  const handleBatchAnalyzeFromCRM = async (clients: Client[]) => { const targets = clients.map(c => c.name); setPendingBatch(targets); setPendingBatchContext('CRM Batch'); setBatchModalOpen(true); };
  const confirmBatchStart = async (mode: 'detailed' | 'economy') => { setBatchModalOpen(false); setActiveModule(ModuleType.PROMO_GENERATOR); const newTasks: AutomationResult[] = pendingBatch.map(target => ({ id: Math.random().toString(36).substr(2, 9), clientName: target, website: target, country: 'Global', status: 'pending', productContext: pendingBatchContext, productImages: [], mode: mode })); setAutomationResults(prev => [...prev, ...newTasks]); for (const task of newTasks) { await saveAutomationTask(task); } await processBatchQueue(newTasks); };
  const handleRunPending = async () => { const pending = automationResults.filter(t => t.status === 'pending' || t.status === 'failed'); await processBatchQueue(pending); };
  const handleRunSingle = async (id: string) => { /* ... existing ... */ };
  const handleDeleteTask = async (id: string) => { if(confirm("Delete?")) { await deleteAutomationTask(id); setAutomationResults(prev => prev.filter(t => t.id !== id)); } };
  const handleLogout = () => { setCurrentUser(null); setAnalysisData(null); setDomainInput(''); setActiveModule(ModuleType.DISCOVERY); };
  const handleSyncToGitHub = async () => { if(!currentUser) return; setIsSyncing(true); try { await backupUserHistory(currentUser.username, history); await saveCRMToCloud(crmClients); alert("数据同步成功!"); } catch (e: any) { alert("同步失败: " + e.message); } finally { setIsSyncing(false); } };

  if (hasKey === null) return <div className="h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;
  if (!currentUser) return <Login onLogin={setCurrentUser} />;
  if (currentUser.role === 'admin') return <AdminDashboard onLogout={handleLogout} currentUser={currentUser} />;

  if (hasKey === false) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
              <div className="bg-red-100 p-4 rounded-full text-red-600 mb-4"><AlertTriangle size={32}/></div>
              <h2 className="text-xl font-bold text-slate-800">System Configuration Required</h2>
              <p className="text-slate-500 mt-2 max-w-md">Please contact admin to configure API Keys.</p>
              <button onClick={handleLogout} className="mt-6 text-blue-600 hover:underline">Back to Login</button>
          </div>
      );
  }

  const alwaysActiveModules = [ModuleType.DISCOVERY, ModuleType.PROMO_GENERATOR, ModuleType.CLIENT_CRM, ModuleType.STRATEGY];

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <aside className={`fixed md:static z-30 h-full w-72 bg-white border-r border-slate-200 transition-transform ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} flex flex-col shadow-2xl md:shadow-none`}>
        <div className="p-6 border-b flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white shadow-md shadow-blue-100"><Zap size={20} /></div>
            <div>
                <h1 className="text-lg font-black text-slate-800 tracking-tight leading-tight">楠哥的小助理<br/><span className="text-blue-600">AI 外贸系统</span></h1>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span>{currentUser.username}</div>
            </div>
        </div>
        
        {systemNotice && (
            <div className="bg-yellow-50 p-3 mx-4 mt-4 rounded-xl border border-yellow-200 text-yellow-800 text-xs font-bold flex items-start gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5"/>
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

        <nav className="p-4 space-y-1 flex-1 overflow-y-auto custom-scrollbar">
          {[
            { id: ModuleType.DISCOVERY, label: '客户搜索 (Discovery)', icon: Globe },
            { id: ModuleType.BACKGROUND, label: '背景调查 (Background)', icon: LayoutDashboard },
            { id: ModuleType.PRODUCTS, label: '产品分析 (Products)', icon: PackageSearch },
            { id: ModuleType.DECISION_MAKERS, label: '决策人挖掘 (Contacts)', icon: Users },
            { id: ModuleType.STRATEGY, label: '开发策略 (Strategy)', icon: PenTool },
            { id: ModuleType.SIMILAR, label: '同类推荐 (Similar)', icon: Network },
            { id: ModuleType.CLIENT_CRM, label: '客户管理 (CRM)', icon: Briefcase },
            { id: ModuleType.PROMO_GENERATOR, label: '营销工具 (Tools)', icon: Ruler },
          ].map(item => (
            <button key={item.id} onClick={() => { setActiveModule(item.id); setMobileMenuOpen(false); }} disabled={!analysisData && !alwaysActiveModules.includes(item.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all ${activeModule === item.id ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30'}`}>
              <item.icon size={18} /> {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-2">
            <button onClick={() => setCloudModalOpen(true)} className="w-full flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors">
                <Cloud size={14} /> 云端数据库连接 (Cloud Config)
            </button>
            <div 
                onClick={handleManualKBSync}
                className={`px-4 py-2 bg-green-50 rounded-xl border border-green-100 flex items-center gap-2 mb-2 cursor-pointer hover:bg-green-100 transition-colors ${isKBSyncing ? 'opacity-70' : ''}`}
                title="Click to Sync Knowledge Base"
            >
                {isKBSyncing ? <Loader2 size={16} className="text-green-600 animate-spin" /> : <CheckCircle2 size={16} className="text-green-600" />}
                <div>
                    <div className="text-[10px] font-black text-green-800 uppercase tracking-wide">Knowledge Base</div>
                    <div className="text-[10px] text-green-600">
                        {kbCount} Files Loaded {kbCount === 0 && !isKBSyncing && "(Click to Sync)"}
                    </div>
                </div>
            </div>
            <button onClick={() => setHistoryOpen(!historyOpen)} className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-sm font-bold transition-colors">
                <span className="flex items-center gap-2"><History size={18} /> 历史记录</span><ChevronRight size={16} className={`transition-transform ${historyOpen ? 'rotate-90' : ''}`} />
            </button>
            <button onClick={handleLogout} className="w-full flex items-center gap-2 px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl text-sm font-bold transition-colors"><LogOut size={18} /> 退出登录</button>
        </div>
      </aside>
      
      {historyOpen && (
          <div className="fixed inset-y-0 left-72 w-80 bg-white shadow-2xl z-20 border-r border-slate-200 transform transition-transform animate-fade-in flex flex-col">
              <div className="p-4 border-b bg-slate-50 font-bold text-slate-700 flex justify-between items-center">
                  <span>Recent Analysis</span>
                  <div className="flex gap-2">
                      <button onClick={handleSyncToGitHub} className="text-blue-600 hover:text-blue-800" title="Sync to GitHub">{isSyncing ? <Loader2 className="animate-spin" size={16}/> : <Cloud size={16}/>}</button>
                      <button onClick={() => setHistoryOpen(false)} className="text-slate-400 hover:text-slate-700">✕</button>
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                  {history.map((item, idx) => (
                      <button key={item.id} onClick={() => loadFromHistory(item)} className="w-full text-left p-3 rounded-xl hover:bg-blue-50 border border-transparent hover:border-blue-100 group transition-all">
                          <div className="font-bold text-slate-800 text-sm truncate group-hover:text-blue-700">{item.data.companyInfo.name || "Unknown"}</div>
                          <div className="text-xs text-slate-400 truncate">{item.domain}</div>
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300"><Clock size={10} /> {new Date(item.timestamp).toLocaleDateString()}</div>
                      </button>
                  ))}
              </div>
          </div>
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
                      
                      <div className="pt-4 border-t border-slate-100 mt-2">
                          <button 
                            onClick={handleManualKBSync} 
                            disabled={isKBSyncing || !checkGitHubStatus().ok}
                            className="w-full bg-green-50 text-green-700 border border-green-200 py-2 rounded-xl font-bold hover:bg-green-100 flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                              {isKBSyncing ? <Loader2 className="animate-spin" size={16}/> : <Database size={16}/>} 
                              强制拉取知识库 (Force Pull KB)
                          </button>
                          <p className="text-[10px] text-slate-400 mt-2 text-center">如果首页显示 "0 Files Loaded" 但云端有文件，请点击此按钮。</p>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="bg-white border-b px-6 py-4 flex items-center gap-4 shadow-sm z-10 min-h-[96px]">
          <button onClick={() => setMobileMenuOpen(true)} className="md:hidden p-2 text-slate-500"><Menu size={24} /></button>
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-5 text-slate-400" size={20} />
            <textarea 
                className="w-full pl-12 pr-4 py-4 border border-slate-200 rounded-2xl bg-slate-50 text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all shadow-inner resize-none overflow-hidden min-h-[56px] focus:min-h-[120px] z-20 relative" 
                placeholder="输入目标网址或公司名称 (支持批量输入)..." 
                value={domainInput} 
                onChange={e => setDomainInput(e.target.value)} 
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnalyzeInput(); } }}
            />
          </div>
          <button onClick={() => handleAnalyzeInput()} disabled={loading || !domainInput.trim()} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-2xl font-black shadow-lg disabled:opacity-50 min-w-[140px] flex justify-center h-[56px] items-center">
            {loading ? <Loader2 className="animate-spin" size={20} /> : '深度调查'}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 relative custom-scrollbar">
          {cooldownTime > 0 && (
              <div className="absolute inset-0 bg-white/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm animate-fade-in cursor-wait">
                  <div className="relative"><Hourglass size={64} className="text-blue-600 animate-pulse" /><div className="absolute -top-2 -right-2 bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs">{cooldownTime}</div></div>
                  <h3 className="text-2xl font-black text-slate-800 mt-6">API 冷却中</h3>
                  <p className="text-slate-500 mt-2 font-medium max-w-md text-center">正在等待 API 配额恢复。</p>
              </div>
          )}

          {loading && (
            <div className="absolute inset-0 bg-white/95 z-50 flex flex-col items-center justify-center backdrop-blur-sm animate-fade-in">
              <Loader2 className="animate-spin w-16 h-16 text-blue-600 mb-6" />
              <h3 className="text-2xl font-black text-slate-800">正在深度挖掘情报...</h3>
              <p className="text-slate-500 mt-2 font-medium">抓取官网架构、LinkedIn 决策人、及海关采购记录中...</p>
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
                        onStateChange={setDiscoveryState} 
                        onSelect={(d) => { setDomainInput(d); handleAnalyzeInput(d); }} 
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
                    />
                )}
                {activeModule === ModuleType.PROMO_GENERATOR && (
                    <ModulePromoGenerator 
                        onStartAutomation={handleStartQueueGeneration} 
                        automationResults={automationResults} 
                        isAutomating={isAutomating} 
                        onRunPending={handleRunPending}
                        onRunSingle={handleRunSingle}
                        onDelete={handleDeleteTask}
                    />
                )}
                {activeModule === ModuleType.STRATEGY && (
                    <div className="animate-fade-in max-w-7xl mx-auto pb-10">
                        {analysisData && (
                            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                                <div><h2 className="text-4xl font-black text-slate-900 tracking-tight">{analysisData.companyInfo?.name}</h2><div className="text-sm text-slate-500 font-bold mt-2">上下文：深度调查报告</div></div>
                            </div>
                        )}
                        <ModuleStrategy data={analysisData} />
                    </div>
                )}
                {analysisData && !alwaysActiveModules.includes(activeModule) && (
                    <div className="animate-fade-in max-w-7xl mx-auto pb-10">
                    <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                        <div>
                            <h2 className="text-4xl font-black text-slate-900 tracking-tight">{analysisData.companyInfo?.name}</h2>
                            <a href={analysisData.companyInfo?.website.startsWith('http') ? analysisData.companyInfo.website : `https://${analysisData.companyInfo?.website}`} target="_blank" rel="noreferrer" className="text-blue-600 font-bold mt-2 hover:underline">{analysisData.companyInfo?.website}</a>
                        </div>
                        <button onClick={handleExportReport} className="flex items-center gap-2 bg-slate-900 hover:bg-blue-600 transition-colors text-white px-6 py-3 rounded-2xl font-bold shadow-lg"><FileSpreadsheet size={18} /> 下载 PPT 报告</button>
                    </div>
                    {activeModule === ModuleType.BACKGROUND && <ModuleBackground data={analysisData} />}
                    {activeModule === ModuleType.PRODUCTS && <ModuleProducts data={analysisData} />}
                    {activeModule === ModuleType.DECISION_MAKERS && <ModuleDecisionMakers data={analysisData} />}
                    {activeModule === ModuleType.SIMILAR && <ModuleSimilar data={analysisData} onAnalyze={handleAnalyzeInput} />}
                    </div>
                )}
            </>
          )}
        </div>
      </main>
      
      {/* BATCH STRATEGY MODAL */}
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
                          <div className="font-bold text-slate-800 text-lg mb-2 group-hover:text-purple-700">详细模式 (高消耗)</div>
                          <ul className="text-xs text-slate-500 space-y-2">
                              <li>✅ 逐个进行背景调查</li>
                              <li>✅ 逐个生成定制开发信策略</li>
                              <li>✅ 每个客户单独生成 PPT</li>
                              <li>⚠️ 消耗更多 AI 配额</li>
                          </ul>
                      </button>
                      <button onClick={() => confirmBatchStart('economy')} className="p-6 border-2 border-slate-200 rounded-2xl hover:border-green-500 hover:bg-green-50 group text-left transition-all">
                          <div className="font-bold text-slate-800 text-lg mb-2 group-hover:text-green-700">经济模式 (省流)</div>
                          <ul className="text-xs text-slate-500 space-y-2">
                              <li>✅ 逐个进行背景调查</li>
                              <li>❌ 不生成单独开发信</li>
                              <li>✅ 1 份合并 PPT + 通用策略</li>
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

      {mobileMenuOpen && <div className="fixed inset-0 bg-slate-900/50 z-10 md:hidden" onClick={() => setMobileMenuOpen(false)} />}
    </div>
  );
};
export default App;
