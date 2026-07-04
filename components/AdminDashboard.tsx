
import React, { useState, useEffect } from 'react';
import { GlobalConfig, ApiConfig, TaskType, User, KnowledgeFile } from '../types';
import { 
  Settings, Shield, Key, Bell, Save, Plus, Trash2, Globe, Server, 
  CheckCircle2, AlertTriangle, LogOut, Cloud, Users, Database, 
  Link as LinkIcon, RefreshCw, X, FileText, Upload, Play, Loader2,
  Youtube, Music, Video, FileSpreadsheet, FilePieChart, FileCode, Image
} from 'lucide-react';
import { 
  setManualGitHubConfig, 
  checkGitHubStatus, 
  fetchApiConfigsFromCloud, 
  fetchGlobalConfig,
  fetchUsersFromCloud,
  saveUsersToCloud,
} from '../services/githubService';
import { getAllFilesFromDB, saveFileToDB, deleteFileFromDB } from '../services/db';
import { testApiKey, testQwenApiKey } from '../services/geminiService';
import { saveApiConfig, getApiConfig, isSupabaseConfigured, saveKnowledgeFile, getKnowledgeFiles, deleteKnowledgeFile } from '../services/supabase';
import { env } from '../services/env';

const KB_ACCEPT = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.json', '.rtf', '.odt', '.ods', '.odp',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif', '.ico', '.heic', '.avif',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.mpeg', '.mpg', '.m4v',
  'image/*', 'audio/*', 'video/*',
].join(',');

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'js', 'ts', 'html', 'css', 'xml', 'svg', 'rtf']);

const isTextKnowledgeFile = (file: File): boolean => {
  if (file.type.startsWith('text/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return TEXT_EXTENSIONS.has(ext) ||
    ['application/json', 'application/javascript', 'text/csv', 'image/svg+xml'].includes(file.type);
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
  const [qwenApiKey, setQwenApiKey] = useState('');
  const [qwenBaseUrl, setQwenBaseUrl] = useState('');
  const [qwenModelId, setQwenModelId] = useState('qwen-max');
  const [defaultAIModel, setDefaultAIModel] = useState<'qwen' | 'gemini' | 'auto'>('qwen');
  const [testingApiId, setTestingApiId] = useState<string | null>(null);
  const [isTestingQwen, setIsTestingQwen] = useState(false);
  
  // GitHub Cloud State
  const [ghToken, setGhToken] = useState(localStorage.getItem('trade_scout_gh_token') || '');
  const [ghOwner, setGhOwner] = useState(localStorage.getItem('trade_scout_gh_owner') || '');
  const [ghRepo, setGhRepo] = useState(localStorage.getItem('trade_scout_gh_repo') || '');
  const [isCloudConnected, setIsCloudConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ytLink, setYtLink] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('trade_scout_api_configs');
    if (stored) {
      try {
        setLocalApiConfigs(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to load API configs", e);
      }
    }

    const savedProxy = localStorage.getItem('trade_scout_custom_proxy');
    if (savedProxy) setProxyUrl(savedProxy);

    const savedModel = localStorage.getItem('trade_scout_default_ai_model') as 'qwen' | 'gemini' | 'auto' | null;
    if (savedModel) setDefaultAIModel(savedModel);
    else if (env.defaultAIModel) setDefaultAIModel(env.defaultAIModel);

    const loadQwenKey = async () => {
      const localKey = localStorage.getItem('trade_scout_qwen_api_key');
      const localBase = localStorage.getItem('trade_scout_qwen_base_url');
      const localModel = localStorage.getItem('trade_scout_qwen_model_id');
      if (localKey) setQwenApiKey(localKey);
      if (localBase) setQwenBaseUrl(localBase);
      if (localModel) setQwenModelId(localModel);

      const cloudConfig = await getApiConfig('qwen');
      if (cloudConfig?.apiKey) setQwenApiKey(cloudConfig.apiKey);
      if (cloudConfig?.baseUrl) setQwenBaseUrl(cloudConfig.baseUrl);
      if (cloudConfig?.modelId) setQwenModelId(cloudConfig.modelId);

      if (!localKey && !cloudConfig?.apiKey && env.qwenApiKey) {
        setQwenApiKey(env.qwenApiKey);
      }
      if (!localBase && !cloudConfig?.baseUrl && env.qwenBaseUrl) {
        setQwenBaseUrl(env.qwenBaseUrl);
      }
      if (!localModel && !cloudConfig?.modelId && env.qwenModelId) {
        setQwenModelId(env.qwenModelId);
      }
    };
    loadQwenKey();

    const loadKB = async () => {
      if (isSupabaseConfigured()) {
        const cloudFiles = await getKnowledgeFiles();
        for (const f of cloudFiles) {
          await saveFileToDB(f);
        }
      }
      const files = await getAllFilesFromDB();
      setKbFiles(files);
    };
    loadKB();

    const status = checkGitHubStatus();
    setIsCloudConnected(status.ok);
  }, []);

  const updateApiConfig = (idx: number, field: keyof ApiConfig, value: string | number) => {
    setLocalApiConfigs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSaveApiConfigs = async () => {
    localStorage.setItem('trade_scout_api_configs', JSON.stringify(localApiConfigs));
    localStorage.setItem('trade_scout_default_ai_model', defaultAIModel);
    if (qwenApiKey.trim()) {
      localStorage.setItem('trade_scout_qwen_api_key', qwenApiKey.trim());
    }
    if (qwenBaseUrl.trim()) {
      localStorage.setItem('trade_scout_qwen_base_url', qwenBaseUrl.trim());
    }
    if (qwenModelId.trim()) {
      localStorage.setItem('trade_scout_qwen_model_id', qwenModelId.trim());
    }

    if (qwenApiKey.trim() && isSupabaseConfigured()) {
      await saveApiConfig({
        provider: 'qwen',
        apiKey: qwenApiKey.trim(),
        baseUrl: qwenBaseUrl.trim() || undefined,
        modelId: qwenModelId.trim() || 'qwen-max',
      });
    }

    alert('API 配置已保存 (本地 + 云端 Qwen)');
  };

  const handleSaveProxy = () => {
    localStorage.setItem('trade_scout_custom_proxy', proxyUrl);
    alert('代理地址已保存');
  };

  const handleTestQwen = async (testSearch = false) => {
    if (!qwenApiKey.trim()) {
      alert('请先填写 Qwen API Key');
      return;
    }
    setIsTestingQwen(true);
    try {
      const result = await testQwenApiKey(qwenApiKey, qwenBaseUrl, qwenModelId, testSearch);
      alert(result.message);
    } finally {
      setIsTestingQwen(false);
    }
  };

  const handleTestApi = async (api: ApiConfig) => {
    if (!api.apiKey?.trim()) {
      alert('请先填写 API Key');
      return;
    }
    setTestingApiId(api.id);
    try {
      const baseUrl = api.baseUrl?.includes('generativelanguage.googleapis.com') ? 'native' : api.baseUrl;
      const result = await testApiKey(api.apiKey, baseUrl, api.modelId);
      alert(result.message);
    } finally {
      setTestingApiId(null);
    }
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
      next[idx].baseUrl = 'native';
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!isSupabaseConfigured()) {
      alert('Supabase 未配置，无法上传。请在 .env.local 中设置 REACT_APP_SUPABASE_URL 和 REACT_APP_SUPABASE_ANON_KEY。');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      let successCount = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isText = isTextKnowledgeFile(file);

        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            let res = event.target?.result as string;
            if (!isText && res.includes('base64,')) {
              res = res.split('base64,')[1];
            }
            resolve(res);
          };
          reader.onerror = reject;
          if (isText) {
            reader.readAsText(file);
          } else {
            reader.readAsDataURL(file);
          }
        });

        const newFile: KnowledgeFile = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          data: content,
          type: file.name.split('.').pop()?.toLowerCase() || 'bin',
          mimeType: file.type || 'application/octet-stream'
        };

        const saved = await saveKnowledgeFile(newFile);
        if (!saved) {
          alert(`文件 ${file.name} 上传到 Supabase 失败，请检查控制台。`);
          continue;
        }
        await saveFileToDB(newFile);
        successCount++;
      }
      const allFiles = await getAllFilesFromDB();
      setKbFiles(allFiles);
      if (successCount > 0) {
        alert(`已成功上传 ${successCount} 个文件到 Supabase 云端！`);
      }
      e.target.value = '';
    } catch (err) {
      console.error("Upload process error:", err);
      alert('文件处理失败');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddYoutube = async () => {
    if (!ytLink.trim()) return;
    if (!ytLink.includes('youtube.com') && !ytLink.includes('youtu.be')) {
      alert('请输入有效的 YouTube 链接');
      return;
    }
    const newFile: KnowledgeFile = {
      id: crypto.randomUUID(),
      name: `YouTube: ${ytLink.split('v=')[1]?.split('&')[0] || ytLink.split('/').pop()}`,
      size: 0,
      data: ytLink,
      type: 'youtube',
      mimeType: 'text/x-uri'
    };
    await saveFileToDB(newFile);
    if (isSupabaseConfigured()) {
      await saveKnowledgeFile(newFile);
    } else {
      alert('Supabase 未配置，链接仅保存到本地。');
    }
    const allFiles = await getAllFilesFromDB();
    setKbFiles(allFiles);
    setYtLink('');
    alert('YouTube 链接已添加');
  };

  const handleDeleteFile = async (id: string) => {
    if (confirm('确定要删除这个文件吗？')) {
      await deleteFileFromDB(id);
      if (isSupabaseConfigured()) {
        await deleteKnowledgeFile(id);
      }
      const allFiles = await getAllFilesFromDB();
      setKbFiles(allFiles);
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
                    <p className="text-sm text-slate-400 font-bold mt-1">国内千问 API — 支持联网搜索、背景调查、PPT 导出等全部功能</p>
                  </div>
                  <button onClick={handleSaveApiConfigs} className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 shadow-lg">
                    <Save size={20} /> 保存配置
                  </button>
                  <button onClick={handleAddApi} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 shadow-lg shadow-blue-100">
                    <Plus size={20} /> 添加新密钥
                  </button>
                </div>

                {/* Qwen + Supabase */}
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-800 font-black text-sm">
                      <Database size={16} /> 千问 / Supabase 配置（国内大模型）
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black ${isSupabaseConfigured() ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isSupabaseConfigured() ? 'Supabase 已连接' : 'Supabase 未配置'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">AI 引擎</label>
                      <select
                        value={defaultAIModel}
                        onChange={e => setDefaultAIModel(e.target.value as 'qwen' | 'gemini' | 'auto')}
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      >
                        <option value="qwen">千问（推荐，国内联网搜索）</option>
                        <option value="auto">自动（千问优先，Gemini 备用）</option>
                        <option value="gemini">Gemini（备用，需额外付费）</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Qwen 模型 ID</label>
                      <input
                        type="text"
                        value={qwenModelId}
                        onChange={e => setQwenModelId(e.target.value)}
                        placeholder="qwen-max / qwen-plus / qwen-turbo"
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Qwen API Key</label>
                      <input
                        type="password"
                        value={qwenApiKey}
                        onChange={e => setQwenApiKey(e.target.value)}
                        placeholder="sk-ws-... (MaaS 工作空间 Key)"
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">API Base URL（OpenAI 兼容地址）</label>
                      <input
                        type="text"
                        value={qwenBaseUrl}
                        onChange={e => setQwenBaseUrl(e.target.value)}
                        placeholder="https://ws-xxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                      <p className="text-[10px] text-slate-400 font-bold mt-2">
                        联网搜索、客户搜索、深度调查均走千问 enable_search。建议使用 qwen-plus 或 qwen-max。
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => handleTestQwen(false)}
                      disabled={isTestingQwen}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 disabled:opacity-50"
                    >
                      {isTestingQwen ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      测试连接
                    </button>
                    <button
                      onClick={() => handleTestQwen(true)}
                      disabled={isTestingQwen}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2 disabled:opacity-50"
                    >
                      {isTestingQwen ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                      测试联网搜索
                    </button>
                  </div>
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
                    <button onClick={handleSaveProxy} className="bg-blue-600 text-white px-6 py-2 rounded-lg text-xs font-black">Save Proxy</button>
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
                          <input type="number" value={api.priority ?? 2} onChange={e => updateApiConfig(idx, 'priority', parseInt(e.target.value) || 2)} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-sm" />
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">任务分配 (Task)</label>
                          <select value={api.taskAssignment || 'default'} onChange={e => updateApiConfig(idx, 'taskAssignment', e.target.value)} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-xs appearance-none">
                            <option value="default">默认 (Default)</option>
                            <option value="email">开发信撰写 (Email)</option>
                            <option value="search">客户搜索 (Search)</option>
                            <option value="analysis">深度分析 (Analysis)</option>
                            <option value="chat">策略对话 (Chat)</option>
                            <option value="keywords">关键词提取 (Keywords)</option>
                          </select>
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">代理地址 (Base URL)</label>
                          <input type="text" value={api.baseUrl} onChange={e => updateApiConfig(idx, 'baseUrl', e.target.value)} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-[10px]" />
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">API 密钥 (Key)</label>
                          <input type="password" value={api.apiKey} onChange={e => updateApiConfig(idx, 'apiKey', e.target.value)} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-sm" placeholder="••••••••••••" />
                        </div>
                        <div className="lg:col-span-1">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">模型 ID (Model)</label>
                          <input type="text" value={api.modelId || ''} onChange={e => updateApiConfig(idx, 'modelId', e.target.value)} className="w-full bg-slate-50 border-slate-100 rounded-xl px-4 py-3 font-bold text-xs" />
                        </div>
                        <div className="flex items-end">
                           <button onClick={() => handleTestApi(api)} disabled={testingApiId === api.id} className="w-full bg-slate-900 text-white p-3 rounded-xl hover:bg-blue-600 transition-all disabled:opacity-50">
                              {testingApiId === api.id ? <Loader2 size={16} className="animate-spin mx-auto" /> : <Play size={16} fill="currentColor" className="mx-auto" />}
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

                <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-slate-800 font-black">
                      <Database size={18} className="text-emerald-600" /> SUPABASE 云端知识库
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black ${isSupabaseConfigured() ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isSupabaseConfigured() ? 'Supabase 已连接' : 'Supabase 未配置'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 font-medium mb-4">
                    上传的文件将直接保存到 Supabase 云端，支持 Word、Excel、PPT、PDF、图片、音频、视频等全部常见格式。
                  </p>
                  <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                    {['PDF', 'Word', 'Excel', 'PPT', '图片', '音频', '视频', 'TXT/MD'].map(tag => (
                      <span key={tag} className="bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">{tag}</span>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <div className="text-lg font-black text-slate-800">
                      云端文件: <span className="text-blue-600">{kbFiles.length}</span>
                    </div>
                    <label 
                      htmlFor="kb-upload-input"
                      className={`bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black text-sm flex items-center gap-2 cursor-pointer transition-all ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {isUploading ? '上传中...' : '上传到 Supabase'}
                    </label>
                    <input 
                      id="kb-upload-input"
                      type="file" 
                      multiple
                      onChange={handleFileUpload} 
                      className="sr-only" 
                      accept={KB_ACCEPT}
                      disabled={isUploading}
                    />
                  </div>

                  {/* YouTube Link Input */}
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 flex items-center gap-4">
                    <div className="bg-red-100 text-red-600 p-3 rounded-xl">
                      <Youtube size={20} />
                    </div>
                    <div className="flex-1">
                      <input 
                        type="text" 
                        placeholder="粘贴 YouTube 视频链接 (Paste YouTube Link)..." 
                        value={ytLink}
                        onChange={e => setYtLink(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none"
                      />
                    </div>
                    <button 
                      onClick={handleAddYoutube}
                      className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-xl font-black text-xs transition-all"
                    >
                      添加链接
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {kbFiles.length > 0 ? kbFiles.map((file, i) => {
                      const getFileIcon = () => {
                        const t = file.type.toLowerCase();
                        if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'].includes(t)) return <Music size={20} />;
                        if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpeg', 'mpg', 'm4v'].includes(t)) return <Video size={20} />;
                        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'avif'].includes(t)) return <Image size={20} />;
                        if (['pdf', 'doc', 'docx'].includes(t)) return <FileText size={20} />;
                        if (['xls', 'xlsx', 'csv'].includes(t)) return <FileSpreadsheet size={20} />;
                        if (['ppt', 'pptx'].includes(t)) return <FilePieChart size={20} />;
                        if (['json', 'js', 'ts', 'html', 'css'].includes(t)) return <FileCode size={20} />;
                        if (t === 'youtube') return <Youtube size={20} />;
                        if (t === 'svg') return <Image size={20} />;
                        return <FileText size={20} />;
                      };

                      const getIconBg = () => {
                        const t = file.type.toLowerCase();
                        if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'].includes(t)) return 'bg-purple-600';
                        if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'mpeg', 'mpg', 'm4v'].includes(t)) return 'bg-indigo-600';
                        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'avif', 'svg'].includes(t)) return 'bg-pink-600';
                        if (['pdf', 'doc', 'docx'].includes(t)) return 'bg-red-600';
                        if (['xls', 'xlsx', 'csv'].includes(t)) return 'bg-green-600';
                        if (['ppt', 'pptx'].includes(t)) return 'bg-orange-600';
                        if (t === 'youtube') return 'bg-red-600';
                        return 'bg-slate-900';
                      };

                      return (
                        <div key={file.id || i} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 hover:shadow-md transition-all group">
                          <div className={`${getIconBg()} text-white p-3 rounded-xl`}>
                            {getFileIcon()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-black text-slate-800 truncate">{file.name}</div>
                            <div className="text-[10px] text-slate-400 font-bold mt-1">
                              {file.type === 'youtube' ? 'Video Link' : formatFileSize(file.size)}
                            </div>
                          </div>
                          <button 
                            onClick={() => handleDeleteFile(file.id)}
                            className="text-slate-200 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      );
                    }) : (
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
