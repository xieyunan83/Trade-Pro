
import { GoogleGenAI, Type, Part } from "@google/genai";
import { AnalysisResult, ClientSearchResult, DecisionMaker, ChatMessage, KnowledgeFile, KeywordExtractionResult, MailGroup, EmailTemplateRequest, ApiConfig, TaskType } from "../types";
import { getAllFilesFromDB } from "./db";
import { getApiConfig as getSupabaseApiConfig, getAllApiConfigs, isSupabaseConfigured } from './supabase';
import { env, getEmailSearchKeys } from './env';

const NATIVE_MODEL = 'gemini-3-pro-preview';

const WEB_SEARCH_TASKS: TaskType[] = ['search', 'analysis'];

const TASK_TIMEOUT_MS: Partial<Record<TaskType, number>> = {
  search: 120_000,
  analysis: 180_000,
  email: 120_000,
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

const qwenSearchPayload = (enableSearch: boolean): Record<string, unknown> | undefined =>
  enableSearch
    ? { enable_search: true, search_options: { forced_search: true } }
    : undefined;

const isDomesticQwenEndpoint = (url: string): boolean =>
  url.startsWith('/qwen-api') || /aliyuncs\.com|dashscope\.aliyun/i.test(url);

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

const fetchAnymailFinder = async (domain: string): Promise<DecisionMaker[]> => {
    const ANYMAIL_FINDER_API_KEY = getEmailSearchKeys().anymailFinder;
    if (!domain || !ANYMAIL_FINDER_API_KEY) return [];
    try {
        const response = await fetch(`https://api.anymailfinder.com/v1.0/search/company.json`, {
            method: 'POST',
            headers: { 'X-Api-Key': ANYMAIL_FINDER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: cleanDomain(domain) })
        });
        await response.json();
        return []; 
    } catch (e) { console.error("Anymail Finder Error", e); }
    return [];
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
    options: { extraPayload?: Record<string, unknown>; timeoutMs?: number; maxTokens?: number } = {}
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
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey.trim()}`
        };

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
                
                // If 401, key is wrong. STOP.
                if (response.status === 401) {
                    throw new Error(`API Key Rejected (401). Please check your Key.`);
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
            if (e.message.includes('401') || e.message.includes('402') || e.message.includes('Key Rejected') || e.message.includes('Rate Limit')) {
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
    task?: TaskType;
    override?: Partial<QwenRuntimeConfig>;
  } = {}
): Promise<string> => {
  const config = await resolveQwenConfig(options.override);
  const timeoutMs = (options.task && TASK_TIMEOUT_MS[options.task]) || 120_000;
  const searchPayload = qwenSearchPayload(!!options.enableSearch);
  const maxTokens = options.task === 'search' ? 8192 : options.task === 'analysis' ? 8192 : 4096;

  if (isQwenOpenAICompatible(config.baseUrl) || config.baseUrl.startsWith('/qwen-api')) {
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
      { timeoutMs, extraPayload: searchPayload, maxTokens }
    );
  }

  const combined = messages
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n');
  return callQwenNative(config, combined, options.jsonMode ?? false, !!options.enableSearch, timeoutMs);
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
  Task: DEEP COMMERCIAL INVESTIGATION.
  
  Action:
  1. Identify company nature, scale, and headquarters.
  2. Analyze product pricing, positioning, and supply chain role.
  3. Find 5-10 specific decision makers (Name + Title).
     - **CRITICAL**: Prioritize finding REAL LinkedIn profiles AND REAL professional email addresses.
     - For Name, provide "firstName", "lastName", and "name" (Full Name).
     - You MUST attempt to construct a professional email for every decision maker found. If you cannot find a direct email, use standard professional email patterns (e.g., first.last@company.com, first@company.com) based on the company domain and label it as 'AI (Pattern Guess)'.
     - Look for "Contact Us", "About Us", or "Team" pages to find real names and contact info.
  4. Find 3-5 competitors.
  5. Identify website product categories.
  6. **PRODUCT ANALYSIS (CRITICAL)**: Analyze the company's products in detail:
     - Features/Functions (功能)
     - Colors (颜色)
     - Packaging (包装)
     - Market Preference (分析客户和终端市场的喜好)
     - Recommendation (给出最适合的产品推荐建议)
  7. **CRITICAL**: Search for "SimilarWeb stats", "site traffic", "organic keywords". ESTIMATE if not found. Populate "trafficAnalysis".
  8. **FINANCIAL TRENDS (MANDATORY)**: You MUST provide an ESTIMATE for "revenue" and "procurement" for the last 5 years (2020-2024).
     - If exact financial reports are not public, you MUST ESTIMATE based on: Employee Count * Industry Revenue Per Capita (approx $150k-$300k/employee for trading).
     - Procurement is typically 30-50% of Revenue.
     - **DO NOT RETURN 0**. Give me your best AI estimate based on company size.
  
  IMPORTANT: All text fields (description, positioning, strategy, etc.) MUST be in Simplified Chinese.
  
  Output JSON matching the following structure exactly (no markdown):
  {
    "companyInfo": { "name": "...", "headquarters": "...", "foundedYear": "...", "nature": "...", "scale": "...", "website": "...", "description": "简要中文描述..." },
    "swot": { "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] },
    "financialTrends": [
        { "year": "2020", "revenue": 1000000, "procurement": 300000 },
        { "year": "2021", "revenue": 1200000, "procurement": 400000 },
        { "year": "2022", "revenue": 1500000, "procurement": 500000 },
        { "year": "2023", "revenue": 1800000, "procurement": 600000 },
        { "year": "2024", "revenue": 2000000, "procurement": 700000 }
    ],
    "trafficAnalysis": [
        { "category": "General", "trafficType": "Organic (SEO)", "topKeywords": "brand name, product key", "volumeEst": "Medium" }
    ],
    "websiteCategories": [{ "categoryName": "...", "items": ["..."] }],
    "businessScope": { "coreProducts": [], "relevantProducts": [], "brandPositioning": "...", "consumerGroup": "...", "productVariety": "...", "priceSensitivity": "...", "websiteStructure": "..." },
    "businessModel": { "channels": [], "hasDistributors": false, "exhibitionHistory": [], "ecommercePresence": [], "procurementInfo": "..." },
    "supplyChain": { "role": "...", "serviceType": "..." },
    "targetAudience": [],
    "financials": { "revenueEstimate": "...", "paymentTerms": "...", "ipInfo": "..." },
    "productSummary": {
        "marketPreference": "终端市场喜好分析...",
        "recommendedProducts": "最适合的产品推荐...",
        "packagingAnalysis": "包装风格分析...",
        "colorPreference": "颜色偏好分析...",
        "featureAnalysis": "产品功能特点分析..."
    },
    "socials": { "linkedin": "", "facebook": "" },
    "products": [{ "name": "...", "retailPrice": "...", "retailPriceCNY": 0, "estimatedFOBPriceCNY": 0, "imageUrl": "", "competitorLink": "...", "pricingStrategy": "...", "pitchPoint": "...", "techSpecs": "...", "features": "...", "colors": "...", "packaging": "..." }],
    "marketTrends": "...",
    "decisionMakers": [{ "firstName": "...", "lastName": "...", "name": "...", "title": "...", "emailGuess": "...", "linkedin": "...", "type": "...", "source": "AI", "isVerified": false }],
    "strategy": { "buyingOfficeLocation": "...", "actionPlan": [] },
    "similarCompanies": [{ "name": "...", "website": "...", "country": "...", "mainProducts": "..." }]
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
      description: aiResult.companyInfo?.description || "N/A"
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
    decisionMakers: (aiResult.decisionMakers || []).map((dm: any) => ({ ...dm, source: 'AI', isVerified: false })),
    strategy: {
      buyingOfficeLocation: aiResult.strategy?.buyingOfficeLocation || "N/A",
      actionPlan: aiResult.strategy?.actionPlan || []
    },
    similarCompanies: Array.isArray(aiResult.similarCompanies) ? aiResult.similarCompanies : []
  };

  // 2. External Enrichment (Email Hunting)
  const targetDomain = result.companyInfo.website !== 'N/A' ? result.companyInfo.website : domainOrName;
  if (targetDomain && targetDomain.includes('.')) {
      try {
          const [hunterData, findy, anymail] = await Promise.all([
              fetchHunterEmails(targetDomain),
              fetchFindymail(targetDomain),
              fetchAnymailFinder(targetDomain)
          ]);
          
          const hunter = hunterData.people;
          const pattern = hunterData.pattern;
          const allExtra = [...hunter, ...findy, ...anymail];
          
          // Merge logic
          const existingNames = new Set(result.decisionMakers.map(dm => dm.name.toLowerCase()));
          
          // For AI found people, try to find/verify their emails using specific finder APIs
          for (const dm of result.decisionMakers) {
              if (dm.source === 'AI' && dm.firstName && targetDomain) {
                  // Try Hunter Email Finder for this specific person
                  const hunterEmail = await findEmailWithHunter(dm.firstName, dm.lastName || '', targetDomain);
                  if (hunterEmail && hunterEmail.confidence > 70) {
                      dm.emailGuess = hunterEmail.email;
                      dm.isVerified = hunterEmail.confidence > 90;
                      dm.confidence = hunterEmail.confidence;
                      dm.source = 'Hunter.io';
                  } else if (dm.name) {
                      // Try Findymail
                      const findyEmail = await findEmailWithFindymail(dm.name, targetDomain);
                      if (findyEmail) {
                          dm.emailGuess = findyEmail.email;
                          dm.isVerified = findyEmail.isVerified;
                          dm.source = 'Findymail';
                      }
                  }
                  
                  // If still no email but we have a pattern from Hunter
                  if (!dm.emailGuess && pattern && dm.firstName) {
                      const guessed = pattern
                          .replace('{first}', dm.firstName.toLowerCase())
                          .replace('{last}', (dm.lastName || '').toLowerCase())
                          .replace('{f}', dm.firstName[0].toLowerCase())
                          .replace('{l}', (dm.lastName || '')[0]?.toLowerCase() || '');
                      
                      dm.emailGuess = `${guessed}@${cleanDomain(targetDomain)}`;
                      dm.source = 'AI (Pattern Guess)';
                  }
              }
          }

          const newPeople = allExtra.filter(p => p.name && !existingNames.has(p.name.toLowerCase()));
          result.decisionMakers = [...result.decisionMakers, ...newPeople];
      } catch (e) { console.error("External API enrichment failed", e); }
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
export const searchPotentialClients = async (productKeyword: string, country: string, industry: string = '', clientType: string = '', limit: number = 30): Promise<ClientSearchResult[]> => {
  const prompt = `
  Act as a high-performance B2B Database Crawler (楠哥的小助理). 
  Use 联网搜索 to find REAL potential B2B clients in ${country} for product "${productKeyword}". 
  Industry: ${industry}. 
  Types to Include: ${clientType || 'Any B2B type (Importers, Distributors, Wholesalers, Brands)'}.
  
  Important:
  - Return REAL companies with active websites (verify via search).
  - Return up to ${limit} valid targets.
  - **Description MUST be in Simplified Chinese (简体中文).**
  
  Return a valid JSON Array ONLY. No text.
  Format: [{ "name": "Company Name", "website": "www.example.com", "description": "Short Description in Chinese", "country": "${country}" }]
  `;
  const text = await generateContentUnified('search', prompt, SYSTEM_INSTRUCTION, true);
  const results = extractJson(text, true);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('搜索未返回有效结果。请确认千问 API 已配置，并使用 qwen-plus 或 qwen-max 模型（支持联网搜索）。');
  }
  return results;
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
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
        },
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
}

const DEFAULT_QWEN_BASE = 'https://dashscope.aliyuncs.com';
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

/** 开发环境走 Vite 代理，生产环境直连 */
const effectiveQwenBaseUrl = (normalized: string): string => {
  const isDev =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  if (isDev && isDomesticQwenEndpoint(normalized)) {
    return '/qwen-api/compatible-mode/v1';
  }
  return normalized;
};

const resolveQwenConfig = async (override?: Partial<QwenRuntimeConfig>): Promise<QwenRuntimeConfig> => {
  const readLocal = (key: string) =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(key) || undefined : undefined;

  const localKey = readLocal('trade_scout_qwen_api_key');
  const localBase = readLocal('trade_scout_qwen_base_url');
  const localModel = readLocal('trade_scout_qwen_model_id');

  let cloudConfig = await getSupabaseApiConfig('qwen');

  // localStorage 优先（用户在本浏览器保存的最新配置）
  const apiKey = override?.apiKey || localKey || cloudConfig?.apiKey || env.qwenApiKey || '';
  const rawBase =
    override?.baseUrl || localBase || cloudConfig?.baseUrl || env.qwenBaseUrl || DEFAULT_QWEN_BASE;
  const baseUrl = effectiveQwenBaseUrl(normalizeQwenBaseUrl(rawBase));
  const modelId =
    override?.modelId || localModel || cloudConfig?.modelId || env.qwenModelId || DEFAULT_QWEN_MODEL;

  if (!apiKey) {
    throw new Error('未配置 Qwen API Key（请在管理后台、.env.local 或 Supabase 中配置）');
  }

  console.log('[Qwen Config]', { baseUrl, modelId, hasKey: !!apiKey });
  return { apiKey, baseUrl, modelId };
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
  timeoutMs = 120_000
): Promise<string> => {
  let apiRoot = config.baseUrl.replace(/\/$/, '');
  if (apiRoot.endsWith('/api/v1')) {
    apiRoot = apiRoot.slice(0, -'/api/v1'.length);
  }
  const url = `${apiRoot}/api/v1/services/aigc/text-generation/generation`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
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
        ...(enableSearch ? { enable_search: true, search_options: { forced_search: true } } : {}),
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
    const override = options.override
      ? {
          ...options.override,
          ...(options.override.baseUrl
            ? { baseUrl: effectiveQwenBaseUrl(normalizeQwenBaseUrl(options.override.baseUrl)) }
            : {}),
        }
      : undefined;

    return await callQwenChat(
      [
        { role: 'system', content: QWEN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      {
        jsonMode: options.jsonMode,
        enableSearch: options.enableSearch,
        task: options.task,
        override,
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
    if (testSearch) {
      const text = await callQwen('搜索并告诉我今天日期，用一句话回答。', {
        override: {
          apiKey: apiKey.trim(),
          baseUrl: baseUrl?.trim(),
          modelId: modelId?.trim(),
        },
        enableSearch: true,
      });
      return { success: true, message: `千问联网搜索成功 ✅ ${text.slice(0, 80)}` };
    }
    const text = await callQwen('Ping. Just reply with the word pong.', {
      override: {
        apiKey: apiKey.trim(),
        baseUrl: baseUrl?.trim(),
        modelId: modelId?.trim(),
      },
    });
    return { success: true, message: `Qwen 连接成功 ✅ 回复: ${text.slice(0, 50)}` };
  } catch (e: any) {
    return { success: false, message: `Qwen 测试失败: ${e.message}` };
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