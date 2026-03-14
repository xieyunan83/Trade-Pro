
import React, { useState, useEffect } from 'react';
import { GlobalConfig, ApiConfig, TaskType, User, KnowledgeFile } from '../types';
import { 
  Settings, Shield, Key, Bell, Save, Plus, Trash2, Globe, Server, 
  CheckCircle2, AlertTriangle, LogOut, Cloud, Users, Database, 
  Link as LinkIcon, RefreshCw, X, FileText, Upload, Github, Play, Loader2
} from 'lucide-react';
import { 
  setManualGitHubConfig, 
  checkGitHubStatus, 
  fetchApiConfigsFromCloud, 
  fetchGlobalConfig,
  fetchUsersFromCloud,
  saveUsersToCloud,
  fetchDocumentsFromRepo,
  saveKnowledgeBaseToCloud
} from '../services/githubService';
import { getAllFilesFromDB, saveFileToDB, deleteFileFromDB } from '../services/db';

interface AdminDashboardProps {
  onLogout: () => void;
  currentUser: User;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout, currentUser, users, setUsers }) => {
  const [activeTab, setActiveTab] = useState<number>(1);
  const [localConfig, setLocalConfig] = useState<GlobalConfig>({
    lastUpdated: Date.now(),
    dailyLimits: { search: 50, analysis: 20 },
    systemNotice: ''
  });
  const [localApiConfigs, setLocalApiConfigs] = useState<ApiConfig[]>([]);
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [proxyUrl, setProxyUrl] = useState('https://corshub.org/api/proxy?');
  
  // GitHub Cloud State
  const [ghToken, setGhToken] = useState(localStorage.getItem('trade_scout_gh_token') || '');
  const [ghOwner, setGhOwner] = useState(localStorage.getItem('trade_scout_gh_owner') || '');
  const [ghRepo, setGhRepo] = useState(localStorage.getItem('trade_scout_gh_repo') || '');
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Load local API configs
    const stored = localStorage.getItem('trade_scout_api_configs');
    if (stored) {
      try {
        setLocalApiConfigs(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to load API configs", e);
      }
    }

    // Load KB files from DB
    const loadKB = async () => {
      const files = await getAllFilesFromDB();
      setKbFiles(files);
    };
    loadKB();

    // Check cloud status
    const status = checkGitHubStatus();
    setIsCloudConnected(status.ok);
  }, []);

  const handleSaveApiConfigs = () => {
    localStorage.setItem('trade_scout_api_configs', JSON.stringify(localApiConfigs));
    alert('API 配置已保存到本地浏览器 (API Configs saved locally)');
  };

  const handleAddApi = () => {
    const newApi: ApiConfig = {
      id: Math.random().toString(36).substr(2, 9),
      apiKey: '',
      baseUrl: 'https://hiapi.online/',
      taskAssignment: 'default',
      priority: 2,
      modelId: 'gemini-3-flash'
    };
    setLocalApiConfigs([...localApiConfigs, newApi]);
  };

  const applyPreset = (idx: number, type: string) => {
    const next = [...localApiConfigs];
    if (type === 'hiapi') {
      next[idx].baseUrl = 'https://hiapi.online/';
      next[idx].modelId = 'gemini-3-flash';
    } else if (type === 'google') {
      next[idx].baseUrl = 'https://generativelanguage.googleapis.com/';
      next[idx].modelId = 'gemini-1.5-flash';
    } else if (type === 'siliconflow') {
      next[idx].baseUrl = 'https://api.siliconflow.cn/v1';
      next[idx].modelId = 'deepseek-ai/DeepSeek-V3';
    } else if (type === 'groq') {
      next[idx].baseUrl = 'https://api.groq.com/openai/v1';
      next[idx].modelId = 'llama3-70b-8192';
    }
    setLocalApiConfigs(next);
  };

  const handleConnectCloud = async () => {
    if (!ghToken || !ghOwner || !ghRepo) {
      alert('请填写完整的 GitHub 凭证 (Please fill all GitHub credentials)');
      return;
    }
    
    setIsSyncing(true);
    try {
      setManualGitHubConfig(ghToken, ghOwner, ghRepo);
      const status = checkGitHubStatus();
      setIsCloudConnected(status.ok);
      
      if (status.ok) {
        // 1. Sync API Configs
        const cloudConfigs = await fetchApiConfigsFromCloud();
        if (cloudConfigs && cloudConfigs.length > 0) {
          if (confirm('发现云端 API 配置，是否覆盖本地设置？')) {
            setLocalApiConfigs(cloudConfigs);
            localStorage.setItem('trade_scout_api_configs', JSON.stringify(cloudConfigs));
          }
        }
        
        // 2. Sync Global Config
        const cloudGlobal = await fetchGlobalConfig();
        if (cloudGlobal) {
          setLocalConfig(cloudGlobal);
        }

        // 3. Sync Users
        const cloudUsers = await fetchUsersFromCloud();
        if (cloudUsers && cloudUsers.length > 0) {
          if (confirm(`发现云端用户数据 (${cloudUsers.length} 个用户)，是否同步？`)) {
            setUsers(cloudUsers);
            localStorage.setItem('trade_scout_users', JSON.stringify(cloudUsers));
          }
        } else {
          // If no users in cloud, maybe backup current users?
          if (confirm('云端无用户数据，是否将当前用户列表备份到云端？')) {
            await saveUsersToCloud(users);
          }
        }

        // 4. Sync Knowledge Base
        const cloudFiles = await fetchDocumentsFromRepo();
        if (cloudFiles && cloudFiles.length > 0) {
          if (confirm(`发现云端知识库文件 (${cloudFiles.length} 个)，是否同步到本地数据库？`)) {
            for (const f of cloudFiles) {
              await saveFileToDB(f);
            }
            const allFiles = await getAllFilesFromDB();
            setKbFiles(allFiles);
          }
        }
        
        alert('云端连接成功并已同步数据！');
      } else {
        alert('连接失败，请检查 Token 或仓库信息。');
      }
    } catch (e) {
      console.error("Cloud connection error", e);
      alert('连接过程中发生错误。');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteUser = (username: string) => {
    if (username === 'admin') return;
    if (confirm(`确定要删除用户 ${username} 吗？`)) {
      setUsers(users.filter(u => u.username !== username));
    }
  };

  const handleAddUser = () => {
    const username = prompt('请输入新用户名:');
    if (!username) return;
    if (users.find(u => u.username === username)) {
      alert('该用户名已存在');
      return;
    }
    const newUser: User = {
      username,
      role: 'user',
      isFirstLogin: true,
      createdAt: Date.now()
    };
    setUsers([...users, newUser]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log("File upload triggered");
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("Selected file:", file.name);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const newFile: KnowledgeFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          size: file.size,
          data: content,
          type: file.name.split('.').pop() || 'txt'
        };

        await saveFileToDB(newFile);
        const allFiles = await getAllFilesFromDB();
        setKbFiles(allFiles);
        alert('文件上传成功！');
        // Reset input
        e.target.value = '';
      } catch (err) {
        console.error("Upload process error:", err);
        alert('文件处理失败');
      }
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      alert('文件读取失败');
    };
    reader.readAsText(file);
  };

  const handleDeleteFile = async (id: string) => {
    if (confirm('确定要删除这个文件吗？')) {
      await deleteFileFromDB(id);
      const allFiles = await getAllFilesFromDB();
      setKbFiles(allFiles);
    }
  };

  const handleSyncKBToCloud = async () => {
    if (!isCloudConnected) {
      alert('请先连接 GitHub (Please connect GitHub first)');
      return;
    }
    setIsSyncing(true);
    try {
      await saveKnowledgeBaseToCloud(kbFiles);
      alert('知识库已同步到 GitHub 仓库！');
    } catch (e) {
      console.error(e);
      alert('同步失败');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] flex flex-col">
      {/* Header */}
      <header className="bg-[#0F172A] text-white px-8 py-4 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">管理员控制台 (Admin Console)</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Management</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-sm font-bold">
            当前登录: <span className="text-blue-400">{currentUser.username}</span>
          </div>
          <button 
            onClick={onLogout}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-black flex items-center gap-2 transition-all"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        <div className="bg-white rounded-[32px] shadow-xl overflow-hidden border border-white">
          {/* Tabs */}
          <div className="flex border-b bg-slate-50/50">
            {[
              { id: 1, label: 'API 密钥配置 (API Keys)', icon: Key },
              { id: 2, label: '云端连接 (Cloud DB)', icon: Cloud },
              { id: 3, label: '用户管理', icon: Users },
              { id: 4, label: '知识库', icon: Database },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-6 flex items-center justify-center gap-2 font-black text-sm transition-all border-b-4 ${activeTab === tab.id ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                <tab.icon size={18} />
                <span>{tab.id} {tab.label}</span>
              </button>
            ))}
          </div>

          <div className="p-10">
            {/* Tab 1: API Keys */}
            {activeTab === 1 && (
              <div className="space-y-8 animate-fade-in">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                      <Key className="text-blue-600" /> API 密钥配置池
                    </h3>
                    <p className="text-sm text-slate-400 font-bold mt-1">本地安全存储 (LocalStorage Only) - 密钥不会上传到云端</p>
                  </div>
                  <button onClick={handleSaveApiConfigs} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 shadow-lg">
                    <Save size={20} /> 保存配置
                  </button>
                  <button onClick={handleAddApi} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 shadow-lg shadow-blue-100">
                    <Plus size={20} /> 添加新密钥
                  </button>
                </div>

                {/* Recommended Sources */}
                <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-6">
                  <div className="flex items-center gap-2 text-blue-800 font-black text-sm mb-4">
                    <Play size={16} fill="currentColor" /> 免费/稳定 API 来源推荐 (Recommended Free Sources)
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                      { name: 'HiAPI', desc: '稳定中转，适合生产环境。' },
                      { name: 'Google AI Studio', desc: 'Native 模式，免费且强大。' },
                      { name: 'SiliconFlow', desc: '国内直连，送14元额度。' },
                      { name: 'Groq', desc: 'Llama 3 极速版。' }
                    ].map((src, i) => (
                      <div key={i} className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm">
                        <div className="font-black text-blue-600 text-sm mb-1 flex items-center justify-between">
                          {i+1}. {src.name} <LinkIcon size={12} />
                        </div>
                        <p className="text-[10px] text-slate-400 font-bold">{src.desc}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex items-center gap-4">
                    <div className="bg-white border border-blue-100 rounded-lg flex items-center px-3 py-2 flex-1">
                      <Database size={14} className="text-slate-400 mr-2" />
                      <input 
                        type="text" 
                        value={proxyUrl} 
                        onChange={e => setProxyUrl(e.target.value)}
                        className="flex-1 bg-transparent border-none focus:ring-0 text-xs font-bold text-slate-600"
                      />
                    </div>
                    <button className="bg-blue-600 text-white px-6 py-2 rounded-lg text-xs font-black">Save Proxy</button>
                  </div>
                </div>

                {/* API List */}
                <div className="space-y-4">
                  {localApiConfigs.map((api, idx) => (
                    <div key={api.id} className="bg-white border border-slate-100 rounded-3xl p-8 shadow-sm relative group">
                      <button onClick={() => setLocalApiConfigs(localApiConfigs.filter(a => a.id !== api.id))} className="absolute top-6 right-6 text-slate-300 hover:text-red-500 transition-all">
                        <Trash2 size={20} />
                      </button>
                      
                      <div className="flex items-center gap-4 mb-6">
                         <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                            <Key size={10} /> {api.taskAssignment || 'EMAIL'}
                         </div>
                         <div className="bg-green-100 text-green-700 px-3 py-1 rounded-lg text-[10px] font-black flex items-center gap-1">
                            <CheckCircle2 size={10} /> Saved to Local Browser
                         </div>
                         <div className="flex-1"></div>
                         <select 
                            onChange={(e) => applyPreset(idx, e.target.value)}
                            className="text-[10px] font-black text-blue-600 bg-blue-50 border-none rounded-lg px-3 py-1 focus:ring-0 cursor-pointer"
                         >
                            <option value="">✨ Apply Preset (快速预设)</option>
                            <option value="hiapi">HiAPI (Gemini)</option>
                            <option value="google">Google Native</option>
                            <option value="siliconflow">SiliconFlow (DeepSeek)</option>
                            <option value="groq">Groq (Llama 3)</option>
                         </select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-6">
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">优先级 (Priority)</label>
                          <input type="number" value={api.priority} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-sm" />
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">任务分配 (Task)</label>
                          <select value={api.taskAssignment} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-xs appearance-none">
                            <option value="email">开发信撰写 (Email)</option>
                            <option value="search">客户搜索 (Search)</option>
                            <option value="analysis">深度分析 (Analysis)</option>
                          </select>
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">代理地址 (Base URL)</label>
                          <input type="text" value={api.baseUrl} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-[10px]" />
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">API 密钥 (Key)</label>
                          <input type="password" value={api.apiKey} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-sm" placeholder="••••••••••••" />
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">模型 ID (Model)</label>
                          <input type="text" value={api.modelId} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-xs" />
                        </div>
                        <div className="flex items-end">
                           <button className="w-full bg-slate-900 text-white p-3 rounded-xl hover:bg-blue-600 transition-all">
                              <Play size={16} fill="currentColor" />
                           </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 2: Cloud DB */}
            {activeTab === 2 && (
              <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
                <div className="flex items-center gap-4 mb-8">
                  <div className="bg-blue-50 p-4 rounded-2xl text-blue-600">
                    <Cloud size={32} />
                  </div>
                  <div>
                       <div className={`px-3 py-1 rounded-full text-[10px] font-black flex items-center gap-1 border ${isCloudConnected ? 'bg-green-50 text-green-500 border-green-100' : 'bg-red-50 text-red-500 border-red-100'}`}>
                    {isCloudConnected ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                    {isCloudConnected ? '已连接 (Connected)' : '未连接 (Disconnected)'}
                  </div>
                </div>
              </div>

                <div className="bg-white border border-slate-100 rounded-[32px] p-10 shadow-sm space-y-8">
                  <div className="flex items-center gap-2 text-slate-800 font-black mb-2">
                    <LinkIcon size={18} /> 首次配置 / 新设备连接
                  </div>
                  <p className="text-sm text-slate-500 font-medium">在新浏览器或设备上，您只需输入一次 GitHub 凭证。连接成功后，系统将自动拉取之前保存的所有 API Key 和用户设置。</p>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">GitHub Personal Access Token</label>
                      <input 
                        type="password" 
                        placeholder="ghp_xxxxxxxxxxxx" 
                        value={ghToken}
                        onChange={e => setGhToken(e.target.value)}
                        className="w-full bg-slate-50 border-slate-100 rounded-2xl px-6 py-4 font-bold" 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Owner (用户名)</label>
                        <input 
                          type="text" 
                          placeholder="例如: NanGe" 
                          value={ghOwner}
                          onChange={e => setGhOwner(e.target.value)}
                          className="w-full bg-slate-50 border-slate-100 rounded-2xl px-6 py-4 font-bold" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Repo (仓库名)</label>
                        <input 
                          type="text" 
                          placeholder="例如: trade-data" 
                          value={ghRepo}
                          onChange={e => setGhRepo(e.target.value)}
                          className="w-full bg-slate-50 border-slate-100 rounded-2xl px-6 py-4 font-bold" 
                        />
                      </div>
                    </div>
                    <button 
                      onClick={handleConnectCloud}
                      disabled={isSyncing}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl font-black text-lg shadow-lg shadow-blue-100 flex items-center justify-center gap-2 transition-all mt-4 disabled:opacity-50"
                    >
                      {isSyncing ? <Loader2 className="animate-spin" size={20} /> : <Cloud size={20} />}
                      {isSyncing ? '正在同步...' : '连接并同步数据 (Connect & Sync)'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 3 && (
              <div className="space-y-8 animate-fade-in">
                <div className="flex justify-between items-center">
                  <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                    <Users className="text-blue-600" /> 系统用户管理
                  </h3>
                  <div className="flex gap-4">
                    <button onClick={handleConnectCloud} className="bg-purple-100 text-purple-600 px-6 py-3 rounded-xl font-black flex items-center gap-2 hover:bg-purple-200 transition-all">
                      <RefreshCw size={18} /> 强制同步
                    </button>
                    <button onClick={handleAddUser} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 shadow-lg shadow-blue-100">
                      <Plus size={20} /> 添加用户
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-slate-100 rounded-[32px] overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100">
                        <th className="px-8 py-6 text-xs font-black text-slate-400 uppercase tracking-widest">用户名</th>
                        <th className="px-8 py-6 text-xs font-black text-slate-400 uppercase tracking-widest">角色</th>
                        <th className="px-8 py-6 text-xs font-black text-slate-400 uppercase tracking-widest text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user, i) => (
                        <tr key={user.username} className="border-b border-slate-50 last:border-none hover:bg-slate-50/30 transition-all">
                          <td className="px-8 py-6 font-black text-slate-800">{user.username}</td>
                          <td className="px-8 py-6">
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                              {user.role}
                            </span>
                          </td>
                          <td className="px-8 py-6 text-right">
                            {user.username !== 'admin' && (
                              <button onClick={() => handleDeleteUser(user.username)} className="text-slate-300 hover:text-red-500 transition-all">
                                <Trash2 size={18} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab 4: Knowledge Base */}
            {activeTab === 4 && (
              <div className="space-y-8 animate-fade-in">
                <div className="flex justify-between items-center">
                  <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                    <Database className="text-blue-600" /> Knowledge Base Management
                  </h3>
                </div>

                <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm space-y-8">
                  <div className="flex items-center gap-2 text-slate-800 font-black mb-2">
                    <Github size={18} className="text-slate-400" /> GITHUB REPOSITORY CONNECTION
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">OWNER</label>
                      <input 
                        type="text" 
                        placeholder="e.g. NanGe" 
                        value={ghOwner}
                        onChange={e => setGhOwner(e.target.value)}
                        className="w-full bg-[#1E293B] border-none rounded-xl px-4 py-3 text-white font-bold text-sm" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">REPOSITORY</label>
                      <input 
                        type="text" 
                        placeholder="e.g. knowledge-base" 
                        value={ghRepo}
                        onChange={e => setGhRepo(e.target.value)}
                        className="w-full bg-[#1E293B] border-none rounded-xl px-4 py-3 text-white font-bold text-sm" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">PATH</label>
                      <input type="text" placeholder="e.g. docs" className="w-full bg-[#1E293B] border-none rounded-xl px-4 py-3 text-white font-bold text-sm" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">TOKEN</label>
                      <input 
                        type="password" 
                        placeholder="ghp_..." 
                        value={ghToken}
                        onChange={e => setGhToken(e.target.value)}
                        className="w-full bg-[#1E293B] border-none rounded-xl px-4 py-3 text-white font-bold text-sm" 
                      />
                    </div>
                  </div>
                  
                  <div className="flex justify-end">
                    <button 
                      onClick={handleConnectCloud}
                      className="bg-[#A855F7] hover:bg-[#9333EA] text-white px-10 py-4 rounded-2xl font-black flex items-center gap-2 shadow-lg shadow-purple-100 transition-all"
                    >
                      <RefreshCw size={20} /> Update Connection
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <div className="text-lg font-black text-slate-800">
                      Active Files: <span className="text-blue-600">{kbFiles.length}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={handleSyncKBToCloud}
                        disabled={isSyncing || kbFiles.length === 0}
                        className="text-purple-600 font-black text-sm flex items-center gap-1 hover:underline disabled:opacity-30"
                      >
                        <Cloud size={16} /> Push to GitHub
                      </button>
                      <label 
                        htmlFor="kb-upload-input"
                        className="text-blue-600 font-black text-sm flex items-center gap-1 hover:underline cursor-pointer"
                      >
                        <Plus size={16} /> Upload Local
                      </label>
                      <input 
                        id="kb-upload-input"
                        type="file" 
                        onChange={handleFileUpload} 
                        className="sr-only" 
                        accept=".txt,.md,.json,.csv"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {kbFiles.length > 0 ? kbFiles.map((file, i) => (
                      <div key={file.id || i} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 hover:shadow-md transition-all group">
                        <div className="bg-slate-900 text-white p-3 rounded-xl">
                          <FileText size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-black text-slate-800 truncate">{file.name}</div>
                          <div className="text-[10px] text-slate-400 font-bold mt-1">{(file.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button 
                          onClick={() => handleDeleteFile(file.id)}
                          className="text-slate-200 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )) : (
                      <div className="col-span-full py-10 text-center text-slate-400 font-bold">
                        暂无知识库文件 (No files found)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};
