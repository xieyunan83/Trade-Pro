
import { AnalysisResult, ClientSearchResult, DecisionMaker, ChatMessage, KnowledgeFile, KeywordExtractionResult, MailGroup, EmailTemplateRequest, ApiConfig, TaskType, StrategyChatContext } from "../types";
import { getAllFilesFromDB } from "./db";
import { getApiConfig as getSupabaseApiConfig, getAllApiConfigs, isSupabaseConfigured } from './supabase';
import {
  buildAliyunFetchHeaders,
  buildAnymailFetchHeaders,
  hunterProxyHint,
  isAppHostedQwenProxy,
  isDomesticAliyunUrl,
  isLocalDevHost,
  isSupabaseQwenProxyUrl,
  qwenCorsHint,
  resolveAnymailUrl,
  resolveHunterUrl,
  resolveQwenRequestTarget,
  DEFAULT_TOKEN_PLAN_ORIGIN,
} from './qwenProxy';
import { env, getEmailSearchKeys, getAnysearchApiKey } from './env';
import {
  anysearchBatchSearch,
  gatherIdentityEvidence,
  testAnysearchConnection,
} from './anysearchService';
import { filterExcludedSearchResults } from './excludedCompanies';
import {
  gatherTavilyLeadEvidence,
  gatherTavilyCompanyEvidenceBundle,
  hasTavilyKey,
} from './tavilyService';
import { hasRichProductCatalog } from './productCatalog';
import {
  buildFallbackEvidenceFromReport,
  evidenceItemsFromTavilyResults,
  mergeEvidenceItems,
  parseEvidenceItemsFromText,
  scoreEvidenceConfidence,
  summarizeEvidence,
} from '../utils/evidenceChain';
import { normalizeAnalysisResult } from './analysisNormalize';
import {
  getCooldownRemainingSec,
  noteRateLimited,
  waitForApiCooldown,
} from './rateLimitGate';

const NATIVE_MODEL = 'gemini-2.0-flash';

/** 解析阿里云 429/402：区分「瞬时限流」与「套餐额度耗尽」 */
const parseAliyunLimitError = (
  status: number,
  errText: string
): { kind: 'rate' | 'quota'; detail: string } => {
  let detail = (errText || '').slice(0, 280);
  try {
    const j = JSON.parse(errText);
    detail =
      j?.error?.message ||
      j?.message ||
      j?.error?.code ||
      (typeof j?.error === 'string' ? j.error : detail);
  } catch {
    /* keep raw */
  }
  const blob = `${detail}\n${errText}`;
  const isQuota =
    status === 402 ||
    /AllocationQuota|Allocated quota|insufficient_quota|exceeded your current quota|套餐额度|额度已用尽|坐席额度/i.test(
      blob
    );
  const isRate =
    /Requests rate limit|rate\s*limit|Throttling\.Rate|Throttling\.Allocation|API-Key Requests rate|请求过于频繁|Too many requests/i.test(
      blob
    );
  // 额度优先：Aliyun 额度耗尽也常返回 429
  if (isQuota && !/Requests rate limit|API-Key Requests rate/i.test(blob)) {
    return { kind: 'quota', detail: String(detail).slice(0, 200) };
  }
  if (isRate || status === 429) {
    if (isQuota) return { kind: 'quota', detail: String(detail).slice(0, 200) };
    return { kind: 'rate', detail: String(detail).slice(0, 200) };
  }
  return { kind: 'quota', detail: String(detail).slice(0, 200) };
};

const formatAliyunLimitError = (
  status: number,
  kind: 'rate' | 'quota',
  detail: string
): string => {
  if (kind === 'quota') {
    return (
      `套餐额度已用尽 (${status})。${detail ? `上游：${detail}。` : ''}` +
      '请到阿里云百炼 Token Plan 控制台加购额度，或等待下月额度重置。'
    );
  }
  return (
    `请求过于频繁被限流 (${status})。${detail ? `上游：${detail}。` : ''}` +
    '请等待约 1 分钟后重试，并降低批量并发。'
  );
};

const WEB_SEARCH_TASKS: TaskType[] = ['search', 'analysis'];

export type AIEngineChoice = 'qwen' | 'gemini';
export type TaskAIModels = {
  search: AIEngineChoice;
  analysis: AIEngineChoice;
  /** 开发信 / 关键词 / 策略对话等整理类任务 */
  organize: AIEngineChoice;
};

const DEFAULT_TASK_AI_MODELS: TaskAIModels = {
  search: 'gemini',
  analysis: 'gemini',
  organize: 'gemini',
};

const TASK_AI_LS_KEY = 'trade_scout_task_ai_models';

export const getTaskAIModels = (): TaskAIModels => {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_TASK_AI_MODELS };
  try {
    // 仅当显式设为 '1' 时强制全链路千问；否则三项各自独立
    if (localStorage.getItem('trade_scout_force_qwen') === '1') {
      return { search: 'qwen', analysis: 'qwen', organize: 'qwen' };
    }
    const raw = localStorage.getItem(TASK_AI_LS_KEY);
    if (!raw) return { ...DEFAULT_TASK_AI_MODELS };
    const parsed = JSON.parse(raw) as Partial<TaskAIModels>;
    return {
      search: parsed.search === 'qwen' ? 'qwen' : 'gemini',
      analysis: parsed.analysis === 'qwen' ? 'qwen' : 'gemini',
      organize: parsed.organize === 'qwen' ? 'qwen' : 'gemini',
    };
  } catch {
    return { ...DEFAULT_TASK_AI_MODELS };
  }
};

export const saveTaskAIModels = (models: TaskAIModels) => {
  if (typeof localStorage === 'undefined') return;
  const normalized: TaskAIModels = {
    search: models.search === 'qwen' ? 'qwen' : 'gemini',
    analysis: models.analysis === 'qwen' ? 'qwen' : 'gemini',
    organize: models.organize === 'qwen' ? 'qwen' : 'gemini',
  };
  localStorage.setItem(TASK_AI_LS_KEY, JSON.stringify(normalized));
  localStorage.setItem('trade_scout_task_ai_models_ts', String(Date.now()));
};

/** 当前三项路由摘要（调试 / 管理后台展示） */
export const describeTaskAIRouting = (): string => {
  const m = getTaskAIModels();
  const label = (e: AIEngineChoice) => (e === 'gemini' ? 'Gemini→千问' : '仅千问');
  return `搜索=${label(m.search)} · 背调=${label(m.analysis)} · 整理=${label(m.organize)}`;
};

/** 将任务路由与默认引擎全部切回千问（应急） */
export const forceQwenTaskRouting = () => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('trade_scout_force_qwen', '1');
  localStorage.setItem('trade_scout_default_ai_model', 'qwen');
  saveTaskAIModels({ search: 'qwen', analysis: 'qwen', organize: 'qwen' });
};

/** 启用独立任务路由（关闭强制千问；仅首次迁移写默认） */
export const enableTavilyGeminiQwenCascade = () => {
  if (typeof localStorage === 'undefined') return;
  const migrated = localStorage.getItem('trade_scout_cascade_v20260804n');
  if (!migrated) {
    localStorage.setItem('trade_scout_force_qwen', '0');
    localStorage.setItem('trade_scout_default_ai_model', 'gemini');
    saveTaskAIModels({ search: 'gemini', analysis: 'gemini', organize: 'gemini' });
    localStorage.setItem('trade_scout_cascade_v20260804n', '1');
    return;
  }
  if (localStorage.getItem('trade_scout_force_qwen') !== '1') {
    localStorage.setItem('trade_scout_force_qwen', '0');
  }
};

/** 按任务类型读取该项路由（search / analysis / organize 各自独立） */
export const resolveEngineForTask = (task: TaskType): AIEngineChoice => {
  const map = getTaskAIModels();
  if (task === 'search') return map.search;
  if (task === 'analysis') return map.analysis;
  // email / keywords / chat / 其他整理类 → organize
  return map.organize;
};

const hasGeminiOfficialKey = (): boolean => {
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem('trade_scout_gemini_api_key')?.trim();
};

const TASK_TIMEOUT_MS: Partial<Record<TaskType, number>> = {
  // 联网搜索拉客户列表常需 2–4 分钟，后台短测能过但前端重任务会超时
  search: 300_000,
  analysis: 360_000,
  email: 180_000,
};

/** 连接测试专用超时（含 Vercel 冷启动 + 跨境到阿里云） */
const CONNECTION_TEST_TIMEOUT_MS = 45_000;

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

/** 硬超时：即使 AbortController 未触发也能结束 Promise（防后台卡死） */
const withHardTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}超时（${Math.round(ms / 1000)} 秒）。请检查 Key/网络后重试。`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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

IDENTITY RULES (CRITICAL — never break these):
1. The TARGET DOMAIN / official website is the single source of truth for company identity.
2. Headquarters, city, and country MUST come from that company's official site (Contact / About / Footer / Impressum / company registry linked from the site), LinkedIn company page for THAT domain, or reputable filings naming that exact legal entity.
3. NEVER confuse two companies that share a similar brand name but operate in different countries (e.g. Polish SMYK smyk.com in Warsaw ≠ any Russian retailer with a similar name).
4. If the user provides a target market/country context, HQ must be consistent with the official entity on the given domain. If public sources conflict, prefer the official website of the given domain and state the conflict briefly.
5. Do NOT invent locations, shipment IDs, emails, or LinkedIn URLs.

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
  const kind = k.startsWith('AQ.')
    ? 'Gemini Auth Key (AQ.)'
    : k.startsWith('AIza')
      ? 'Gemini Standard Key (AIza)'
      : k.startsWith('sk-sp-')
        ? 'Token Plan (sk-sp-)'
        : k.startsWith('sk-ws-')
          ? '工作空间 (sk-ws-)'
          : k.startsWith('sk-')
            ? '通用/其他 (sk-)'
            : '未知格式';
  return `${kind}, 长度 ${k.length}`;
};

/** 开发走 Vite /gemini-api；线上复用已部署的 /api/qwen（带 x-goog-api-key 即 Gemini 模式） */
const resolveGeminiProxyUrl = (upstreamPath: string): string => {
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  if (typeof window !== 'undefined' && isLocalDevHost()) {
    return `/gemini-api${path}`;
  }
  return `/api/qwen?__upstream=${encodeURIComponent(path)}`;
};

const formatGeminiAuthError = (status: number, bodyText: string): string => {
  const lower = bodyText.toLowerCase();
  if (
    status === 401 ||
    /access_token_type_unsupported|unauthenticated|invalid authentication/i.test(bodyText)
  ) {
    return (
      `Gemini 认证失败 (${status})：Google 拒绝了当前 Key。` +
      `AQ. Auth Key 若曾粘贴到公开聊天/截图，可能已被 Google 自动吊销。` +
      `请打开 https://aistudio.google.com/apikey 点击 Create API key 生成新 Key，` +
      `只粘贴到本页「Gemini API Key」并点测试（不要发到聊天）。` +
      `同时确认 AI Studio 项目已关联结算。详情: ${bodyText.slice(0, 160)}`
    );
  }
  if (status === 403 && /api.?key|permission|blocked/i.test(lower)) {
    return `Gemini 权限被拒 (403)。请检查 Key 限制与 Generative Language API 是否已启用。${bodyText.slice(0, 180)}`;
  }
  return `Gemini API ${status}: ${bodyText.slice(0, 280)}`;
};

type GeminiInlinePart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

const extractGeminiText = (data: any): string => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
};

/**
 * 官方 Gemini REST（经同域代理）：只用 x-goog-api-key，绝不带 Authorization。
 */
const callGeminiGenerateContent = async (
  apiKey: string,
  modelId: string,
  options: {
    prompt: string;
    systemInstruction?: string;
    jsonMode?: boolean;
    enableSearch?: boolean;
    images?: string[];
    attachments?: KnowledgeFile[];
    timeoutMs?: number;
  }
): Promise<string> => {
  const key = sanitizeApiKey(apiKey);
  if (!key) throw new Error('未配置 Gemini API Key');

  const model = (modelId || NATIVE_MODEL).trim() || NATIVE_MODEL;
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const url = resolveGeminiProxyUrl(path);

  const userParts: GeminiInlinePart[] = [{ text: options.prompt }];
  for (const img of options.images || []) {
    if (img?.trim()) {
      userParts.push({ inline_data: { mime_type: 'image/jpeg', data: img } });
    }
  }
  for (const file of options.attachments || []) {
    if (file.type === 'youtube') {
      userParts.push({ text: `[YouTube: ${file.data}]` });
    } else if (file.mimeType && file.data) {
      userParts.push({ inline_data: { mime_type: file.mimeType, data: file.data } });
    }
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: userParts }],
  };
  if (options.systemInstruction?.trim()) {
    body.systemInstruction = {
      parts: [{ text: options.systemInstruction }],
    };
  }
  if (options.jsonMode) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }
  if (options.enableSearch) {
    body.tools = [{ google_search: {} }];
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(formatGeminiAuthError(res.status, text));
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Gemini 返回非 JSON: ${text.slice(0, 200)}`);
    }
    if (data?.error) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : data.error.message || JSON.stringify(data.error);
      throw new Error(formatGeminiAuthError(res.status || 401, msg));
    }
    const out = extractGeminiText(data);
    if (!out) throw new Error('Empty Gemini response');
    return out;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`Gemini 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

/** Hunter 额度用尽 / 限流等：静默跳过，不抛错给用户 */
const isHunterQuotaOrSoftFail = (status: number, data: any): boolean => {
  if (status === 429 || status === 402 || status === 403) return true;
  const errs = Array.isArray(data?.errors) ? data.errors : [];
  const blob = JSON.stringify(errs).toLowerCase();
  return /quota|credit|limit|exceed|usage|rate.?limit|insufficient|payment/.test(blob);
};

const hunterGet = async (
  path: string,
  params: Record<string, string | number | undefined>,
  timeoutMs = 25_000
): Promise<{ ok: boolean; status: number; data: any; softFail: boolean }> => {
  const { url } = resolveHunterUrl(path, params);
  try {
    const response = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
    const softFail = isHunterQuotaOrSoftFail(response.status, data);
    if (!response.ok) {
      if (softFail) {
        console.info('[Hunter] soft-fail (quota/limit)', response.status, String(text).slice(0, 160));
      } else {
        console.warn('[Hunter] HTTP', response.status, String(text).slice(0, 160));
      }
      return { ok: false, status: response.status, data, softFail };
    }
    return { ok: true, status: response.status, data, softFail: false };
  } catch (e) {
    // 网络/超时：同样不打断决策人流程
    console.warn('[Hunter] request failed (ignored)', e);
    return { ok: false, status: 0, data: {}, softFail: true };
  }
};

const fetchHunterEmails = async (domain: string): Promise<{ people: DecisionMaker[], pattern: string | null }> => {
    const HUNTER_API_KEY = getEmailSearchKeys().hunter;
    if (!domain || !HUNTER_API_KEY) return { people: [], pattern: null };
    const res = await hunterGet('/v2/domain-search', {
      domain: cleanDomain(domain),
      api_key: HUNTER_API_KEY,
      limit: 20,
    });
    if (!res.ok) return { people: [], pattern: null };
    const data = res.data;
    const pattern = data.data?.pattern || null;
    if (data.data && Array.isArray(data.data.emails)) {
      const people: DecisionMaker[] = data.data.emails.map((e: any) => {
        const title = e.position || 'Employee';
        return {
          name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Professional',
          firstName: e.first_name,
          lastName: e.last_name,
          title,
          emailGuess: e.value,
          linkedin: e.linkedin,
          type: classifyDecisionMakerType(title),
          source: 'Hunter.io' as const,
          emailSource: 'Hunter.io' as const,
          emailStatus: e.verification?.status || (e.confidence > 85 ? 'valid' : 'unverified'),
          isVerified: e.confidence > 85,
          confidence: typeof e.confidence === 'number' ? e.confidence / 100 : undefined,
          influenceScore: classifyDecisionMakerType(title) === 'Buyer' ? 5 : classifyDecisionMakerType(title) === 'CEO' ? 4 : 2,
        };
      });
      return { people, pattern };
    }
    return { people: [], pattern: null };
};

const findEmailWithHunter = async (firstName: string, lastName: string, domain: string): Promise<{ email: string, confidence: number } | null> => {
    const HUNTER_API_KEY = getEmailSearchKeys().hunter;
    if (!HUNTER_API_KEY || !domain || !firstName) return null;
    const res = await hunterGet('/v2/email-finder', {
      domain: cleanDomain(domain),
      first_name: firstName,
      last_name: lastName || '',
      api_key: HUNTER_API_KEY,
    });
    if (!res.ok) return null;
    if (res.data?.data?.email) {
      return { email: res.data.data.email, confidence: (res.data.data.score || 0) / 100 };
    }
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

/** 采购/买手相关职位（外贸核心目标） */
const isProcurementTitle = (title?: string): boolean => {
  const t = (title || '').toLowerCase();
  return /buyer|procurement|purchasing|sourcing|category\s*manager|merchandis|importer|import\s*manager|vendor\s*manager|supplier|supply\s*chain|采购|买手|供应链|品类|跟单/.test(
    t
  );
};

const classifyDecisionMakerType = (title: string): 'CEO' | 'Buyer' | 'Other' => {
  const t = (title || '').toLowerCase();
  if (/ceo|founder|owner|president|managing director|md\b|总经理|创始/.test(t)) return 'CEO';
  if (isProcurementTitle(t)) return 'Buyer';
  return 'Other';
};

/** 占位名 / 无真实姓名：禁止拿去查 Anymail（会白烧积分或查垃圾） */
const isPlaceholderPersonName = (name?: string): boolean => {
  const n = (name || '').trim();
  if (!n) return true;
  if (
    /公开信息未找到|未知|不详|待补充|n\/?a|unknown|not found|decision maker|contact person/i.test(n)
  ) {
    return true;
  }
  // 无拉丁字母姓名且是中文占位/描述，不可用于 find-person
  if (!/[A-Za-z]{2,}/.test(n)) return true;
  return false;
};

/** 姓名是否不完整（仅邮箱前缀/单名），需要官网/LinkedIn 校对补全 */
const isIncompletePersonName = (name?: string): boolean => {
  if (isPlaceholderPersonName(name)) return true;
  const parts = (name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return true;
  // 职能邮箱本地部分当姓名
  if (/^(info|sales|contact|support|admin|office|dpo|hr|ceo|cfo|coo)$/i.test(parts[0])) return true;
  return false;
};

const isWeakJobTitle = (title?: string): boolean =>
  !title?.trim() ||
  /Company Contact|待补充|Domain Search|Employee|Professional|^Manager$/i.test(title.trim());

const needsProfileEnrichment = (dm: DecisionMaker): boolean =>
  isIncompletePersonName(dm.name) ||
  isWeakJobTitle(dm.title) ||
  !dm.linkedin ||
  !/linkedin\.com\/in\//i.test(dm.linkedin || '');


/** 是否像真实在职联系人（有姓名 + 领英或可核对职位），占位名不算 */
const isLikelyRealPerson = (
  dm: Pick<DecisionMaker, 'name' | 'firstName' | 'lastName' | 'title' | 'linkedin'>
): boolean => {
  if (isPlaceholderPersonName(dm.name) && !(dm.firstName && dm.lastName)) return false;
  if (dm.linkedin && /linkedin\.com\/in\//i.test(dm.linkedin)) return true;
  if (dm.firstName && dm.lastName && /[A-Za-z]{2,}/.test(`${dm.firstName}${dm.lastName}`)) return true;
  if (!isPlaceholderPersonName(dm.name) && /[A-Za-z]{2,}/.test(dm.name || '') && (dm.title || '').trim()) {
    return true;
  }
  return false;
};

const isBuyerContact = (dm: Pick<DecisionMaker, 'type' | 'title'>): boolean =>
  dm.type === 'Buyer' || isProcurementTitle(dm.title);

const rankDecisionMakers = (list: DecisionMaker[]): DecisionMaker[] => {
  const typeWeight = (t: DecisionMaker['type']) => (t === 'Buyer' ? 3 : t === 'CEO' ? 2 : 1);
  return [...list].sort((a, b) => {
    const scoreA =
      (a.influenceScore || typeWeight(a.type)) +
      (a.isVerified ? 1 : 0) +
      (a.emailGuess ? 0.5 : 0) +
      (a.linkedin ? 0.3 : 0) +
      (isBuyerContact(a) ? 2 : 0);
    const scoreB =
      (b.influenceScore || typeWeight(b.type)) +
      (b.isVerified ? 1 : 0) +
      (b.emailGuess ? 0.5 : 0) +
      (b.linkedin ? 0.3 : 0) +
      (isBuyerContact(b) ? 2 : 0);
    return scoreB - scoreA;
  });
};

const anymailFetch = async (
  path: string,
  apiKey: string,
  body: unknown,
  timeoutMs = 45_000
): Promise<Response> => {
  const { url } = resolveAnymailUrl(path);
  return fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: buildAnymailFetchHeaders(apiKey, url),
      body: JSON.stringify(body),
    },
    timeoutMs
  );
};

type AnymailFindResult = {
  email: string;
  emailStatus: string;
  isVerified: boolean;
  confidence?: number;
  creditsCharged?: number;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  title?: string;
  linkedin?: string;
};

const canEnrichPersonWithAnymail = (dm: {
  name?: string;
  firstName?: string;
  lastName?: string;
  linkedin?: string;
}): boolean => {
  if (dm.linkedin && /linkedin\.com/i.test(dm.linkedin)) return true;
  if (dm.firstName && dm.lastName && /[A-Za-z]{2,}/.test(dm.firstName + dm.lastName)) return true;
  if (!isPlaceholderPersonName(dm.name)) return true;
  return false;
};

const extractAnymailJobTitle = (data: any, fallback?: string): string | undefined => {
  const raw =
    data?.person_job_title ||
    data?.job_title ||
    data?.title ||
    data?.person_title ||
    data?.position ||
    data?.role ||
    fallback;
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (!title || isWeakJobTitle(title)) return fallback && !isWeakJobTitle(fallback) ? fallback : undefined;
  return title;
};

const mapAnymailPersonPayload = (
  data: any,
  fallbackTitle: string,
  influenceScore: number
): DecisionMaker | null => {
  const emailStatus = String(data.email_status || 'unverified').toLowerCase();
  // 优先只要已验证邮箱；risky 免费但质量差，外贸场景默认不展示为「已找到」
  const email = data.valid_email || (emailStatus === 'valid' ? data.email : null);
  if (!email) return null;
  const fullName =
    data.person_full_name ||
    [data.person_first_name, data.person_last_name].filter(Boolean).join(' ') ||
    'Decision Maker';
  const title = extractAnymailJobTitle(data, fallbackTitle) || fallbackTitle;
  const credits = Number(data.credits_charged || 0);
  if (credits > 0) {
    console.info(`[Anymail] charged ${credits} credits for ${fullName} <${email}>`);
  }
  return {
    name: fullName,
    firstName: data.person_first_name || undefined,
    lastName: data.person_last_name || undefined,
    title,
    linkedin: data.person_linkedin_url || data.linkedin_url || undefined,
    emailGuess: email,
    type: classifyDecisionMakerType(title),
    source: 'AnymailFinder',
    emailSource: 'AnymailFinder',
    emailStatus: 'valid',
    isVerified: true,
    confidence: 0.95,
    influenceScore,
  };
};

/** 用 Anymail Finder 按「公司名 + 人员姓名」查找邮箱（查找已含校验，勿再调 verify-email）
 *  传入 linkedinUrl 时，官网同款会返回 person_job_title（职位来自 LinkedIn）
 */
const findEmailWithAnymail = async (
  name: string,
  opts?: {
    firstName?: string;
    lastName?: string;
    domain?: string;
    companyName?: string;
    linkedinUrl?: string;
  }
): Promise<AnymailFindResult | null> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  const domain = opts?.domain ? cleanDomain(opts.domain) : '';
  const companyName = (opts?.companyName || '').trim();
  const linkedinUrl = (opts?.linkedinUrl || '').trim();
  if (!apiKey || (!domain && !companyName && !linkedinUrl)) return null;
  if (
    !linkedinUrl &&
    isPlaceholderPersonName(name) &&
    !(opts?.firstName && opts?.lastName)
  ) {
    return null;
  }
  try {
    const body: Record<string, string> = {};
    if (domain) body.domain = domain;
    if (companyName) body.company_name = companyName;
    if (opts?.firstName) body.first_name = opts.firstName;
    if (opts?.lastName) body.last_name = opts.lastName;
    if (name && !isPlaceholderPersonName(name)) body.full_name = name;
    if (linkedinUrl) body.linkedin_url = linkedinUrl;

    const response = await anymailFetch('/v5.1/find-email/person', apiKey, body, 180_000);
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn('Anymail person find failed', response.status, errText.slice(0, 200));
      return null;
    }
    const data = await response.json();
    const emailStatus = String(data.email_status || 'unverified').toLowerCase();
    const email = data.valid_email || (emailStatus === 'valid' ? data.email : null);
    if (!email) return null;
    const credits = Number(data.credits_charged || 0);
    if (credits > 0) console.info(`[Anymail] person find charged ${credits}: ${email}`);
    return {
      email,
      emailStatus: 'valid',
      isVerified: true,
      confidence: 0.95,
      creditsCharged: credits,
      firstName: data.person_first_name || undefined,
      lastName: data.person_last_name || undefined,
      fullName: data.person_full_name || undefined,
      title: extractAnymailJobTitle(data),
      linkedin: data.person_linkedin_url || linkedinUrl || undefined,
    };
  } catch (e) {
    console.error('Anymail person find error', e);
    return null;
  }
};

/** 从邮箱本地部分推断姓名 */
const nameFromEmailLocal = (email: string): { name: string; firstName?: string; lastName?: string } => {
  const local = String(email).split('@')[0] || 'Contact';
  // 过滤纯职能邮箱
  if (/^(info|sales|contact|support|admin|office|hello|mail|hr|jobs|press|media|enquiry|inquiry|service)$/i.test(local)) {
    return { name: local };
  }
  const parts = local
    .replace(/\d+/g, ' ')
    .replace(/[._+\-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
  const firstName = parts[0] ? cap(parts[0]) : undefined;
  const lastName = parts.length > 1 ? cap(parts[parts.length - 1]) : undefined;
  const name = firstName && lastName ? `${firstName} ${lastName}` : firstName || local;
  return { name, firstName, lastName };
};

const isGenericRoleEmail = (email: string): boolean => {
  const local = String(email).split('@')[0] || '';
  return /^(info|sales|contact|support|admin|office|hello|mail|hr|jobs|press|media|enquiry|inquiry|service|noreply|no-reply)$/i.test(
    local
  );
};

/**
 * 官网/域名批量找邮箱（Anymail company）
 * 官方定价：找到 valid 邮箱时扣 1 积分，一次最多返回 20 个（与官网页「复制 20 个」一致）。
 * 勿对同一域名连打 personal + any（会扣两次）。
 */
const fetchAnymailCompanyEmails = async (
  domain: string,
  opts?: {
    companyName?: string;
    /** 默认 any：与官网 Company search 一致，个人+职能邮箱都可能返回 */
    emailType?: 'any' | 'personal' | 'generic';
    timeoutMs?: number;
  }
): Promise<{ people: DecisionMaker[]; creditsCharged: number; emailStatus: string }> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  const clean = cleanDomain(domain);
  const companyName = (opts?.companyName || '').trim();
  if (!apiKey || (!clean && !companyName)) {
    return { people: [], creditsCharged: 0, emailStatus: 'not_found' };
  }
  const emailType = opts?.emailType || 'any';
  try {
    const body: Record<string, string> = { email_type: emailType };
    if (clean) body.domain = clean;
    if (companyName) body.company_name = companyName;

    // 官方建议超时最长 180s；公司搜索走实时校验，短超时会空结果
    const response = await anymailFetch(
      '/v5.1/find-email/company',
      apiKey,
      body,
      opts?.timeoutMs ?? 180_000
    );
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn('Anymail company find HTTP', response.status, errText.slice(0, 200));
      return { people: [], creditsCharged: 0, emailStatus: 'error' };
    }
    const data = await response.json();
    const creditsCharged = Number(data.credits_charged || 0);
    const emailStatus = String(data.email_status || 'not_found').toLowerCase();
    if (creditsCharged > 0) {
      console.info(`[Anymail] company search charged ${creditsCharged} (status=${emailStatus})`);
    }

    // valid_emails 优先；否则在 valid 状态下用 emails；risky 免费也可展示但标记 risky
    let list: string[] = [];
    if (Array.isArray(data.valid_emails) && data.valid_emails.length) {
      list = data.valid_emails;
    } else if (emailStatus === 'valid' && Array.isArray(data.emails)) {
      list = data.emails;
    } else if (emailStatus === 'risky' && Array.isArray(data.emails)) {
      list = data.emails;
    } else if (typeof data.valid_email === 'string' && data.valid_email) {
      list = [data.valid_email];
    }

    const isVerified = emailStatus === 'valid';
    const people = list.slice(0, 20).map((email: string) => {
      const parsed = nameFromEmailLocal(email);
      const generic = isGenericRoleEmail(email);
      const title = generic ? '待补充职位（职能邮箱）' : '待补充职位';
      return {
        name: parsed.name,
        firstName: generic ? undefined : parsed.firstName,
        lastName: generic ? undefined : parsed.lastName,
        title,
        emailGuess: email,
        type: 'Other' as const,
        source: 'AnymailFinder' as const,
        emailSource: 'AnymailFinder',
        emailStatus: isVerified ? 'valid' : emailStatus,
        isVerified,
        confidence: isVerified ? 0.92 : 0.55,
        influenceScore: generic ? 1 : 2,
      } satisfies DecisionMaker;
    });

    return { people, creditsCharged, emailStatus };
  } catch (e) {
    console.error('Anymail company find error', e);
    return { people: [], creditsCharged: 0, emailStatus: 'error' };
  }
};

/**
 * 按角色挖决策人（每成功 1 人约 2 积分）。
 * 仅作深挖补充，默认搜索不要并行打多个类别。
 */
const fetchAnymailDecisionMakers = async (
  domain: string,
  categories: Array<{ categories: string[]; title: string; score: number }> = [
    { categories: ['buyer'], title: 'Procurement / Buyer', score: 5 },
  ]
): Promise<DecisionMaker[]> => {
  const apiKey = getEmailSearchKeys().anymailFinder;
  if (!domain || !apiKey) return [];
  const people: DecisionMaker[] = [];
  const seenEmails = new Set<string>();

  // 串行：按优先级找，找到足够采购相关即可停，避免一次扣 8 分
  for (const role of categories) {
    try {
      const response = await anymailFetch(
        '/v5.1/find-email/decision-maker',
        apiKey,
        {
          domain: cleanDomain(domain),
          decision_maker_category: role.categories,
        },
        180_000
      );
      if (!response.ok) {
        console.warn('Anymail decision-maker HTTP', response.status, role.categories.join(','));
        continue;
      }
      const data = await response.json();
      const person = mapAnymailPersonPayload(data, role.title, role.score);
      if (!person?.emailGuess) continue;
      const key = person.emailGuess.toLowerCase();
      if (seenEmails.has(key)) continue;
      seenEmails.add(key);
      people.push(person);
      if (people.length >= 4) break;
    } catch (e) {
      console.warn('Anymail decision-maker error', role.categories, e);
    }
  }
  return people;
};

/**
 * 用 AnySearch（官网/网页检索）+ 联网 AI 为域名邮箱补全：全名、职位、LinkedIn。
 * 不额外消耗 Anymail 积分。
 */
const enrichCompanyContactsWithWebIntel = async (
  domain: string,
  companyName: string,
  contacts: DecisionMaker[]
): Promise<DecisionMaker[]> => {
  const targets = contacts.filter((c) => c.emailGuess && needsProfileEnrichment(c)).slice(0, 20);
  if (!targets.length) return contacts;

  // 1) AnySearch：并行检索每人 + 公司团队页线索
  let searchEvidence = '';
  if (getAnysearchApiKey().trim() || isSupabaseConfigured()) {
    try {
      const queries = [
        {
          query: `${companyName || domain} ${domain} LinkedIn company employees team leadership procurement`,
          max_results: 5,
        },
        ...targets.slice(0, 4).map((c) => ({
          query: `${c.emailGuess} OR ${c.name} ${domain} LinkedIn job title`,
          max_results: 3,
        })),
      ].slice(0, 5);
      const batchText = await anysearchBatchSearch(queries);
      if (batchText?.trim()) {
        searchEvidence = batchText.trim().slice(0, 8_000);
        console.log('[DM enrich] AnySearch evidence chars:', searchEvidence.length);
      }
    } catch (e) {
      console.warn('[DM enrich] AnySearch batch failed', e);
    }
  }

  const roster = targets
    .map(
      (c, i) =>
        `${i + 1}. email=${c.emailGuess}; guessedName=${c.name}; first=${c.firstName || ''}; last=${c.lastName || ''}; currentTitle=${c.title || ''}`
    )
    .join('\n');

  const prompt = `你是外贸 B2B 情报分析师。请为公司联系人补全「真实全名 + 职位 + LinkedIn」。

公司：${companyName || domain}
官网域名：${domain}

AnySearch 网页检索证据（优先采信；可能含 LinkedIn / 新闻 / 团队页片段）：
${searchEvidence || '（无 AnySearch 证据，请自行联网搜索 LinkedIn、官网 About/Team/Contact）'}

待补全联系人（邮箱来自 Anymail 公司域名搜索，姓名可能只是邮箱前缀）：
${roster}

任务：
1. 对每人用邮箱本地部分 + 公司名在 LinkedIn / 官网 / 新闻中交叉验证。
2. 输出真实 First Last 全名（拉丁字母姓名优先）；查不到则 fullName 留空，不要把邮箱前缀当全名。
3. 职位写具体岗位（如 Purchasing Manager / Category Buyer / CFO）；查不到 title 留空。
4. linkedin 必须是 linkedin.com/in/... 个人主页；不确定则留空，严禁编造。
5. 采购/买手/品类/供应链 → type=Buyer；CEO/Founder/Owner/President → CEO；其它 Other。

严格返回 JSON 数组（与输入人数相同、顺序一致）：
[{"email":"...","fullName":"","firstName":"","lastName":"","title":"","phone":"","whatsapp":"","linkedin":"","type":"CEO|Buyer|Other","influenceScore":1-5}]
规则补充：
- phone / whatsapp 仅填公开可查到的号码（官网 Contact、名片、新闻）；查不到留空，不要编造。
- WhatsApp 可为国际号码格式或 wa.me 链接中的号码。
只输出 JSON，不要 markdown。`;

  try {
    const text = await callQwen(prompt, {
      jsonMode: true,
      enableSearch: true,
      forcedSearch: true,
      task: 'analysis',
      timeoutMs: 120_000,
    });
    const parsed = extractJson(text, true);
    if (!Array.isArray(parsed) || !parsed.length) {
      console.warn('[DM enrich] empty/invalid AI enrich result');
      return contacts;
    }

    const byEmail = new Map<string, any>();
    for (const row of parsed) {
      const em = String(row?.email || '').toLowerCase().trim();
      if (em) byEmail.set(em, row);
    }

    return contacts.map((c) => {
      const row = byEmail.get((c.emailGuess || '').toLowerCase());
      if (!row) return c;
      const title = String(row.title || '').trim();
      const fullName = String(row.fullName || '').trim();
      const firstName = String(row.firstName || '').trim() || undefined;
      const lastName = String(row.lastName || '').trim() || undefined;
      const linkedin = String(row.linkedin || '').trim();
      const phone = String(row.phone || '').trim();
      const whatsapp = String(row.whatsapp || '').trim();
      const typeRaw = String(row.type || '').trim();
      const type: DecisionMaker['type'] =
        typeRaw === 'CEO' || typeRaw === 'Buyer'
          ? typeRaw
          : title
            ? classifyDecisionMakerType(title)
            : c.type;
      const influenceScore = Math.min(
        5,
        Math.max(
          1,
          Number(row.influenceScore) ||
            (type === 'Buyer' ? 5 : type === 'CEO' ? 4 : c.influenceScore || 2)
        )
      );
      const preferName =
        fullName && !isIncompletePersonName(fullName)
          ? fullName
          : firstName && lastName
            ? `${firstName} ${lastName}`
            : '';
      return {
        ...c,
        name: preferName || c.name,
        firstName: firstName || c.firstName,
        lastName: lastName || c.lastName,
        title: title && !isWeakJobTitle(title) ? title : isWeakJobTitle(c.title) ? title || c.title : c.title,
        phone: phone || c.phone,
        whatsapp: whatsapp || c.whatsapp,
        linkedin: linkedin && /linkedin\.com\/in\//i.test(linkedin) ? linkedin : c.linkedin,
        type,
        influenceScore,
      };
    });
  } catch (e) {
    console.warn('enrichCompanyContactsWithWebIntel failed', e);
    return contacts;
  }
};

/** 验证邮箱（仅用于非 Anymail 来源的二次确认；每次约 0.2 分） */
const verifyEmailWithAnymail = async (
  email: string
): Promise<{ emailStatus: string; isVerified: boolean; creditsCharged?: number } | null> => {
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
    const creditsCharged = Number(data.credits_charged || 0);
    if (creditsCharged > 0) console.info(`[Anymail] verify charged ${creditsCharged}: ${email}`);
    return { emailStatus, isVerified: emailStatus === 'valid', creditsCharged };
  } catch (e) {
    console.error('Anymail verify error', e);
    return null;
  }
};

const isAnymailVerified = (dm: DecisionMaker): boolean =>
  (dm.emailSource === 'AnymailFinder' || dm.source === 'AnymailFinder') &&
  !!dm.isVerified &&
  (dm.emailStatus || '').toLowerCase() === 'valid';

const stampChecked = (dm: DecisionMaker, at: number): DecisionMaker => ({
  ...dm,
  lastEmailCheckedAt: at,
});

export type DecisionMakerResearchStats = {
  added: number;
  upgraded: number;
  verified: number;
  anymailFound: number;
  linkedinDiscovered: number;
  reFoundAfterInvalid: number;
};

export type DecisionMakerResearchResult = {
  decisionMakers: DecisionMaker[];
  searchedAt: number;
  stats: DecisionMakerResearchStats;
};

/**
 * 决策人邮箱搜索：
 * 1) 角色决策人接口优先（官方返回 person_job_title，与官网页一致）
 * 2) 公司域名搜索拿更多邮箱 → AnySearch + 大模型补全姓名/职位/领英
 * 3) 已有 LinkedIn 但缺职位：用 person+linkedin_url 补职位（官网同款有职位）
 * 4) 仅当 Anymail 完全无邮箱时，才回退 Hunter domain-search
 */
export const researchDecisionMakerEmails = async (opts: {
  domain: string;
  existing?: DecisionMaker[];
  companyName?: string;
  /** 对非 Anymail 来源邮箱做 verify（默认 true） */
  reverifyNonAnymail?: boolean;
  /** 深挖：角色接口（默认开） */
  deepDig?: boolean;
}): Promise<DecisionMakerResearchResult> => {
  const searchedAt = Date.now();
  const domain = cleanDomain(opts.domain || '');
  const companyName = (opts.companyName || '').trim();
  const reverifyNonAnymail = opts.reverifyNonAnymail !== false;
  const deepDig = opts.deepDig !== false; // 默认深挖：角色接口带回姓名+职位

  const stats: DecisionMakerResearchStats = {
    added: 0,
    upgraded: 0,
    verified: 0,
    anymailFound: 0,
    linkedinDiscovered: 0,
    reFoundAfterInvalid: 0,
  };

  if (!companyName && (!domain || !domain.includes('.'))) {
    return {
      decisionMakers: rankDecisionMakers([...(opts.existing || [])]),
      searchedAt,
      stats,
    };
  }

  const merged: DecisionMaker[] = (opts.existing || []).map((d) => ({ ...d }));
  const hasAnymail = !!getEmailSearchKeys().anymailFinder;
  const hasHunter = !!getEmailSearchKeys().hunter;

  // 清理背调 AI 占位人（无真实姓名、无邮箱）——避免干扰公司域名搜索结果与「再次搜索」
  for (let i = merged.length - 1; i >= 0; i--) {
    const dm = merged[i];
    const name = dm.name || [dm.firstName, dm.lastName].filter(Boolean).join(' ');
    const isJunkPlaceholder =
      !dm.emailGuess &&
      (dm.source === 'AI' || dm.source === 'AI (Pattern Guess)') &&
      (isPlaceholderPersonName(name) || /待补充|Company Contact/i.test(dm.title || ''));
    if (isJunkPlaceholder) {
      merged.splice(i, 1);
    }
  }

  const personLabel = (dm: DecisionMaker) =>
    dm.name || [dm.firstName, dm.lastName].filter(Boolean).join(' ');

  const emailKey = (dm: DecisionMaker) => (dm.emailGuess || '').toLowerCase().trim();
  const seenEmails = new Set(merged.map(emailKey).filter(Boolean));

  const pushOrMergeCompanyContact = (candidate: DecisionMaker) => {
    const em = emailKey(candidate);
    if (!em) return;
    const idx = merged.findIndex((d) => emailKey(d) === em);
    if (idx >= 0) {
      const cur = merged[idx];
      // 已是 Anymail 已验证：仍刷新时间戳，计为「已覆盖确认」，避免用户误以为搜索失败
      if (isAnymailVerified(cur)) {
        merged[idx] = stampChecked(
          {
            ...cur,
            title:
              cur.title && !isWeakJobTitle(cur.title)
                ? cur.title
                : candidate.title || cur.title,
            linkedin: cur.linkedin || candidate.linkedin,
            name: !isIncompletePersonName(cur.name) ? cur.name : candidate.name,
          },
          searchedAt
        );
        stats.upgraded += 1;
        stats.anymailFound += 1;
        return;
      }
      merged[idx] = stampChecked(
        {
          ...cur,
          ...candidate,
          name: !isIncompletePersonName(cur.name) ? cur.name : candidate.name,
          title: !isWeakJobTitle(cur.title) ? cur.title : candidate.title,
          linkedin: cur.linkedin || candidate.linkedin,
          type: cur.type !== 'Other' ? cur.type : candidate.type,
          influenceScore: Math.max(cur.influenceScore || 0, candidate.influenceScore || 0) || candidate.influenceScore,
        },
        searchedAt
      );
      stats.upgraded += 1;
      if (candidate.emailSource === 'Hunter.io' || candidate.source === 'Hunter.io') {
        /* hunter merge counted below via caller */
      } else {
        stats.anymailFound += 1;
      }
      return;
    }
    seenEmails.add(em);
    merged.push(stampChecked(candidate, searchedAt));
    stats.added += 1;
    if (candidate.emailSource === 'Hunter.io' || candidate.source === 'Hunter.io') {
      /* counted by hunter fallback */
    } else {
      stats.anymailFound += 1;
    }
  };

  const countWithEmail = () => merged.filter((d) => !!d.emailGuess?.includes('@')).length;
  const emailsBeforeAnymail = countWithEmail();

  try {
    if (hasAnymail) {
      // ——— 1) 角色决策人优先（官方返回 person_job_title，与手动搜索一致）———
      if (deepDig && domain) {
        const roleCandidates = await fetchAnymailDecisionMakers(domain, [
          { categories: ['buyer'], title: 'Procurement / Buyer', score: 5 },
          { categories: ['ceo'], title: 'CEO / Owner', score: 4 },
          { categories: ['sales'], title: 'Sales Director', score: 4 },
          { categories: ['logistics'], title: 'Logistics / Supply Chain', score: 4 },
          { categories: ['finance'], title: 'Finance / CFO', score: 3 },
          { categories: ['marketing'], title: 'Marketing / Brand', score: 3 },
        ]);
        for (const candidate of roleCandidates) {
          const em = emailKey(candidate);
          if (em && seenEmails.has(em)) {
            const idx = merged.findIndex((d) => emailKey(d) === em);
            if (idx >= 0) {
              const cur = merged[idx];
              merged[idx] = stampChecked(
                {
                  ...cur,
                  name:
                    candidate.name && !isIncompletePersonName(candidate.name)
                      ? candidate.name
                      : cur.name,
                  firstName: cur.firstName || candidate.firstName,
                  lastName: cur.lastName || candidate.lastName,
                  title:
                    candidate.title && !isWeakJobTitle(candidate.title)
                      ? candidate.title
                      : cur.title,
                  linkedin: cur.linkedin || candidate.linkedin,
                  type: candidate.type !== 'Other' ? candidate.type : cur.type,
                  influenceScore: Math.max(
                    cur.influenceScore || 0,
                    candidate.influenceScore || 0
                  ),
                },
                searchedAt
              );
              stats.upgraded += 1;
              if (candidate.linkedin) stats.linkedinDiscovered += 1;
            }
            continue;
          }
          if (em) seenEmails.add(em);
          merged.push(stampChecked(candidate, searchedAt));
          stats.added += 1;
          stats.anymailFound += 1;
          if (candidate.linkedin) stats.linkedinDiscovered += 1;
        }
      }

      // ——— 2) 公司域名搜索（补齐更多邮箱；API 本身不返回职位）———
      if (domain || companyName) {
        const companyHit = await fetchAnymailCompanyEmails(domain, {
          companyName: companyName || undefined,
          emailType: 'any',
        });
        let companyPeople = companyHit.people;
        if (companyPeople.length) {
          // 姓名/职位/领英：用 AnySearch + 大模型补全，不调用 Hunter（省额度）
          companyPeople = await enrichCompanyContactsWithWebIntel(
            domain || companyName,
            companyName || domain,
            companyPeople
          );
          for (const p of companyPeople) {
            if (p.linkedin) stats.linkedinDiscovered += 1;
            pushOrMergeCompanyContact(p);
          }
        }
      }

      // ——— 3) 已有真实姓名：补邮箱 / 校验非 Anymail 邮箱 ———
      for (let i = 0; i < merged.length; i++) {
        const dm = merged[i];
        const name = personLabel(dm);
        if (isPlaceholderPersonName(name) && !(dm.firstName && dm.lastName)) continue;
        if (isAnymailVerified(dm)) continue;
        // 已由公司域名搜索拿到的邮箱不再按人扣分重查
        if (dm.emailSource === 'AnymailFinder' && dm.emailGuess) continue;

        if (
          reverifyNonAnymail &&
          dm.emailGuess?.includes('@') &&
          dm.emailSource !== 'AnymailFinder' &&
          dm.source !== 'AnymailFinder'
        ) {
          const status = (dm.emailStatus || '').toLowerCase();
          if (!(dm.isVerified && status === 'valid')) {
            const verified = await verifyEmailWithAnymail(dm.emailGuess);
            if (verified) {
              stats.verified += 1;
              merged[i] = stampChecked(
                {
                  ...dm,
                  emailStatus: verified.emailStatus,
                  isVerified: verified.isVerified,
                },
                searchedAt
              );
              if (verified.isVerified) continue;
            }
          } else {
            continue;
          }
        }

        const cur = merged[i];
        const statusNow = (cur.emailStatus || '').toLowerCase();
        const needsFind =
          !cur.emailGuess ||
          (!isAnymailVerified(cur) &&
            (statusNow === 'invalid' ||
              statusNow === 'not_found' ||
              statusNow === 'blacklisted' ||
              statusNow === 'risky' ||
              statusNow === 'unverified' ||
              !cur.isVerified));

        if (!needsFind) continue;
        if (!isLikelyRealPerson(cur)) continue;

        const hadBadEmail = !!cur.emailGuess && !isAnymailVerified(cur);
        const found = await findEmailWithAnymail(name, {
          firstName: cur.firstName,
          lastName: cur.lastName,
          domain: domain || undefined,
          companyName: companyName || undefined,
          linkedinUrl: cur.linkedin,
        });

        if (!found?.email) continue;
        const em = found.email.toLowerCase();
        if (seenEmails.has(em) && emailKey(cur) !== em) {
          continue;
        }
        seenEmails.add(em);

        merged[i] = stampChecked(
          {
            ...cur,
            emailGuess: found.email,
            emailSource: 'AnymailFinder',
            source: 'AnymailFinder',
            emailStatus: 'valid',
            isVerified: true,
            confidence: found.confidence,
            name: found.fullName && isPlaceholderPersonName(cur.name) ? found.fullName : cur.name,
            firstName: cur.firstName || found.firstName,
            lastName: cur.lastName || found.lastName,
            title: found.title && !isWeakJobTitle(found.title) ? found.title : cur.title,
            linkedin: cur.linkedin || found.linkedin,
            type: found.title ? classifyDecisionMakerType(found.title) : cur.type,
          },
          searchedAt
        );
        stats.upgraded += 1;
        stats.anymailFound += 1;
        if (hadBadEmail) stats.reFoundAfterInvalid += 1;
      }

      // ——— 4) 缺职位但已有 LinkedIn：用 linkedin_url 补职位（官网手动搜同路径）———
      let titleEnrichBudget = 6;
      for (let i = 0; i < merged.length && titleEnrichBudget > 0; i++) {
        const cur = merged[i];
        if (!isWeakJobTitle(cur.title)) continue;
        const li = (cur.linkedin || '').trim();
        if (!li || !/linkedin\.com\/in\//i.test(li)) continue;
        titleEnrichBudget -= 1;
        const found = await findEmailWithAnymail(personLabel(cur) || '', {
          firstName: cur.firstName,
          lastName: cur.lastName,
          domain: domain || undefined,
          companyName: companyName || undefined,
          linkedinUrl: li,
        });
        if (!found?.title || isWeakJobTitle(found.title)) continue;
        merged[i] = stampChecked(
          {
            ...cur,
            title: found.title,
            name:
              found.fullName && isIncompletePersonName(cur.name) ? found.fullName : cur.name,
            firstName: cur.firstName || found.firstName,
            lastName: cur.lastName || found.lastName,
            type: classifyDecisionMakerType(found.title),
            // 若已有有效邮箱则保留；否则用 LinkedIn 找回的邮箱
            emailGuess: cur.emailGuess || found.email,
            emailSource: cur.emailGuess ? cur.emailSource : 'AnymailFinder',
            source: cur.source || 'AnymailFinder',
            emailStatus: cur.emailGuess ? cur.emailStatus : 'valid',
            isVerified: cur.emailGuess ? cur.isVerified : true,
          },
          searchedAt
        );
        stats.upgraded += 1;
      }
    }

    // ——— 4) 仅当 Anymail 完全未找到邮箱时，才回退 Hunter（避免浪费 Hunter 额度）———
    const anymailFoundContacts = stats.anymailFound > 0 || countWithEmail() > emailsBeforeAnymail;
    const needHunterFallback = hasHunter && domain && domain.includes('.') && !anymailFoundContacts;

    if (needHunterFallback) {
      console.info('[DM] Anymail 无邮箱结果，回退 Hunter.io domain-search');
      try {
        const hunterHit = await fetchHunterEmails(domain);
        for (const p of hunterHit.people) {
          const em = emailKey(p);
          if (!em || seenEmails.has(em)) continue;
          seenEmails.add(em);
          merged.push(stampChecked(p, searchedAt));
          stats.added += 1;
          if (p.linkedin) stats.linkedinDiscovered += 1;
        }
      } catch (hunterErr) {
        // 额度/网络问题：静默，保留已有结果
        console.info('[DM] Hunter fallback skipped (no user-facing error)', hunterErr);
      }
    }
  } catch (e) {
    console.error('researchDecisionMakerEmails failed', e);
  }

  return {
    decisionMakers: rankDecisionMakers(merged),
    searchedAt,
    stats,
  };
};

/** 后台测试 Anymail Finder Key 是否可用（短超时，避免云端长时间无反馈） */
export const testAnymailFinderApiKey = async (
  apiKey: string
): Promise<{ success: boolean; message: string }> => {
  const key = (apiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!key) return { success: false, message: '请先填写 AnymailFinder API Key' };
  try {
    const response = await anymailFetch(
      '/v5.1/verify-email',
      key,
      { email: 'connection-test@example.com' },
      20_000
    );
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
    const hint = /Failed to fetch|NetworkError|超时|timeout|AbortError/i.test(msg)
      ? isLocalDevHost()
        ? ' 请重启 npm run dev（需要 /anymail-api 代理），然后强制刷新页面再测。'
        : ' 请确认线上已部署 /api/anymail，或稍后再试。'
      : '';
    return {
      success: false,
      message: `AnymailFinder 测试失败: ${msg}.${hint}`,
    };
  }
};

/** 后台测试 AnySearch（背调身份补全；Key 由服务端/本地代理从 ANYSEARCH_API_KEY 注入） */
export const testAnysearchApiKey = async (): Promise<{ success: boolean; message: string }> => {
  const r = await testAnysearchConnection();
  return { success: r.ok, message: r.message };
};

/** 后台测试 Hunter.io Key（读账户额度，短超时） */
export const testHunterApiKey = async (
  apiKey: string
): Promise<{ success: boolean; message: string }> => {
  const key = (apiKey || '').trim();
  if (!key) return { success: false, message: '请先填写 Hunter.io API Key' };
  try {
    const { url } = resolveHunterUrl('/v2/account', { api_key: key });
    const response = await fetchWithTimeout(url, { method: 'GET' }, 20_000);
    const text = await response.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
    if (response.status === 401 || response.status === 403) {
      return { success: false, message: `鉴权失败 (${response.status})：Hunter Key 无效或权限不足` };
    }
    if (response.status === 429 || response.status === 402) {
      return {
        success: true,
        message: 'Hunter.io Key 有效 ✅（当前额度不足或限流，但鉴权已通过；决策人挖掘时会静默跳过）',
      };
    }
    if (!response.ok) {
      const detail =
        data?.errors?.[0]?.details ||
        data?.errors?.[0]?.id ||
        data?.message ||
        text;
      return {
        success: false,
        message: `测试失败 HTTP ${response.status}: ${String(detail).slice(0, 160)}`,
      };
    }
    const searches = data?.data?.requests?.searches;
    const email = data?.data?.email || data?.data?.first_name || '';
    const used = searches?.used;
    const available = searches?.available;
    const quota =
      typeof used === 'number' && typeof available === 'number'
        ? `搜索额度 ${used}/${available}`
        : '账户可读';
    return {
      success: true,
      message: `Hunter.io 连接成功 ✅${email ? `（${email}）` : ''} · ${quota}`,
    };
  } catch (e: any) {
    const msg = String(e?.message || e);
    const hint = /Failed to fetch|NetworkError|超时|timeout|AbortError/i.test(msg)
      ? hunterProxyHint()
      : '';
    return {
      success: false,
      message: `Hunter.io 测试失败: ${msg}.${hint}`,
    };
  }
};

// --- API Configuration ---

export const getGeminiConfig = (): ApiConfig[] => {
    const configs: ApiConfig[] = [];

    // 官方 Gemini Key（管理后台专用字段，优先）
    if (typeof localStorage !== 'undefined') {
        const officialKey = localStorage.getItem('trade_scout_gemini_api_key')?.trim();
        const officialModel =
          localStorage.getItem('trade_scout_gemini_model_id')?.trim() || NATIVE_MODEL;
        if (officialKey) {
            configs.push({
                id: 'gemini_official',
                apiKey: officialKey,
                baseUrl: 'native',
                modelId: officialModel,
                priority: 0,
                taskAssignment: 'default',
            });
        }

        const stored = localStorage.getItem('trade_scout_api_configs');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                const extras = (parsed as ApiConfig[]).filter(
                  (c) =>
                    c.apiKey &&
                    c.apiKey.trim() !== '' &&
                    c.apiKey.trim() !== officialKey &&
                    (c.baseUrl === 'native' ||
                      (c.baseUrl || '').includes('generativelanguage.googleapis.com'))
                );
                configs.push(...extras);
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
    if (typeof localStorage !== 'undefined' && localStorage.getItem('trade_scout_gemini_api_key')?.trim()) return true;
    if (getGeminiConfig().length > 0) return true;
    if (env.apiKey) return true;
    return false;
};

/** 从 Supabase 拉取管理员保存的 API 密钥到 localStorage（含邮箱搜索 Key）
 * 注意：即使本地已有千问 Key，也必须继续同步 Hunter / Anymail，否则决策人挖掘会空跑。
 */
export const hydrateApiConfigsFromCloud = async (): Promise<boolean> => {
    if (!isSupabaseConfigured()) return hasApiKeyConfigured();

    try {
        const configs = await getAllApiConfigs();
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
            if (c.provider === 'anysearch' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_anysearch_api_key', c.apiKey.trim());
            }
            if (c.provider === 'tavily' && c.apiKey?.trim()) {
                const raw = c.apiKey.trim();
                try {
                  const parsed = JSON.parse(raw);
                  if (Array.isArray(parsed)) {
                    localStorage.setItem('trade_scout_tavily_api_keys', JSON.stringify(parsed));
                    localStorage.setItem('trade_scout_tavily_api_key', String(parsed[0] || ''));
                  } else {
                    localStorage.setItem('trade_scout_tavily_api_key', raw);
                  }
                } catch {
                  localStorage.setItem('trade_scout_tavily_api_key', raw);
                }
            }
            if (c.provider === 'wan' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_wan_api_key', c.apiKey.trim());
                if (c.baseUrl?.trim()) localStorage.setItem('trade_scout_wan_base_url', c.baseUrl.trim());
                if (c.modelId?.trim()) localStorage.setItem('trade_scout_wan_model_id', c.modelId.trim());
            }
            if (c.provider === 'gemini' && c.apiKey?.trim()) {
                localStorage.setItem('trade_scout_gemini_api_key', c.apiKey.trim());
                if (c.modelId?.trim()) localStorage.setItem('trade_scout_gemini_model_id', c.modelId.trim());
            }
            if (c.provider === 'task_ai_models' && c.apiKey?.trim()) {
                try {
                    // 本机刚改过路由则不要被云端旧值盖掉
                    const localTs = Number(localStorage.getItem('trade_scout_task_ai_models_ts') || 0);
                    const freshLocal = Date.now() - localTs < 7 * 24 * 3600 * 1000 && localTs > 0;
                    const localRaw = localStorage.getItem('trade_scout_task_ai_models');
                    if (freshLocal && localRaw) {
                      /* keep local independent routing */
                    } else {
                      const parsed = JSON.parse(c.apiKey) as TaskAIModels;
                      saveTaskAIModels({
                        search: parsed.search === 'qwen' ? 'qwen' : 'gemini',
                        analysis: parsed.analysis === 'qwen' ? 'qwen' : 'gemini',
                        organize: parsed.organize === 'qwen' ? 'qwen' : 'gemini',
                      });
                    }
                } catch {
                  /* ignore */
                }
            }
        }
        return hasApiKeyConfigured();
    } catch (e) {
        console.error('Failed to hydrate API configs from Supabase', e);
        return hasApiKeyConfigured();
    }
};

/** 确保邮箱搜索 Key 已从云端同步到本机（决策人挖掘前调用） */
export const ensureEmailSearchKeysReady = async (): Promise<{
  anymail: boolean;
  hunter: boolean;
  findymail: boolean;
}> => {
  try {
    await hydrateApiConfigsFromCloud();
  } catch (e) {
    console.warn('ensureEmailSearchKeysReady hydrate failed', e);
  }
  const keys = getEmailSearchKeys();
  return {
    anymail: !!keys.anymailFinder,
    hunter: !!keys.hunter,
    findymail: !!keys.findymail,
  };
};

export const checkApiKeyAvailability = async (): Promise<boolean> => {
    // 始终尝试同步云端（含邮箱 Key）；本地已有千问时也不能跳过
    if (isSupabaseConfigured()) {
      try {
        await hydrateApiConfigsFromCloud();
      } catch {
        /* ignore */
      }
    }
    if (hasApiKeyConfigured()) return true;
    if (typeof window !== 'undefined' && window.aistudio?.hasSelectedApiKey) {
        const studioKey = await window.aistudio.hasSelectedApiKey();
        if (studioKey) return true;
    }
    return hasApiKeyConfigured();
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

    // Vercel 单文件代理：把 /chat/completions 写入 __upstream，避免多段路径 404
    if (baseUrl.includes('__upstream=')) {
        try {
            const u = new URL(baseUrl, 'http://local.invalid');
            let up = u.searchParams.get('__upstream') || '';
            if (up && !up.endsWith('/chat/completions') && !up.includes('generateContent')) {
                up = `${up.replace(/\/$/, '')}/chat/completions`;
                u.searchParams.set('__upstream', up);
                baseUrl = `${u.pathname}${u.search}`;
            }
        } catch {
            /* keep */
        }
    } else if (!baseUrl.endsWith('/chat/completions') && !baseUrl.includes('generateContent')) {
        // Auto-append chat/completions if not present (Standard OpenAI format)
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
                
                // 402/429：区分瞬时限流 vs 套餐额度耗尽（阿里云两者都可能是 429）
                if (response.status === 402 || response.status === 429) {
                    const parsed = parseAliyunLimitError(response.status, errText);
                    if (parsed.kind === 'rate') {
                      const retryAfter = Number(response.headers.get('Retry-After') || 0);
                      noteRateLimited(retryAfter > 0 ? retryAfter : 60);
                    }
                    throw new Error(formatAliyunLimitError(response.status, parsed.kind, parsed.detail));
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
              e.message.includes('请求过于频繁') ||
              e.message.includes('套餐额度已用尽') ||
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
        if (/FUNCTION_INVOCATION_FAILED/i.test(String(lastError?.message || ''))) {
          errorMsg += ' 同域云函数异常，请重新部署最新代码后重试。';
        } else if (!isLocalDevHost() && isDomesticQwenEndpoint(baseUrl) && !baseUrl.includes('/functions/v1/qwen-proxy') && !isAppHostedQwenProxy(baseUrl)) {
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
        const text = await callGeminiGenerateContent(config.apiKey, config.modelId || NATIVE_MODEL, {
          prompt,
          systemInstruction: systemInfo,
          jsonMode,
          enableSearch: needsWebSearch,
          images,
          attachments,
        });
        if (text) return text;
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
    /** 连接测试：禁止降级重试，避免后台转圈数分钟 */
    connectionTest?: boolean;
    maxTokens?: number;
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
  // 连接测试严格短超时；正式任务线上代理最长约 280s
  const timeoutMs = options.connectionTest
    ? Math.min(rawTimeout, CONNECTION_TEST_TIMEOUT_MS)
    : viaSupabase
      ? Math.min(rawTimeout, 50_000)
      : viaAppProxy && !isLocalDevHost()
        ? Math.min(rawTimeout, 280_000)
        : rawTimeout;
  const searchPayload = qwenSearchPayload(!!options.enableSearch, !!options.forcedSearch);
  const maxTokens =
    options.maxTokens ??
    (options.connectionTest
      ? 64
      : options.task === 'search'
        ? viaSupabase
          ? 2000
          : config.baseUrl.includes('/functions/v1/qwen-proxy')
            ? 2500
            : 4096
        : options.task === 'analysis'
          ? viaSupabase
            ? 3000
            : 6144
          : 4096);

  const runOnce = async (extraPayload: Record<string, unknown> | undefined) => {
    if (
      isQwenOpenAICompatible(config.baseUrl) ||
      config.baseUrl.startsWith('/qwen-api') ||
      config.baseUrl.startsWith('/api/qwen') ||
      config.baseUrl.includes('/qwen-api/') ||
      config.baseUrl.includes('__upstream=')
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
    const msg0 = String(err?.message || '');
    const isQuotaErr = /套餐额度已用尽|AllocationQuota|Allocated quota|insufficient_quota/i.test(msg0);
    const isRateErr =
      !isQuotaErr &&
      /请求过于频繁|rate\s*limit|429|Throttling|Too many requests|Rate Limit/i.test(msg0);

    // 连接测试：额度耗尽立即失败；瞬时限流则短退避重试（最多 2 次）
    if (options.connectionTest) {
      if (isQuotaErr) throw err;
      if (isRateErr) {
        for (let i = 1; i <= 2; i++) {
          const waitMs = i === 1 ? 8_000 : 20_000;
          console.warn(`[Qwen] 连接测试遇限流，${waitMs / 1000}s 后重试 (${i}/2)…`);
          noteRateLimited(Math.ceil(waitMs / 1000));
          await waitForApiCooldown();
          try {
            return await runOnce(searchPayload);
          } catch (retryErr: any) {
            const m2 = String(retryErr?.message || '');
            if (/套餐额度已用尽|AllocationQuota|Allocated quota|insufficient_quota/i.test(m2)) {
              throw retryErr;
            }
            if (
              !/请求过于频繁|rate\s*limit|429|Throttling|Too many requests|Rate Limit/i.test(m2) ||
              i === 2
            ) {
              throw retryErr;
            }
          }
        }
      }
      throw err;
    }

    const msg = msg0;
    const isTimeout = /超时|timeout|AbortError|504|Gateway Timeout|上游超时/i.test(msg);
    const is546 = /546|WORKER_RESOURCE|云端代理算力不足/i.test(msg);
    const is429 = isRateErr || (/429|rate\s*limit|quota exceeded/i.test(msg) && !isQuotaErr);

    // 限流：短退避后自动重试（最多 2 次），避免整页反复「冷却中」
    // 套餐额度耗尽不重试
    if (is429 && !isQuotaErr) {
      for (let i = 1; i <= 2; i++) {
        const waitMs = 20_000 * i;
        console.warn(`[Qwen] 限流 429，${waitMs / 1000}s 后重试 (${i}/2)…`);
        noteRateLimited(Math.ceil(waitMs / 1000));
        await waitForApiCooldown();
        try {
          return await runOnce(searchPayload);
        } catch (retryErr: any) {
          const m2 = String(retryErr?.message || '');
          if (/套餐额度已用尽|AllocationQuota|Allocated quota|insufficient_quota/i.test(m2)) {
            throw retryErr;
          }
          if (!/429|rate\s*limit|quota exceeded|请求过于频繁|Throttling/i.test(m2) || i === 2) {
            if (i === 2) throw retryErr;
            if (!/429|rate\s*limit|quota exceeded|请求过于频繁|Throttling/i.test(m2)) throw retryErr;
          }
        }
      }
    }
    if (isQuotaErr) throw err;

    // 客户搜索/背调：超时后先再试一次联网（代理已加长，避免立刻丢掉联网）
    if (
      options.enableSearch &&
      isTimeout &&
      (options.task === 'search' || options.task === 'analysis')
    ) {
      console.warn('[Qwen] 联网超时/504，联网重试一次…');
      try {
        return await runOnce(qwenSearchPayload(true, false));
      } catch (retryErr: any) {
        console.warn('[Qwen] 联网重试仍失败:', retryErr?.message || retryErr);
      }
    }

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

// --- Unified Generator：按任务各自路由（search / analysis / organize 独立）---
const generateContentUnified = async (
    task: TaskType, 
    prompt: string, 
    systemInfo?: string, 
    jsonMode: boolean = false, 
    images: string[] = [],
    attachments: KnowledgeFile[] = [],
    opts?: {
      /** 覆盖默认联网：客户搜索在已有 Tavily 证据时关联网，避免抢优先级 */
      enableSearch?: boolean;
    }
): Promise<string> => {
    const needsWebSearch =
      typeof opts?.enableSearch === 'boolean'
        ? opts.enableSearch
        : WEB_SEARCH_TASKS.includes(task);
    const map = getTaskAIModels();
    const engine = resolveEngineForTask(task);
    const systemText = systemInfo || QWEN_SYSTEM;

    const runQwen = async () => {
      let userContent = buildQwenUserContent(prompt, images, attachments);
      if (jsonMode && needsWebSearch && typeof userContent === 'string') {
        userContent += '\n\n【重要】请严格输出 JSON 格式，不要包含 markdown 代码块。';
      }
      const messages = [
        { role: 'system', content: systemText },
        { role: 'user', content: userContent },
      ];
      return callQwenChat(messages, {
        jsonMode,
        enableSearch: needsWebSearch,
        forcedSearch: false,
        task,
      });
    };

    const runGemini = async () => {
      const configs = getGeminiConfig();
      if (!configs.length) {
        throw new Error('未配置 Gemini 官方 API Key，请在管理后台「Gemini 官方」中填写');
      }
      const config =
        configs.find((c) => c.id === 'gemini_official') ||
        configs.find((c) => c.baseUrl === 'native') ||
        configs[0];
      if (images.length || attachments.length) {
        const text = await tryGeminiFailover(
          task,
          prompt,
          systemText,
          jsonMode,
          images,
          attachments,
          needsWebSearch
        );
        if (!text) throw new Error('Gemini 调用未返回结果');
        return text;
      }
      return callGeminiNative(prompt, { ...config, baseUrl: 'native' }, {
        jsonMode,
        enableSearch: needsWebSearch,
        systemInstruction: systemText,
      });
    };

    const cascadeLabel = engine === 'gemini' ? 'Gemini→千问' : '仅千问';
    console.log(
      `[AI] Task '${task}' → ${cascadeLabel}` +
        ` | 路由表: 搜索=${map.search}, 背调=${map.analysis}, 整理=${map.organize}` +
        `${needsWebSearch ? ' (联网)' : ' (不联网/用已有证据)'}` +
        `${hasGeminiOfficialKey() ? '' : ' [无Gemini Key]'}`
    );

    // 该项选「Gemini 优先」：先 Gemini，失败/额度尽再千问
    if (engine === 'gemini') {
      if (hasGeminiOfficialKey() || getGeminiConfig().length > 0) {
        try {
          return await runGemini();
        } catch (geminiErr: any) {
          console.warn(
            `[AI] Gemini 失败 (${task})，按路由降级千问:`,
            geminiErr?.message || geminiErr
          );
          try {
            return await runQwen();
          } catch (qwenErr: any) {
            throw new Error(
              `Gemini 与千问均失败。Gemini: ${geminiErr?.message || geminiErr}；千问: ${qwenErr?.message || qwenErr}`
            );
          }
        }
      }
      console.warn(`[AI] 未配置 Gemini，任务 ${task} 改用千问`);
      return await runQwen();
    }

    // 该项选「仅用千问」
    return await runQwen();
};

// --- Public Methods ---

export const testApiKey = async (apiKey: string, baseUrl?: string, modelId?: string): Promise<{ success: boolean; message: string }> => {
    try {
        // Special case for Official Native Key testing
        if (baseUrl === 'native') {
            const clean = sanitizeApiKey(apiKey);
            const testModel = modelId?.includes('gemini') ? modelId : NATIVE_MODEL;
            const reply = await callGeminiGenerateContent(clean, testModel, {
              prompt: 'Ping. Reply with the single word pong.',
              timeoutMs: 45_000,
            });
            return {
              success: true,
              message: `Google Native Connection Successful! ✅ (${describeKey(clean)}) 回复: ${reply.slice(0, 40)}`,
            };
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


/** Country aliases for HQ vs search-market conflict checks */
const COUNTRY_ALIAS_GROUPS: string[][] = [
  ['poland', 'polish', 'polska', '波兰', '华沙', 'warsaw', 'warszawa'],
  ['russia', 'russian', 'россия', '俄罗斯', '俄国', '莫斯科', 'moscow', 'москва'],
  ['germany', 'german', 'deutschland', '德国', 'berlin'],
  ['france', 'french', '法国', 'paris'],
  ['italy', 'italian', '意大利', 'rome', 'milan'],
  ['spain', 'spanish', '西班牙', 'madrid', 'barcelona'],
  ['uk', 'united kingdom', 'britain', 'england', '英国', 'london'],
  ['usa', 'united states', 'america', '美国', 'new york', 'california'],
  ['china', '中国', 'beijing', 'shanghai', 'shenzhen', 'guangzhou'],
  ['japan', '日本', 'tokyo', 'osaka'],
  ['korea', 'south korea', '韩国', 'seoul'],
  ['india', '印度', 'mumbai', 'delhi'],
  ['brazil', '巴西', 'sao paulo', 'são paulo'],
  ['mexico', '墨西哥', 'mexico city'],
  ['turkey', '土耳其', 'istanbul', 'ankara'],
  ['netherlands', 'holland', '荷兰', 'amsterdam'],
  ['belgium', '比利时', 'brussels'],
  ['czech', 'czechia', 'czech republic', '捷克', 'prague', 'praha'],
  ['romania', '罗马尼亚', 'bucharest'],
  ['hungary', '匈牙利', 'budapest'],
  ['ukraine', '乌克兰', 'kyiv', 'kiev'],
  ['australia', '澳大利亚', 'sydney', 'melbourne'],
  ['canada', '加拿大', 'toronto', 'vancouver'],
];

const normalizeGeoText = (s?: string) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();

const isVagueMarketCountry = (c?: string) =>
  !c?.trim() || /global|worldwide|international|国际|全球|不限/i.test(c.trim());

const geoGroupIndex = (text: string): number => {
  const n = normalizeGeoText(text);
  if (!n) return -1;
  for (let i = 0; i < COUNTRY_ALIAS_GROUPS.length; i++) {
    if (COUNTRY_ALIAS_GROUPS[i].some((a) => n.includes(a))) return i;
  }
  return -1;
};

const hqConflictsWithSearchCountry = (hq?: string, city?: string, searchCountry?: string): boolean => {
  if (isVagueMarketCountry(searchCountry)) return false;
  const market = geoGroupIndex(searchCountry || '');
  if (market < 0) return false;
  const loc = geoGroupIndex(`${hq || ''} ${city || ''}`);
  if (loc < 0) return false;
  return loc !== market;
};

/**
 * Second-pass identity verification: official domain wins over namesake brands.
 * Overwrites HQ/city/description when web search contradicts the first pass.
 */
const verifyCompanyIdentity = async (
  result: AnalysisResult,
  canonicalDomain: string,
  searchCountry?: string,
  identityEvidence?: string
): Promise<AnalysisResult> => {
  if (!canonicalDomain || canonicalDomain === 'unknown' || !canonicalDomain.includes('.')) {
    return result;
  }

  const info = result.companyInfo;
  const evidenceBlock = identityEvidence?.trim()
    ? `
GROUND-TRUTH EVIDENCE from AnySearch (MUST prefer this over draft / third-party mix-ups):
${identityEvidence.trim()}
`
    : '';

  const prompt = `
IDENTITY VERIFICATION (联网搜索，强制以官网为准)

Canonical domain (唯一身份主键): ${canonicalDomain}
Official website URL to verify: https://${canonicalDomain}
Search market hint (may be empty/Global): ${searchCountry || 'N/A'}
Current (possibly wrong) draft:
- Company: ${info.name}
- HQ: ${info.headquarters || 'N/A'}
- City: ${info.city || 'N/A'}
- Description: ${(info.description || '').slice(0, 320)}
${evidenceBlock}
TASK:
1. Use the AnySearch evidence above FIRST (official page extract + search snippets). Then web-search if needed.
2. Confirm legal entity name, headquarters city & country for THAT domain only.
3. REJECT any other company that merely shares a similar brand name in another country.
   Example: smyk.com = SMYK (Poland, Warsaw) — NOT a Russian retailer with a similar name / Moscow HQ.
4. If draft HQ/city/country/description conflicts with the official site / evidence, overwrite with official facts.
5. Rewrite description in Simplified Chinese to match the verified entity (max 2 sentences).
   Geography in the description MUST match verified HQ (do not say Russia if HQ is Poland).

Output JSON only:
{
  "verified": true,
  "companyName": "...",
  "headquarters": "City, Country",
  "city": "...",
  "description": "简体中文...",
  "corrected": true/false,
  "reason": "简短说明"
}
`;

  try {
    const text = await generateContentUnified('analysis', prompt, SYSTEM_INSTRUCTION, true);
    const v = extractJson(text) as Record<string, any>;
    if (!v || v.verified === false) return result;

    const next: AnalysisResult = {
      ...result,
      companyInfo: { ...result.companyInfo },
    };
    let changed = false;

    if (v.companyName && String(v.companyName).trim()) {
      next.companyInfo.name = String(v.companyName).trim();
      changed = true;
    }
    if (v.headquarters && String(v.headquarters).trim()) {
      next.companyInfo.headquarters = String(v.headquarters).trim();
      changed = true;
    }
    if (v.city && String(v.city).trim()) {
      next.companyInfo.city = String(v.city).trim();
      changed = true;
    }
    if (v.description && String(v.description).trim()) {
      next.companyInfo.description = String(v.description).trim();
      changed = true;
    }

    // Keep website bound to canonical domain
    next.companyInfo.website = canonicalDomain;

    if (hqConflictsWithSearchCountry(next.companyInfo.headquarters, next.companyInfo.city, searchCountry)) {
      console.warn('[verifyCompanyIdentity] HQ still conflicts with search country; clearing HQ/city');
      next.companyInfo.headquarters = '公开信息待核实';
      next.companyInfo.city = '';
      changed = true;
    }

    if (changed || v.corrected) {
      console.log('[verifyCompanyIdentity]', canonicalDomain, v.reason || 'updated', {
        hq: next.companyInfo.headquarters,
        city: next.companyInfo.city,
      });
    }
    return next;
  } catch (e) {
    console.warn('[verifyCompanyIdentity] failed, keeping first-pass result', e);
    return result;
  }
};

export const analyzeCompany = async (
  domainOrName: string,
  mode: 'detailed' | 'economy' = 'detailed',
  opts?: { searchKeyword?: string; searchTags?: string[]; searchCountry?: string }
): Promise<AnalysisResult> => {
  const searchKeyword = (opts?.searchKeyword || '').trim();
  const searchCountry = (opts?.searchCountry || '').trim();
  const rawInput = (domainOrName || '').trim();
  const canonicalDomain = cleanDomain(rawInput).toLowerCase();
  const hasDomain = Boolean(canonicalDomain && canonicalDomain.includes('.') && !/\s/.test(canonicalDomain));
  const identityDomain = hasDomain ? canonicalDomain : rawInput;

  const productFocusBlock = searchKeyword
    ? `
  PRODUCT CATALOG COLLECTION (CRITICAL — FULL ASSORTMENT FIRST, keyword match SECOND):
  - User discovered this client via "${searchKeyword}", but you MUST first inventory their ENTIRE sellable catalog
    from official website + shop/catalog pages + other platforms (Amazon/Allegro/eBay/wholesale dirs if present).
  - Do NOT only collect products related to "${searchKeyword}". Non-matching categories/SKUs are REQUIRED.
  - websiteCategories: complete nav/catalog tree (aim 5–15 categoryName). EACH category MUST include
    priceMinCNY, priceMaxCNY (CNY terminal/retail band for that category) and priceBand (e.g. "¥15–45" or "$4–12 CAD").
  - products[]: 12–20 concrete SKUs spanning MULTIPLE categories across the full assortment (real names from site).
    Cover breadth: at least several categories, not a single keyword niche.
  - AFTER full collection: set keywordMatch=true ONLY for items clearly related to "${searchKeyword}"; false otherwise.
    UI will highlight matches — never omit non-matching lines to "focus".
  - EVERY product MUST include: category (标准化品类), retailPrice, retailPriceCNY, estimatedFOBPriceCNY, priceMinCNY, priceMaxCNY.
  - priceMinCNY / priceMaxCNY = 该 SKU 或同系列终端价区间（人民币）；单点价则 min=max。
  - businessScope.coreProducts = 全站主营品类；relevantProducts 可另列与 "${searchKeyword}" 相关的项。
  - productSummary 可兼顾全站定位，并点出 "${searchKeyword}" 机会；不要只写关键词相关。
  - tradeIntelligence.importCategories + hsCodes 尽量覆盖全品类进口线索。
  ${searchCountry && !isVagueMarketCountry(searchCountry) ? `- Search target market context: ${searchCountry}.` : ''}
`
    : `
  PRODUCT CATALOG COLLECTION (CRITICAL — full assortment for exporter matching DB):
  - Crawl official shop/catalog/collection pages + other retail/wholesale platforms; inventory ALL major sellable categories.
  - websiteCategories: 5–15 categories from real nav; EACH with priceMinCNY, priceMaxCNY, priceBand.
  - products[]: 12–20 concrete SKUs spanning multiple categories (real site names, not vague "toys").
  - EVERY product MUST include category, retailPrice, retailPriceCNY, estimatedFOBPriceCNY, priceMinCNY, priceMaxCNY.
  - coreProducts = top lines across the whole catalog; importCategories for trade.
  - Set keywordMatch=false (no active search keyword).
`;

  const identityBlock = `
  IDENTITY LOCK (CRITICAL — wrong HQ destroys the whole report):
  - Canonical domain / identity primary key: "${identityDomain}"
  - Analyze ONLY the legal entity that owns/operates this domain. Official site About/Contact/Footer/Impressum wins over directories.
  - NEVER mix same-name brands across countries. Example: smyk.com = SMYK Poland (Warsaw) — NOT Moscow/Russia.
  - headquarters + city MUST match the official entity on this domain. If unverifiable, use "公开信息未找到" — NEVER guess another country's capital.
  ${searchCountry && !isVagueMarketCountry(searchCountry) ? `- Lead market hint: ${searchCountry}. Prefer the entity of this domain that matches this market; still do not invent HQ.` : '- No specific market hint (or Global): still bind identity strictly to the domain above.'}
`;

  // AnySearch + Tavily 身份证据；失败则软跳过
  let identityEvidence = '';
  let collectedEvidenceItems = evidenceItemsFromTavilyResults([]);
  if (hasDomain) {
    try {
      identityEvidence = await gatherIdentityEvidence(canonicalDomain, {
        companyHint: rawInput,
        searchCountry: searchCountry || undefined,
      });
      if (identityEvidence) {
        console.log('[analyzeCompany] AnySearch identity evidence chars:', identityEvidence.length);
        collectedEvidenceItems = mergeEvidenceItems(
          collectedEvidenceItems,
          parseEvidenceItemsFromText(identityEvidence, 'anysearch')
        );
      }
    } catch (e) {
      console.warn('[analyzeCompany] AnySearch evidence skipped', e);
    }
    try {
      const tavilyBundle = await gatherTavilyCompanyEvidenceBundle({
        domain: canonicalDomain,
        companyHint: rawInput,
        searchKeyword: searchKeyword || undefined,
        searchCountry: searchCountry || undefined,
      });
      if (tavilyBundle.text) {
        identityEvidence = identityEvidence
          ? `${identityEvidence}\n\n${tavilyBundle.text}`
          : tavilyBundle.text;
        console.log('[analyzeCompany] Tavily evidence chars:', tavilyBundle.text.length);
      }
      collectedEvidenceItems = mergeEvidenceItems(
        collectedEvidenceItems,
        evidenceItemsFromTavilyResults(tavilyBundle.items)
      );
    } catch (e) {
      console.warn('[analyzeCompany] Tavily evidence skipped', e);
    }
  }

  const evidenceBlock = identityEvidence
    ? `
  === WEB GROUND TRUTH (AnySearch / Tavily — highest priority for name / HQ / city / country) ===
  ${identityEvidence}
  === END WEB EVIDENCE ===
`
    : '';

  const prompt = `
  Target: "${rawInput}".
  Task: DEEP B2B FOREIGN-TRADE DUE DILIGENCE for Chinese exporters selling to this buyer/importer.
${searchKeyword ? `  Discovery source keyword: "${searchKeyword}". Tag this report with that search source.` : ''}
${identityBlock}
${evidenceBlock}

  You MUST use web search. Prefer official website of ${identityDomain}, LinkedIn company page for THAT domain, trade directories, exhibition pages,
  ImportYeti / Bill of Lading public indexes, news, certification pages. If a fact is unknown, write "公开信息未找到" — NEVER invent customs shipment IDs.
  When AnySearch evidence is present, treat official page extracts as ground truth for headquarters/city/country.

  Action checklist:
  1. Company identity: legal/trading name, HQ city+country (verified for ${identityDomain}), founded year, nature (importer/distributor/retailer/brand/manufacturer), scale, employees. Description geography MUST match HQ.
  2. Business model: channels, distributors, ecommerce, exhibitions, procurement habits, supply-chain role.
  3. TRADE INTELLIGENCE (critical for exporters):
     - HS codes / product categories they likely import
     - Public customs/shipment clues (summarize; cite source type)
     - Top source countries
     - Certifications (CE, FDA, UL, BSCI, ISO, REACH, GRS, OEKO-TEX, etc.) if mentioned on site or news
     - Preferred Incoterms / MOQ / buying season if found
     - Risk level (低/中/高/未知) + short notes (sanctions/adverse media only if real evidence)
  4. DECISION MAKERS — ONLY include people with a REAL full name AND at least one of: public phone, email, or personal LinkedIn.
     - Do NOT invent placeholder people with name "公开信息未找到" and empty contact fields.
     - Prefer fewer high-quality contacts over many empty cards.
     - Include public phone / WhatsApp / mobile when found on website Contact pages.
     - Procurement / Purchasing / Sourcing / Buyer first; CEO/Founder secondary (max 2).
     - If no verifiable contacts, return decisionMakers: [].
     - NEVER invent emails. Leave emailGuess empty unless publicly listed.
     - phone / whatsapp only when publicly listed; otherwise leave empty.
  5. PRODUCTS & PRICING (HIGHEST PRIORITY for catalog DB — do NOT skip):
     - Crawl/use official product, shop, catalog, collection pages from web evidence.
     - Extract concrete SKU/product names + category + retail/FOB price band in CNY.
     - Fill websiteCategories, businessScope.coreProducts/relevantProducts, priceSensitivity.
${productFocusBlock}
  6. Financial trends last 5 years — estimate if needed, never all zeros.
  7. SIMILAR COMPANIES (required, high volume):
     - Return 12–15 similarCompanies that are REAL buyers/importers/retailers/distributors in the SAME or closely related market.
     - Prefer same country as the target; if thin, expand to same region (e.g. DACH / Benelux) but keep trade relevance.
     - Each must include: name, website (real domain), country, mainProducts (short Chinese or bilingual).
     - Do NOT return fewer than 10 when public peers exist; avoid inventing fake domains.

  IMPORTANT: All descriptive text in Simplified Chinese (简体中文).
  CRITICAL LANGUAGE RULE for productSummary:
  - marketPreference / recommendedProducts / packagingAnalysis / colorPreference / featureAnalysis
    MUST be written entirely in Simplified Chinese. Do NOT output English paragraphs.
  - Product names inside those fields may keep common English trade terms in parentheses, e.g. 回力车（pull-back）.
  - Example tone: "终端市场极度看重价格，产品需低成本制造、外观吸引儿童、组装尽量简单。"

  Output JSON only (no markdown) matching:
  {
    "companyInfo": { "name": "", "headquarters": "", "city": "", "foundedYear": "", "nature": "", "scale": "", "employeeRange": "", "website": "", "description": "" },
    "swot": { "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] },
    "financialTrends": [{ "year": "2020", "revenue": 0, "procurement": 0 }],
    "trafficAnalysis": [{ "category": "", "trafficType": "Organic (SEO)", "topKeywords": "", "volumeEst": "Medium" }],
    "websiteCategories": [{ "categoryName": "", "items": [], "priceMinCNY": 0, "priceMaxCNY": 0, "priceBand": "" }],
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
    "products": [{ "name": "", "category": "", "retailPrice": "", "retailPriceCNY": 0, "estimatedFOBPriceCNY": 0, "priceMinCNY": 0, "priceMaxCNY": 0, "imageUrl": "", "competitorLink": "", "pricingStrategy": "", "pitchPoint": "", "techSpecs": "", "features": "", "colors": "", "packaging": "", "keywordMatch": false }],
    "marketTrends": "",
    "decisionMakers": [{ "firstName": "", "lastName": "", "name": "", "title": "", "department": "", "emailGuess": "", "phone": "", "whatsapp": "", "linkedin": "", "yearsActive": "", "type": "Buyer", "source": "AI", "isVerified": false, "influenceScore": 4 }],
    "strategy": { "buyingOfficeLocation": "", "actionPlan": [] },
    "similarCompanies": [
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" },
      { "name": "", "website": "", "country": "", "mainProducts": "" }
    ]
  }
  `;

  // 1. Get Basic Analysis
  const text = await generateContentUnified('analysis', prompt, SYSTEM_INSTRUCTION, true);
  const aiResult = extractJson(text);
  
  // Merge Defaults
  let result: AnalysisResult = {
    companyInfo: {
      name: aiResult.companyInfo?.name || domainOrName || "Unknown",
      headquarters: aiResult.companyInfo?.headquarters || "N/A",
      foundedYear: aiResult.companyInfo?.foundedYear || "N/A",
      nature: aiResult.companyInfo?.nature || "N/A",
      scale: aiResult.companyInfo?.scale || "N/A",
      website: hasDomain
        ? canonicalDomain
        : (aiResult.companyInfo?.website || "N/A"),
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
        category: p.category || '',
        priceMinCNY: typeof p.priceMinCNY === 'number' ? p.priceMinCNY : undefined,
        priceMaxCNY: typeof p.priceMaxCNY === 'number' ? p.priceMaxCNY : undefined,
        features: p.features || "N/A",
        colors: p.colors || "N/A",
        packaging: p.packaging || "N/A",
        keywordMatch: !!p.keywordMatch,
    })),
    marketTrends: aiResult.marketTrends || "N/A",
    decisionMakers: (aiResult.decisionMakers || [])
      .map((dm: any) => {
        const name = dm.name || [dm.firstName, dm.lastName].filter(Boolean).join(' ') || '';
        const placeholder = isPlaceholderPersonName(name) && !dm.firstName;
        const emailGuess = placeholder ? '' : (dm.emailGuess || '');
        const phone = String(dm.phone || '').trim() || undefined;
        const whatsapp = String(dm.whatsapp || '').trim() || undefined;
        return {
          ...dm,
          name: name || '公开信息未找到',
          type: dm.type === 'CEO' || dm.type === 'Buyer' ? dm.type : classifyDecisionMakerType(dm.title || ''),
          source: 'AI' as const,
          emailGuess,
          emailSource: emailGuess ? (dm.emailSource || 'AI') : undefined,
          emailStatus: emailGuess ? 'unverified' : undefined,
          phone,
          whatsapp,
          isVerified: false,
          influenceScore:
            dm.influenceScore ||
            (classifyDecisionMakerType(dm.title || '') === 'Buyer'
              ? 5
              : classifyDecisionMakerType(dm.title || '') === 'CEO'
                ? 4
                : 2),
        };
      })
      // 背调阶段不展示空壳联系人；有电话/邮箱/WhatsApp 的保留
      .filter((dm: DecisionMaker) => {
        const hasPhone = !!(dm.phone || '').trim();
        const hasWhatsapp = !!(dm.whatsapp || '').trim();
        const hasEmail = !!(dm.emailGuess || '').includes('@');
        if (hasPhone || hasWhatsapp || hasEmail) return true;
        return false;
      }),
    strategy: {
      buyingOfficeLocation: aiResult.strategy?.buyingOfficeLocation || "N/A",
      actionPlan: aiResult.strategy?.actionPlan || []
    },
    similarCompanies: Array.isArray(aiResult.similarCompanies)
      ? aiResult.similarCompanies
          .filter((c: any) => c && (c.name || c.website))
          .slice(0, 20)
          .map((c: any) => ({
            name: String(c.name || '').trim() || 'Unknown',
            website: String(c.website || '').trim(),
            country: String(c.country || '').trim(),
            mainProducts: String(c.mainProducts || '').trim(),
          }))
      : [],
    searchKeyword: searchKeyword || undefined,
    searchTags: opts?.searchTags?.length ? opts.searchTags : undefined,
    searchCountry: searchCountry || undefined,
  };

  // 若模型未标 keywordMatch，按关键词启发式补标并排序
  if (searchKeyword) {
    const tokens = searchKeyword
      .toLowerCase()
      .split(/[\s,/|+\-，、]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    result.products = result.products
      .map((p) => {
        if (p.keywordMatch) return p;
        const blob = `${p.name || ''} ${p.features || ''} ${p.pitchPoint || ''}`.toLowerCase();
        const hit = tokens.some((t) => blob.includes(t));
        return hit ? { ...p, keywordMatch: true } : p;
      })
      .sort((a, b) => Number(!!b.keywordMatch) - Number(!!a.keywordMatch));
  }

  // 2. Domain-bound identity verification (fixes namesake / wrong-country HQ)
  if (hasDomain) {
    result = await verifyCompanyIdentity(result, canonicalDomain, searchCountry, identityEvidence);
  }

  // Final safety: never leave a conflicting HQ after verification
  if (
    hqConflictsWithSearchCountry(
      result.companyInfo.headquarters,
      result.companyInfo.city,
      searchCountry
    )
  ) {
    console.warn('[analyzeCompany] Post-verify HQ conflict; blanking HQ', {
      hq: result.companyInfo.headquarters,
      city: result.companyInfo.city,
      searchCountry,
    });
    result.companyInfo.headquarters = '公开信息待核实';
    result.companyInfo.city = '';
  }

  // 3. 背调阶段不调用 Anymail、不自动生成开发信（开发信由用户在策略模块按需手动生成）
  result.decisionMakers = rankDecisionMakers(result.decisionMakers);

  // 4. 证据链：检索链接 + 官网/社媒回退
  const evidenceChain = mergeEvidenceItems(
    collectedEvidenceItems,
    buildFallbackEvidenceFromReport(result)
  );
  result.evidenceChain = evidenceChain;
  result.evidenceConfidence = scoreEvidenceConfidence(result, evidenceChain);
  result.evidenceSummary = summarizeEvidence(evidenceChain, result.evidenceConfidence);

  let normalized = normalizeAnalysisResult(result);

  // 新背调必须带上品类与价格：若首轮不足，自动再跑一轮产品深挖并合并
  if (!hasRichProductCatalog(normalized)) {
    try {
      console.info('[analyzeCompany] product catalog incomplete → auto digProductIntelligence');
      normalized = await digProductIntelligence(hasDomain ? canonicalDomain : rawInput, normalized, {
        searchKeyword: searchKeyword || undefined,
        searchCountry: searchCountry || undefined,
      });
    } catch (e) {
      console.warn('[analyzeCompany] auto product dig failed, keeping first-pass report', e);
    }
  }

  return normalized;
};

/**
 * 仅深挖产品品类与价格（供「旧背调缺品类」补做；新背调已在 analyzeCompany 内自动完成）
 * 合并回 existing，保留决策人、证据链等既有字段。
 */
export const digProductIntelligence = async (
  domainOrName: string,
  existing?: AnalysisResult | null,
  opts?: { searchKeyword?: string; searchCountry?: string }
): Promise<AnalysisResult> => {
  const searchKeyword = (opts?.searchKeyword || existing?.searchKeyword || '').trim();
  const searchCountry = (opts?.searchCountry || existing?.searchCountry || '').trim();
  const rawInput = (domainOrName || existing?.companyInfo?.website || existing?.companyInfo?.name || '').trim();
  const canonicalDomain = cleanDomain(rawInput).toLowerCase();
  const hasDomain = Boolean(canonicalDomain && canonicalDomain.includes('.') && !/\s/.test(canonicalDomain));
  const companyName = existing?.companyInfo?.name || rawInput;

  let productEvidence = '';
  if (hasDomain) {
    try {
      const tavilyBundle = await gatherTavilyCompanyEvidenceBundle({
        domain: canonicalDomain,
        companyHint: companyName,
        searchKeyword: searchKeyword || undefined,
        searchCountry: searchCountry || undefined,
      });
      productEvidence = tavilyBundle.text || '';
    } catch (e) {
      console.warn('[digProductIntelligence] Tavily skipped', e);
    }
  }

  const prompt = `
Target company: "${companyName}" / domain: "${hasDomain ? canonicalDomain : rawInput}".
Task: FULL PRODUCT CATALOG & PRICE DEEP-DIVE for Chinese exporters' matching database.
${searchKeyword ? `Discovery keyword (match AFTER full catalog): "${searchKeyword}".` : ''}
${searchCountry ? `Market: ${searchCountry}.` : ''}

${productEvidence ? `=== WEB PRODUCT EVIDENCE ===\n${productEvidence}\n=== END ===` : 'Use web search on official shop/catalog/product pages AND other platforms (Amazon/Allegro/wholesale dirs if present).'}

Requirements (简体中文描述字段):
1. FIRST inventory the company's ENTIRE assortment — all major categories from website nav + shop + other platforms. Do NOT only collect "${searchKeyword || 'keyword'}"-related items.
2. websiteCategories: 5–15 real nav/catalog categories. EACH MUST include priceMinCNY, priceMaxCNY, priceBand (CNY terminal/retail band for that category).
3. products[]: 12–20 concrete SKUs spanning MULTIPLE categories (breadth of full catalog). Each with name, category, retailPrice, retailPriceCNY, estimatedFOBPriceCNY, priceMinCNY, priceMaxCNY.
4. AFTER full collection: keywordMatch=true only if clearly related to "${searchKeyword || ''}"; otherwise false. Never drop non-matching SKUs.
5. businessScope.coreProducts = 全站主营品类；relevantProducts 可列与关键词相关项；priceSensitivity / brandPositioning / consumerGroup / productVariety.
6. tradeIntelligence.importCategories + hsCodes (cover full lines, short).
7. productSummary entirely in Simplified Chinese (全站定位 + 可选关键词机会).
8. Do NOT invent customs IDs. Unknown → "公开信息未找到".

Output JSON only:
{
  "websiteCategories": [{ "categoryName": "", "items": [], "priceMinCNY": 0, "priceMaxCNY": 0, "priceBand": "" }],
  "businessScope": { "coreProducts": [], "relevantProducts": [], "brandPositioning": "", "consumerGroup": "", "productVariety": "Medium", "priceSensitivity": "", "websiteStructure": "" },
  "tradeIntelligence": { "hsCodes": [], "importCategories": [] },
  "productSummary": { "marketPreference": "", "recommendedProducts": "", "packagingAnalysis": "", "colorPreference": "", "featureAnalysis": "" },
  "products": [{ "name": "", "category": "", "retailPrice": "", "retailPriceCNY": 0, "estimatedFOBPriceCNY": 0, "priceMinCNY": 0, "priceMaxCNY": 0, "pricingStrategy": "", "pitchPoint": "", "features": "", "colors": "", "packaging": "", "keywordMatch": false }]
}
`;

  const text = await generateContentUnified('analysis', prompt, SYSTEM_INSTRUCTION, true);
  const ai = extractJson(text) || {};

  const products = (Array.isArray(ai.products) ? ai.products : []).map((p: any) => ({
    name: String(p.name || '').trim(),
    category: String(p.category || '').trim(),
    retailPrice: String(p.retailPrice || ''),
    retailPriceCNY: Number(p.retailPriceCNY) || 0,
    estimatedFOBPriceCNY: Number(p.estimatedFOBPriceCNY) || 0,
    priceMinCNY: typeof p.priceMinCNY === 'number' ? p.priceMinCNY : undefined,
    priceMaxCNY: typeof p.priceMaxCNY === 'number' ? p.priceMaxCNY : undefined,
    pricingStrategy: p.pricingStrategy || '',
    pitchPoint: p.pitchPoint || '',
    techSpecs: p.techSpecs || '',
    features: p.features || '',
    colors: p.colors || '',
    packaging: p.packaging || '',
    imageUrl: p.imageUrl || '',
    competitorLink: p.competitorLink || '',
    keywordMatch: !!p.keywordMatch,
  })).filter((p: { name: string }) => p.name);

  const base: AnalysisResult = existing
    ? { ...existing }
    : ({
        companyInfo: {
          name: companyName,
          headquarters: 'N/A',
          foundedYear: 'N/A',
          nature: 'N/A',
          scale: 'N/A',
          website: hasDomain ? canonicalDomain : rawInput,
          description: 'N/A',
        },
        swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
        financialTrends: [],
        trafficAnalysis: [],
        websiteCategories: [],
        businessScope: {
          coreProducts: [],
          relevantProducts: [],
          brandPositioning: 'N/A',
          consumerGroup: 'N/A',
          productVariety: 'Medium',
          priceSensitivity: 'N/A',
          websiteStructure: 'N/A',
        },
        businessModel: {
          channels: [],
          hasDistributors: false,
          exhibitionHistory: [],
          ecommercePresence: [],
          procurementInfo: 'N/A',
        },
        supplyChain: { role: 'N/A', serviceType: 'N/A' },
        targetAudience: [],
        financials: { revenueEstimate: 'N/A', paymentTerms: 'N/A', ipInfo: 'N/A' },
        socials: {},
        products: [],
        marketTrends: 'N/A',
        decisionMakers: [],
        strategy: { buyingOfficeLocation: 'N/A', actionPlan: [] },
        similarCompanies: [],
      } as AnalysisResult);

  const merged: AnalysisResult = {
    ...base,
    websiteCategories: Array.isArray(ai.websiteCategories) && ai.websiteCategories.length
      ? ai.websiteCategories.map((cat: any) => {
          const priceMinCNY =
            typeof cat?.priceMinCNY === 'number' && cat.priceMinCNY > 0 ? cat.priceMinCNY : undefined;
          const priceMaxCNY =
            typeof cat?.priceMaxCNY === 'number' && cat.priceMaxCNY > 0 ? cat.priceMaxCNY : undefined;
          const priceBand = String(cat?.priceBand || '').trim() || undefined;
          return {
            categoryName: String(cat?.categoryName || '未分类').trim(),
            items: Array.isArray(cat?.items) ? cat.items.map(String).filter(Boolean) : [],
            priceMinCNY,
            priceMaxCNY,
            priceBand:
              priceBand ||
              (priceMinCNY != null || priceMaxCNY != null
                ? `¥${priceMinCNY ?? '?'}–${priceMaxCNY ?? '?'}`
                : undefined),
          };
        })
      : base.websiteCategories,
    businessScope: {
      ...base.businessScope,
      ...(ai.businessScope || {}),
      coreProducts: ai.businessScope?.coreProducts?.length
        ? ai.businessScope.coreProducts
        : base.businessScope.coreProducts,
      relevantProducts: ai.businessScope?.relevantProducts?.length
        ? ai.businessScope.relevantProducts
        : base.businessScope.relevantProducts,
    },
    tradeIntelligence: {
      ...(base.tradeIntelligence || {
        hsCodes: [],
        importCategories: [],
        customsSummary: '',
        recentShipments: [],
        topSourceCountries: [],
        estimatedAnnualImport: '',
        certifications: [],
        complianceNotes: '',
        preferredIncoterms: '',
        typicalMoq: '',
        buyingSeasons: '',
        registrationId: '',
        companyLinkedin: '',
        riskLevel: '未知' as const,
        riskNotes: '',
      }),
      hsCodes: ai.tradeIntelligence?.hsCodes?.length
        ? ai.tradeIntelligence.hsCodes
        : base.tradeIntelligence?.hsCodes || [],
      importCategories: ai.tradeIntelligence?.importCategories?.length
        ? ai.tradeIntelligence.importCategories
        : base.tradeIntelligence?.importCategories || [],
    },
    productSummary: ai.productSummary
      ? {
          marketPreference: ai.productSummary.marketPreference || base.productSummary?.marketPreference || '',
          recommendedProducts: ai.productSummary.recommendedProducts || base.productSummary?.recommendedProducts || '',
          packagingAnalysis: ai.productSummary.packagingAnalysis || base.productSummary?.packagingAnalysis || '',
          colorPreference: ai.productSummary.colorPreference || base.productSummary?.colorPreference || '',
          featureAnalysis: ai.productSummary.featureAnalysis || base.productSummary?.featureAnalysis || '',
        }
      : base.productSummary,
    products: products.length ? products : base.products,
    searchKeyword: searchKeyword || base.searchKeyword,
    searchCountry: searchCountry || base.searchCountry,
  };

  if (searchKeyword && merged.products?.length) {
    const tokens = searchKeyword
      .toLowerCase()
      .split(/[\s,/|+\-，、]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    merged.products = merged.products
      .map((p) => {
        if (p.keywordMatch) return p;
        const blob = `${p.name || ''} ${p.category || ''} ${p.features || ''}`.toLowerCase();
        return tokens.some((t) => blob.includes(t)) ? { ...p, keywordMatch: true } : p;
      })
      .sort((a, b) => Number(!!b.keywordMatch) - Number(!!a.keywordMatch));
  }

  return normalizeAnalysisResult(merged);
};

/** 检测文本是否主要为英文（用于已有报告译成中文） */
export const looksLikeEnglishParagraph = (text?: string): boolean => {
  const t = (text || '').trim();
  if (!t || t === 'N/A') return false;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  return latin >= 40 && cjk < latin * 0.25;
};

export type ProductSummaryFields = {
  marketPreference: string;
  recommendedProducts: string;
  packagingAnalysis: string;
  colorPreference: string;
  featureAnalysis: string;
};

/** 将市场喜好与产品策略字段准确译为简体中文 */
export const translateProductSummaryToZh = async (
  summary: ProductSummaryFields,
  keyword?: string
): Promise<ProductSummaryFields> => {
  const prompt = `请将以下外贸「市场喜好与产品策略」字段准确翻译成简体中文。
要求：
1. 专业外贸用语，自然通顺，不要逐词生硬直译
2. 常见产品名可保留英文原词于括号内，如 回力车（pull-back）
3. 只输出 JSON，键名保持不变
${keyword ? `4. 语境关键词：${keyword}` : ''}

原文 JSON：
${JSON.stringify(summary, null, 2)}`;

  const text = await callQwen(prompt, {
    jsonMode: true,
    task: 'email',
    timeoutMs: 60_000,
  });
  const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim());
  return {
    marketPreference: String(parsed.marketPreference || summary.marketPreference),
    recommendedProducts: String(parsed.recommendedProducts || summary.recommendedProducts),
    packagingAnalysis: String(parsed.packagingAnalysis || summary.packagingAnalysis),
    colorPreference: String(parsed.colorPreference || summary.colorPreference),
    featureAnalysis: String(parsed.featureAnalysis || summary.featureAnalysis),
  };
};

const countriesLikelyMatch = (a?: string, b?: string): boolean => {
  if (isVagueMarketCountry(a) || isVagueMarketCountry(b)) return true;
  const ga = geoGroupIndex(a || '');
  const gb = geoGroupIndex(b || '');
  if (ga >= 0 && gb >= 0) return ga === gb;
  const na = normalizeGeoText(a);
  const nb = normalizeGeoText(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
};

/** 行业词为空时，从产品关键词推断检索约束，避免模型乱扩到无关行业 */
const inferIndustryConstraint = (productKeyword: string, industry: string): string => {
  const ind = (industry || '').trim();
  if (ind) return ind;
  const p = (productKeyword || '').toLowerCase();
  if (/bubble|wand|soap.?bubble|泡泡|玩具|toy|doll|plush|teddy|lego|puzzle|game|kids|children|baby|infant|juvenile|party.?favor|novelty/i.test(p)) {
    return 'Toys / children’s products / party favors / outdoor play / novelty gifts（玩具、儿童用品、派对礼品）';
  }
  if (/silicone|baby|paci|teether|bib|nursery/i.test(p)) {
    return 'Baby products / nursery / infant feeding（母婴用品）';
  }
  if (/furniture|chair|table|sofa|cabinet/i.test(p)) {
    return 'Furniture / home furnishings（家具家居）';
  }
  return `Strictly the same product category as "${productKeyword}" — do NOT expand to unrelated industries`;
};

const productRelevanceOk = (
  r: Pick<ClientSearchResult, 'name' | 'mainProducts' | 'description' | 'fitReason' | 'fitScore'>,
  productKeyword: string
): boolean => {
  const score = typeof r.fitScore === 'number' ? r.fitScore : 0;
  if (score > 0 && score < 3) return false;
  const blob = `${r.name || ''} ${r.mainProducts || ''} ${r.description || ''} ${r.fitReason || ''}`.toLowerCase();
  const kw = (productKeyword || '').trim().toLowerCase();
  if (!kw) return score >= 3;
  const tokens = kw.split(/[\s/_+\-]+/).filter((t) => t.length >= 3);
  const hit = tokens.some((t) => blob.includes(t));
  // 中文描述常见玩具/采购词：英文关键词没命中时，高分 + 行业词也可过
  const softIndustry =
    /玩具|儿童|母婴|派对|礼品|户外|泡泡|采购|进口|分销|批发|零售|brand|toy|kids|baby|party|import|distribut|wholesale|retail/i.test(
      blob
    );
  if (hit) return true;
  if (score >= 4 && softIndustry) return true;
  if (score >= 3 && softIndustry && tokens.length <= 1) return true;
  // 无分数字段时：至少要命中关键词或明显行业词
  if (score === 0) return hit || softIndustry;
  return false;
};

const filterSearchResultsByMarketAndProduct = (
  results: ClientSearchResult[],
  opts: { productKeyword: string; targetCountry: string; limit: number }
): ClientSearchResult[] => {
  const target = (opts.targetCountry || '').trim();
  const specific = !isVagueMarketCountry(target);
  const filtered = results.filter((r) => {
    if (!r.website && !r.name) return false;
    if (specific) {
      const companyCountry = (r.country || r.searchCountry || '').trim();
      // 模型未填国家时，暂按目标市场收下，但后面会强制 stamp 为目标国
      if (companyCountry && !countriesLikelyMatch(companyCountry, target)) return false;
    }
    return productRelevanceOk(r, opts.productKeyword);
  });
  return filtered
    .sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0))
    .slice(0, opts.limit);
};

// Add this function to export
export const searchPotentialClients = async (productKeyword: string, country: string, industry: string = '', clientType: string = '', limit: number = 15): Promise<ClientSearchResult[]> => {
  const countries = country.split(/[,，;/|]+/).map(s => s.trim()).filter(Boolean);
  const types = clientType.split(/[,，;/|]+/).map(s => s.trim()).filter(Boolean);
  const singleMarket = countries.length === 1 && !isVagueMarketCountry(countries[0]);
  const targetMarket = singleMarket ? countries[0] : countries.filter((c) => !isVagueMarketCountry(c)).join(', ');
  // 单次请求控制体量；单国可稍高
  const effectiveLimit = Math.min(Math.max(limit, 3), countries.length > 1 ? 12 : 20);
  const industryConstraint = inferIndustryConstraint(productKeyword, industry);
  const typeHint = types.length
    ? types.join(', ')
    : 'Importer, Distributor, Wholesaler, Retailer, Brand Owner, Buying Office';

  const buildPrompt = (askLimit: number, stricter = false) => `
  Act as a high-performance B2B lead discovery engine for Chinese exporters (楠哥的小助理).
  Use web search to find REAL companies that buy / import / distribute / wholesale / retail the product: "${productKeyword}".

  TARGET MARKET (CRITICAL):
  ${
    singleMarket
      ? `- Search ONLY in this ONE country/market: ${countries[0]}.
  - Every result MUST be a real buyer entity whose official HQ / primary operating country is ${countries[0]}.
  - Do NOT return companies from other countries even if they sell similar products.
  - The JSON "country" field MUST be "${countries[0]}" (or the local official name of the same country).`
      : targetMarket
        ? `- Target markets: ${targetMarket}. Prefer companies headquartered in these markets.`
        : `- Target: relevant markets, but each result must show its REAL HQ country (never write "Global").`
  }

  PRODUCT / INDUSTRY (CRITICAL):
  - Product keyword: "${productKeyword}"
  - Industry constraint: ${industryConstraint}
  - Companies MUST clearly deal in this product category (or extremely close substitutes).
  - REJECT unrelated industries (software, banks, chemicals, construction, logistics-only, generic trading with no product fit, etc.).
  ${stricter ? `- STRICT MODE: If unsure about product fit OR country fit, OMIT the company. Quality > quantity.` : ''}

  Preferred buyer types (match ANY): ${typeHint}.
  ${types.length > 1 ? `- Mix buyer types among: ${types.join(', ')}.` : ''}

  Rules:
  - Only real companies with active websites. Prefer B2B buyers.
  - Return up to ${askLimit} diverse targets (no duplicates). Prefer precision over filler leads.
  - fitScore 1-5 reflecting PRODUCT fit for "${productKeyword}" in the target market (3+=usable, 5=excellent).
  - description / fitReason / mainProducts in Simplified Chinese; explicitly mention how they relate to "${productKeyword}".
  - Do NOT invent emails.
  - Keep each field concise (1 short sentence max for description/fitReason).
  - country / city MUST match the legal entity that owns the website domain (official HQ).

  Return a valid JSON Array ONLY:
  [{
    "name": "Company Name",
    "website": "www.example.com",
    "description": "一句话说明为何适合开发该产品",
    "country": "${singleMarket ? countries[0] : 'Official HQ country in English'}",
    "clientType": "Importer|Distributor|Wholesaler|Retailer|Brand|Buying Office",
    "mainProducts": "主营品类（须与关键词相关）",
    "estimatedScale": "如 50-200人 / 中型",
    "city": "城市",
    "linkedinCompanyUrl": "",
    "contactHint": "",
    "fitScore": 4,
    "fitReason": "匹配原因（含产品与市场）"
  }]
  `;

  const mapRaw = (results: any[]): ClientSearchResult[] =>
    results.map((r: any) => {
      const modelCountry = (r.country || '').trim();
      const fallbackCountry = singleMarket
        ? countries[0]
        : countries.find((c) => !isVagueMarketCountry(c)) || (!isVagueMarketCountry(country) ? country : '');
      // 单国搜索：若模型国家与目标不一致，先保留模型值，后面过滤器会丢弃
      const countryOut = modelCountry || fallbackCountry || '';
      return {
        name: r.name || 'Unknown',
        website: r.website || '',
        description: r.description || '',
        country: countryOut,
        clientType: r.clientType || (types[0] || clientType || ''),
        mainProducts: r.mainProducts || '',
        estimatedScale: r.estimatedScale || '',
        city: r.city || '',
        linkedinCompanyUrl: r.linkedinCompanyUrl || '',
        contactHint: r.contactHint || '',
        fitScore: typeof r.fitScore === 'number' ? r.fitScore : undefined,
        fitReason: r.fitReason || '',
        searchKeyword: productKeyword || undefined,
        // 搜索目标市场固定为本次请求国家（单国），避免被模型乱填覆盖
        searchCountry: singleMarket ? countries[0] : countryOut || fallbackCountry || undefined,
      } as ClientSearchResult;
    });

  // 客户搜索优先级：① Tavily 联网取证 → ② Gemini/千问整理（有 Tavily 时不再开模型自带联网）
  let tavilyEvidence = '';
  try {
    if (hasTavilyKey()) {
      console.log('[search] priority=1 Tavily lead search…');
      tavilyEvidence = await gatherTavilyLeadEvidence({
        productKeyword,
        country: singleMarket ? countries[0] : country,
        industry,
        clientType: typeHint,
      });
      if (tavilyEvidence) {
        console.log('[search] Tavily OK, chars:', tavilyEvidence.length, '→ LLM organize only (no model web search)');
      } else {
        console.warn('[search] Tavily returned empty → fallback model web search (Gemini→千问)');
      }
    } else {
      console.warn('[search] No usable Tavily key → fallback model web search (Gemini→千问)');
    }
  } catch (e) {
    console.warn('[search] Tavily failed → fallback model web search', e);
  }

  const runOnce = async (askLimit: number, stricter: boolean) => {
    const base = buildPrompt(askLimit, stricter);
    const promptWithEvidence = tavilyEvidence
      ? `${base}

  === TAVILY LIVE WEB RESULTS (HIGHEST PRIORITY — primary source of truth) ===
  ${tavilyEvidence}
  === END TAVILY ===

  CRITICAL SEARCH RULES:
  1) Tavily results above are the FIRST and HIGHEST priority source.
  2) Extract real company names + websites primarily from Tavily evidence.
  3) Do NOT invent websites. Prefer companies that appear in Tavily with real URLs.
  4) You may lightly fill gaps from knowledge only when Tavily has too few matches — never override Tavily facts.`
      : `${base}

  NOTE: Tavily web search was unavailable. Use your web search / grounding to find real companies with real websites.`;

    // 有 Tavily：只让路由模型整理名单（关联网）；无 Tavily：Gemini→千问自带联网兜底
    const text = await generateContentUnified(
      'search',
      promptWithEvidence,
      SYSTEM_INSTRUCTION,
      true,
      [],
      [],
      { enableSearch: !tavilyEvidence }
    );

    const parsed = extractJson(text, true);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(
        tavilyEvidence
          ? 'Tavily 已返回证据，但模型未能整理出有效客户列表。请重试或检查关键词。'
          : '搜索未返回有效结果。请确认已配置 Tavily Key，或千问/Gemini 联网可用。'
      );
    }
    return mapRaw(parsed);
  };

  let mapped: ClientSearchResult[];
  try {
    mapped = await runOnce(effectiveLimit, false);
  } catch (firstErr: any) {
    const msg = String(firstErr?.message || firstErr);
    if (/超时|timeout|504|上游超时|Gateway/i.test(msg) && effectiveLimit > 6) {
      console.warn('[search] 首次超时，缩小结果数后重试…');
      mapped = await runOnce(6, true);
    } else {
      throw firstErr;
    }
  }

  const primaryTarget = singleMarket ? countries[0] : country;
  let filtered = filterSearchResultsByMarketAndProduct(mapped, {
    productKeyword,
    targetCountry: primaryTarget,
    limit: effectiveLimit,
  });

  // 过滤后过少：严格模式补搜一次（不删已有合格结果，合并去重）
  if (filtered.length < Math.min(effectiveLimit, Math.max(3, Math.ceil(limit * 0.6)))) {
    try {
      console.warn(
        `[search] 合格结果仅 ${filtered.length}/${effectiveLimit}，严格补搜中…`,
        { productKeyword, country: primaryTarget }
      );
      const extra = await runOnce(effectiveLimit, true);
      const merged = [...filtered, ...extra];
      const seen = new Set<string>();
      const deduped: ClientSearchResult[] = [];
      for (const r of merged) {
        const key = (r.website || r.name || '').toLowerCase().replace(/^www\./, '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
      }
      filtered = filterSearchResultsByMarketAndProduct(deduped, {
        productKeyword,
        targetCountry: primaryTarget,
        limit: effectiveLimit,
      });
    } catch (e) {
      console.warn('[search] 严格补搜失败，沿用已有过滤结果', e);
    }
  }

  // 单国：强制 searchCountry / 缺省 country 为目标国（已通过过滤的结果）
  if (singleMarket) {
    filtered = filtered.map((r) => ({
      ...r,
      searchCountry: countries[0],
      country: r.country && countriesLikelyMatch(r.country, countries[0]) ? r.country : countries[0],
    }));
  }

  console.log(
    `[search] ${productKeyword} @ ${primaryTarget || 'global'}: raw=${mapped.length} kept=${filtered.length}`
  );

  return filterExcludedSearchResults(filtered);
};

export const streamStrategyChat = async function* (
    history: ChatMessage[],
    knowledgeBase: KnowledgeFile[], 
    newMessage: string, 
    newAttachments: KnowledgeFile[],
    companyData?: AnalysisResult | null,
    strategyContext?: StrategyChatContext | null
) {
    const config = await resolveQwenConfig();
    let baseUrl = config.baseUrl.replace(/\/$/, '');
    if (baseUrl.includes('__upstream=')) {
        try {
            const u = new URL(baseUrl, 'http://local.invalid');
            let up = u.searchParams.get('__upstream') || '';
            if (up && !up.endsWith('/chat/completions')) {
                up = `${up.replace(/\/$/, '')}/chat/completions`;
                u.searchParams.set('__upstream', up);
                baseUrl = `${u.pathname}${u.search}`;
            }
        } catch {
            /* keep */
        }
    } else if (!baseUrl.endsWith('/chat/completions')) {
        baseUrl += '/chat/completions';
    }

    const companies = [
      ...(strategyContext?.companies || []),
      ...(companyData ? [companyData] : []),
    ].filter((c, i, arr) => {
      const key = (c.companyInfo?.website || c.companyInfo?.name || '').toLowerCase();
      return key && arr.findIndex((x) => (x.companyInfo?.website || x.companyInfo?.name || '').toLowerCase() === key) === i;
    });
    const keywords = Array.from(new Set((strategyContext?.keywords || []).map((k) => k.trim()).filter(Boolean)));
    const countries = Array.from(new Set((strategyContext?.countries || []).map((c) => c.trim()).filter(Boolean)));
    const marketLeads = (strategyContext?.marketLeads || []).slice(0, 30);

    let systemInstruction = `${QWEN_SYSTEM} 你是高级外贸策略顾问，擅长开发信撰写、谈判话术与市场进入策略。`;
    systemInstruction += `\n\n写作要求：\n- 若提供了具体背调客户，策略与开发信必须针对该公司画像、产品与痛点。\n- 若提供了关键词/国家市场上下文，可写面向整个目标市场的通用开发信框架，并说明可如何按客户微调。\n- 用户上传的附件优先作为「我方产品/报价」参考，勿编造未出现的规格与价格。\n- 回复使用中文为主，开发信正文可用英文（外贸常用）。`;

    if (companies.length) {
      systemInstruction += `\n\n## 已选背调客户（${companies.length}）`;
      for (const c of companies.slice(0, 5)) {
        const info = c.companyInfo || ({} as AnalysisResult['companyInfo']);
        const dms = (c.decisionMakers || [])
          .slice(0, 5)
          .map((d) => `${d.name || ''} (${d.title || ''})`)
          .filter((s) => s.trim() !== '()')
          .join('; ');
        systemInstruction += `
### ${info.name || '未知公司'}
- 网址: ${info.website || '—'}
- 总部/城市: ${info.headquarters || '—'} / ${info.city || '—'}
- 性质/规模: ${info.nature || '—'} / ${info.scale || '—'}
- 搜索关键词: ${c.searchKeyword || '—'}
- 目标国家: ${c.searchCountry || '—'}
- 核心产品: ${(c.businessScope?.coreProducts || []).slice(0, 8).join(', ') || '—'}
- 营收粗估: ${c.financials?.revenueEstimate || '—'}
- SWOT弱点: ${(c.swot?.weaknesses || []).slice(0, 4).join('; ') || '—'}
- 决策人线索: ${dms || '—'}
`;
      }
    }

    if (keywords.length || countries.length) {
      systemInstruction += `\n\n## 市场上下文（整市场策略）`;
      if (keywords.length) systemInstruction += `\n- 产品/搜索关键词: ${keywords.join(' | ')}`;
      if (countries.length) systemInstruction += `\n- 目标国家/市场: ${countries.join(' | ')}`;
      if (marketLeads.length) {
        systemInstruction += `\n- 同市场已搜索客户样本（${marketLeads.length}）:\n`;
        systemInstruction += marketLeads
          .map(
            (l) =>
              `  · ${l.name}${l.website ? ` (${l.website})` : ''}${l.country ? ` · ${l.country}` : ''}${l.clientType ? ` · ${l.clientType}` : ''}${l.keyword ? ` · kw:${l.keyword}` : ''}`
          )
          .join('\n');
      }
    }

    if (!companies.length && !keywords.length && !countries.length) {
      systemInstruction += `\n\n当前为通用模式：用户未绑定具体背调客户或市场标签，可先追问目标客户/市场再给策略。`;
    }

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
  baseUrl.includes('/compatible-mode/v1') ||
  baseUrl.includes('%2Fcompatible-mode%2Fv1') ||
  /compatible-mode%2Fv1/i.test(baseUrl);

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

  // 测试连接若已带完整 override，跳过云端读取，避免 Supabase 挂起拖死后台
  const hasFullOverride = !!(override?.apiKey?.trim() && override?.baseUrl?.trim());

  // localStorage 优先，避免云端旧 Key 覆盖管理员刚录入的 Token Plan Key
  let cloudConfig: Awaited<ReturnType<typeof getSupabaseApiConfig>> = null;
  if (!hasFullOverride && (!localKey || !localBase)) {
    try {
      cloudConfig = await withHardTimeout(
        getSupabaseApiConfig('qwen').catch(() => null),
        4_000,
        '读取云端千问配置'
      );
    } catch (e) {
      console.warn('[Qwen] 跳过云端配置读取:', e);
      cloudConfig = null;
    }
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
    forcedSearch?: boolean;
    task?: TaskType;
    timeoutMs?: number;
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
        forcedSearch: options.forcedSearch,
        task: options.task,
        override: options.override,
        timeoutMs: options.timeoutMs,
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

    // 若刚被批量任务限流，先等到冷却结束再测，避免误报失败
    const cool = getCooldownRemainingSec();
    if (cool > 0) {
      await waitForApiCooldown();
    }

    // 轻量 ping：不走完整 callQwen / 系统提示 / 降级重试链
    // 联网测试：以客户端本地日期为准展示；提示模型用搜索核对，避免模型凭记忆编造旧日期
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const localIso = `${y}-${m}-${d}`;
    const localZh = `${y}年${Number(m)}月${Number(d)}日`;

    const run = () =>
      callQwenChat(
        [
          {
            role: 'user',
            content: testSearch
              ? `请务必使用联网搜索查询今天的公历日期。客户端本地日期是 ${localIso}（${localZh}）。请以搜索引擎或权威日历网站结果为准，只用一句话回答今天的日期（优先 YYYY-MM-DD），不要编造或沿用训练数据里的旧日期。`
              : 'Reply with exactly one word: pong',
          },
        ],
        {
          enableSearch: testSearch,
          forcedSearch: false,
          timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
          connectionTest: true,
          maxTokens: 32,
          override: {
            apiKey: cleanKey,
            baseUrl: cleanBase,
            modelId: modelId?.trim(),
          },
        }
      );

    // 含限流退避重试预算（约 8s+20s），避免硬超时误杀
    const text = await withHardTimeout(
      run(),
      CONNECTION_TEST_TIMEOUT_MS + 55_000,
      testSearch ? '千问联网测试' : '千问连接测试'
    );
    const reply = String(text || '').trim();
    if (testSearch) {
      // 回复里若出现明显过期年份且不含今年，判定为未真正用上实时搜索
      const hasCurrentYear = reply.includes(String(y));
      const staleYear = reply.match(/20[0-2][0-9]/);
      if (!hasCurrentYear && staleYear && Number(staleYear[0]) < y) {
        return {
          success: false,
          message: `联网接口已通，但模型返回了过期日期「${reply.slice(0, 80)}」（本地应为 ${localZh}）。请确认模型支持联网搜索（enable_search），或换用支持搜索的模型。`,
        };
      }
      return {
        success: true,
        message: `千问联网搜索成功 ✅ 今天是${localZh}。${reply ? `模型：${reply.slice(0, 60)}` : ''}`,
      };
    }
    return {
      success: true,
      message: `Qwen 连接成功 ✅ 回复: ${reply.slice(0, 50)}`,
    };
  } catch (e: any) {
    const hint = qwenCorsHint(e?.message);
    const msg = String(e?.message || e).slice(0, 280);
    return { success: false, message: `Qwen 测试失败: ${msg}${hint}` };
  }
};

const callGeminiNative = async (
  prompt: string,
  config: ApiConfig,
  options: { jsonMode?: boolean; enableSearch?: boolean; systemInstruction?: string } = {}
): Promise<string> => {
  return callGeminiGenerateContent(config.apiKey, config.modelId || NATIVE_MODEL, {
    prompt,
    systemInstruction: options.systemInstruction,
    jsonMode: options.jsonMode,
    enableSearch: options.enableSearch,
  });
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