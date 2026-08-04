
import React, { useState, useEffect } from 'react';
import { GlobalConfig, ApiConfig, TaskType, User, KnowledgeFile, Department } from '../types';
import { 
  Settings, Shield, Key, Bell, Save, Plus, Trash2, Globe, Server, 
  CheckCircle2, AlertTriangle, LogOut, Users, Database, 
  RefreshCw, X, FileText, Upload, Play, Loader2,
  Youtube, Music, Video, FileSpreadsheet, FilePieChart, FileCode, Image, Mail, Building2
} from 'lucide-react';
import { getAllFilesFromDB, saveFileToDB, deleteFileFromDB } from '../services/db';
import { testApiKey, testQwenApiKey, testAnymailFinderApiKey, testHunterApiKey, testAnysearchApiKey, getTaskAIModels, saveTaskAIModels, sanitizeApiKey, type TaskAIModels, type AIEngineChoice } from '../services/geminiService';
import { testTavilyKeyPool, listTavilyKeys, setTavilyKeyPool, getTavilyKeyStatuses, clearTavilyExhausted } from '../services/tavilyService';
import { testWanImageApi } from '../services/wanImageService';
import { saveApiConfig, getApiConfig, isSupabaseConfigured, saveKnowledgeFile, getKnowledgeFiles, deleteKnowledgeFile, resetSupabaseClient, testSupabaseConnection } from '../services/supabase';
import { getSupabaseConfig, saveSupabaseConfig, clearSupabaseOverride, saveEmailSearchKeys, getEmailSearchKeys, getAnysearchApiKey, saveAnysearchApiKey, env } from '../services/env';
import { hashPassword, persistUsers, updateUserPassword } from '../services/auth';
import { loadDepartmentsFromStorage } from '../services/orgStore';
import { roleLabel } from '../services/permissions';
import { OrgPermissionPanel } from './OrgPermissionPanel';
import { AddUserModal } from './AddUserModal';
import {
  getAliyunProxyMode,
  setAliyunProxyMode,
  getAliyunProxyBase,
  setAliyunProxyBase,
  type AliyunProxyMode,
} from '../services/qwenProxy';

type AdminTab = 'api' | 'users' | 'org' | 'kb';

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
  const [activeTab, setActiveTab] = useState<AdminTab>('api');
  const [departments, setDepartments] = useState<Department[]>(() => loadDepartmentsFromStorage());
  const [localConfig, setLocalConfig] = useState<GlobalConfig>({
    lastUpdated: Date.now(),
    dailyLimits: { search: 500, analysis: 500 },
    systemNotice: ''
  });
  const [localApiConfigs, setLocalApiConfigs] = useState<ApiConfig[]>([]);
  const [kbFiles, setKbFiles] = useState<KnowledgeFile[]>([]);
  const [proxyUrl, setProxyUrl] = useState('https://corshub.org/api/proxy?');
  const [qwenApiKey, setQwenApiKey] = useState('');
  const [qwenBaseUrl, setQwenBaseUrl] = useState('');
  const [qwenModelId, setQwenModelId] = useState('qwen-max');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModelId, setGeminiModelId] = useState('gemini-2.0-flash');
  const [taskAIModels, setTaskAIModels] = useState<TaskAIModels>(() => getTaskAIModels());
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [geminiTestMsg, setGeminiTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [wanApiKey, setWanApiKey] = useState('');
  const [wanBaseUrl, setWanBaseUrl] = useState('https://token-plan.cn-beijing.maas.aliyuncs.com');
  const [wanModelId, setWanModelId] = useState('wan2.7-image');
  const [defaultAIModel, setDefaultAIModel] = useState<'qwen' | 'gemini' | 'auto'>('qwen');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseReady, setSupabaseReady] = useState(isSupabaseConfigured());
  const [supabaseLiveOk, setSupabaseLiveOk] = useState<boolean | null>(null);
  const [supabaseLiveMsg, setSupabaseLiveMsg] = useState('');
  const [kbCloudError, setKbCloudError] = useState<string | null>(null);
  const [hunterApiKey, setHunterApiKey] = useState('');
  const [findymailApiKey, setFindymailApiKey] = useState('');
  const [anymailFinderApiKey, setAnymailFinderApiKey] = useState('');
  const [anysearchApiKey, setAnysearchApiKey] = useState('');
  const [tavilyKeys, setTavilyKeys] = useState<string[]>([]);
  const [tavilyDraftKey, setTavilyDraftKey] = useState('');
  const [aliyunProxyMode, setAliyunProxyModeState] = useState<AliyunProxyMode>('auto');
  const [aliyunProxyBase, setAliyunProxyBaseState] = useState('');
  const [testingApiId, setTestingApiId] = useState<string | null>(null);
  const [isTestingQwen, setIsTestingQwen] = useState(false);
  const [isTestingWan, setIsTestingWan] = useState(false);
  const [isTestingAnymail, setIsTestingAnymail] = useState(false);
  const [isTestingHunter, setIsTestingHunter] = useState(false);
  const [isTestingAnysearch, setIsTestingAnysearch] = useState(false);
  const [isSavingConfigs, setIsSavingConfigs] = useState(false);
  const [qwenTestMsg, setQwenTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [anymailTestMsg, setAnymailTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hunterTestMsg, setHunterTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [anysearchTestMsg, setAnysearchTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tavilyTestMsg, setTavilyTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isTestingTavily, setIsTestingTavily] = useState(false);
  const [wanTestMsg, setWanTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveConfigMsg, setSaveConfigMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ytLink, setYtLink] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState('');
  const [resetPwdMsg, setResetPwdMsg] = useState<string | null>(null);
  const [isResettingPwd, setIsResettingPwd] = useState(false);

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
    setAliyunProxyModeState(getAliyunProxyMode());
    setAliyunProxyBaseState(getAliyunProxyBase());

    const savedModel = localStorage.getItem('trade_scout_default_ai_model') as 'qwen' | 'gemini' | 'auto' | null;
    if (savedModel) setDefaultAIModel(savedModel);
    else if (env.defaultAIModel) setDefaultAIModel(env.defaultAIModel);

    setTaskAIModels(getTaskAIModels());

    const loadGeminiKey = async () => {
      const localKey = localStorage.getItem('trade_scout_gemini_api_key');
      const localModel = localStorage.getItem('trade_scout_gemini_model_id');
      if (localKey) setGeminiApiKey(localKey);
      if (localModel) setGeminiModelId(localModel);
      const cloud = await getApiConfig('gemini');
      if (!localKey && cloud?.apiKey) setGeminiApiKey(cloud.apiKey);
      if (!localModel && cloud?.modelId) setGeminiModelId(cloud.modelId);
      // 兼容旧「API 配置池」里 native Gemini
      if (!localKey && !cloud?.apiKey) {
        try {
          const pool = JSON.parse(localStorage.getItem('trade_scout_api_configs') || '[]') as ApiConfig[];
          const native = pool.find(
            (c) =>
              c.apiKey?.trim() &&
              (c.baseUrl === 'native' || (c.baseUrl || '').includes('generativelanguage.googleapis.com'))
          );
          if (native?.apiKey) {
            setGeminiApiKey(native.apiKey);
            if (native.modelId) setGeminiModelId(native.modelId);
          }
        } catch {
          /* ignore */
        }
      }
    };
    void loadGeminiKey();

    const loadQwenKey = async () => {
      const localKey = localStorage.getItem('trade_scout_qwen_api_key');
      const localBase = localStorage.getItem('trade_scout_qwen_base_url');
      const localModel = localStorage.getItem('trade_scout_qwen_model_id');
      if (localKey) setQwenApiKey(localKey);
      if (localBase) setQwenBaseUrl(localBase);
      if (localModel) setQwenModelId(localModel);

      // 仅在本地没有配置时，才用云端 / .env 填充，避免覆盖刚录入的 Token Plan Key
      const cloudConfig = await getApiConfig('qwen');
      if (!localKey && cloudConfig?.apiKey) setQwenApiKey(cloudConfig.apiKey);
      if (!localBase && cloudConfig?.baseUrl) setQwenBaseUrl(cloudConfig.baseUrl);
      if (!localModel && cloudConfig?.modelId) setQwenModelId(cloudConfig.modelId);

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

    const loadWanKey = async () => {
      const localKey = localStorage.getItem('trade_scout_wan_api_key');
      const localBase = localStorage.getItem('trade_scout_wan_base_url');
      const localModel = localStorage.getItem('trade_scout_wan_model_id');
      if (localKey) setWanApiKey(localKey);
      if (localBase) setWanBaseUrl(localBase);
      if (localModel) setWanModelId(localModel);

      const cloud = await getApiConfig('wan');
      if (!localKey && cloud?.apiKey) setWanApiKey(cloud.apiKey);
      if (!localBase && cloud?.baseUrl) setWanBaseUrl(cloud.baseUrl);
      if (!localModel && cloud?.modelId) setWanModelId(cloud.modelId);

      if (!localKey && !cloud?.apiKey && env.wanApiKey) setWanApiKey(env.wanApiKey);
      if (!localBase && !cloud?.baseUrl && env.wanBaseUrl) setWanBaseUrl(env.wanBaseUrl);
      if (!localModel && !cloud?.modelId && env.wanModelId) setWanModelId(env.wanModelId);
    };
    loadWanKey();

    const sb = getSupabaseConfig();
    setSupabaseUrl(sb.url);
    setSupabaseAnonKey(sb.key);
    setSupabaseReady(isSupabaseConfigured());

    const emailKeys = getEmailSearchKeys();
    setHunterApiKey(emailKeys.hunter);
    setFindymailApiKey(emailKeys.findymail);
    setAnymailFinderApiKey(emailKeys.anymailFinder);
    setAnysearchApiKey(getAnysearchApiKey());
    setTavilyKeys(listTavilyKeys());

    const loadEmailKeysFromCloud = async () => {
      if (!isSupabaseConfigured()) return;
      const [hunter, findymail, anymail, anysearch, tavily] = await Promise.all([
        getApiConfig('hunter'),
        getApiConfig('findymail'),
        getApiConfig('anymailfinder'),
        getApiConfig('anysearch'),
        getApiConfig('tavily'),
      ]);
      if (hunter?.apiKey) setHunterApiKey(hunter.apiKey);
      if (findymail?.apiKey) setFindymailApiKey(findymail.apiKey);
      if (anymail?.apiKey) setAnymailFinderApiKey(anymail.apiKey);
      if (anysearch?.apiKey) {
        setAnysearchApiKey(anysearch.apiKey);
        saveAnysearchApiKey(anysearch.apiKey);
      }
      if (tavily?.apiKey) {
        const raw = tavily.apiKey.trim();
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setTavilyKeyPool(parsed.map(String));
            setTavilyKeys(listTavilyKeys());
          } else {
            setTavilyKeyPool([raw]);
            setTavilyKeys(listTavilyKeys());
          }
        } catch {
          setTavilyKeyPool([raw]);
          setTavilyKeys(listTavilyKeys());
        }
      }
    };
    loadEmailKeysFromCloud();

    const loadKB = async () => {
      setKbCloudError(null);
      // 先加载本地，保证云端挂了也能看到已有文件
      const localFiles = await getAllFilesFromDB();
      setKbFiles(localFiles);

      if (isSupabaseConfigured()) {
        const ping = await testSupabaseConnection();
        setSupabaseLiveOk(ping.ok);
        setSupabaseLiveMsg(ping.message);
        if (!ping.ok) {
          setKbCloudError(ping.message);
          return;
        }
        const { files: cloudFiles, error } = await getKnowledgeFiles();
        if (error) {
          setKbCloudError(error);
          return;
        }
        for (const f of cloudFiles) {
          await saveFileToDB(f);
        }
        const merged = await getAllFilesFromDB();
        setKbFiles(merged);
      } else {
        setSupabaseLiveOk(false);
        setSupabaseLiveMsg('Supabase 未配置');
      }
    };
    loadKB();
  }, []);

  const updateApiConfig = (idx: number, field: keyof ApiConfig, value: string | number) => {
    setLocalApiConfigs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSaveSupabaseConfig = async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      setSaveConfigMsg({ ok: false, text: '请填写 Supabase URL 和 Anon Key' });
      return;
    }
    saveSupabaseConfig(supabaseUrl, supabaseAnonKey);
    resetSupabaseClient();
    setSupabaseReady(true);
    setSaveConfigMsg({ ok: true, text: 'Supabase 配置已保存，即将刷新以同步云端数据…' });
    window.setTimeout(() => window.location.reload(), 400);
  };

  const handleResetSupabaseOverride = () => {
    clearSupabaseOverride();
    resetSupabaseClient();
    const sb = getSupabaseConfig();
    setSupabaseUrl(sb.url);
    setSupabaseAnonKey(sb.key);
    setSupabaseReady(isSupabaseConfigured());
    setSaveConfigMsg({ ok: true, text: '已恢复为 .env.local / bakedConfig 中的默认 Supabase 配置' });
  };

  const handleSaveApiConfigs = async () => {
    if (isSavingConfigs) return;
    setIsSavingConfigs(true);
    setSaveConfigMsg({ ok: true, text: '正在保存配置…' });
    const cloudWithTimeout = async (label: string, fn: () => Promise<boolean>) => {
      try {
        const ok = await Promise.race([
          fn(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 12_000)),
        ]);
        return { label, ok };
      } catch (e: any) {
        console.error(`save ${label} failed`, e);
        return { label, ok: false };
      }
    };

    try {
      localStorage.setItem('trade_scout_default_ai_model', defaultAIModel);
      saveTaskAIModels(taskAIModels);
      if (geminiApiKey.trim()) {
        localStorage.setItem('trade_scout_gemini_api_key', sanitizeApiKey(geminiApiKey));
      }
      if (geminiModelId.trim()) {
        localStorage.setItem('trade_scout_gemini_model_id', geminiModelId.trim());
      }
      // 同步一份 native 配置到旧池，兼容其它读取路径；清除中转条目
      const syncedPool: ApiConfig[] = geminiApiKey.trim()
        ? [
            {
              id: 'gemini_official',
              apiKey: sanitizeApiKey(geminiApiKey),
              baseUrl: 'native',
              modelId: geminiModelId.trim() || 'gemini-2.0-flash',
              priority: 0,
              taskAssignment: 'default',
            },
          ]
        : [];
      setLocalApiConfigs(syncedPool);
      localStorage.setItem('trade_scout_api_configs', JSON.stringify(syncedPool));
      if (qwenApiKey.trim()) {
        localStorage.setItem('trade_scout_qwen_api_key', qwenApiKey.trim());
      }
      if (qwenBaseUrl.trim()) {
        localStorage.setItem('trade_scout_qwen_base_url', qwenBaseUrl.trim());
      }
      if (qwenModelId.trim()) {
        localStorage.setItem('trade_scout_qwen_model_id', qwenModelId.trim());
      }
      if (wanApiKey.trim()) {
        localStorage.setItem('trade_scout_wan_api_key', wanApiKey.trim());
      } else if (qwenApiKey.trim()) {
        localStorage.setItem('trade_scout_wan_api_key', qwenApiKey.trim());
      }
      if (wanBaseUrl.trim()) {
        localStorage.setItem('trade_scout_wan_base_url', wanBaseUrl.trim());
      } else if (qwenBaseUrl.trim()) {
        localStorage.setItem('trade_scout_wan_base_url', qwenBaseUrl.trim());
      }
      if (wanModelId.trim()) {
        localStorage.setItem('trade_scout_wan_model_id', wanModelId.trim());
      }

      saveEmailSearchKeys({
        hunter: hunterApiKey,
        findymail: findymailApiKey,
        anymailFinder: anymailFinderApiKey,
      });
      saveAnysearchApiKey(anysearchApiKey);
      setTavilyKeyPool(tavilyKeys);

      const emailLocal = [
        geminiApiKey.trim() ? 'Gemini✓' : 'Gemini✗',
        qwenApiKey.trim() ? '千问✓' : '千问✗',
        anymailFinderApiKey.trim() ? 'Anymail✓' : 'Anymail✗',
        hunterApiKey.trim() ? 'Hunter✓' : 'Hunter✗',
        findymailApiKey.trim() ? 'Findymail✓' : 'Findymail✗',
        anysearchApiKey.trim() ? 'AnySearch✓' : 'AnySearch✗',
        tavilyKeys.length ? `Tavily✓×${tavilyKeys.length}` : 'Tavily✗',
      ].join(' · ');

      const cloudParts: string[] = [];
      if (isSupabaseConfigured()) {
        if (qwenApiKey.trim()) {
          const r = await cloudWithTimeout('千问', () =>
            saveApiConfig({
              provider: 'qwen',
              apiKey: qwenApiKey.trim(),
              baseUrl: qwenBaseUrl.trim() || undefined,
              modelId: qwenModelId.trim() || 'qwen-max',
            })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }

        if (geminiApiKey.trim()) {
          const r = await cloudWithTimeout('Gemini', () =>
            saveApiConfig({
              provider: 'gemini',
              apiKey: sanitizeApiKey(geminiApiKey),
              baseUrl: 'native',
              modelId: geminiModelId.trim() || 'gemini-2.0-flash',
            })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }

        {
          const r = await cloudWithTimeout('任务路由', () =>
            saveApiConfig({
              provider: 'task_ai_models',
              apiKey: JSON.stringify(taskAIModels),
              baseUrl: 'local',
              modelId: 'task-routing',
            })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }

        const wanKeyToSave = wanApiKey.trim() || qwenApiKey.trim();
        if (wanKeyToSave) {
          const r = await cloudWithTimeout('万相', () =>
            saveApiConfig({
              provider: 'wan',
              apiKey: wanKeyToSave,
              baseUrl: (wanBaseUrl.trim() || qwenBaseUrl.trim()) || undefined,
              modelId: wanModelId.trim() || 'wan2.7-image',
            })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }

        if (hunterApiKey.trim()) {
          const r = await cloudWithTimeout('Hunter', () =>
            saveApiConfig({ provider: 'hunter', apiKey: hunterApiKey.trim() })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }
        if (findymailApiKey.trim()) {
          const r = await cloudWithTimeout('Findymail', () =>
            saveApiConfig({ provider: 'findymail', apiKey: findymailApiKey.trim() })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }
        if (anymailFinderApiKey.trim()) {
          const r = await cloudWithTimeout('Anymail', () =>
            saveApiConfig({ provider: 'anymailfinder', apiKey: anymailFinderApiKey.trim() })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }
        if (anysearchApiKey.trim()) {
          const r = await cloudWithTimeout('AnySearch', () =>
            saveApiConfig({ provider: 'anysearch', apiKey: anysearchApiKey.trim() })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }

        if (tavilyKeys.length) {
          const r = await cloudWithTimeout('Tavily', () =>
            saveApiConfig({ provider: 'tavily', apiKey: JSON.stringify(tavilyKeys) })
          );
          cloudParts.push(`${r.label}${r.ok ? '✓' : '✗'}`);
        }
      }

      const cloudLine = isSupabaseConfigured()
        ? cloudParts.length
          ? `云端：${cloudParts.join(' · ')}`
          : '云端：无新增 Key 可同步（请确认已填写）'
        : '云端：Supabase 未配置（仅本机生效）';

      const text = `配置已保存\n本机 Key：${emailLocal}\n${cloudLine}\n\n普通用户请刷新页面后再使用（会自动拉取云端 Key）`;
      setSaveConfigMsg({ ok: true, text: text.replace(/\n/g, ' · ') });
    } catch (e: any) {
      const text = `保存失败：${e?.message || String(e)}（本机 Key 可能已写入，云端请重试）`;
      setSaveConfigMsg({ ok: false, text });
    } finally {
      setIsSavingConfigs(false);
    }
  };

  const handleSaveProxy = () => {
    localStorage.setItem('trade_scout_custom_proxy', proxyUrl);
    setSaveConfigMsg({ ok: true, text: '代理地址已保存' });
  };

  const handleSaveAliyunProxy = () => {
    setAliyunProxyMode(aliyunProxyMode);
    setAliyunProxyBase(aliyunProxyBase);
    setSaveConfigMsg({ ok: true, text: '中转设置已保存。保持「自动」即可，本机和线上都会自动走通。' });
  };

  const handleTestGemini = async () => {
    if (isTestingGemini) return;
    if (!geminiApiKey.trim()) {
      setGeminiTestMsg({ ok: false, text: '请先填写 Gemini 官方 API Key' });
      return;
    }
    setIsTestingGemini(true);
    setGeminiTestMsg(null);
    try {
      const result = await testApiKey(
        sanitizeApiKey(geminiApiKey),
        'native',
        geminiModelId.trim() || 'gemini-2.0-flash'
      );
      setGeminiTestMsg({
        ok: result.success,
        text: result.success
          ? `${result.message} 可在 AI Studio 查看用量：https://aistudio.google.com/usage`
          : result.message,
      });
    } catch (e: any) {
      setGeminiTestMsg({ ok: false, text: `Gemini 测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingGemini(false);
    }
  };

  const patchTaskAI = (role: keyof TaskAIModels, value: AIEngineChoice) => {
    setTaskAIModels((prev) => ({ ...prev, [role]: value }));
  };

  const handleTestQwen = async (testSearch = false) => {
    if (isTestingQwen) return;
    if (!qwenApiKey.trim()) {
      const msg = '请先填写 Qwen API Key';
      setQwenTestMsg({ ok: false, text: msg });
      return;
    }
    // 测试前先写入 localStorage，保证请求用的是当前表单里的 Token Plan 配置
    localStorage.setItem('trade_scout_qwen_api_key', qwenApiKey.trim());
    if (qwenBaseUrl.trim()) localStorage.setItem('trade_scout_qwen_base_url', qwenBaseUrl.trim());
    else localStorage.setItem('trade_scout_qwen_base_url', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1');
    if (qwenModelId.trim()) localStorage.setItem('trade_scout_qwen_model_id', qwenModelId.trim());

    setIsTestingQwen(true);
    setQwenTestMsg({
      ok: true,
      text: testSearch
        ? '正在测试联网搜索（遇限流会自动重试，最长约 100 秒）…'
        : '正在测试连接（遇限流会自动重试，最长约 100 秒）…',
    });
    try {
      const result = await testQwenApiKey(qwenApiKey, qwenBaseUrl, qwenModelId, testSearch);
      setQwenTestMsg({ ok: result.success, text: result.message });
    } catch (e: any) {
      setQwenTestMsg({ ok: false, text: `Qwen 测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingQwen(false);
    }
  };

  const handleTestWan = async () => {
    if (isTestingWan) return;
    const key = (wanApiKey.trim() || qwenApiKey.trim()).replace(/\s+/g, '');
    if (!key) {
      setWanTestMsg({ ok: false, text: '请先填写万相 API Key（可与千问 Token Plan 共用）' });
      return;
    }
    const base =
      wanBaseUrl.trim() ||
      qwenBaseUrl.trim() ||
      'https://token-plan.cn-beijing.maas.aliyuncs.com';
    const origin = (() => {
      try {
        return key.startsWith('sk-sp-')
          ? 'https://token-plan.cn-beijing.maas.aliyuncs.com'
          : new URL(base.startsWith('http') ? base : `https://${base}`).origin;
      } catch {
        return 'https://token-plan.cn-beijing.maas.aliyuncs.com';
      }
    })();
    localStorage.setItem('trade_scout_wan_api_key', key);
    localStorage.setItem('trade_scout_wan_base_url', origin);
    localStorage.setItem('trade_scout_wan_model_id', wanModelId.trim() || 'wan2.7-image');
    setWanBaseUrl(origin);
    if (!wanApiKey.trim()) setWanApiKey(key);
    setIsTestingWan(true);
    setWanTestMsg({ ok: true, text: '正在测试万相连接（最长约 45 秒）…' });
    try {
      const result = await testWanImageApi({
        apiKey: key,
        origin,
        modelId: wanModelId.trim() || 'wan2.7-image',
      });
      setWanTestMsg({ ok: result.success, text: result.message });
    } catch (e: any) {
      setWanTestMsg({ ok: false, text: `万相测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingWan(false);
    }
  };

  const handleTestAnymail = async () => {
    if (isTestingAnymail) return;
    if (!anymailFinderApiKey.trim()) {
      setAnymailTestMsg({ ok: false, text: '请先填写 AnymailFinder API Key' });
      return;
    }
    localStorage.setItem('trade_scout_anymail_finder_api_key', anymailFinderApiKey.trim());
    setIsTestingAnymail(true);
    setAnymailTestMsg({ ok: true, text: '正在测试 AnymailFinder（最长约 20 秒）…' });
    try {
      const result = await testAnymailFinderApiKey(anymailFinderApiKey.trim());
      setAnymailTestMsg({ ok: result.success, text: result.message });
    } catch (e: any) {
      setAnymailTestMsg({ ok: false, text: `AnymailFinder 测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingAnymail(false);
    }
  };

  const handleTestHunter = async () => {
    if (isTestingHunter) return;
    if (!hunterApiKey.trim()) {
      setHunterTestMsg({ ok: false, text: '请先填写 Hunter.io API Key' });
      return;
    }
    localStorage.setItem('trade_scout_hunter_api_key', hunterApiKey.trim());
    setIsTestingHunter(true);
    setHunterTestMsg({ ok: true, text: '正在测试 Hunter.io（最长约 20 秒）…' });
    try {
      const result = await testHunterApiKey(hunterApiKey.trim());
      setHunterTestMsg({ ok: result.success, text: result.message });
    } catch (e: any) {
      setHunterTestMsg({ ok: false, text: `Hunter.io 测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingHunter(false);
    }
  };

  const handleTestAnysearch = async () => {
    if (isTestingAnysearch) return;
    if (!anysearchApiKey.trim()) {
      setAnysearchTestMsg({ ok: false, text: '请先填写 AnySearch API Key' });
      return;
    }
    saveAnysearchApiKey(anysearchApiKey.trim());
    setIsTestingAnysearch(true);
    setAnysearchTestMsg({ ok: true, text: '正在测试 AnySearch（最长约 40 秒）…' });
    try {
      const result = await testAnysearchApiKey();
      setAnysearchTestMsg({ ok: result.success, text: result.message });
    } catch (e: any) {
      setAnysearchTestMsg({ ok: false, text: `AnySearch 测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingAnysearch(false);
    }
  };

  const persistTavilyKeys = (keys: string[]) => {
    const cleaned = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    setTavilyKeys(cleaned);
    setTavilyKeyPool(cleaned);
  };

  const handleAddTavilyKey = () => {
    const k = tavilyDraftKey.trim();
    if (!k) {
      setTavilyTestMsg({ ok: false, text: '请先粘贴一把 tvly- Key' });
      return;
    }
    if (tavilyKeys.includes(k)) {
      setTavilyTestMsg({ ok: false, text: '该 Key 已在池中' });
      return;
    }
    persistTavilyKeys([...tavilyKeys, k]);
    setTavilyDraftKey('');
    setTavilyTestMsg({ ok: true, text: `已加入 Key 池（共 ${tavilyKeys.length + 1} 把）` });
  };

  const handleRemoveTavilyKey = (key: string) => {
    persistTavilyKeys(tavilyKeys.filter((k) => k !== key));
  };

  const handleTestTavily = async () => {
    if (isTestingTavily) return;
    if (tavilyDraftKey.trim() && !tavilyKeys.includes(tavilyDraftKey.trim())) {
      persistTavilyKeys([...tavilyKeys, tavilyDraftKey.trim()]);
      setTavilyDraftKey('');
    }
    if (!listTavilyKeys().length) {
      setTavilyTestMsg({ ok: false, text: '请先添加至少一把 Tavily API Key' });
      return;
    }
    setIsTestingTavily(true);
    setTavilyTestMsg({ ok: true, text: '正在测试 Key 池…' });
    try {
      const result = await testTavilyKeyPool();
      setTavilyTestMsg({ ok: result.success, text: result.message });
      setTavilyKeys(listTavilyKeys());
    } catch (e: any) {
      setTavilyTestMsg({ ok: false, text: `Tavily 测试异常: ${e?.message || String(e)}` });
    } finally {
      setIsTestingTavily(false);
    }
  };

  const handleTestApi = async (api: ApiConfig) => {
    if (testingApiId) return;
    if (!api.apiKey?.trim()) {
      setSaveConfigMsg({ ok: false, text: '请先填写 API Key' });
      return;
    }
    setTestingApiId(api.id);
    try {
      const baseUrl = api.baseUrl?.includes('generativelanguage.googleapis.com') ? 'native' : api.baseUrl;
      const result = await testApiKey(api.apiKey, baseUrl, api.modelId);
      setSaveConfigMsg({ ok: result.success, text: result.message });
    } catch (e: any) {
      setSaveConfigMsg({ ok: false, text: `API 测试异常: ${e?.message || String(e)}` });
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

  const handleDeleteUser = async (username: string) => {
    if (username === 'admin') return;
    if (confirm(`确定要删除用户 ${username} 吗？`)) {
      const next = users.filter(u => u.username !== username);
      setUsers(next);
      await persistUsers(next);
    }
  };

  const handleAddUser = () => setAddUserOpen(true);

  const handleResetPassword = (username: string) => {
    setResetPwdUser(username);
    setResetPwdValue('');
    setResetPwdMsg(null);
  };

  const submitResetPassword = async () => {
    if (!resetPwdUser || isResettingPwd) return;
    const pwd = resetPwdValue.trim();
    if (pwd.length < 6) {
      setResetPwdMsg('密码至少需要 6 位');
      return;
    }
    setIsResettingPwd(true);
    setResetPwdMsg(null);
    try {
      const hashed = await hashPassword(pwd);
      const next = updateUserPassword(users, resetPwdUser, hashed);
      setUsers(next);
      await persistUsers(next, Date.now(), departments);
      setResetPwdMsg(`已重置 ${resetPwdUser} 的密码（本机已保存，云端后台同步）`);
      window.setTimeout(() => {
        setResetPwdUser(null);
        setResetPwdValue('');
        setResetPwdMsg(null);
      }, 900);
    } catch (e: any) {
      setResetPwdMsg(`重置失败：${e?.message || String(e)}`);
    } finally {
      setIsResettingPwd(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      let localCount = 0;
      let cloudCount = 0;
      const cloudErrors: string[] = [];

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

        // 本地优先：云端挂了也不丢文件
        await saveFileToDB(newFile);
        localCount++;

        if (isSupabaseConfigured()) {
          const saved = await saveKnowledgeFile(newFile);
          if (saved.ok) cloudCount++;
          else cloudErrors.push(`${file.name}: ${saved.error || '未知错误'}`);
        }
      }

      const allFiles = await getAllFilesFromDB();
      setKbFiles(allFiles);

      if (!isSupabaseConfigured()) {
        alert(`已保存 ${localCount} 个文件到本地。未配置 Supabase，无法同步云端。`);
      } else if (cloudCount === localCount) {
        alert(`已成功保存 ${localCount} 个文件（本地 + Supabase 云端）`);
      } else {
        setKbCloudError(cloudErrors.join('\n') || '云端同步失败');
        alert(
          `已保存 ${localCount} 个到本地；云端成功 ${cloudCount} 个。\n` +
          `云端失败原因：${cloudErrors[0] || '请检查 Supabase 项目是否暂停/删除'}\n` +
          `提示：请确认 .env.local 中的 URL 对应的项目仍在 dashboard.supabase.com 可打开。`
        );
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
      const saved = await saveKnowledgeFile(newFile);
      if (!saved.ok) {
        alert(`链接已保存到本地；云端同步失败：${saved.error}`);
      } else {
        alert('YouTube 链接已添加（本地 + 云端）');
      }
    } else {
      alert('YouTube 链接已保存到本地（Supabase 未配置）');
    }
    const allFiles = await getAllFilesFromDB();
    setKbFiles(allFiles);
    setYtLink('');
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
    <div className="min-h-screen min-h-[100dvh] bg-[#F0F2F5] flex flex-col">
      {/* Header */}
      <header className="bg-[#0F172A] text-white px-4 sm:px-8 py-3 sm:py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Shield size={22} className="sm:w-6 sm:h-6" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black tracking-tight">管理员控制台</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Management</p>
          </div>
        </div>
        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
          <div className="text-sm font-bold truncate">
            当前登录: <span className="text-blue-400">{currentUser.username}</span>
          </div>
          <button 
            onClick={onLogout}
            className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-black flex items-center gap-2 transition-all touch-manipulation flex-shrink-0"
          >
            <LogOut size={16} /> 退出登录
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full">
        <div className="bg-white rounded-2xl sm:rounded-[32px] shadow-xl overflow-hidden border border-white">
          {/* Tabs */}
          <div className="flex border-b bg-slate-50/50 overflow-x-auto scrollbar-hide">
            {([
              { id: 'api' as AdminTab, label: 'API 密钥配置', short: 'API', icon: Key },
              { id: 'org' as AdminTab, label: '组织权限', short: '组织', icon: Building2 },
              { id: 'users' as AdminTab, label: '用户列表', short: '用户', icon: Users },
              { id: 'kb' as AdminTab, label: '知识库', short: '知识库', icon: Database },
            ]).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 min-w-[120px] py-4 sm:py-6 px-3 sm:px-4 flex items-center justify-center gap-2 font-black text-xs sm:text-sm transition-all border-b-4 whitespace-nowrap touch-manipulation ${activeTab === tab.id ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                <tab.icon size={18} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.short}</span>
              </button>
            ))}
          </div>

          <div className="p-4 sm:p-6 md:p-10">
            {activeTab === 'api' && (
              <div className="space-y-8 animate-fade-in">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h3 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
                      <Key className="text-blue-600" /> API 与模型路由
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-400 font-bold mt-1">
                      Gemini 官方 Key + 千问 Key；可按「搜索 / 背调 / 整理」分别选择引擎。决策人挖掘与图片生成配置不变。
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleSaveApiConfigs}
                    disabled={isSavingConfigs}
                    className="bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white px-4 sm:px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2 shadow-lg touch-manipulation"
                  >
                    {isSavingConfigs ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                    {isSavingConfigs ? '保存中…' : '保存配置'}
                  </button>
                  </div>
                </div>
                {saveConfigMsg && (
                  <p className={`text-xs font-bold ${saveConfigMsg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {saveConfigMsg.text}
                  </p>
                )}

                {/* Task routing */}
                <div className="bg-violet-50/60 border border-violet-100 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-violet-800 font-black text-sm">
                    <Settings size={16} /> 任务模型路由（搜索 / 背调 / 整理）
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    当前已<strong>强制全链路千问</strong>（搜索/背调/整理）。Gemini 可用后，在控制台执行 localStorage.setItem('trade_scout_force_qwen','0') 再按需切换。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(
                      [
                        { key: 'search' as const, label: '客户搜索', hint: '自动化 / 客户搜索模块' },
                        { key: 'analysis' as const, label: '背调分析', hint: '单次/批量背景调查' },
                        { key: 'organize' as const, label: '资料整理', hint: '开发信、关键词、策略对话' },
                      ] as const
                    ).map((row) => (
                      <div key={row.key} className="bg-white rounded-xl border border-violet-100 p-4">
                        <div className="text-sm font-black text-slate-800">{row.label}</div>
                        <div className="text-[10px] text-slate-400 font-bold mt-0.5 mb-3">{row.hint}</div>
                        <select
                          value={taskAIModels[row.key]}
                          onChange={(e) => patchTaskAI(row.key, e.target.value as AIEngineChoice)}
                          className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5 font-bold text-sm"
                        >
                          <option value="gemini">Gemini（Google 联网）</option>
                          <option value="qwen">千问 Qwen</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Gemini official */}
                <div className="bg-sky-50/50 border border-sky-100 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-sky-800 font-black text-sm">
                      <Globe size={16} /> Gemini 官方 API（Google AI Studio）
                    </div>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-black text-sky-700 underline"
                    >
                      获取 API Key
                    </a>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    支持 AIza / AQ. Auth Key。经同域代理只用 x-goog-api-key。若测试报
                    ACCESS_TOKEN_TYPE_UNSUPPORTED：到{' '}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-700 underline"
                    >
                      AI Studio
                    </a>{' '}
                    新建 Key（旧 Key 若曾泄露会被 Google 自动吊销），只粘贴到下方，并确认项目已结算。用量见{' '}
                    <a
                      href="https://aistudio.google.com/usage"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-700 underline"
                    >
                      Usage
                    </a>
                    。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                        Gemini API Key
                      </label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={geminiApiKey}
                        onChange={(e) => setGeminiApiKey(e.target.value)}
                        placeholder="AIza... 或 AQ...."
                        className="w-full bg-white border border-sky-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                        模型 ID
                      </label>
                      <input
                        type="text"
                        value={geminiModelId}
                        onChange={(e) => setGeminiModelId(e.target.value)}
                        placeholder="gemini-2.0-flash / gemini-1.5-pro"
                        className="w-full bg-white border border-sky-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => void handleTestGemini()}
                        disabled={isTestingGemini}
                        className="w-full bg-sky-600 hover:bg-sky-700 text-white px-5 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isTestingGemini ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                        测试 Gemini 连接
                      </button>
                    </div>
                  </div>
                  {geminiTestMsg && (
                    <p className={`text-xs font-bold ${geminiTestMsg.ok ? 'text-sky-800' : 'text-rose-600'}`}>
                      {geminiTestMsg.text}
                    </p>
                  )}
                </div>

                {/* Qwen + Supabase */}
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-800 font-black text-sm">
                      <Database size={16} /> 千问 / Supabase 配置（国内大模型）
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black ${supabaseReady ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {supabaseReady ? 'Supabase 已连接' : 'Supabase 未配置'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    <div className="flex items-end text-[10px] font-bold text-slate-400 pb-2">
                      引擎选择请到上方「任务模型路由」设置
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Supabase Project URL</label>
                      <input
                        type="text"
                        value={supabaseUrl}
                        onChange={e => setSupabaseUrl(e.target.value)}
                        placeholder="https://xxx.supabase.co"
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Supabase Anon Key</label>
                      <input
                        type="password"
                        value={supabaseAnonKey}
                        onChange={e => setSupabaseAnonKey(e.target.value)}
                        placeholder="eyJhbGciOiJIUzI1NiIs..."
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                      <p className="text-[10px] text-slate-400 font-bold mt-2">
                        Cursor 本地开发：在项目根目录 .env.local 中配置即可自动连接。此处仅用于手动覆盖。
                      </p>
                    </div>
                    <div className="md:col-span-2 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={handleResetSupabaseOverride}
                        className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-6 py-3 rounded-xl font-black"
                      >
                        恢复默认配置
                      </button>
                      <button
                        onClick={handleSaveSupabaseConfig}
                        className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-3 rounded-xl font-black flex items-center gap-2"
                      >
                        <Save size={16} /> 保存 Supabase 连接
                      </button>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Qwen API Key</label>
                      <input
                        type="password"
                        value={qwenApiKey}
                        onChange={e => setQwenApiKey(e.target.value)}
                        placeholder="sk-sp-...（Token Plan）或 sk-ws-...（工作空间）"
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">API Base URL（OpenAI 兼容地址）</label>
                      <input
                        type="text"
                        value={qwenBaseUrl}
                        onChange={e => setQwenBaseUrl(e.target.value)}
                        placeholder="https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                        className="w-full bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                      <p className="text-[10px] text-slate-400 font-bold mt-2">
                        必须完整填到 /compatible-mode/v1，Key 用 sk-sp-。本地若报 ENOTFOUND：把电脑 DNS 改为 223.5.5.5 后重启 npm run dev。
                      </p>
                    </div>
                  </div>

                  {/* 长时中转：解决线上 HTTP 546 */}
                  <div className="mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
                    <div className="text-xs font-black text-amber-900">千问联网中转</div>
                    <p className="text-[10px] text-amber-800/80 font-bold leading-relaxed">
                      保持「自动」即可：本机走本地代理，线上自动走网站同域接口。一般不用改。
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">中转模式</label>
                        <select
                          value={aliyunProxyMode}
                          onChange={(e) => setAliyunProxyModeState(e.target.value as AliyunProxyMode)}
                          className="w-full bg-white border border-amber-100 rounded-xl px-3 py-2.5 text-sm font-bold"
                        >
                          <option value="auto">自动（推荐，勿改）</option>
                          <option value="same-origin">强制同域接口</option>
                          <option value="custom">自定义中转（高级）</option>
                          <option value="supabase">仅 Supabase（不推荐）</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">自定义中转根地址</label>
                        <input
                          type="text"
                          value={aliyunProxyBase}
                          onChange={(e) => setAliyunProxyBaseState(e.target.value)}
                          placeholder="仅「自定义」模式需要填写"
                          className="w-full bg-white border border-amber-100 rounded-xl px-3 py-2.5 text-sm font-bold"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleSaveAliyunProxy}
                        className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-xl text-xs font-black"
                      >
                        保存
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-end gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => handleTestQwen(false)}
                      disabled={isTestingQwen}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isTestingQwen ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      测试连接
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTestQwen(true)}
                      disabled={isTestingQwen}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isTestingQwen ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                      测试联网搜索
                    </button>
                  </div>
                  {qwenTestMsg && (
                    <p className={`text-xs font-bold mt-3 ${qwenTestMsg.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {qwenTestMsg.text}
                    </p>
                  )}
                </div>

                {/* 万相图片生成 */}
                <div className="bg-pink-50/50 border border-pink-100 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-pink-800 font-black text-sm">
                    <Image size={16} /> 万相图片生成（wan2.7-image）
                  </div>
                  <p className="text-xs text-slate-500 font-medium">
                    与上方千问共用同一把 Token Plan Key（sk-sp-）和域名 token-plan.cn-beijing.maas.aliyuncs.com。
                    Key 留空则自动用千问 Key。若千问已通而万相仍 401，请到阿里云控制台确认套餐已开通 wan2.7-image。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">万相 API Key（可选）</label>
                      <input
                        type="password"
                        value={wanApiKey}
                        onChange={e => setWanApiKey(e.target.value)}
                        placeholder="留空则与千问共用 sk-sp-... Key"
                        className="w-full bg-white border border-pink-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">万相 API Origin / Base</label>
                      <input
                        type="text"
                        value={wanBaseUrl}
                        onChange={e => setWanBaseUrl(e.target.value)}
                        placeholder="https://token-plan.cn-beijing.maas.aliyuncs.com"
                        className="w-full bg-white border border-pink-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">模型 ID</label>
                      <input
                        type="text"
                        value={wanModelId}
                        onChange={e => setWanModelId(e.target.value)}
                        placeholder="wan2.7-image"
                        className="w-full bg-white border border-pink-100 rounded-xl px-4 py-3 font-bold text-sm"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleTestWan}
                        disabled={isTestingWan}
                        className="w-full bg-pink-600 hover:bg-pink-700 text-white px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isTestingWan ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                        测试万相生图
                      </button>
                    </div>
                  </div>
                  {wanTestMsg && (
                    <p className={`text-xs font-bold mt-3 ${wanTestMsg.ok ? 'text-pink-700' : 'text-rose-600'}`}>
                      {wanTestMsg.text}
                    </p>
                  )}
                </div>

                {/* 第三方邮箱搜索 API */}
                <div className="bg-violet-50/50 border border-violet-100 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-violet-800 font-black text-sm">
                    <Mail size={16} /> 第三方邮箱搜索 API
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    决策人邮箱优先用 AnymailFinder「公司域名搜索」（1 积分最多 20 个已验证邮箱）；若 Anymail 未找到任何联系人，再自动回退 Hunter.io。Hunter 额度用尽时静默跳过、不报错。Findymail 仅作可选补充。结果会标注来源与是否已验证。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Hunter.io API Key（Anymail 无结果时回退）</label>
                      <input
                        type="password"
                        value={hunterApiKey}
                        onChange={e => setHunterApiKey(e.target.value)}
                        placeholder="hunter.io 控制台获取"
                        className="w-full bg-white border border-violet-100 rounded-xl px-4 py-3 font-bold text-sm text-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Findymail API Key（可选补充）</label>
                      <input
                        type="password"
                        value={findymailApiKey}
                        onChange={e => setFindymailApiKey(e.target.value)}
                        placeholder="app.findymail.com"
                        className="w-full bg-white border border-violet-100 rounded-xl px-4 py-3 font-bold text-sm text-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">AnymailFinder API Key（主用）</label>
                      <input
                        type="password"
                        value={anymailFinderApiKey}
                        onChange={e => setAnymailFinderApiKey(e.target.value)}
                        placeholder="anymailfinder.com"
                        className="w-full bg-white border border-violet-100 rounded-xl px-4 py-3 font-bold text-sm text-slate-950"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleTestHunter}
                      disabled={isTestingHunter}
                      className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isTestingHunter ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      测试 Hunter.io
                    </button>
                    <button
                      type="button"
                      onClick={handleTestAnymail}
                      disabled={isTestingAnymail}
                      className="bg-violet-600 hover:bg-violet-700 text-white px-5 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isTestingAnymail ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      测试 AnymailFinder
                    </button>
                  </div>
                  {hunterTestMsg && (
                    <p className={`text-xs font-bold mt-2 ${hunterTestMsg.ok ? 'text-slate-700' : 'text-rose-600'}`}>
                      {hunterTestMsg.text}
                    </p>
                  )}
                  {anymailTestMsg && (
                    <p className={`text-xs font-bold mt-2 ${anymailTestMsg.ok ? 'text-violet-700' : 'text-rose-600'}`}>
                      {anymailTestMsg.text}
                    </p>
                  )}
                </div>

                <div className="bg-cyan-50/40 border border-cyan-100 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center gap-2 text-cyan-800 font-black text-sm">
                    <Globe size={16} /> AnySearch 背调身份补全
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    背调前自动抽取官网（extract）并并行检索总部线索（batch_search）。Key 与 Hunter/千问一样：本机缓存 + Supabase 加密存储，登录时自动同步，线上全员可用。请求经同域代理转发，勿把 Key 提交到 Git。
                  </p>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                      AnySearch API Key（as_sk_...）
                    </label>
                    <input
                      type="password"
                      autoComplete="off"
                      value={anysearchApiKey}
                      onChange={(e) => setAnysearchApiKey(e.target.value)}
                      placeholder="https://anysearch.com/console/api-keys"
                      className="w-full bg-white border border-cyan-100 rounded-xl px-4 py-3 font-bold text-sm text-slate-950"
                    />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleTestAnysearch}
                      disabled={isTestingAnysearch}
                      className="bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isTestingAnysearch ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      测试 AnySearch
                    </button>
                  </div>
                  {anysearchTestMsg && (
                    <p className={`text-xs font-bold ${anysearchTestMsg.ok ? 'text-cyan-800' : 'text-rose-600'}`}>
                      {anysearchTestMsg.text}
                    </p>
                  )}
                </div>

                <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-6 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-emerald-800 font-black text-sm">
                      <Globe size={16} /> Tavily Key 池（多账号额度轮换）
                    </div>
                    <a
                      href="https://app.tavily.com/home"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-black text-emerald-700 underline"
                    >
                      获取 API Key
                    </a>
                  </div>
                  <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                    可添加多把 tvly Key（例如 5×1000=5000 月积分）。某把额度用尽会自动切下一把；全部用尽后搜索/背调回退千问联网。Key 仅存本机/云端，勿提交 Git。
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      value={tavilyDraftKey}
                      onChange={(e) => setTavilyDraftKey(e.target.value)}
                      placeholder="粘贴 tvly-dev-... 后点添加"
                      className="flex-1 bg-white border border-emerald-100 rounded-xl px-4 py-3 font-bold text-sm text-slate-950"
                    />
                    <button
                      type="button"
                      onClick={handleAddTavilyKey}
                      className="bg-white border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl font-black flex items-center gap-1"
                    >
                      <Plus size={16} /> 添加
                    </button>
                  </div>
                  {tavilyKeys.length > 0 ? (
                    <ul className="space-y-2">
                      {tavilyKeys.map((k) => {
                        const st = getTavilyKeyStatuses().find((s) => s.key === k);
                        return (
                          <li
                            key={k}
                            className="flex items-center justify-between gap-2 bg-white border border-emerald-50 rounded-xl px-3 py-2"
                          >
                            <div className="text-xs font-bold text-slate-700 truncate">
                              {st?.label || k.slice(0, 12)}
                              {st?.active ? (
                                <span className="ml-2 text-emerald-600">使用中</span>
                              ) : null}
                              {st?.exhausted ? (
                                <span className="ml-2 text-rose-500">本月已耗尽</span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveTavilyKey(k)}
                              className="text-rose-500 hover:text-rose-700 p-1"
                              title="移除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-400 font-bold">尚未添加 Key</p>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        clearTavilyExhausted();
                        setTavilyTestMsg({ ok: true, text: '已清除本月「耗尽」标记，将重新尝试全部 Key' });
                        setTavilyKeys(listTavilyKeys());
                      }}
                      className="bg-white border border-slate-200 text-slate-600 px-4 py-3 rounded-xl font-bold text-xs"
                    >
                      重置耗尽标记
                    </button>
                    <button
                      type="button"
                      onClick={handleTestTavily}
                      disabled={isTestingTavily}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-black flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isTestingTavily ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
                      测试 Key 池
                    </button>
                  </div>
                  {tavilyTestMsg && (
                    <p className={`text-xs font-bold whitespace-pre-wrap ${tavilyTestMsg.ok ? 'text-emerald-800' : 'text-rose-600'}`}>
                      {tavilyTestMsg.text}
                    </p>
                  )}
                </div>

{/* Recommended Sources + API pool removed: use Gemini official + Qwen sections above */}
              </div>
            )}

            {activeTab === 'org' && (
              <OrgPermissionPanel
                currentUser={currentUser}
                users={users}
                setUsers={setUsers}
                departments={departments}
                setDepartments={setDepartments}
                mode="admin"
              />
            )}

            {activeTab === 'users' && (
              <div className="space-y-4 sm:space-y-8 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <h3 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
                    <Users className="text-blue-600" /> 系统用户管理
                  </h3>
                  <button onClick={handleAddUser} className="bg-blue-600 hover:bg-blue-700 text-white px-4 sm:px-6 py-3 rounded-xl font-black flex items-center justify-center gap-2 shadow-lg shadow-blue-100 touch-manipulation w-full sm:w-auto">
                    <Plus size={20} /> 添加用户
                  </button>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {users.map(user => (
                    <div key={user.username} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="font-black text-slate-800">{user.username}</div>
                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : user.role === 'director' ? 'bg-cyan-100 text-cyan-700' : user.role === 'manager' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                          {roleLabel(user.role)}
                        </span>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => handleResetPassword(user.username)} className="flex-1 text-center py-2 rounded-xl bg-blue-50 text-blue-600 text-xs font-black touch-manipulation">
                          重置密码
                        </button>
                        {user.username !== 'admin' && (
                          <button onClick={() => handleDeleteUser(user.username)} className="px-4 py-2 rounded-xl bg-red-50 text-red-500 touch-manipulation">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden md:block bg-white border border-slate-100 rounded-2xl sm:rounded-[32px] overflow-hidden shadow-sm overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[480px]">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-slate-100">
                        <th className="px-4 lg:px-8 py-4 lg:py-6 text-xs font-black text-slate-400 uppercase tracking-widest">用户名</th>
                        <th className="px-4 lg:px-8 py-4 lg:py-6 text-xs font-black text-slate-400 uppercase tracking-widest">角色</th>
                        <th className="px-4 lg:px-8 py-4 lg:py-6 text-xs font-black text-slate-400 uppercase tracking-widest text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.username} className="border-b border-slate-50 last:border-none hover:bg-slate-50/30 transition-all">
                          <td className="px-4 lg:px-8 py-4 lg:py-6 font-black text-slate-800">{user.username}</td>
                          <td className="px-4 lg:px-8 py-4 lg:py-6">
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : user.role === 'director' ? 'bg-cyan-100 text-cyan-700' : user.role === 'manager' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                              {roleLabel(user.role)}
                            </span>
                          </td>
                          <td className="px-4 lg:px-8 py-4 lg:py-6 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleResetPassword(user.username)}
                                className="text-slate-400 hover:text-blue-600 transition-all text-[10px] font-black uppercase touch-manipulation"
                              >
                                重置密码
                              </button>
                              {user.username !== 'admin' && (
                                <button onClick={() => handleDeleteUser(user.username)} className="text-slate-300 hover:text-red-500 transition-all touch-manipulation">
                                  <Trash2 size={18} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'kb' && (
              <div className="space-y-4 sm:space-y-8 animate-fade-in">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl sm:text-2xl font-black text-slate-800 flex items-center gap-2">
                    <Database className="text-blue-600" /> 知识库管理
                  </h3>
                </div>

                <div className="bg-white border border-slate-100 rounded-2xl sm:rounded-[32px] p-4 sm:p-6 md:p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-slate-800 font-black">
                      <Database size={18} className="text-emerald-600" /> SUPABASE 云端知识库
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black ${
                      supabaseLiveOk === true ? 'bg-green-100 text-green-700' :
                      supabaseLiveOk === false ? 'bg-red-100 text-red-700' :
                      supabaseReady ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {supabaseLiveOk === true ? '云端在线' :
                       supabaseLiveOk === false ? '云端不可用' :
                       supabaseReady ? '仅配置凭证' : '未配置'}
                    </span>
                  </div>
                  {kbCloudError && (
                    <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-100 text-xs font-bold text-red-600 whitespace-pre-wrap">
                      云端同步异常：{kbCloudError}
                      <div className="mt-1 text-red-400 font-medium">
                        文件仍会保存在本机 IndexedDB。请到 Supabase Dashboard 确认项目是否仍存在；若已重建项目，请更新 .env.local 中的 URL/Key，并执行 scripts/supabase-schema.sql。
                      </div>
                    </div>
                  )}
                  <p className="text-sm text-slate-500 font-medium mb-4">
                    上传优先保存到本机；云端可用时自动同步。支持 Word、Excel、PPT、PDF、图片、音频、视频等格式。
                    {supabaseLiveMsg ? `（${supabaseLiveMsg}）` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-400">
                    {['PDF', 'Word', 'Excel', 'PPT', '图片', '音频', '视频', 'TXT/MD'].map(tag => (
                      <span key={tag} className="bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">{tag}</span>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 sm:space-y-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div className="text-base sm:text-lg font-black text-slate-800">
                      知识库文件: <span className="text-blue-600">{kbFiles.length}</span>
                      <span className="ml-2 text-xs font-bold text-slate-400">（本地缓存；云端在线时自动同步）</span>
                    </div>
                    <label 
                      htmlFor="kb-upload-input"
                      className={`bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 cursor-pointer transition-all touch-manipulation w-full sm:w-auto ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {isUploading ? '上传中...' : '上传文件'}
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
                  <div className="bg-slate-50 p-4 sm:p-6 rounded-2xl border border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                    <div className="bg-red-100 text-red-600 p-3 rounded-xl self-start sm:self-center flex-shrink-0">
                      <Youtube size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <input 
                        type="text" 
                        placeholder="粘贴 YouTube 视频链接..." 
                        value={ytLink}
                        onChange={e => setYtLink(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none"
                      />
                    </div>
                    <button 
                      onClick={handleAddYoutube}
                      className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-xl font-black text-xs transition-all touch-manipulation w-full sm:w-auto"
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

      <AddUserModal
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        users={users}
        departments={departments}
        allowRolePick
        onCreated={({ users: next, created }) => {
          setUsers(next);
          setSaveConfigMsg({ ok: true, text: `用户 ${created.username} 已创建（本机已保存，云端后台同步）` });
        }}
      />

      {resetPwdUser && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-black text-slate-800">重置密码 · {resetPwdUser}</h3>
            <input
              type="password"
              value={resetPwdValue}
              onChange={(e) => setResetPwdValue(e.target.value)}
              placeholder="新密码（至少 6 位）"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitResetPassword();
              }}
            />
            {resetPwdMsg && (
              <p className={`text-xs font-bold ${resetPwdMsg.includes('失败') || resetPwdMsg.includes('至少') ? 'text-rose-600' : 'text-emerald-700'}`}>
                {resetPwdMsg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isResettingPwd}
                onClick={() => {
                  setResetPwdUser(null);
                  setResetPwdValue('');
                  setResetPwdMsg(null);
                }}
                className="rounded-xl px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isResettingPwd}
                onClick={() => void submitResetPassword()}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-black text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {isResettingPwd ? '保存中…' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
