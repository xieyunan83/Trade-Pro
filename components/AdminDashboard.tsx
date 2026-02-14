
import React, { useState, useEffect, useRef } from 'react';
import { User, KnowledgeFile, GlobalConfig, ApiConfig } from '../types';
import { getAllUsers, saveUser, deleteUser, getAllFilesFromDB, saveFileToDB, deleteFileFromDB, clearDB } from '../services/db';
import { testApiKey, getGeminiConfig } from '../services/geminiService';
import { 
    saveGlobalConfig, 
    fetchGlobalConfig, 
    checkGitHubStatus, 
    setManualGitHubConfig, 
    clearManualGitHubConfig, 
    fetchUsersFromCloud, 
    saveUsersToCloud, 
    fetchApiConfigsFromCloud, 
    saveApiConfigsToCloud, 
    fetchDocumentsFromRepo,
    verifyConnection 
} from '../services/githubService';
import { Users, Database, Plus, Trash2, Shield, UploadCloud, FileText, Loader2, LogOut, Key, Save, CheckCircle2, AlertTriangle, Info, Play, Workflow, Cloud, Download, Upload, ExternalLink, HelpCircle, Link2, RefreshCw, ArrowDownCircle, Github, FolderOpen, Network, ChevronDown } from 'lucide-react';

interface Props {
    onLogout: () => void;
    currentUser: User;
}

// --- UPDATED PRESETS FOR FOREIGN TRADE ---
const PROVIDER_PRESETS = [
    {
        name: "Gemini Pro (Google) - 🌍 外贸搜索首选",
        baseUrl: "https://hiapi.online/v1", // Stable relay
        modelId: "gemini-1.5-pro",
        note: "需 HiAPI Key。支持谷歌联网搜索，数据最准。"
    },
    {
        name: "Llama 3.1 (US Model / CN Speed) - ⚡️ 推荐",
        baseUrl: "https://api.siliconflow.cn/v1",
        modelId: "meta-llama/Meta-Llama-3.1-70B-Instruct",
        note: "需硅基流动 Key。美国 Llama 模型，国内直连不卡顿。"
    },
    {
        name: "DeepSeek V3 (China) - 🇨🇳 国产之光",
        baseUrl: "https://api.siliconflow.cn/v1",
        modelId: "deepseek-ai/DeepSeek-V3",
        note: "需硅基流动 Key。中文理解能力极强，写邮件地道。"
    },
    {
        name: "NVIDIA NIM (Official) - ❌ 容易断连",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        modelId: "meta/llama-3.1-70b-instruct",
        note: "需 NVIDIA Key。国内网络极难连通，不推荐。"
    }
];

export const AdminDashboard: React.FC<Props> = ({ onLogout, currentUser }) => {
    // Default to 'settings' tab for easier config access
    const [activeTab, setActiveTab] = useState<'users' | 'kb' | 'settings' | 'limits'>(
        checkGitHubStatus().ok ? 'settings' : 'limits'
    );
    const [refreshKey, setRefreshKey] = useState(0); 

    const handleConnectionChange = () => {
        setRefreshKey(prev => prev + 1);
        if (checkGitHubStatus().ok) {
            setTimeout(() => setActiveTab('settings'), 100);
        }
    };

    return (
        <div className="min-h-screen bg-slate-100 flex flex-col">
            <div className="bg-slate-900 text-white p-4 shadow-lg flex justify-between items-center z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-purple-600 p-2 rounded-lg">
                        <Shield size={20} />
                    </div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">管理员控制台 (Admin Console)</h1>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">System Management</p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-400 font-medium">当前登录: <span className="text-white font-bold">{currentUser.username}</span></span>
                    <button 
                        onClick={onLogout}
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
                    >
                        <LogOut size={16} /> 退出登录
                    </button>
                </div>
            </div>

            <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px]">
                    <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
                        <button onClick={() => setActiveTab('limits')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'limits' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Cloud size={18} /> ① 云端连接 (Connection)
                        </button>
                        <button onClick={() => setActiveTab('settings')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'settings' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Key size={18} /> ② API 密钥配置
                        </button>
                        <button onClick={() => setActiveTab('users')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'users' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Users size={18} /> ③ 用户管理
                        </button>
                        <button onClick={() => setActiveTab('kb')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'kb' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Database size={18} /> ④ 知识库
                        </button>
                    </div>

                    <div className="p-8">
                        {/* Pass refreshKey to force re-render/re-fetch when connection changes */}
                        {activeTab === 'users' && <UserManagement key={refreshKey} />}
                        {activeTab === 'kb' && <KnowledgeManagement key={refreshKey} />}
                        {activeTab === 'settings' && <SystemSettings key={refreshKey} />}
                        {activeTab === 'limits' && <CloudLimitManager onConnectionChange={handleConnectionChange} />}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface CloudLimitManagerProps {
    onConnectionChange: () => void;
}

const CloudLimitManager: React.FC<CloudLimitManagerProps> = ({ onConnectionChange }) => {
    const [status, setStatus] = useState(checkGitHubStatus());
    const [config, setConfig] = useState<GlobalConfig>({
        lastUpdated: Date.now(),
        dailyLimits: { search: 10, analysis: 3 },
        systemNotice: ''
    });
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
    const [manualToken, setManualToken] = useState('');
    const [manualOwner, setManualOwner] = useState('');
    const [manualRepo, setManualRepo] = useState('');

    useEffect(() => {
        if (status.ok) {
            loadRemoteConfig();
        }
    }, [status.ok]);

    const loadRemoteConfig = async () => {
        setLoading(true);
        try {
            const remote = await fetchGlobalConfig();
            if (remote) setConfig(remote);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setLoading(true);
        setMsg(null);
        try {
            const toSave = { ...config, lastUpdated: Date.now() };
            await saveGlobalConfig(toSave);
            setConfig(toSave);
            setMsg({ type: 'success', text: '配置已保存到云端！其他浏览器连接后将自动应用此配置。' });
        } catch (e: any) {
            setMsg({ type: 'error', text: `保存失败: ${e.message}。请检查 Token 权限或仓库是否存在。` });
        } finally {
            setLoading(false);
        }
    };

    const handleManualConnect = async () => {
        if (!manualToken || !manualOwner || !manualRepo) {
            alert("请填写所有字段 (Token, Owner, Repo)");
            return;
        }
        setLoading(true);
        // 1. Save Config Locally First
        setManualGitHubConfig(manualToken, manualOwner, manualRepo);
        
        try {
            // 2. Verify Connection (API Call)
            await verifyConnection();
            
            // 3. If Successful, Update Status & Load Config
            setStatus(checkGitHubStatus());
            setMsg({ type: 'success', text: "连接成功！已验证仓库访问权限。" });
            
            try {
                await loadRemoteConfig(); 
            } catch(e) {
                // Config load might fail if file doesn't exist yet, that's okay for new repo
            }
            onConnectionChange();

        } catch (e: any) {
            console.error("Manual Connect Failed", e);
            let errText = "连接失败，请检查凭证。";
            const statusCode = e.status || e.response?.status;
            if (statusCode === 404) errText = "连接失败 (404): 找不到仓库。请确认 Owner/Repo拼写正确，且 Token 拥有 Repo 权限。";
            else if (statusCode === 401) errText = "连接失败 (401): Token 无效或已过期。";
            else if (statusCode === 403) errText = "连接失败 (403): 访问被拒绝，可能触发了 API 速率限制。";
            
            setMsg({ type: 'error', text: errText });
            clearManualGitHubConfig(); 
            setStatus(checkGitHubStatus());
        } finally {
            setLoading(false);
        }
    };

    const handleDisconnect = () => {
        if(confirm("确定要断开连接并清除配置吗？")) {
            clearManualGitHubConfig();
            const check = checkGitHubStatus();
            setStatus(check);
            setMsg(null);
            onConnectionChange();
        }
    };

    return (
        <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Cloud className="text-blue-600" /> GitHub 云端数据库 (Cloud DB)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">这是系统的大脑。连接后，所有配置、用户和数据将同步到您的 GitHub 仓库。</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${status.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {status.ok ? <><CheckCircle2 size={12}/> 已连接 ({status.source === 'ENV' ? '环境变量' : '手动配置'})</> : <><AlertTriangle size={12}/> 未连接 (Disconnected)</>}
                </div>
            </div>

            {!status.ok ? (
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-blue-200 shadow-md">
                        <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-lg"><Link2 size={20}/> 首次配置 / 新设备连接</h4>
                        <div className="text-sm text-slate-600 mb-4">
                            在新浏览器或设备上，您只需输入一次 GitHub 凭证。连接成功后，系统将自动拉取之前保存的所有 API Key 和用户设置。
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">GitHub Personal Access Token</label>
                                <input 
                                    type="password" 
                                    className="w-full p-3 border border-slate-300 rounded-xl font-mono text-sm"
                                    placeholder="ghp_xxxxxxxxxxxx"
                                    value={manualToken}
                                    onChange={e => setManualToken(e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Owner (用户名)</label>
                                    <input type="text" className="w-full p-3 border border-slate-300 rounded-xl" placeholder="例如: NanGe" value={manualOwner} onChange={e => setManualOwner(e.target.value)}/>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Repo (仓库名)</label>
                                    <input type="text" className="w-full p-3 border border-slate-300 rounded-xl" placeholder="例如: trade-data" value={manualRepo} onChange={e => setManualRepo(e.target.value)}/>
                                </div>
                            </div>
                            <button 
                                onClick={handleManualConnect}
                                disabled={loading}
                                className="mt-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center gap-2 justify-center shadow-lg"
                            >
                                {loading ? <Loader2 className="animate-spin" size={18}/> : <Cloud size={18}/>}
                                连接并同步数据 (Connect & Sync)
                            </button>
                            {msg && msg.type === 'error' && (
                                <div className="mt-2 p-3 bg-red-100 text-red-700 text-sm font-bold rounded-lg flex items-center gap-2 animate-fade-in">
                                    <AlertTriangle size={16}/> {msg.text}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className={`bg-slate-50 p-6 rounded-xl border border-slate-200 mb-6 animate-fade-in`}>
                     {/* Configuration Form (Existing) */}
                     <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-slate-700 flex items-center gap-2"><Shield size={16}/> 每日用户额度限制 (Daily User Limits)</h4>
                        <div className="flex items-center gap-3">
                             <span className="text-xs text-slate-400 bg-white px-2 py-1 rounded border">云端状态: 正常</span>
                             {status.source === 'LOCAL' && (
                                 <button onClick={handleDisconnect} className="text-xs text-red-500 hover:underline">断开连接</button>
                             )}
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-6 mb-6">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <label className="block text-xs font-bold text-slate-500 mb-2">每日最大搜索次数</label>
                            <input 
                                type="number" 
                                className="w-full p-2 border border-slate-300 rounded-lg font-mono text-lg font-bold text-blue-600"
                                value={config.dailyLimits.search}
                                onChange={(e) => setConfig({...config, dailyLimits: {...config.dailyLimits, search: parseInt(e.target.value)}})}
                            />
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <label className="block text-xs font-bold text-slate-500 mb-2">每日最大深度背调次数</label>
                            <input 
                                type="number" 
                                className="w-full p-2 border border-slate-300 rounded-lg font-mono text-lg font-bold text-purple-600"
                                value={config.dailyLimits.analysis}
                                onChange={(e) => setConfig({...config, dailyLimits: {...config.dailyLimits, analysis: parseInt(e.target.value)}})}
                            />
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1"><Info size={12}/> 系统公告 (System Notice)</label>
                        <input 
                            type="text" 
                            className="w-full p-3 border border-slate-300 rounded-xl"
                            placeholder="例如：系统将于今晚维护..."
                            value={config.systemNotice}
                            onChange={(e) => setConfig({...config, systemNotice: e.target.value})}
                        />
                    </div>

                    <button 
                        onClick={handleSave} 
                        disabled={loading || !status.ok}
                        className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 disabled:opacity-50 transition-colors w-full justify-center shadow-lg"
                    >
                        {loading ? <Loader2 className="animate-spin" size={18}/> : <UploadCloud size={18}/>}
                        保存配置到云端 (Save to Cloud)
                    </button>
                    
                    {msg && (
                        <div className={`mt-4 p-3 rounded-lg text-sm font-bold flex items-center gap-2 ${msg.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {msg.type === 'success' ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}
                            {msg.text}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const SystemSettings: React.FC = () => {
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [isTesting, setIsTesting] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState<{ id: string, type: 'success'|'error', msg: string } | null>(null);
    const [ghStatus] = useState(checkGitHubStatus());
    const [customProxy, setCustomProxy] = useState(localStorage.getItem('trade_scout_custom_proxy') || '');

    useEffect(() => {
        const load = async () => {
            setIsLoading(true);
            if (ghStatus.ok) {
                try {
                    const cloudConfigs = await fetchApiConfigsFromCloud();
                    if (cloudConfigs.length > 0) {
                        setConfigs(cloudConfigs);
                        localStorage.setItem('trade_scout_api_configs', JSON.stringify(cloudConfigs));
                        setIsLoading(false);
                        return;
                    }
                } catch(e) { console.error("Cloud config fetch error", e); }
            }
            const loaded = getGeminiConfig();
            if (loaded.length > 0) {
                setConfigs(loaded);
            } else {
                setConfigs([{ id: Date.now().toString(), apiKey: '', baseUrl: '', modelId: 'gemini-1.5-pro', taskAssignment: 'default' }]);
            }
            setIsLoading(false);
        };
        load();
    }, [ghStatus.ok]); 

    const saveConfigsToStateAndCloud = async (newConfigs: ApiConfig[]) => {
        setConfigs(newConfigs);
        localStorage.setItem('trade_scout_api_configs', JSON.stringify(newConfigs));
        if (ghStatus.ok) {
            setIsSyncing(true);
            try { await saveApiConfigsToCloud(newConfigs); } catch (e) {} finally { setIsSyncing(false); }
        }
    };

    const updateConfig = (id: string, field: keyof ApiConfig, value: string) => {
        const updated = configs.map(c => c.id === id ? { ...c, [field]: value } : c);
        setConfigs(updated);
    };

    const handleCustomProxySave = () => {
        localStorage.setItem('trade_scout_custom_proxy', customProxy);
        alert("Custom Proxy Saved. It will be prioritized.");
    };

    const forceSync = async () => {
        setIsSyncing(true);
        try {
            await saveApiConfigsToCloud(configs);
            localStorage.setItem('trade_scout_api_configs', JSON.stringify(configs));
            alert("API 配置已成功同步到云端！");
        } catch(e:any) { alert("同步失败: " + e.message); } finally { setIsSyncing(false); }
    };

    const addConfig = () => {
        const newConfig: ApiConfig = { 
            id: Date.now().toString(), apiKey: '', baseUrl: '', modelId: 'gemini-1.5-pro', taskAssignment: 'default'
        };
        saveConfigsToStateAndCloud([...configs, newConfig]);
    };

    // New: Generic Preset Application
    const applyPreset = (id: string, indexStr: string) => {
        const index = parseInt(indexStr);
        const preset = PROVIDER_PRESETS[index];
        if (!preset) return;
        const updated = configs.map(c => {
            if (c.id === id) {
                return { 
                    ...c, 
                    baseUrl: preset.baseUrl, 
                    modelId: preset.modelId 
                };
            }
            return c;
        });
        saveConfigsToStateAndCloud(updated);
    };

    const removeConfig = (id: string) => {
        if (configs.length > 1 && confirm("确认删除此 API 配置？")) {
            saveConfigsToStateAndCloud(configs.filter(c => c.id !== id));
        } else if (configs.length === 1) {
            alert("必须保留至少一个配置。");
        }
    };

    const testConfig = async (config: ApiConfig) => {
        if (!config.apiKey) return;
        setIsTesting(config.id);
        setStatus(null);
        localStorage.setItem('trade_scout_api_configs', JSON.stringify(configs));
        const res = await testApiKey(config.apiKey, config.baseUrl, config.modelId);
        setStatus({ id: config.id, type: res.success ? 'success' : 'error', msg: res.message });
        setIsTesting(null);
    };

    return (
        <div className="max-w-6xl">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Key className="text-blue-600" /> API 密钥配置池
                    </h3>
                    {ghStatus.ok && <p className="text-xs text-green-600 font-bold mt-1">✓ Cloud Sync Enabled (Auto-Saving)</p>}
                </div>
                <div className="flex gap-2">
                    <button onClick={forceSync} disabled={isSyncing || !ghStatus.ok} className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 transition-colors disabled:opacity-50 shadow-md">
                        {isSyncing ? <Loader2 className="animate-spin" size={16}/> : <UploadCloud size={16}/>}
                        强制同步 (Force Sync)
                    </button>
                    <button onClick={addConfig} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors shadow-md">
                        <Plus size={16} /> 添加新密钥
                    </button>
                </div>
            </div>
            
            {/* Helpful Banner for Connectivity */}
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-6 text-sm text-blue-900 flex items-start gap-3">
                <Info size={20} className="shrink-0 mt-0.5 text-blue-600"/>
                <div>
                    <div className="font-bold mb-1">外贸专用网络设置 (Network for Global Trade)</div>
                    <p className="opacity-90 leading-relaxed mb-2">
                        <strong>NVIDIA / Google / OpenAI</strong> 官方接口在国内通常无法直连。请务必使用“预设”中的中转服务。
                    </p>
                    <div className="bg-white p-2 rounded border border-blue-200 mb-2 text-xs">
                        <strong>💡 推荐方案:</strong> 使用 <strong>Gemini (HiAPI 中转)</strong> 进行客户搜索，因为它能实时联网 Google 获取最新海外数据。
                    </div>
                    
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-blue-100">
                        <Network size={16}/>
                        <input type="text" className="bg-white border border-blue-300 rounded px-2 py-1 text-xs w-64" placeholder="Custom Proxy Prefix" value={customProxy} onChange={(e) => setCustomProxy(e.target.value)} />
                        <button onClick={handleCustomProxySave} className="text-xs bg-blue-600 text-white px-3 py-1 rounded font-bold hover:bg-blue-700">Save Proxy</button>
                    </div>
                </div>
            </div>
            
            {isLoading && <div className="p-8 text-center text-slate-500"><Loader2 className="animate-spin inline mr-2"/> Loading Cloud Configs...</div>}

            <div className="flex flex-col gap-4">
                {configs.map((config, index) => (
                    <div key={config.id} className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm relative group transition-all hover:border-blue-300">
                        <div className="absolute top-4 left-4 flex gap-2">
                            <span className="bg-slate-200 text-slate-700 px-2 py-1 rounded text-xs font-bold border border-slate-300">
                                配置 #{index + 1}
                            </span>
                            {config.taskAssignment !== 'default' && (
                                <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs font-bold border border-purple-200 flex items-center gap-1">
                                    <Workflow size={10} /> {config.taskAssignment?.toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div className="absolute top-4 right-4 flex gap-2">
                            {/* NEW PRESET DROPDOWN */}
                            <select 
                                className="text-xs bg-white border border-blue-300 text-blue-700 px-2 py-1 rounded font-bold cursor-pointer hover:bg-blue-50 outline-none shadow-sm"
                                onChange={(e) => applyPreset(config.id, e.target.value)}
                                value=""
                            >
                                <option value="" disabled>✨ Apply Preset (快速预设)</option>
                                {PROVIDER_PRESETS.map((p, i) => (
                                    <option key={i} value={i}>{p.name}</option>
                                ))}
                            </select>
                            <button onClick={() => removeConfig(config.id)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={18}/></button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-8">
                            <div className="md:col-span-1">
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">任务分配 (Task)</label>
                                <select 
                                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white text-slate-900 font-bold shadow-sm"
                                    value={config.taskAssignment || 'default'}
                                    onChange={(e) => updateConfig(config.id, 'taskAssignment', e.target.value)}
                                >
                                    <option value="default">全局默认 (Default)</option>
                                    <option value="analysis">深度背调 (Deep Analysis)</option>
                                    <option value="search">客户搜索 (Client Search)</option>
                                    <option value="email">开发信撰写 (Email Writing)</option>
                                    <option value="keywords">视觉/关键词 (Vision)</option>
                                    <option value="chat">AI 聊天助手 (Chat)</option>
                                </select>
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">代理地址 (Base URL)</label>
                                <input 
                                    type="text" 
                                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm text-slate-900 bg-white shadow-sm"
                                    placeholder="https://..."
                                    value={config.baseUrl}
                                    onChange={(e) => updateConfig(config.id, 'baseUrl', e.target.value)}
                                />
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">API 密钥 (Key)</label>
                                <input 
                                    type="password" 
                                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm text-slate-900 bg-white shadow-sm"
                                    placeholder="sk-..."
                                    value={config.apiKey}
                                    onChange={(e) => updateConfig(config.id, 'apiKey', e.target.value)}
                                />
                            </div>
                            <div className="md:col-span-1">
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">模型 ID (Model)</label>
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm text-slate-900 bg-white shadow-sm"
                                        placeholder="model-id"
                                        value={config.modelId}
                                        onChange={(e) => updateConfig(config.id, 'modelId', e.target.value)}
                                    />
                                    <button 
                                        onClick={() => testConfig(config)}
                                        disabled={isTesting === config.id || !config.apiKey}
                                        className="bg-slate-900 text-white px-4 rounded-xl hover:bg-slate-700 disabled:opacity-50 transition-colors shadow-sm"
                                    >
                                        {isTesting === config.id ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                                    </button>
                                </div>
                            </div>
                        </div>
                        {status?.id === config.id && (
                            <div className={`mt-4 p-3 rounded-lg text-xs font-bold flex items-center gap-2 ${status.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {status.type === 'success' ? <CheckCircle2 size={14}/> : <AlertTriangle size={14}/>}
                                {status.msg}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-6 flex justify-end">
                 <button onClick={forceSync} disabled={!ghStatus.ok || isSyncing} className="text-slate-400 hover:text-blue-600 text-xs font-bold underline">
                     Tips: Remember to Save/Sync if Auto-Save fails
                 </button>
            </div>
        </div>
    );
};

// ... UserManagement and KnowledgeManagement ...
// Re-inserting unchanged code to maintain file structure integrity

const UserManagement: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [newUser, setNewUser] = useState<{username: string, password: string, role: 'user' | 'admin'}>({ username: '', password: '', role: 'user' });
    const [ghStatus] = useState(checkGitHubStatus());

    const loadUsers = async () => { 
        if (ghStatus.ok) {
            try {
                const cloudUsers = await fetchUsersFromCloud();
                if (cloudUsers.length > 0) {
                     setUsers(cloudUsers);
                     for(const u of cloudUsers) await saveUser(u);
                     return;
                }
            } catch(e) { console.error("Cloud user fetch error", e); }
        }
        setUsers(await getAllUsers()); 
    };

    useEffect(() => { loadUsers(); }, [ghStatus.ok]);

    const handleSyncToCloud = async () => {
        setIsSyncing(true);
        try {
            await saveUsersToCloud(users);
            alert("用户列表已同步到云端！");
        } catch (e: any) { alert("同步失败: " + e.message); } finally { setIsSyncing(false); }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        const u: User = { ...newUser, isFirstLogin: true, createdAt: Date.now() };
        await saveUser(u);
        const updatedList = [...users, u];
        setUsers(updatedList);
        if(ghStatus.ok) {
            setIsSyncing(true);
            try { await saveUsersToCloud(updatedList); } catch(e) {} finally { setIsSyncing(false); }
        }
        setNewUser({ username: '', password: '', role: 'user' });
        setIsAdding(false);
    };

    const handleDelete = async (username: string) => {
        if (username !== 'admin' && confirm(`确认删除用户 ${username}?`)) {
            await deleteUser(username);
            const updatedList = users.filter(u => u.username !== username);
            setUsers(updatedList);
            if(ghStatus.ok) {
                setIsSyncing(true);
                try { await saveUsersToCloud(updatedList); } catch(e) {} finally { setIsSyncing(false); }
            }
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users className="text-blue-600"/> 系统用户管理</h3>
                    {ghStatus.ok && <p className="text-xs text-green-600 font-bold mt-1">✓ Cloud Sync Enabled</p>}
                </div>
                <div className="flex gap-2">
                    <button onClick={handleSyncToCloud} disabled={isSyncing || !ghStatus.ok} className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 disabled:opacity-50 shadow-md">
                        {isSyncing ? <Loader2 className="animate-spin" size={16}/> : <UploadCloud size={16}/>}
                        强制同步
                    </button>
                    <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 shadow-md">
                        <Plus size={16} /> 添加用户
                    </button>
                </div>
            </div>
            {isAdding && (
                <form onSubmit={handleAddUser} className="bg-slate-50 p-6 rounded-xl border border-slate-200 mb-8 animate-fade-in shadow-inner">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <input placeholder="用户名" className="p-3 border rounded-xl" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
                        <input placeholder="密码" className="p-3 border rounded-xl" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
                        <select className="p-3 border rounded-xl" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as 'user'|'admin'})}>
                            <option value="user">普通用户</option>
                            <option value="admin">管理员</option>
                        </select>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setIsAdding(false)} className="bg-slate-200 text-slate-600 px-4 py-2 rounded-lg font-bold">取消</button>
                        <button type="submit" className="bg-green-600 text-white px-6 py-2 rounded-lg font-bold">保存并同步</button>
                    </div>
                </form>
            )}
            <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-sm">
                <table className="w-full text-left text-sm bg-white">
                    <thead className="bg-slate-100 text-slate-500 uppercase font-bold">
                        <tr><th className="p-4">用户名</th><th className="p-4">角色</th><th className="p-4 text-right">操作</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {users.map(u => (
                            <tr key={u.username} className="hover:bg-blue-50/50 bg-white transition-colors">
                                <td className="p-4 font-bold text-slate-900">{u.username}</td>
                                <td className="p-4"><span className={`px-2 py-1 rounded text-xs uppercase font-bold ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{u.role}</span></td>
                                <td className="p-4 text-right">
                                    {u.username !== 'admin' && (
                                        <button onClick={() => handleDelete(u.username)} className="text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const KnowledgeManagement: React.FC = () => {
    const [files, setFiles] = useState<KnowledgeFile[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [ghStatus] = useState(checkGitHubStatus());
    
    const [ghOwner, setGhOwner] = useState(localStorage.getItem("GH_OWNER") || "");
    const [ghRepo, setGhRepo] = useState(localStorage.getItem("GH_REPO") || "");
    const [ghPath, setGhPath] = useState(localStorage.getItem("GH_PATH") || "");
    const [ghToken, setGhToken] = useState(localStorage.getItem("GH_TOKEN") || "");

    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFiles = async () => { 
        if (ghStatus.ok) {
            try {
                const cloudFiles = await fetchDocumentsFromRepo();
                if(cloudFiles.length > 0) {
                    setFiles(cloudFiles);
                    return;
                }
            } catch(e) { console.error("KB fetch failed", e); }
        }
        setFiles(await getAllFilesFromDB()); 
    };
    
    useEffect(() => { loadFiles(); }, [ghStatus.ok]);

    const handleSaveAndSync = async () => {
        if (!ghOwner || !ghRepo) { alert("Please fill in Owner and Repository."); return; }
        setIsSyncing(true);
        setManualGitHubConfig(ghToken, ghOwner, ghRepo, ghPath);
        try {
            const cloudFiles = await fetchDocumentsFromRepo();
            for (const f of cloudFiles) { await saveFileToDB(f); }
            await loadFiles();
            alert("Sync Complete!");
        } catch (e: any) { alert(`Sync Failed: ${e.message}`); } finally { setIsSyncing(false); }
    };

    const processFiles = async (fileList: FileList | null) => {
        if (!fileList) return;
        setIsUploading(true);
        try {
            for (let i = 0; i < fileList.length; i++) {
                 const file = fileList[i];
                 const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                 });
                 const fileObj = { id: `local_${Date.now()}_${i}`, name: file.name, type: file.type || 'application/octet-stream', data: base64, size: file.size };
                 await saveFileToDB(fileObj);
            }
            await loadFiles();
        } catch (e: any) { alert("Upload Failed: " + e.message); } finally { setIsUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
    };
    
    const handleDelete = async (id: string) => { if(!confirm("Remove?")) return; await deleteFileFromDB(id); loadFiles(); };

    return (
        <div className="space-y-8">
             <div className="flex justify-between items-center">
                 <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Database className="text-blue-600"/> Knowledge Base Management</h3>
                 {ghStatus.ok && <p className="text-xs text-green-600 font-bold mt-1">✓ Connected to Repo</p>}
             </div>

             <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                 <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                     <div className="bg-white p-1.5 rounded-lg border border-slate-200 text-purple-600"><Github size={18} /></div>
                     <span className="font-bold text-slate-700 text-sm uppercase tracking-wider">GitHub Repository Connection</span>
                 </div>
                 <div className="p-6 bg-white space-y-6">
                     <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                         <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase">Owner</label><input value={ghOwner} onChange={e => setGhOwner(e.target.value)} className="w-full bg-slate-800 text-white p-3 rounded-xl font-bold text-sm outline-none" placeholder="e.g. NanGe"/></div>
                         <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase">Repository</label><input value={ghRepo} onChange={e => setGhRepo(e.target.value)} className="w-full bg-slate-800 text-white p-3 rounded-xl font-bold text-sm outline-none" placeholder="e.g. knowledge-base"/></div>
                         <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase">Path</label><input value={ghPath} onChange={e => setGhPath(e.target.value)} className="w-full bg-slate-800 text-white p-3 rounded-xl font-bold text-sm outline-none" placeholder="e.g. docs"/></div>
                         <div className="space-y-1"><label className="text-[10px] font-bold text-slate-400 uppercase">Token</label><input type="password" value={ghToken} onChange={e => setGhToken(e.target.value)} className="w-full bg-slate-800 text-white p-3 rounded-xl font-bold text-sm outline-none" placeholder="ghp_..."/></div>
                     </div>
                     <div className="flex items-center justify-between pt-2">
                         <div className="flex items-center gap-2 text-xs text-slate-400">{isSyncing && <><Loader2 size={14} className="animate-spin" /> Syncing...</>}</div>
                         <button onClick={handleSaveAndSync} disabled={isSyncing} className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 disabled:opacity-50 shadow-lg">{isSyncing ? <Loader2 size={18} className="animate-spin"/> : <Save size={18}/>} Update Connection</button>
                     </div>
                 </div>
             </div>

             <div>
                 <div className="flex justify-between items-end mb-4">
                     <div className="text-sm font-bold text-slate-600">Active Files: <span className="text-slate-900 text-lg">{files.length}</span></div>
                     <button onClick={() => fileInputRef.current?.click()} className="text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-2">{isUploading ? <Loader2 size={16} className="animate-spin"/> : <Plus size={16}/>} Upload Local</button>
                     <input type="file" multiple ref={fileInputRef} className="hidden" onChange={(e) => processFiles(e.target.files)} />
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {files.map(f => (
                        <div key={f.id} className="flex justify-between p-4 border border-slate-200 rounded-xl bg-white items-center shadow-sm">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className={`p-2 rounded-lg text-white shrink-0 ${f.id.startsWith('local') ? 'bg-blue-500' : 'bg-slate-800'}`}>{f.id.startsWith('local') ? <UploadCloud size={16} /> : <Github size={16} />}</div>
                                <div className="overflow-hidden"><div className="font-bold text-sm text-slate-800 truncate" title={f.name}>{f.name}</div><div className="text-[10px] text-slate-400">{(f.size/1024).toFixed(1)} KB</div></div>
                            </div>
                            <button onClick={() => handleDelete(f.id)} className="text-slate-300 hover:text-red-500 p-2"><Trash2 size={16}/></button>
                        </div>
                    ))}
                 </div>
             </div>
        </div>
    );
};
