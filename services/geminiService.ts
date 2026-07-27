
import { GoogleGenAI, Type, Part } from "@google/genai";
import { AnalysisResult, ClientSearchResult, DecisionMaker, ChatMessage, KnowledgeFile, KeywordExtractionResult, MailGroup, EmailTemplateRequest, ApiConfig, TaskType } from "../types";
import { getAllFilesFromDB } from "./db";
import { getApiConfig as getSupabaseApiConfig, getAllApiConfigs, isSupabaseConfigured } from './supabase';
import {
  buildAliyunFetchHeaders,
  buildAnymailFetchHeaders,
  isAppHostedQwenProxy,
  isDomesticAliyunUrl,
  isLocalDevHost,
  isSupabaseQwenProxyUrl,
  qwenCorsHint,
  resolveAnymailUrl,
  resolveQwenRequestTarget,
  DEFAULT_TOKEN_PLAN_ORIGIN,
} from './qwenProxy';
import { env, getEmailSearchKeys } from './env';

const NATIVE_MODEL = 'gemini-3-pro-preview';

const WEB_SEARCH_TASKS: TaskType[] = ['search', 'analysis'];

const TASK_TIMEOUT_MS: Partial<Record<TaskType, number>> = {
  // 联网搜索拉客户列表常需 2–4 分钟，后台短测能过但前端重任务会超时
  search: 300_000,
  analysis: 360_000,
  email: 180_000,
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 120_000
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）。请检查网络或稍后重试。`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// CORS Proxy Fallbacks (Expanded for China/Firewall bypass)
// NOTE: Public proxies are unreliable. The best solution is always a paid Relay (HiAPI, OpenRouter, etc.)
const PROXY_LADDER = [
    '', // 1. Direct Connection (Best for Localhost/VPN)
    'https://corsproxy.io/?', // 2. Most stable public proxy
    'https://api.allorigins.win/raw?url=', // 3. Backup
    'https://thingproxy.freeboard.io/fetch/', // 4. Backup
];

const SYSTEM_INSTRUCTION = `
You are "楠哥的小助理" (Nan Ge's Assistant), an elite Foreign Trade Intelligence Agent.
Your goal is to provide deep, actionable insights for Chinese export suppliers.
You MUST use 联网搜索 (web search) to find REAL, CURRENT information about companies, websites, and markets.
DO NOT hallucinate. If data is unavailable, say "公开信息未找到".

LANGUAGE REQUIREMENT:
All descriptive text MUST be in SIMPLIFIED CHINESE (简体中文). 
Do NOT use English for descriptions unless it is a proper noun (like a specific company name or product model).
Structure the report professionally in Chinese.
`;

const QWEN_SYSTEM = '你是外贸客户开发专家「楠哥的小助理」，擅长背景调查、客户搜索和开发信撰写。请使用联网搜索获取真实最新信息。所有输出使用简体中文。';

/** forced_search 会显著拖慢大任务，仅在明确要求时开启 */
const qwenSearchPayload = (
  enableSearch: boolean,
  forced = false
): Record<string, unknown> | undefined => {
  if (!enableSearch) return undefined;
  if (forced) {
    return { enable_search: true, search_options: { forced_search: true } };
  }
  return { enable_search: true };
};

const isDomesticQwenEndpoint = (url: string): boolean => isDomesticAliyunUrl(url);

/** 清理 API Key：去空格、零宽字符、Bearer 前缀 */
export const sanitizeApiKey = (key: string): string =>
  (key || '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();

const describeKey = (key: string): string => {
  const k = sanitizeApiKey(key);
  if (!k) return '空';
  const kind = k.startsWith('sk-sp-') ? 'Token Plan (sk-sp-)' : k.startsWith('sk-ws-') ? '工作空间 (sk-ws-)' : k.startsWith('sk-') ? '通用/其他 (sk-)' : '未知格式';
  return `${kind}, 长度 ${k.length}`;
};

export interface TaskTypeAssignment {
    task: TaskType;
}

const extractJson = (text: string, isArray: boolean = false): any => {
  if (!text) return isArray ? [] : {};
  try {
    const startChar = isArray ? '[' : '{';
    const endChar = isArray ? ']' : '}';
    const firstOpen = text.indexOf(startChar);
    const lastClose = text.lastIndexOf(endChar);
    if (firstOpen !== -1 && lastClose !== -1 && lastClose > firstOpen) {
      const jsonCandidate = text.substring(firstOpen, lastClose + 1);
      return JSON.parse(jsonCandidate);
    }
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("JSON Extraction Error:", e);
    return isArray ? [] : {};
  }
};

const cleanDomain = (domain: string) => domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split('/')[0];

// --- External APIs ---
const fetchHunterEmails = async (domain: string): Promise<{ people: DecisionMaker[], pattern: string | null }> => {
    const HUNTER_API_KEY = getEmailSearchKeys().hunter;
    if (!domain || !HUNTER_API_KEY) return { people: [], pattern: null };
    try {
        const url = `https://api.hunter.io/v2/domain-search?domain=${cleanDomain(domain)}&api_key=${HUNTER_API_KEY}&limit=20`;
        const response = await fetch(url);
        const data = await response.json();
        const pattern = data.data?.pattern || null;
        if (data.data && data.data.emails) {
            const people = data.data.emails.map((e: any) => ({
                name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Professional',
                firstName: e.first_name,
                lastName: e.last_name,
                title: e.position || 'Employee',
                emailGuess: e.value,
                linkedin: e.linkedin,
                type: (e.position?.toLowerCase().match(/ceo|founder|owner|president/) ? 'CEO' : e.position?.toLowerCase().match(/buyer|procurement|purchasing|sourcing|manager/) ? 'Buyer' : 'Other'),
                source: 'Hunter.io',
                isVerified: e.confidence > 85, // More strict
                confidence: e.confidence / 100
            }));
            return { people, pattern };
        }
    } catch (error) { console.error("Hunter API Error", error); }
    return { people: [], pattern: null };
};

const findEmailWithHunter = async (firstName: string, lastName: string, domain: string): Promise<{ email: string, confidence: number } | null> => {
    const HUNTER_API_KEY = getEmailSearchKeys().hunter;
    if (!HUNTER_API_KEY || !domain || !firstName) return null;
    try {
        const url = `https://api.hunter.io/v2/email-finder?domain=${cleanDomain(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName || '')}&api_key=${HUNTER_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.data && data.data.email) {
            return { email: data.data.email, confidence: data.data.score / 100 };
        }
    } catch (e) { console.error("Hunter Email Finder Error", e); }
    return null;
};

const findEmailWithFindymail = async (name: string, domain: string): Promise<{ email: string, isVerified: boolean } | null> => {
    const FINDYMAIL_API_KEY = getEmailSearchKeys().findymail;
    if (!FINDYMAIL_API_KEY || !domain || !name) return null;
    try {
        const url = `https://app.findymail.com/api/search/name?domain=${cleanDomain(domain)}&name=${encodeURIComponent(name)}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${FINDYMAIL_API_KEY}` }
        });
        const data = await response.json();
        if (data.email) {
            return { email: data.email, isVerified: data.status === 'valid' };
        }
    } catch (e) { console.error("Findymail Search Error", e); }
    return null;
};

const fetchFindymail = async (domain: string): Promise<DecisionMaker[]> => {
    const FINDYMAIL_API_KEY = getEmailSearchKeys().findymail;
    if (!domain || !FINDYMAIL_API_KEY) return [];
    try {
        const response = await fetch(`https://app.findymail.com/api/search/domain?domain=${cleanDomain(domain)}`, {
            headers: { 'Authorization': `Bearer ${FINDYMAIL_API_KEY}` }
        });
        const data = await response.json();
        if (data.emails && Array.isArray(data.emails)) {
            return data.emails.map((e: any) => ({
                name: e.name || 'Contact',
                title: e.job_title || 'Manager',
                emailGuess: e.email,
                linkedin: e.linkedin,
                type: (e.job_title?.toLowerCase().match(/ceo|founder|owner/) ? 'CEO' : e.job_title?.toLowerCase().match(/buyer|procurement|purchasing/) ? 'Buyer' : 'Other'),
                source: 'Findymail',
                isVerified: e.status === 'valid'
            }));
        }
    } catch (e) { console.error("Findymail Error", e); }
    return [];
};

const classifyDecisionMakerType = (title: string): 'CEO' | 'Buyer' | 'Other' => {
  const t = (title || '').toLowerCase();
  if (/ceo|founder|owner|president|managing director|md\b|总经理|创始/.test(t)) return 'CEO';
  if (/buyer|procurement|purchasing|sourcing|category|merchandis|采购|买手|供应链/.test(t)) return 'Buyer';
  return 'Other';
};

const rankDecisionMakers = (list: DecisionMaker[]): DecisionMaker[] => {
  const typeWeight = (t: DecisionMaker['type']) => (t === 'Buyer' ? 3 : t === 'CEO' ? 2 : 1);
  return [...list].sort((a, b) => {
    const scoreA = (a.influenceScore || typeWeight(a.type)) + (a.isVerified ? 1 : 0) + (a.emailGuess ? 0.5 : 0) + (a.linkedin ? 0.3 : 0);
    const scoreB = (b.influenceScore || typeWeight(b.type)) + (b.isVerified ? 1 : 0) + (b.emailGuess ? 0.5 : 0) + (b.linkedin ? 0.3 : 0);
    return scoreB - scoreA;
  });
};

const anymailFetch = async (path: string, apiKey: string, body: unknown): Promise<Response> => {
  const { url } = resolveAnymailUrl(path);
  return fetch(url, {
    method: 'POST',
    headers: buildAnymailFetchHeaders(apiKey, url),
    body: JSON.stringify(body),
  });
};

type AnymailFindResult = {
  email: string;
  emailStatus: string;
  isVerified: boolean;
  confidence?: number;
};

/** 用 Anymail Finder 按姓名+域名查找邮箱 */
const findEmailWithAnymail = async (
  name: string,
  domain: string,
  opts?: { firstName?: string; lastName?: string; linkedin?: string }
): Promise<AnymailFindResult | null> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  if (!apiKey || !domain || (!name && !opts?.firstName && !opts?.linkedin)) return null;
  try {
    const body: Record<string, string> = { domain: cleanDomain(domain) };
    if (opts?.firstName) body.first_name = opts.firstName;
    if (opts?.lastName) body.last_name = opts.lastName;
    if (name) body.full_name = name;
    if (opts?.linkedin) body.linkedin_url = opts.linkedin;

    const response = await anymailFetch('/v5.1/find-email/person', apiKey, body);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn('Anymail person find failed', response.status, errText.slice(0, 200));
      return null;
    }
    const data = await response.json();
    const email = data.valid_email || data.email;
    if (!email) return null;
    const emailStatus = String(data.email_status || 'unverified').toLowerCase();
    return {
      email,
      emailStatus,
      isVerified: emailStatus === 'valid',
      confidence: emailStatus === 'valid' ? 0.95 : emailStatus === 'risky' ? 0.6 : 0.3,
    };
  } catch (e) {
    console.error('Anymail person find error', e);
    return null;
  }
};

/** 验证邮箱（Anymail Finder verify-email） */
const verifyEmailWithAnymail = async (
  email: string
): Promise<{ emailStatus: string; isVerified: boolean } | null> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  if (!apiKey || !email?.includes('@')) return null;
  try {
    const response = await anymailFetch('/v5.1/verify-email', apiKey, { email: email.trim() });
    if (!response.ok) {
      console.warn('Anymail verify failed', response.status);
      return null;
    }
    const data = await response.json();
    const emailStatus = String(data.email_status || 'unverified').toLowerCase();
    return { emailStatus, isVerified: emailStatus === 'valid' };
  } catch (e) {
    console.error('Anymail verify error', e);
    return null;
  }
};

/** 按决策人角色从公司挖邮箱（采购/CEO 等） */
const fetchAnymailDecisionMakers = async (domain: string): Promise<DecisionMaker[]> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  if (!domain || !apiKey) return [];
  const categories = ['procurement', 'ceo', 'founder', 'sales'];
  const people: DecisionMaker[] = [];

  for (const category of categories) {
    try {
      const response = await anymailFetch('/v5.1/find-email/decision-maker', apiKey, {
        domain: cleanDomain(domain),
        decision_maker_category: [category],
      });
      if (!response.ok) continue;
      const data = await response.json();
      const email = data.valid_email || data.email;
      if (!email) continue;
      const emailStatus = String(data.email_status || 'unverified').toLowerCase();
      const title = data.person_job_title || category;
      const name = data.person_full_name || 'Decision Maker';
      people.push({
        name,
        title,
        linkedin: data.linkedin_url || undefined,
        emailGuess: email,
        type: classifyDecisionMakerType(title),
        source: 'AnymailFinder',
        emailSource: 'AnymailFinder',
        emailStatus,
        isVerified: emailStatus === 'valid',
        confidence: emailStatus === 'valid' ? 0.95 : 0.55,
        influenceScore: /procurement|buyer|purchasing/i.test(category) ? 5 : /ceo|founder/i.test(category) ? 5 : 3,
      });
    } catch (e) {
      console.warn('Anymail decision-maker error', category, e);
    }
  }
  return people;
};

const fetchAnymailFinder = async (domain: string): Promise<DecisionMaker[]> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  if (!domain || !apiKey) return [];
  try {
    const byRole = await fetchAnymailDecisionMakers(domain);
    if (byRole.length) return byRole;

    const response = await anymailFetch('/v5.1/find-email/company', apiKey, {
      domain: cleanDomain(domain),
      email_type: 'any',
    });
    if (!response.ok) {
      const legacy = await anymailFetch('/v5.0/search/company.json', apiKey, {
        domain: cleanDomain(domain),
        email_type: 'all',
      });
      if (!legacy.ok) return [];
      const legacyData = await legacy.json();
      const emails = legacyData?.emails || legacyData?.results || [];
      if (!Array.isArray(emails)) return [];
      return emails.slice(0, 20).map((e: any) => {
        const email = typeof e === 'string' ? e : e.email || e.value;
        const title = typeof e === 'string' ? 'Manager' : e.title || e.job_title || 'Manager';
        const emailStatus = typeof e === 'string' ? 'valid' : String(e.email_status || (e.valid ? 'valid' : 'unverified'));
        return {
          name: typeof e === 'string' ? email.split('@')[0] : e.name || [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Contact',
          firstName: typeof e === 'object' ? e.first_name : undefined,
          lastName: typeof e === 'object' ? e.last_name : undefined,
          title,
          emailGuess: email,
          linkedin: typeof e === 'object' ? e.linkedin || e.linkedin_url : undefined,
          type: classifyDecisionMakerType(title),
          source: 'AnymailFinder' as const,
          emailSource: 'AnymailFinder',
          emailStatus,
          isVerified: emailStatus === 'valid',
        };
      });
    }

    const data = await response.json();
    const emailStatus = String(data.email_status || 'unverified').toLowerCase();
    const list: string[] = data.valid_emails?.length
      ? data.valid_emails
      : Array.isArray(data.emails)
        ? data.emails
        : [];
    return list.slice(0, 20).map((email: string) => ({
      name: String(email).split('@')[0] || 'Contact',
      title: 'Company Contact',
      emailGuess: email,
      type: 'Other' as const,
      source: 'AnymailFinder' as const,
      emailSource: 'AnymailFinder',
      emailStatus,
      isVerified: emailStatus === 'valid',
      confidence: emailStatus === 'valid' ? 0.9 : 0.5,
      influenceScore: 2,
    }));
  } catch (e) {
    console.error('Anymail Finder Error', e);
  }
  return [];
};

/** 后台测试 Anymail Finder Key 是否可用 */
export const testAnymailFinderApiKey = async (
  apiKey: string
): Promise<{ success: boolean; message: string }> => {
  const key = (apiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return { success: false, message: '请先填写 AnymailFinder API Key' };
  try {
    const response = await anymailFetch('/v5.1/verify-email', key, {
      email: 'connection-test@example.com',
    });
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: `鉴权失败 (${response.status})：Key 无效或权限不足` };
    }
    if (response.status === 402) {
      return { success: true, message: 'AnymailFinder Key 有效 ✅（账户额度不足/需充值，但鉴权已通过）' };
    }
    if (!response.ok) {
      return {
        success: false,
        message: `测试失败 HTTP ${response.status}: ${(data?.error || data?.message || text).toString().slice(0, 160)}`,
      };
    }
    const status = data.email_status || 'ok';
    return {
      success: true,
      message: `AnymailFinder 连接成功 ✅（verify-email 返回 status=${status}）`,
    };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const hint = /Failed to fetch|NetworkError/i.test(msg)
      ? isLocalDevHost()
        ? ' 请重启 npm run dev（需要 /anymail-api 代理），然后强制刷新页面再测。'
        : ' 线上需已部署 qwen-proxy Edge Function（Anymail 复用该代理）。'
      : '';
    return {
      success: false,
      message: `AnymailFinder 测试失败: ${msg}.${hint}`,
    };
  }
};

// --- API Configuration ---

export const getGeminiConfig = (): ApiConfig[] => {
    const configs: ApiConfig[] = [];

    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('trade_scout_api_configs');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                configs.push(...parsed.filter((c: ApiConfig) => c.apiKey && c.apiKey.trim() !== ''));
            } catch (e) {
                console.error("Failed to parse stored API configs", e);
            }
        }
    }

    if (env.apiKey && !configs.some(c => c.apiKey === env.apiKey)) {
        configs.push({
            id: 'env_gemini',
            apiKey: env.apiKey,
            baseUrl: 'native',
            modelId: NATIVE_MODEL,
            priority: 0,
            taskAssignment: 'default',
        });
    }

    return configs;
};

export const hasApiKeyConfigured = (): boolean => {
    if (env.qwenApiKey) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('trade_scout_qwen_api_key')?.trim()) return true;
    if (getGeminiConfig().length > 0) return true;
    if (env.apiKey) return true;
    return false;
};

/** 从 Supabase 拉取管理员保存的 API 密钥到 localStorage，供普通用户登录后使用 */
export const hydrateApiConfigsFromCloud = async (): Promise<boolean> => {
    if (hasApiKeyConfigured()) return true;
    if (!isSupabaseConfigured()) return false;

    try {
        const configs = await getAllApiConfigs();
        if (configs.length === 0) return false;

        for (const c of configs) {
            if (c.provider === 'qwen' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_qwen_api_key', c.apiKey.trim());
                if (c.baseUrl?.trim()) localStorage.setItem('trade_scout_qwen_base_url', c.baseUrl.trim());
                if (c.modelId?.trim()) localStorage.setItem('trade_scout_qwen_model_id', c.modelId.trim());
            }
            if (c.provider === 'hunter' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_hunter_api_key', c.apiKey.trim());
            }
            if (c.provider === 'findymail' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_findymail_api_key', c.apiKey.trim());
            }
            if (c.provider === 'anymailfinder' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_anymail_finder_api_key', c.apiKey.trim());
            }
            if (c.provider === 'wan' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_wan_api_key', c.apiKey.trim());
                if (c.baseUrl?.trim()) localStorage.setItem('trade_scout_wan_base_url', c.baseUrl.trim());
                if (c.modelId?.trim()) localStorage.setItem('trade_scout_wan_model_id', c.modelId.trim());
            }
        }

        return hasApiKeyConfigured();
    } catch (e) {
        console.error('Failed to hydrate API configs from Supabase', e);
        return hasApiKeyConfigured();
    }
};

export const checkApiKeyAvailability = async (): Promise<boolean> => {
    if (hasApiKeyConfigured()) return true;
    if (typeof window !== 'undefined' && window.aistudio?.hasSelectedApiKey) {
        const studioKey = await window.aistudio.hasSelectedApiKey();
        if (studioKey) return true;
    }
    return hydrateApiConfigsFromCloud();
};

const getDefaultAIModel = (): 'qwen' | 'gemini' | 'auto' => {
    if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('trade_scout_default_ai_model') as 'qwen' | 'gemini' | 'auto' | null;
        if (saved) return saved;
    }
    return env.defaultAIModel;
};

// --- OpenAI Adapter for Relay Services (hiapi, nvidia, deepseek, openrouter etc) ---
const callOpenAICompatible = async (
    config: ApiConfig,
    messages: any[],
    jsonMode: boolean = false,
    options: { extraPayload?: Record<string, unknown>; timeoutMs?: number; maxTokens?: number; proxyOrigin?: string } = {}
): Promise<string> => {
    // Construct URL robustly
    let baseUrl = config.baseUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    
    // Auto-append chat/completions if not present (Standard OpenAI format)
    // EXCEPTION: Some proxies might not need this, but most do.
    if (!baseUrl.endsWith('/chat/completions') && !baseUrl.includes('generateContent')) {
        baseUrl += '/chat/completions';
    }

    // Model Mapping fallback
    const model = config.modelId?.trim() || 'gemini-1.5-pro';
    
    const payload: any = {
        model: model,
        messages: messages,
        temperature: 0.7,
        stream: false,
        max_tokens: options.maxTokens ?? 4096,
    };

    if (jsonMode && !options.extraPayload?.enable_search) {
        payload.response_format = { type: "json_object" };
    }
    if (options.extraPayload) {
        Object.assign(payload, options.extraPayload);
    }

    // Helper to execute fetch
    const doFetch = async (proxyPrefix: string, targetUrl: string) => {
        const finalUrl = proxyPrefix ? `${proxyPrefix}${encodeURIComponent(targetUrl)}` : targetUrl;

        const headers = buildAliyunFetchHeaders({
            targetUrl: finalUrl,
            apiKey: sanitizeApiKey(config.apiKey),
            proxyOrigin: options.proxyOrigin,
        });

        // --- CRITICAL FIX FOR OPENROUTER ---
        // OpenRouter requires these headers to identify the app and prevent blocks
        if (targetUrl.includes('openrouter')) {
            headers['HTTP-Referer'] = window.location.href; // Site URL
            headers['X-Title'] = 'Trade Scout Pro'; // App Name
        }

        return fetchWithTimeout(finalUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        }, options.timeoutMs ?? 120_000);
    };

    const isWorkerLimit = (status: number, body: string) =>
      status === 546 || /WORKER_RESOURCE_LIMIT/i.test(body);

    // Multi-Level Proxy Attempt Strategy
    let lastError: any = null;
    
    // Custom Proxy from LocalStorage
    const customProxy = typeof localStorage !== 'undefined' ? localStorage.getItem('trade_scout_custom_proxy') : '';
    
    // 国内千问 / DashScope：直连，不走 CORS 代理（代理会导致 Failed to fetch）
    let attempts: string[];
    if (isDomesticQwenEndpoint(baseUrl)) {
        attempts = [''];
    } else if (baseUrl.includes('openrouter') || baseUrl.includes('siliconflow') || baseUrl.includes('hiapi')) {
        attempts = ['', ...PROXY_LADDER.filter(p => p !== '')];
    } else {
        attempts = customProxy ? [customProxy, ...PROXY_LADDER] : PROXY_LADDER;
    }

    for (const proxy of attempts) {
        try {
            const response = await doFetch(proxy, baseUrl);

            if (!response.ok) {
                const errText = await response.text();

                if (isWorkerLimit(response.status, errText)) {
                    throw new Error(
                      `云端代理超时或资源不足 (HTTP 546)。系统会自动降级重试。详情: ${errText.slice(0, 120)}`
                    );
                }
                
                // If 401, key is wrong or proxy hit wrong host. STOP.
                if (response.status === 401) {
                    const proxiedTo = response.headers.get('X-Proxied-To') || '';
                    let detail = errText.slice(0, 240);
                    try { detail = JSON.parse(errText).error?.message || detail; } catch { /* ignore */ }
                    const wrongHost =
                      /Incorrect API key provided/i.test(detail) &&
                      (proxiedTo.includes('dashscope') || !proxiedTo.includes('token-plan'));
                    throw new Error(
                      `API Key Rejected (401). Key=${describeKey(config.apiKey)}; ` +
                      `目标=${proxiedTo || config.baseUrl}. ${detail}` +
                      (wrongHost
                        ? ' —— 请求可能打到了 dashscope 而不是 Token Plan。请重启 npm run dev 后再测。'
                        : ' —— 请确认使用完整 sk-sp- Key，且与 token-plan 域名配套。')
                    );
                }
                
                // If 402, Quota exceeded. STOP.
                if (response.status === 402 || response.status === 429) {
                    throw new Error(`Rate Limit or Quota Exceeded (${response.status}).`);
                }

                // If 403/404/5xx, it might be network/proxy issue. Continue to next proxy.
                if (response.status >= 500 || response.status === 403) {
                    console.warn(`Attempt failed with status ${response.status}. Trying next proxy...`);
                    lastError = new Error(`HTTP ${response.status}: ${errText}`);
                    continue;
                }

                // Other errors
                let safeErr = errText;
                try { safeErr = JSON.parse(errText).error?.message || errText; } catch(e) { /* ignore parse error */ }
                throw new Error(`API Error (${response.status}): ${safeErr}`);
            }

            const data = await response.json();
            
            // Handle different response structures
            const content = data.choices?.[0]?.message?.content || data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!content) {
                console.error("Empty Response Structure:", data);
                throw new Error("Received empty response from API (Structure mismatch)");
            }
            return content; // Success!

        } catch (e: any) {
            lastError = e;
            // Fatal errors that shouldn't trigger retry loop
            if (
              e.message.includes('401') ||
              e.message.includes('402') ||
              e.message.includes('Key Rejected') ||
              e.message.includes('Rate Limit') ||
              /云端代理算力不足 \(HTTP 546\)/.test(e.message)
            ) {
                throw e;
            }
        }
    }

    // Comprehensive Error Message
    let errorMsg = `[Connection Failed] `;
    if (baseUrl.includes('openrouter')) {
        errorMsg += `OpenRouter connection failed. Ensure your API Key is valid and you have credits. If in China, try using a global VPN mode.`;
    } else if (baseUrl.includes('googleapis.com')) {
        errorMsg += `It seems you are using a raw Google URL. Please use the 'Google Official (Native)' preset instead.`;
    } else {
        errorMsg += `Last Error: ${lastError?.message || 'Network Error'}. Check URL/Network.`;
        errorMsg += qwenCorsHint(lastError?.message);
        if (!isLocalDevHost() && isDomesticQwenEndpoint(baseUrl) && !baseUrl.includes('/functions/v1/qwen-proxy')) {
          errorMsg += ' 若尚未部署 qwen-proxy，线上测试必失败。';
        }
    }
    throw new Error(errorMsg);
};

// --- 国内千问统一调用（联网搜索 + 多模态）---
const buildQwenUserContent = (
  prompt: string,
  images: string[] = [],
  attachments: KnowledgeFile[] = []
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> => {
  if (images.length === 0 && attachments.length === 0) return prompt;

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: prompt },
  ];

  images.forEach(img => {
    parts.push({
      type: 'image_url',
      image_url: { url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}` },
    });
  });

  attachments.forEach(file => {
    if (file.type === 'youtube') {
      parts.push({ type: 'text', text: `[Reference YouTube Link: ${file.data}]` });
    } else if (file.mimeType?.startsWith('text/') || ['txt', 'md', 'csv', 'json'].includes(file.type)) {
      parts.push({ type: 'text', text: `[File: ${file.name}]\n${file.data.substring(0, 8000)}` });
    } else if (file.mimeType?.startsWith('image/') && file.data) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: file.data.startsWith('data:') ? file.data : `data:${file.mimeType};base64,${file.data}`,
        },
      });
    } else {
      parts.push({ type: 'text', text: `[Attachment: ${file.name}]` });
    }
  });

  return parts;
};

const tryGeminiFailover = async (
  task: TaskType,
  prompt: string,
  systemInfo: string | undefined,
  jsonMode: boolean,
  images: string[],
  attachments: KnowledgeFile[],
  needsWebSearch: boolean
): Promise<string | null> => {
  const allConfigs = getGeminiConfig();
  const nativeConfig: ApiConfig | null = env.apiKey ? {
    id: 'native_env_key',
    apiKey: env.apiKey,
    baseUrl: 'native',
    priority: 0,
    taskAssignment: 'default',
    modelId: NATIVE_MODEL,
  } : null;

  const candidates = [...allConfigs];
  if (nativeConfig) candidates.push(nativeConfig);
  const relevantCandidates = candidates.filter(
    c => c.taskAssignment === task || !c.taskAssignment || c.taskAssignment === 'default'
  );
  if (relevantCandidates.length === 0) return null;

  relevantCandidates.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  let lastError: any = null;

  for (const config of relevantCandidates) {
    try {
      if (config.baseUrl === 'native') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const parts: Part[] = [{ text: prompt }];
        images.forEach(img => parts.push({ inlineData: { mimeType: 'image/jpeg', data: img } }));
        attachments.forEach(file => {
          if (file.type === 'youtube') parts.push({ text: `[YouTube: ${file.data}]` });
          else if (file.mimeType && file.data) parts.push({ inlineData: { mimeType: file.mimeType, data: file.data } });
        });
        const reqConfig: any = { systemInstruction: systemInfo };
        if (jsonMode) reqConfig.responseMimeType = 'application/json';
        if (needsWebSearch) reqConfig.tools = [{ googleSearch: {} }];
        const response = await ai.models.generateContent({
          model: config.modelId || NATIVE_MODEL,
          contents: [{ role: 'user', parts }],
          config: reqConfig,
        });
        if (response.text) return response.text;
      } else {
        const messages: any[] = [];
        if (systemInfo) messages.push({ role: 'system', content: systemInfo });
        messages.push({ role: 'user', content: buildQwenUserContent(prompt, images, attachments) });
        const result = await callOpenAICompatible(config, messages, jsonMode);
        if (result) return result;
      }
    } catch (e: any) {
      lastError = e;
    }
  }
  if (lastError) console.warn('[AI] Gemini fallback failed:', lastError.message);
  return null;
};

const callQwenChat = async (
  messages: Array<{ role: string; content: unknown }>,
  options: {
    jsonMode?: boolean;
    enableSearch?: boolean;
    /** 强制联网；大任务默认 false，避免 120s+ 无响应 */
    forcedSearch?: boolean;
    task?: TaskType;
    override?: Partial<QwenRuntimeConfig>;
    timeoutMs?: number;
  } = {}
): Promise<string> => {
  const config = await resolveQwenConfig(options.override);
  const viaSupabase = isSupabaseQwenProxyUrl(config.baseUrl);
  const viaAppProxy = isAppHostedQwenProxy(config.baseUrl);
  // 线上 Vercel Edge 约 60s；本地 Vite 可更长
  const rawTimeout =
    options.timeoutMs ||
    (options.task && TASK_TIMEOUT_MS[options.task]) ||
    180_000;
  // 线上 Vercel Node 最长约 300s；本地 Vite 可更长
  const timeoutMs = viaSupabase
    ? Math.min(rawTimeout, 50_000)
    : viaAppProxy && !isLocalDevHost()
      ? Math.min(rawTimeout, 280_000)
      : rawTimeout;
  const searchPayload = qwenSearchPayload(!!options.enableSearch, !!options.forcedSearch);
  const maxTokens =
    options.task === 'search'
      ? viaSupabase
        ? 2000
        : config.baseUrl.includes('/functions/v1/qwen-proxy')
          ? 2500
          : 4096
      : options.task === 'analysis'
        ? viaSupabase
          ? 3000
          : 6144
        : 4096;

  const runOnce = async (extraPayload: Record<string, unknown> | undefined) => {
    if (
      isQwenOpenAICompatible(config.baseUrl) ||
      config.baseUrl.startsWith('/qwen-api') ||
      config.baseUrl.startsWith('/api/qwen-api') ||
      config.baseUrl.includes('/qwen-api/')
    ) {
      return callOpenAICompatible(
        {
          id: 'qwen',
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          modelId: config.modelId,
          taskAssignment: 'default',
        },
        messages,
        options.jsonMode ?? false,
        { timeoutMs, extraPayload, maxTokens, proxyOrigin: config.proxyOrigin }
      );
    }

    const combined = messages
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n');
    return callQwenNative(
      config,
      combined,
      options.jsonMode ?? false,
      !!options.enableSearch,
      timeoutMs,
      !!options.forcedSearch
    );
  };

  try {
    return await runOnce(searchPayload);
  } catch (err: any) {
    const msg = String(err?.message || '');
    const isTimeout = /超时|timeout|AbortError/i.test(msg);
    const is546 = /546|WORKER_RESOURCE|云端代理算力不足/i.test(msg);

    // 线上代理超时 / 546：降级为不联网再试一次（保证功能可用）
    const degradeNoSearch =
      options.enableSearch &&
      (is546 || (isTimeout && (viaSupabase || (viaAppProxy && !isLocalDevHost()))));
    if (degradeNoSearch) {
      console.warn('[Qwen] 云端代理受限，降级为不联网重试…');
      try {
        return await runOnce(undefined);
      } catch (e2: any) {
        throw new Error(
          `${msg} ${qwenCorsHint(msg)}（已尝试不联网兜底仍失败：${e2?.message || e2}）`
        );
      }
    }

    if (isTimeout && options.enableSearch && options.forcedSearch) {
      console.warn('[Qwen] 强制联网超时，降级为普通联网重试…');
      return await runOnce(qwenSearchPayload(true, false));
    }
    if (
      isTimeout &&
      options.enableSearch &&
      options.task !== 'search' &&
      options.task !== 'analysis'
    ) {
      console.warn('[Qwen] 联网超时，降级为不联网重试…');
      return await runOnce(undefined);
    }
    if (isTimeout) {
      throw new Error(
        `${msg} 客户搜索/背调联网较慢，已等待 ${Math.round(timeoutMs / 1000)} 秒仍未返回。请确认模型支持联网（如 qwen-plus / qwen-max / qwen3.x），或减少目标国家后重试。${qwenCorsHint(msg)}`
      );
    }
    if (is546) {
      throw new Error(`${msg}${qwenCorsHint(msg)}`);
    }
    throw err;
  }
};

// --- Unified Generator：国内千问优先，Gemini 仅作可选备用 ---
const generateContentUnified = async (
    task: TaskType, 
    prompt: string, 
    systemInfo?: string, 
    jsonMode: boolean = false, 
    images: string[] = [],
    attachments: KnowledgeFile[] = []
): Promise<string> => {
    const needsWebSearch = WEB_SEARCH_TASKS.includes(task);
    const systemText = needsWebSearch ? QWEN_SYSTEM : (systemInfo || QWEN_SYSTEM);

    console.log(`[AI] Task '${task}' → 千问${needsWebSearch ? ' (联网搜索)' : ''}`);

    try {
      let userContent = buildQwenUserContent(prompt, images, attachments);
      if (jsonMode && needsWebSearch && typeof userContent === 'string') {
        userContent += '\n\n【重要】请严格输出 JSON 格式，不要包含 markdown 代码块。';
      }
      const messages = [
        { role: 'system', content: systemText },
        { role: 'user', content: userContent },
      ];

      return await callQwenChat(messages, {
        jsonMode,
        enableSearch: needsWebSearch,
        // 客户搜索用普通联网即可；强制搜索易导致数分钟无响应
        forcedSearch: false,
        task,
      });
    } catch (qwenErr: any) {
      console.warn(`[AI] 千问调用失败 (${task}):`, qwenErr.message);

      const defaultModel = getDefaultAIModel();
      if (defaultModel === 'qwen') {
        throw new Error(
          `千问调用失败: ${qwenErr.message}。请确认 API Key / Base URL 正确，联网搜索建议使用 qwen-plus 或 qwen-max 模型。`
        );
      }

      const geminiResult = await tryGeminiFailover(
        task, prompt, systemInfo, jsonMode, images, attachments, needsWebSearch
      );
      if (geminiResult) return geminiResult;

      throw new Error(
        `千问调用失败: ${qwenErr.message}。请在管理后台配置千问 API，联网搜索需 qwen-plus / qwen-max。`
      );
    }

    throw new Error('AI 调用未返回结果');
};

// --- Public Methods ---

export const testApiKey = async (apiKey: string, baseUrl?: string, modelId?: string): Promise<{ success: boolean; message: string }> => {
    try {
        // Special case for Official Native Key testing
        if (baseUrl === 'native') {
            const ai = new GoogleGenAI({ apiKey });
            // Use 'gemini-1.5-flash' for a quick ping test if modelId not provided or generic
            const testModel = modelId?.includes('gemini') ? modelId : 'gemini-1.5-flash';
            await ai.models.generateContent({
                model: testModel,
                contents: 'Ping',
            });
            return { success: true, message: "Google Native Connection Successful! ✅" };
        }

        // Standard OpenAI Compatible Test
        const config = { 
            id: 'test', 
            apiKey: apiKey.trim(), 
            baseUrl: baseUrl?.trim() || '', 
            modelId: modelId?.trim(), 
            taskAssignment: 'default' as TaskType 
        };
        await callOpenAICompatible(config, [{ role: 'user', content: 'Ping. Just say pong.' }]);
        return { success: true, message: "Connection Successful! ✅" };
    } catch (e: any) {
        let msg = e.message;
        if (msg.includes('404') && baseUrl?.includes('googleapis')) {
            msg = "Incorrect Base URL. Please use the 'Google Official' preset for native keys.";
        }
        return { success: false, message: `Failed: ${msg}` };
    }
};

export const generateMailGroupStrategy = async (client: AnalysisResult, productImages: string[], knowledgeBaseFiles: KnowledgeFile[]): Promise<MailGroup> => {
    const prompt = `
    Role: Sales Expert (楠哥的小助理). Write 3 Cold Emails for ${client.companyInfo.name}.
    They sell: ${client.businessScope.coreProducts.join(', ')}.
    Their pain points/weaknesses (from SWOT): ${client.swot.weaknesses.join(', ')}.
    
    Structure:
    1. Analysis: Briefly explain WHY you chose this angle (1 sentence, in Chinese).
    2. Email 1: The Hook (Soft introduction, mentioning their specific product).
    3. Email 2: Value Prop (Focus on profit margin or better supply chain).
    4. Email 3: Case Study/Social Proof (Short & punchy).

    Output JSON: { "analysis": "...", "email1": "...", "email2": "...", "email3": "..." }
    `;
    const text = await generateContentUnified('email', prompt, undefined, true, productImages, knowledgeBaseFiles);
    const res = extractJson(text);
    return {
        analysis: res.analysis || "Generated",
        email1: res.email1 || "Draft 1",
        email2: res.email2 || "Draft 2",
        email3: res.email3 || "Draft 3"
    };
};

export const generateConsolidatedEmailStrategy = async (clients: AnalysisResult[], knowledgeBaseFiles: KnowledgeFile[], context: string = ''): Promise<MailGroup> => {
    if (clients.length === 0) return { analysis: 'No Data', email1: '', email2: '', email3: '' };
    
    const clientSummary = clients.slice(0, 10).map(c => `- ${c.companyInfo.name} (${c.companyInfo.nature})`).join('\n');
    
    const prompt = `
    Role: Sales Expert (楠哥的小助理). 
    Task: Write a Universal Cold Email Sequence suitable for a group of ${clients.length} similar potential clients.
    
    My Campaign Context/Goal: "${context}"
    
    Client Examples in this batch:
    ${clientSummary}
    
    Requirement:
    Create a generalized but high-converting sequence that addresses common pain points in this industry/sector.
    Integrate my Campaign Goal keywords and our product advantages found in the attached Knowledge Base.
    
    Structure:
    1. Analysis: Strategy behind this mass-outreach template (In Chinese).
    2. Email 1: General Industry Hook (Using my context).
    3. Email 2: Product Fit & Value (Referencing KB advantages).
    4. Email 3: Meeting Request.

    Output JSON: { "analysis": "...", "email1": "...", "email2": "...", "email3": "..." }
    `;
    const text = await generateContentUnified('email', prompt, undefined, true, [], knowledgeBaseFiles);
    const res = extractJson(text);
    return {
        analysis: res.analysis || "Generated",
        email1: res.email1 || "Draft 1",
        email2: res.email2 || "Draft 2",
        email3: res.email3 || "Draft 3"
    };
};

export const analyzeCompany = async (domainOrName: string, mode: 'detailed' | 'economy' = 'detailed'): Promise<AnalysisResult> => {
  const prompt = `
  Target: "${domainOrName}".
  Task: DEEP B2B FOREIGN-TRADE DUE DILIGENCE for Chinese exporters selling to this buyer/importer.

  You MUST use web search. Prefer official website, LinkedIn company page, trade directories, exhibition pages,
  ImportYeti / Bill of Lading public indexes, news, certification pages. If a fact is unknown, write "公开信息未找到" — NEVER invent customs shipment IDs.

  Action checklist:
  1. Company identity: legal/trading name, HQ city, founded year, nature (importer/distributor/retailer/brand/manufacturer), scale, employees.
  2. Business model: channels, distributors, ecommerce, exhibitions, procurement habits, supply-chain role.
  3. TRADE INTELLIGENCE (critical for exporters):
     - HS codes / product categories they likely import
     - Public customs/shipment clues (summarize; cite source type)
     - Top source countries
     - Certifications (CE, FDA, UL, BSCI, ISO, REACH, GRS, OEKO-TEX, etc.) if mentioned on site or news
     - Preferred Incoterms / MOQ / buying season if found
     - Risk level (低/中/高/未知) + short notes (sanctions/adverse media only if real evidence)
  4. DECISION MAKERS (5-12 people) — prioritize accuracy:
     - Prefer Procurement / Purchasing / Sourcing / Category / Merchandising / Supply Chain / Owner / CEO / Founder
     - Require firstName, lastName, full name, title, department if possible
     - Real LinkedIn URL when searchable; otherwise leave empty (do NOT invent LinkedIn paths)
     - Email: real if found; else professional pattern guess with source "AI (Pattern Guess)"
     - phone if public; yearsActive if known; influenceScore 1-5 (Buyer/CEO higher)
     - type must be CEO | Buyer | Other
  5. Products, pricing, SWOT, traffic estimates, competitors, action plan for Chinese suppliers.
  6. Financial trends last 5 years — estimate if needed, never all zeros.

  IMPORTANT: All descriptive text in Simplified Chinese.

  Output JSON only (no markdown) matching:
  {
    "companyInfo": { "name": "", "headquarters": "", "city": "", "foundedYear": "", "nature": "", "scale": "", "employeeRange": "", "website": "", "description": "" },
    "swot": { "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] },
    "financialTrends": [{ "year": "2020", "revenue": 0, "procurement": 0 }],
    "trafficAnalysis": [{ "category": "", "trafficType": "Organic (SEO)", "topKeywords": "", "volumeEst": "Medium" }],
    "websiteCategories": [{ "categoryName": "", "items": [] }],
    "businessScope": { "coreProducts": [], "relevantProducts": [], "brandPositioning": "", "consumerGroup": "", "productVariety": "Medium", "priceSensitivity": "", "websiteStructure": "" },
    "businessModel": { "channels": [], "hasDistributors": false, "exhibitionHistory": [], "ecommercePresence": [], "procurementInfo": "" },
    "supplyChain": { "role": "", "serviceType": "" },
    "tradeIntelligence": {
      "hsCodes": [],
      "importCategories": [],
      "customsSummary": "",
      "recentShipments": [],
      "topSourceCountries": [],
      "estimatedAnnualImport": "",
      "certifications": [],
      "complianceNotes": "",
      "preferredIncoterms": "",
      "typicalMoq": "",
      "buyingSeasons": "",
      "registrationId": "",
      "companyLinkedin": "",
      "riskLevel": "未知",
      "riskNotes": ""
    },
    "targetAudience": [],
    "financials": { "revenueEstimate": "", "paymentTerms": "", "ipInfo": "" },
    "productSummary": { "marketPreference": "", "recommendedProducts": "", "packagingAnalysis": "", "colorPreference": "", "featureAnalysis": "" },
    "socials": { "linkedin": "", "facebook": "", "instagram": "", "youtube": "" },
    "products": [{ "name": "", "retailPrice": "", "retailPriceCNY": 0, "estimatedFOBPriceCNY": 0, "imageUrl": "", "competitorLink": "", "pricingStrategy": "", "pitchPoint": "", "techSpecs": "", "features": "", "colors": "", "packaging": "" }],
    "marketTrends": "",
    "decisionMakers": [{ "firstName": "", "lastName": "", "name": "", "title": "", "department": "", "emailGuess": "", "phone": "", "linkedin": "", "yearsActive": "", "type": "Buyer", "source": "AI", "isVerified": false, "influenceScore": 4 }],
    "strategy": { "buyingOfficeLocation": "", "actionPlan": [] },
    "similarCompanies": [{ "name": "", "website": "", "country": "", "mainProducts": "" }]
  }
  `;

  // 1. Get Basic Analysis
  const text = await generateContentUnified('analysis', prompt, SYSTEM_INSTRUCTION, true);
  const aiResult = extractJson(text);
  
  // Merge Defaults
  const result: AnalysisResult = {
    companyInfo: {
      name: aiResult.companyInfo?.name || domainOrName || "Unknown",
      headquarters: aiResult.companyInfo?.headquarters || "N/A",
      foundedYear: aiResult.companyInfo?.foundedYear || "N/A",
      nature: aiResult.companyInfo?.nature || "N/A",
      scale: aiResult.companyInfo?.scale || "N/A",
      website: aiResult.companyInfo?.website || "N/A",
      description: aiResult.companyInfo?.description || "N/A",
      employeeRange: aiResult.companyInfo?.employeeRange || "",
      city: aiResult.companyInfo?.city || "",
    },
    swot: {
        strengths: aiResult.swot?.strengths || [],
        weaknesses: aiResult.swot?.weaknesses || [],
        opportunities: aiResult.swot?.opportunities || [],
        threats: aiResult.swot?.threats || []
    },
    financialTrends: Array.isArray(aiResult.financialTrends) ? aiResult.financialTrends : [],
    trafficAnalysis: Array.isArray(aiResult.trafficAnalysis) ? aiResult.trafficAnalysis : [],
    websiteCategories: Array.isArray(aiResult.websiteCategories) ? aiResult.websiteCategories : [],
    businessScope: {
      coreProducts: aiResult.businessScope?.coreProducts || [],
      relevantProducts: aiResult.businessScope?.relevantProducts || [],
      brandPositioning: aiResult.businessScope?.brandPositioning || "N/A",
      consumerGroup: aiResult.businessScope?.consumerGroup || "N/A",
      productVariety: aiResult.businessScope?.productVariety || "Medium",
      priceSensitivity: aiResult.businessScope?.priceSensitivity || "N/A",
      websiteStructure: aiResult.businessScope?.websiteStructure || "N/A"
    },
    businessModel: {
      channels: aiResult.businessModel?.channels || [],
      hasDistributors: !!aiResult.businessModel?.hasDistributors,
      exhibitionHistory: aiResult.businessModel?.exhibitionHistory || [],
      ecommercePresence: aiResult.businessModel?.ecommercePresence || [],
      procurementInfo: aiResult.businessModel?.procurementInfo || "N/A"
    },
    supplyChain: {
      role: aiResult.supplyChain?.role || "N/A",
      serviceType: aiResult.supplyChain?.serviceType || "N/A"
    },
    tradeIntelligence: {
      hsCodes: aiResult.tradeIntelligence?.hsCodes || [],
      importCategories: aiResult.tradeIntelligence?.importCategories || [],
      customsSummary: aiResult.tradeIntelligence?.customsSummary || "公开信息未找到",
      recentShipments: aiResult.tradeIntelligence?.recentShipments || [],
      topSourceCountries: aiResult.tradeIntelligence?.topSourceCountries || [],
      estimatedAnnualImport: aiResult.tradeIntelligence?.estimatedAnnualImport || "公开信息未找到",
      certifications: aiResult.tradeIntelligence?.certifications || [],
      complianceNotes: aiResult.tradeIntelligence?.complianceNotes || "",
      preferredIncoterms: aiResult.tradeIntelligence?.preferredIncoterms || "公开信息未找到",
      typicalMoq: aiResult.tradeIntelligence?.typicalMoq || "公开信息未找到",
      buyingSeasons: aiResult.tradeIntelligence?.buyingSeasons || "公开信息未找到",
      registrationId: aiResult.tradeIntelligence?.registrationId || "",
      companyLinkedin: aiResult.tradeIntelligence?.companyLinkedin || aiResult.socials?.linkedin || "",
      riskLevel: aiResult.tradeIntelligence?.riskLevel || "未知",
      riskNotes: aiResult.tradeIntelligence?.riskNotes || "",
    },
    targetAudience: aiResult.targetAudience || [],
    financials: {
      revenueEstimate: aiResult.financials?.revenueEstimate || "N/A",
      paymentTerms: aiResult.financials?.paymentTerms || "N/A",
      ipInfo: aiResult.financials?.ipInfo || "N/A"
    },
    productSummary: {
        marketPreference: aiResult.productSummary?.marketPreference || "N/A",
        recommendedProducts: aiResult.productSummary?.recommendedProducts || "N/A",
        packagingAnalysis: aiResult.productSummary?.packagingAnalysis || "N/A",
        colorPreference: aiResult.productSummary?.colorPreference || "N/A",
        featureAnalysis: aiResult.productSummary?.featureAnalysis || "N/A"
    },
    socials: aiResult.socials || {},
    products: (Array.isArray(aiResult.products) ? aiResult.products : []).map((p: any) => ({
        ...p,
        features: p.features || "N/A",
        colors: p.colors || "N/A",
        packaging: p.packaging || "N/A"
    })),
    marketTrends: aiResult.marketTrends || "N/A",
    decisionMakers: (aiResult.decisionMakers || []).map((dm: any) => ({
      ...dm,
      type: dm.type === 'CEO' || dm.type === 'Buyer' ? dm.type : classifyDecisionMakerType(dm.title || ''),
      source: 'AI' as const,
      isVerified: false,
      influenceScore: dm.influenceScore || (classifyDecisionMakerType(dm.title || '') === 'Buyer' ? 5 : classifyDecisionMakerType(dm.title || '') === 'CEO' ? 4 : 2),
    })),
    strategy: {
      buyingOfficeLocation: aiResult.strategy?.buyingOfficeLocation || "N/A",
      actionPlan: aiResult.strategy?.actionPlan || []
    },
    similarCompanies: Array.isArray(aiResult.similarCompanies) ? aiResult.similarCompanies : []
  };

  // 2. External Enrichment — 决策人邮箱以 Anymail Finder 为主，查找后强制校验
  const targetDomain = result.companyInfo.website !== 'N/A' ? result.companyInfo.website : domainOrName;
  if (targetDomain && targetDomain.includes('.')) {
      try {
          const hasAnymail = !!getEmailSearchKeys().anymailFinder;
          const [hunterData, findy, anymail] = await Promise.all([
              fetchHunterEmails(targetDomain),
              fetchFindymail(targetDomain),
              fetchAnymailFinder(targetDomain),
          ]);

          const hunter = hunterData.people;
          const pattern = hunterData.pattern;
          // Anymail 结果优先排在前
          const allExtra = [...anymail, ...hunter, ...findy];

          const existingNames = new Set(result.decisionMakers.map(dm => dm.name.toLowerCase()));

          for (const dm of result.decisionMakers) {
              if (!dm.firstName && !dm.name) continue;

              // ① 优先 Anymail Finder 按人查找
              if (hasAnymail) {
                  const found = await findEmailWithAnymail(dm.name || '', targetDomain, {
                      firstName: dm.firstName,
                      lastName: dm.lastName,
                      linkedin: dm.linkedin,
                  });
                  if (found?.email) {
                      dm.emailGuess = found.email;
                      dm.emailSource = 'AnymailFinder';
                      dm.source = 'AnymailFinder';
                      dm.emailStatus = found.emailStatus;
                      dm.isVerified = found.isVerified;
                      dm.confidence = found.confidence;
                      // ② 再走一遍 verify-email 二次确认
                      const verified = await verifyEmailWithAnymail(found.email);
                      if (verified) {
                          dm.emailStatus = verified.emailStatus;
                          dm.isVerified = verified.isVerified;
                          dm.emailSource = 'AnymailFinder';
                      }
                      continue;
                  }
              }

              // ③ 无 Anymail 结果时，回退 Hunter / Findymail，仍尽量用 Anymail 校验
              if (dm.firstName) {
                  const hunterEmail = await findEmailWithHunter(dm.firstName, dm.lastName || '', targetDomain);
                  if (hunterEmail && hunterEmail.confidence > 0.7) {
                      dm.emailGuess = hunterEmail.email;
                      dm.emailSource = 'Hunter.io';
                      dm.source = 'Hunter.io';
                      dm.confidence = hunterEmail.confidence;
                      dm.isVerified = hunterEmail.confidence > 0.9;
                      dm.emailStatus = dm.isVerified ? 'valid' : 'unverified';
                  } else if (dm.name) {
                      const findyEmail = await findEmailWithFindymail(dm.name, targetDomain);
                      if (findyEmail) {
                          dm.emailGuess = findyEmail.email;
                          dm.emailSource = 'Findymail';
                          dm.source = 'Findymail';
                          dm.isVerified = findyEmail.isVerified;
                          dm.emailStatus = findyEmail.isVerified ? 'valid' : 'unverified';
                      }
                  }
              }

              if (dm.emailGuess && hasAnymail) {
                  const verified = await verifyEmailWithAnymail(dm.emailGuess);
                  if (verified) {
                      dm.emailStatus = verified.emailStatus;
                      dm.isVerified = verified.isVerified;
                      // 保留原邮箱来源平台，校验方标注在 status
                  }
              } else if (!dm.emailGuess && pattern && dm.firstName) {
                  const guessed = pattern
                      .replace('{first}', dm.firstName.toLowerCase())
                      .replace('{last}', (dm.lastName || '').toLowerCase())
                      .replace('{f}', dm.firstName[0].toLowerCase())
                      .replace('{l}', (dm.lastName || '')[0]?.toLowerCase() || '');
                  dm.emailGuess = `${guessed}@${cleanDomain(targetDomain)}`;
                  dm.source = 'AI (Pattern Guess)';
                  dm.emailSource = 'AI (Pattern Guess)';
                  dm.emailStatus = 'unverified';
                  dm.isVerified = false;
                  if (hasAnymail) {
                      const verified = await verifyEmailWithAnymail(dm.emailGuess);
                      if (verified) {
                          dm.emailStatus = verified.emailStatus;
                          dm.isVerified = verified.isVerified;
                      }
                  }
              }
          }

          // 平台挖到的新联系人：已有邮箱的再校验一遍
          const newPeople = allExtra
              .filter(p => p.name && !existingNames.has(p.name.toLowerCase()))
              .map(p => ({
                  ...p,
                  type: p.type || classifyDecisionMakerType(p.title || ''),
                  emailSource: p.emailSource || p.source,
                  influenceScore:
                      p.influenceScore ||
                      (p.type === 'Buyer' || classifyDecisionMakerType(p.title || '') === 'Buyer'
                          ? 5
                          : p.type === 'CEO'
                            ? 4
                            : 2),
              }));

          if (hasAnymail) {
              for (const p of newPeople) {
                  if (!p.emailGuess) continue;
                  if (p.emailSource === 'AnymailFinder' && p.isVerified) continue;
                  const verified = await verifyEmailWithAnymail(p.emailGuess);
                  if (verified) {
                      p.emailStatus = verified.emailStatus;
                      p.isVerified = verified.isVerified;
                  }
              }
          }

          result.decisionMakers = rankDecisionMakers([...result.decisionMakers, ...newPeople]);
      } catch (e) {
          console.error('External API enrichment failed', e);
      }
  } else {
      result.decisionMakers = rankDecisionMakers(result.decisionMakers);
  }

  // 3. Generate Email Strategy (ONLY IF DETAILED MODE)
  // If economy mode, we skip this to save tokens, and generate one at the end of the batch.
  if (mode === 'detailed') {
      try {
          const kbFiles = await getAllFilesFromDB();
          const emailStrategy = await generateMailGroupStrategy(result, [], kbFiles);
          result.generatedEmails = emailStrategy;
      } catch (e) {
          console.error("Failed to generate initial email strategy", e);
      }
  }

  return result;
};

// Add this function to export
export const searchPotentialClients = async (productKeyword: string, country: string, industry: string = '', clientType: string = '', limit: number = 15): Promise<ClientSearchResult[]> => {
  const countries = country.split(/[,，;/|]+/).map(s => s.trim()).filter(Boolean);
  const types = clientType.split(/[,，;/|]+/).map(s => s.trim()).filter(Boolean);
  const marketHint = countries.length
    ? `these target markets (cover as many as possible): ${countries.join(', ')}`
    : 'relevant global target markets';
  const typeHint = types.length
    ? types.join(', ')
    : 'Importer, Distributor, Wholesaler, Retailer, Brand Owner, Buying Office';

  const prompt = `
  Act as a high-performance B2B lead discovery engine for Chinese exporters (楠哥的小助理).
  Use web search to find REAL companies in ${marketHint} that buy / import / distribute "${productKeyword}".
  Industry focus: ${industry || '与产品相关的行业'}.
  Preferred buyer types (match ANY of these): ${typeHint}.
  ${countries.length > 1 ? `- Distribute results across the selected countries when possible.` : ''}
  ${types.length > 1 ? `- Mix buyer types among: ${types.join(', ')}.` : ''}

  Rules:
  - Only real companies with active websites. Prefer B2B buyers.
  - Return up to ${limit} diverse targets (no duplicates).
  - fitScore 1-5; description / fitReason / mainProducts in Simplified Chinese.
  - Do NOT invent emails.
  - Keep each field concise (1 short sentence max for description/fitReason).

  Return a valid JSON Array ONLY:
  [{
    "name": "Company Name",
    "website": "www.example.com",
    "description": "一句话说明为何适合开发",
    "country": "Country name in English",
    "clientType": "Importer|Distributor|Wholesaler|Retailer|Brand|Buying Office",
    "mainProducts": "主营品类",
    "estimatedScale": "如 50-200人 / 中型",
    "city": "城市",
    "linkedinCompanyUrl": "",
    "contactHint": "",
    "fitScore": 4,
    "fitReason": "匹配原因"
  }]
  `;
  const text = await generateContentUnified('search', prompt, SYSTEM_INSTRUCTION, true);
  const results = extractJson(text, true);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('搜索未返回有效结果。请确认千问 API 已配置，并使用支持联网搜索的模型。');
  }
  return results.map((r: any) => ({
    name: r.name || 'Unknown',
    website: r.website || '',
    description: r.description || '',
    country: r.country || country || '',
    clientType: r.clientType || clientType || '',
    mainProducts: r.mainProducts || '',
    estimatedScale: r.estimatedScale || '',
    city: r.city || '',
    linkedinCompanyUrl: r.linkedinCompanyUrl || '',
    contactHint: r.contactHint || '',
    fitScore: typeof r.fitScore === 'number' ? r.fitScore : undefined,
    fitReason: r.fitReason || '',
  })).sort((a: ClientSearchResult, b: ClientSearchResult) => (b.fitScore || 0) - (a.fitScore || 0));
};

export const streamStrategyChat = async function* (
    history: ChatMessage[],
    knowledgeBase: KnowledgeFile[], 
    newMessage: string, 
    newAttachments: KnowledgeFile[],
    companyData?: AnalysisResult | null
) {
    const config = await resolveQwenConfig();
    let baseUrl = config.baseUrl.replace(/\/$/, '');
    if (!baseUrl.endsWith('/chat/completions')) baseUrl += '/chat/completions';

    let systemInstruction = `${QWEN_SYSTEM} 你是高级外贸策略顾问。`;
    if (companyData) systemInstruction += ` 当前分析对象: ${companyData.companyInfo.name}。`;
    if (knowledgeBase.length > 0) {
        const kbText = knowledgeBase.map(f => `[KB: ${f.name}]\n${f.data.substring(0, 500)}...`).join("\n\n");
        systemInstruction += `\n\n知识库:\n${kbText}`;
    }

    const messages: any[] = [
        { role: 'system', content: systemInstruction },
        ...history.filter(m => m.id !== 'init').map(m => ({ role: m.role, content: m.text })),
        { role: 'user', content: buildQwenUserContent(newMessage, [], newAttachments) },
    ];

    const response = await fetchWithTimeout(baseUrl, {
        method: 'POST',
        headers: buildAliyunFetchHeaders({
            targetUrl: baseUrl,
            apiKey: config.apiKey,
            proxyOrigin: config.proxyOrigin,
        }),
        body: JSON.stringify({
            model: config.modelId,
            messages,
            stream: true,
            ...qwenSearchPayload(true),
        }),
    }, 120_000);

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`千问对话失败: ${response.status} ${errText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('千问流式响应不可用');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                const chunk = parsed.choices?.[0]?.delta?.content;
                if (chunk) yield chunk;
            } catch { /* skip malformed SSE */ }
        }
    }
};

export const extractKeywordsFromMedia = async (file: KnowledgeFile): Promise<KeywordExtractionResult> => {
    const prompt = `Analyze this product image/doc. Extract: 1. Industry Terms 2. Tier 1 Keywords 3. Tier 2 Keywords. Output JSON: { "industryTerms": [], "tier1Keywords": [], "tier2Keywords": [] }`;
    const text = await generateContentUnified('keywords', prompt, undefined, true, [file.data]);
    return extractJson(text);
};

export const generateColdEmail = async (companyName: string, request: EmailTemplateRequest): Promise<string> => {
  const prompt = `Write a Cold Email for ${companyName}. Style: ${request.style}. Context: ${request.sourceContext}. Product: ${request.ourProducts}. Advantages: ${request.advantages}. Hook: ${request.personalHook}.`;
  return await generateContentUnified('email', prompt, SYSTEM_INSTRUCTION);
};
// ==================== Qwen 模型支持 ====================

interface QwenRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  /** 开发代理转发用的真实阿里云域名（如 token-plan.cn-beijing.maas.aliyuncs.com） */
  proxyOrigin?: string;
}

const DEFAULT_QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_QWEN_MODEL = 'qwen-max';

const normalizeQwenBaseUrl = (raw: string): string => {
  let url = raw.trim().replace(/\/$/, '');
  if (!url) return DEFAULT_QWEN_BASE;
  // 开发环境 Vite 代理路径，保持原样
  if (url.startsWith('/')) return url;
  if (!url.startsWith('http')) url = `https://${url}`;
  if (!url.includes('/compatible-mode') && !url.includes('/api/v1')) {
    url = `${url}/compatible-mode/v1`;
  }
  return url;
};

const isQwenOpenAICompatible = (baseUrl: string): boolean =>
  baseUrl.includes('/compatible-mode/v1');

/** 开发走 Vite；线上走 Vercel /api/qwen-api，始终带上真实阿里云 Origin */
const toProxiedQwenEndpoint = (normalized: string): { url: string; proxyOrigin?: string } => {
  if (normalized.startsWith('/')) {
    return { url: normalized, proxyOrigin: DEFAULT_TOKEN_PLAN_ORIGIN };
  }
  if (!isDomesticQwenEndpoint(normalized)) {
    return { url: normalized };
  }
  const resolved = resolveQwenRequestTarget(normalized);
  return {
    url: resolved.url,
    proxyOrigin: resolved.proxyOrigin || DEFAULT_TOKEN_PLAN_ORIGIN,
  };
};

const effectiveQwenBaseUrl = (normalized: string): string => toProxiedQwenEndpoint(normalized).url;

const resolveQwenConfig = async (override?: Partial<QwenRuntimeConfig>): Promise<QwenRuntimeConfig> => {
  const readLocal = (key: string) =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(key) || undefined : undefined;

  const localKey = readLocal('trade_scout_qwen_api_key');
  const localBase = readLocal('trade_scout_qwen_base_url');
  const localModel = readLocal('trade_scout_qwen_model_id');

  // localStorage 优先，避免云端旧 Key 覆盖管理员刚录入的 Token Plan Key
  let cloudConfig: Awaited<ReturnType<typeof getSupabaseApiConfig>> = null;
  if (!localKey || !localBase) {
    cloudConfig = await getSupabaseApiConfig('qwen');
  }

  const apiKey = sanitizeApiKey(override?.apiKey || localKey || cloudConfig?.apiKey || env.qwenApiKey || '');
  const rawBase =
    override?.baseUrl || localBase || cloudConfig?.baseUrl || env.qwenBaseUrl || DEFAULT_QWEN_BASE;
  const normalized = normalizeQwenBaseUrl(rawBase);
  const proxied = toProxiedQwenEndpoint(normalized);
  const modelId =
    (override?.modelId || localModel || cloudConfig?.modelId || env.qwenModelId || DEFAULT_QWEN_MODEL).trim();

  if (!apiKey) {
    throw new Error('未配置 Qwen API Key（请在管理后台、.env.local 或 Supabase 中配置）');
  }

  // Token Plan 必须用 sk-sp- + token-plan 域名
  if (apiKey.startsWith('sk-sp-') && proxied.proxyOrigin && !/token-plan/i.test(proxied.proxyOrigin) && !proxied.url.includes('token-plan')) {
    console.warn('[Qwen] sk-sp Key 但 Base 不是 token-plan，鉴权极易 401');
  }
  if (!apiKey.startsWith('sk-sp-') && /token-plan/i.test(proxied.proxyOrigin || normalized)) {
    console.warn('[Qwen] Base 是 token-plan 但 Key 不是 sk-sp-，鉴权极易 401');
  }

  console.log('[Qwen Config]', {
    baseUrl: proxied.url,
    proxyOrigin: proxied.proxyOrigin,
    modelId,
    keyInfo: describeKey(apiKey),
  });
  return { apiKey, baseUrl: proxied.url, modelId, proxyOrigin: proxied.proxyOrigin };
};

const extractQwenText = (data: any): string | null => {
  if (data?.output?.text) return data.output.text;
  const choice = data?.output?.choices?.[0]?.message?.content;
  if (choice) return choice;
  return null;
};

const callQwenNative = async (
  config: QwenRuntimeConfig,
  prompt: string,
  jsonMode: boolean,
  enableSearch = false,
  timeoutMs = 180_000,
  forcedSearch = false
): Promise<string> => {
  let apiRoot = config.baseUrl.replace(/\/$/, '');
  if (apiRoot.endsWith('/api/v1')) {
    apiRoot = apiRoot.slice(0, -'/api/v1'.length);
  }
  const url = `${apiRoot}/api/v1/services/aigc/text-generation/generation`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: buildAliyunFetchHeaders({
      targetUrl: url,
      apiKey: config.apiKey,
      proxyOrigin: config.proxyOrigin,
    }),
    body: JSON.stringify({
      model: config.modelId,
      input: {
        messages: [
          {
            role: 'system',
            content: '你是外贸客户开发专家，擅长背景调查和开发信撰写。所有输出使用简体中文。',
          },
          { role: 'user', content: prompt },
        ],
      },
      parameters: {
        result_format: jsonMode ? 'message' : 'text',
        ...(qwenSearchPayload(enableSearch, forcedSearch) || {}),
      },
    }),
  }, timeoutMs);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Qwen API 错误: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text = extractQwenText(data);
  if (!text) throw new Error('Qwen 返回格式异常');
  return text;
};

/**
 * 调用 Qwen API（支持公共 DashScope 与 MaaS 工作空间专属端点）
 */
export const callQwen = async (
  prompt: string,
  options: {
    jsonMode?: boolean;
    override?: Partial<QwenRuntimeConfig>;
    enableSearch?: boolean;
    task?: TaskType;
  } = {}
): Promise<string> => {
  try {
    // override 只传原始字段，由 resolveQwenConfig / callQwenChat 统一做代理改写
    return await callQwenChat(
      [
        { role: 'system', content: QWEN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      {
        jsonMode: options.jsonMode,
        enableSearch: options.enableSearch,
        task: options.task,
        override: options.override,
      }
    );
  } catch (error) {
    console.error('Qwen 调用失败:', error);
    throw error;
  }
};

export const testQwenApiKey = async (
  apiKey: string,
  baseUrl?: string,
  modelId?: string,
  testSearch = false
): Promise<{ success: boolean; message: string }> => {
  try {
    const cleanKey = sanitizeApiKey(apiKey);
    const cleanBase = (baseUrl || '').trim() || 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
    if (cleanKey.startsWith('sk-sp-') && !/token-plan/i.test(cleanBase)) {
      return {
        success: false,
        message: '配置不匹配：Token Plan Key (sk-sp-) 必须搭配 https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      };
    }
    if (!cleanKey.startsWith('sk-sp-') && /token-plan/i.test(cleanBase)) {
      return {
        success: false,
        message: '配置不匹配：token-plan 域名必须使用 sk-sp- 开头的 Token Plan Key（不要用按量付费 sk-ws-/sk- Key）',
      };
    }
    if (testSearch) {
      const text = await callQwen('搜索并告诉我今天日期，用一句话回答。', {
        override: {
          apiKey: cleanKey,
          baseUrl: cleanBase,
          modelId: modelId?.trim(),
        },
        enableSearch: true,
        task: 'email',
      });
      return { success: true, message: `千问联网搜索成功 ✅ ${text.slice(0, 80)}` };
    }
    const text = await callQwen('Ping. Just reply with the word pong.', {
      override: {
        apiKey: cleanKey,
        baseUrl: cleanBase,
        modelId: modelId?.trim(),
      },
    });
    return { success: true, message: `Qwen 连接成功 ✅ 回复: ${text.slice(0, 50)}` };
  } catch (e: any) {
    const hint = qwenCorsHint(e?.message);
    return { success: false, message: `Qwen 测试失败: ${e.message}${hint}` };
  }
};

const callGeminiNative = async (
  prompt: string,
  config: ApiConfig,
  options: { jsonMode?: boolean; enableSearch?: boolean } = {}
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const reqConfig: Record<string, unknown> = {};
  if (options.jsonMode) {
    reqConfig.responseMimeType = "application/json";
  }
  if (options.enableSearch) {
    reqConfig.tools = [{ googleSearch: {} }];
  }
  const response = await ai.models.generateContent({
    model: config.modelId || NATIVE_MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: reqConfig
  });
  if (!response.text) throw new Error("Empty Gemini response");
  return response.text;
};

/**
 * 统一 AI 调用：默认使用国内千问
 */
export const callAI = async (
    prompt: string,
    options: {
      model?: 'qwen' | 'gemini' | 'auto'
      jsonMode?: boolean
      enableSearch?: boolean
    } = {}
  ): Promise<string> => {
    const model = options.model || getDefaultAIModel();
    
    if (model === 'gemini') {
      const configs = getGeminiConfig();
      if (configs.length === 0 && !env.apiKey) {
        throw new Error('未配置 Gemini API Key');
      }
      const nativeConfig = configs.find(c => c.baseUrl === 'native') || configs[0];
      return await callGeminiNative(prompt, nativeConfig, {
        jsonMode: options.jsonMode,
        enableSearch: options.enableSearch,
      });
    }

    try {
      return await callQwen(prompt, {
        jsonMode: options.jsonMode,
        enableSearch: options.enableSearch ?? false,
      });
    } catch (error) {
      if (model === 'qwen') throw error;
      console.warn('千问调用失败，尝试 Gemini 备用:', error);
      const geminiResult = await tryGeminiFailover(
        'default', prompt, SYSTEM_INSTRUCTION, options.jsonMode ?? false, [], [], !!options.enableSearch
      );
      if (geminiResult) return geminiResult;
      throw error;
    }
  }