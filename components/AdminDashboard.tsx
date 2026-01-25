
import React, { useState, useEffect, useRef } from 'react';
import { User, KnowledgeFile, GlobalConfig } from '../types';
import { getAllUsers, saveUser, deleteUser, getAllFilesFromDB, saveFileToDB, deleteFileFromDB } from '../services/db';
import { testApiKey, ApiConfig, getGeminiConfig } from '../services/geminiService';
import { saveGlobalConfig, fetchGlobalConfig, saveSharedKnowledgeBase, checkGitHubStatus, setManualGitHubConfig, clearManualGitHubConfig } from '../services/githubService';
import { Users, Database, Plus, Trash2, Shield, UploadCloud, FileText, Loader2, LogOut, Key, Save, CheckCircle2, AlertTriangle, Info, Play, Workflow, Cloud, Download, Upload, ExternalLink, HelpCircle, Link2 } from 'lucide-react';

interface Props {
    onLogout: () => void;
    currentUser: User;
}

export const AdminDashboard: React.FC<Props> = ({ onLogout, currentUser }) => {
    const [activeTab, setActiveTab] = useState<'users' | 'kb' | 'settings' | 'limits'>('users');

    return (
        <div className="min-h-screen bg-slate-100 flex flex-col">
            <div className="bg-slate-900 text-white p-4 shadow-lg flex justify-between items-center z-10">
                <div className="flex items-center gap-3">
                    <div className="bg-purple-600 p-2 rounded-lg">
                        <Shield size={20} />
                    </div>
                    <div>
                        <h1 className="font-bold text-lg leading-tight">管理员控制台</h1>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">系统管理 (System Management)</p>
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
                        <button onClick={() => setActiveTab('users')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'users' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Users size={18} /> 用户管理
                        </button>
                        <button onClick={() => setActiveTab('kb')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'kb' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Database size={18} /> 知识库管理
                        </button>
                        <button onClick={() => setActiveTab('settings')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'settings' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Key size={18} /> API 密钥配置
                        </button>
                        <button onClick={() => setActiveTab('limits')} className={`px-6 py-4 font-bold text-sm flex items-center gap-2 transition-colors whitespace-nowrap ${activeTab === 'limits' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                            <Cloud size={18} /> 云端同步与额度
                        </button>
                    </div>

                    <div className="p-8">
                        {activeTab === 'users' && <UserManagement />}
                        {activeTab === 'kb' && <KnowledgeManagement />}
                        {activeTab === 'settings' && <SystemSettings />}
                        {activeTab === 'limits' && <CloudLimitManager />}
                    </div>
                </div>
            </div>
        </div>
    );
};

const CloudLimitManager: React.FC = () => {
    const [status, setStatus] = useState(checkGitHubStatus());
    const [config, setConfig] = useState<GlobalConfig>({
        lastUpdated: Date.now(),
        dailyLimits: { search: 10, analysis: 3 },
        systemNotice: ''
    });
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);

    // Manual Config Form State
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
            setMsg({ type: 'success', text: '成功！设置已同步到 GitHub。用户重启 App 后生效。' });
        } catch (e: any) {
            setMsg({ type: 'error', text: `保存失败: ${e.message}。请检查 Token 权限或仓库是否存在。` });
        } finally {
            setLoading(false);
        }
    };

    const handleManualConnect = () => {
        if (!manualToken || !manualOwner || !manualRepo) {
            alert("请填写所有字段 (Token, Owner, Repo)");
            return;
        }
        setManualGitHubConfig(manualToken, manualOwner, manualRepo);
        setStatus(checkGitHubStatus());
        alert("已保存配置！正在尝试连接...");
    };

    const handleDisconnect = () => {
        if(confirm("确定要断开连接并清除配置吗？")) {
            clearManualGitHubConfig();
            setStatus(checkGitHubStatus());
        }
    };

    return (
        <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Cloud className="text-blue-600" /> GitHub 云端数据库 (Cloud DB)
                </h3>
                <div className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${status.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {status.ok ? (
                        <>
                            <CheckCircle2 size={12}/> 
                            已连接 ({status.source === 'ENV' ? '环境变量' : '手动配置'})
                        </>
                    ) : (
                        <>
                            <AlertTriangle size={12}/> 未连接 (Disconnected)
                        </>
                    )}
                </div>
            </div>

            {!status.ok ? (
                <div className="space-y-6">
                    <div className="p-5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm space-y-3">
                        <div className="flex items-center gap-2 font-bold text-lg">
                            <AlertTriangle size={20} />
                            配置缺失 (Configuration Missing)
                        </div>
                        <p>环境变量未生效？不用担心，您可以在下方手动填入配置，立即连接。</p>
                        <div className="pt-2">
                            <a 
                                href="https://github.com/settings/tokens/new?scopes=repo&description=TradeScoutApp" 
                                target="_blank" 
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-700 transition-colors"
                            >
                                <ExternalLink size={16} /> 第一步：点击生成 Token (必须勾选 repo)
                            </a>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                        <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Link2 size={18}/> 手动连接 (Manual Connection)</h4>
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">GitHub Personal Access Token (以 ghp_ 开头)</label>
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
                                    <input 
                                        type="text" 
                                        className="w-full p-3 border border-slate-300 rounded-xl"
                                        placeholder="例如: NanGe"
                                        value={manualOwner}
                                        onChange={e => setManualOwner(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Repo (仓库名)</label>
                                    <input 
                                        type="text" 
                                        className="w-full p-3 border border-slate-300 rounded-xl"
                                        placeholder="例如: trade-data"
                                        value={manualRepo}
                                        onChange={e => setManualRepo(e.target.value)}
                                    />
                                </div>
                            </div>
                            <button 
                                onClick={handleManualConnect}
                                className="mt-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors"
                            >
                                立即连接 (Connect Now)
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className={`bg-slate-50 p-6 rounded-xl border border-slate-200 mb-6`}>
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-slate-700 flex items-center gap-2"><Shield size={16}/> 每日用户额度限制 (Daily User Limits)</h4>
                        <div className="flex items-center gap-3">
                             <span className="text-xs text-slate-400 bg-white px-2 py-1 rounded border">最后更新: {new Date(config.lastUpdated).toLocaleString()}</span>
                             {status.source === 'LOCAL' && (
                                 <button onClick={handleDisconnect} className="text-xs text-red-500 hover:underline">断开连接</button>
                             )}
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-6 mb-6">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <label className="block text-xs font-bold text-slate-500 mb-2">每日最大搜索次数 (Searches/Day)</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-lg font-bold text-blue-600"
                                    value={config.dailyLimits.search}
                                    onChange={(e) => setConfig({...config, dailyLimits: {...config.dailyLimits, search: parseInt(e.target.value)}})}
                                />
                                <span className="text-xs font-bold text-slate-400">次</span>
                            </div>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <label className="block text-xs font-bold text-slate-500 mb-2">每日最大深度背调次数 (Analysis/Day)</label>
                            <div className="flex items-center gap-2">
                                <input 
                                    type="number" 
                                    className="w-full p-2 border border-slate-300 rounded-lg font-mono text-lg font-bold text-purple-600"
                                    value={config.dailyLimits.analysis}
                                    onChange={(e) => setConfig({...config, dailyLimits: {...config.dailyLimits, analysis: parseInt(e.target.value)}})}
                                />
                                <span className="text-xs font-bold text-slate-400">次</span>
                            </div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1"><Info size={12}/> 系统公告 (System Notice)</label>
                        <div className="relative">
                            <input 
                                type="text" 
                                className="w-full p-3 pl-10 border border-slate-300 rounded-xl"
                                placeholder="例如：系统将于今晚午夜维护，请提前保存数据..."
                                value={config.systemNotice}
                                onChange={(e) => setConfig({...config, systemNotice: e.target.value})}
                            />
                            <Info className="absolute left-3 top-3.5 text-slate-400" size={18} />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 pl-1">此消息将显示在所有用户的侧边栏上方。</p>
                    </div>

                    <button 
                        onClick={handleSave} 
                        disabled={loading || !status.ok}
                        className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-700 disabled:opacity-50 transition-colors w-full justify-center"
                    >
                        {loading ? <Loader2 className="animate-spin" size={18}/> : <UploadCloud size={18}/>}
                        推送配置到云端 (Push Config to GitHub)
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
    const [status, setStatus] = useState<{ id: string, type: 'success'|'error', msg: string } | null>(null);

    useEffect(() => {
        const loaded = getGeminiConfig();
        if (loaded.length > 0) {
            setConfigs(loaded);
        } else {
            setConfigs([{ id: Date.now().toString(), apiKey: '', baseUrl: '', modelId: 'gemini-1.5-pro', taskAssignment: 'default' }]);
        }
    }, []);

    const saveConfigs = (newConfigs: ApiConfig[]) => {
        setConfigs(newConfigs);
        localStorage.setItem('trade_scout_api_configs', JSON.stringify(newConfigs));
    };

    const updateConfig = (id: string, field: keyof ApiConfig, value: string) => {
        const updated = configs.map(c => c.id === id ? { ...c, [field]: value } : c);
        saveConfigs(updated);
    };

    const addConfig = () => {
        const newConfig: ApiConfig = { 
            id: Date.now().toString(), 
            apiKey: '', 
            baseUrl: '', 
            modelId: 'gemini-1.5-pro',
            taskAssignment: 'default'
        };
        saveConfigs([...configs, newConfig]);
    };

    const removeConfig = (id: string) => {
        if (configs.length > 1 && confirm("确认删除此 API 配置？")) {
            saveConfigs(configs.filter(c => c.id !== id));
        } else if (configs.length === 1) {
            alert("必须保留至少一个配置。");
        }
    };

    const testConfig = async (config: ApiConfig) => {
        if (!config.apiKey) return;
        setIsTesting(config.id);
        setStatus(null);
        const res = await testApiKey(config.apiKey, config.baseUrl, config.modelId);
        setStatus({ id: config.id, type: res.success ? 'success' : 'error', msg: res.message });
        setIsTesting(null);
    };

    return (
        <div className="max-w-6xl">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Key className="text-blue-600" /> API 密钥配置池 (Configuration Pool)
                </h3>
                <button onClick={addConfig} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors">
                    <Plus size={16} /> 添加新密钥
                </button>
            </div>
            
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
                        <div className="absolute top-4 right-4">
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
                                    placeholder="https://hiapi.online/v1"
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
                                        placeholder="gemini-1.5-pro"
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
        </div>
    );
};

const UserManagement: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newUser, setNewUser] = useState<{username: string, password: string, role: 'user' | 'admin'}>({ username: '', password: '', role: 'user' });

    const loadUsers = async () => { setUsers(await getAllUsers()); };
    useEffect(() => { loadUsers(); }, []);

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        await saveUser({ ...newUser, isFirstLogin: true, createdAt: Date.now() });
        setNewUser({ username: '', password: '', role: 'user' });
        setIsAdding(false);
        loadUsers();
    };

    const handleDelete = async (username: string) => {
        if (username !== 'admin' && confirm(`确认删除用户 ${username}?`)) {
            await deleteUser(username);
            loadUsers();
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-800">系统用户管理</h3>
                <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700">
                    <Plus size={16} /> 添加用户
                </button>
            </div>
            {isAdding && (
                <form onSubmit={handleAddUser} className="bg-slate-50 p-6 rounded-xl border border-slate-200 mb-8 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <input placeholder="用户名 (Username)" className="p-2 border rounded text-slate-900" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} required />
                        <input placeholder="密码 (Password)" className="p-2 border rounded text-slate-900" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
                        <select className="p-2 border rounded text-slate-900" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value as 'user'|'admin'})}>
                            <option value="user">普通用户 (User)</option>
                            <option value="admin">管理员 (Admin)</option>
                        </select>
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded font-bold">保存 (Save)</button>
                        <button type="button" onClick={() => setIsAdding(false)} className="bg-slate-200 text-slate-600 px-4 py-2 rounded font-bold">取消 (Cancel)</button>
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
    const [isUploading, setIsUploading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFiles = async () => { setFiles(await getAllFilesFromDB()); };
    useEffect(() => { loadFiles(); }, []);

    const processFiles = async (fileList: FileList | null) => {
        if (!fileList) return;
        setIsUploading(true);
        for (let i = 0; i < fileList.length; i++) {
             const file = fileList[i];
             const base64 = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
                reader.readAsDataURL(file);
             });
             await saveFileToDB({ id: Date.now()+'-'+i, name: file.name, type: file.type || 'application/octet-stream', data: base64, size: file.size });
        }
        setIsUploading(false);
        loadFiles();
    };
    
    const handleDelete = async (id: string) => { await deleteFileFromDB(id); loadFiles(); };

    const handleSyncToGitHub = async () => {
        setIsSyncing(true);
        try {
            await saveSharedKnowledgeBase(files);
            alert("知识库已同步到 GitHub 'data/kb.json'！");
        } catch (e: any) {
            alert(`同步失败: ${e.message}`);
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div>
             <div className="flex justify-between items-center mb-6">
                 <h3 className="text-xl font-bold text-slate-800">知识库文件管理</h3>
                 <button onClick={handleSyncToGitHub} disabled={isSyncing || files.length === 0} className="bg-purple-600 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-purple-700 disabled:opacity-50">
                     {isSyncing ? <Loader2 className="animate-spin" size={16}/> : <UploadCloud size={16}/>}
                     同步给所有用户 (GitHub)
                 </button>
             </div>
             
             <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-slate-400 hover:border-blue-500 hover:bg-blue-50 cursor-pointer mb-6 transition-all">
                {isUploading ? <Loader2 className="animate-spin text-blue-600" /> : <UploadCloud size={32} />}
                <span className="mt-2 font-bold text-slate-600">点击上传文件 (PDF/图片)</span>
                <input type="file" multiple ref={fileInputRef} className="hidden" onChange={(e) => processFiles(e.target.files)} />
             </div>
             
             <div className="space-y-2">
                {files.map(f => (
                    <div key={f.id} className="flex justify-between p-4 border border-slate-200 rounded-xl bg-white items-center shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-50 p-2 rounded-lg text-blue-600"><FileText size={18} /></div>
                            <span className="font-bold text-sm text-slate-800">{f.name}</span>
                            <span className="text-xs text-slate-400">({(f.size/1024).toFixed(1)} KB)</span>
                        </div>
                        <button onClick={() => handleDelete(f.id)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18}/></button>
                    </div>
                ))}
                {files.length === 0 && <div className="text-center text-slate-400 py-10">数据库中暂无文件。</div>}
             </div>
        </div>
    );
};
