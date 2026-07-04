import { bakedAppConfig } from './bakedConfig';

export type DefaultAIModel = 'qwen' | 'gemini' | 'auto';

const LS_URL = 'trade_scout_supabase_url';
const LS_KEY = 'trade_scout_supabase_anon_key';

const read = (key: string): string =>
  (process.env[key] as string | undefined) || '';

/** 读取 Supabase 凭证：.env.local（Cursor 开发）→ bakedConfig（构建产物）→ localStorage（手动覆盖） */
export const getSupabaseConfig = (): { url: string; key: string } => {
  const envUrl = read('REACT_APP_SUPABASE_URL');
  const envKey = read('REACT_APP_SUPABASE_ANON_KEY');
  if (envUrl && envKey) return { url: envUrl, key: envKey };

  const bakedUrl = bakedAppConfig.supabaseUrl || '';
  const bakedKey = bakedAppConfig.supabaseAnonKey || '';
  if (bakedUrl && bakedKey) return { url: bakedUrl, key: bakedKey };

  if (typeof localStorage !== 'undefined') {
    const lsUrl = localStorage.getItem(LS_URL)?.trim() || '';
    const lsKey = localStorage.getItem(LS_KEY)?.trim() || '';
    if (lsUrl && lsKey) return { url: lsUrl, key: lsKey };
  }

  return { url: '', key: '' };
};

export const isSupabaseConfigured = (): boolean => {
  const { url, key } = getSupabaseConfig();
  return !!(url && key);
};

export const saveSupabaseConfig = (url: string, key: string): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_URL, url.trim());
  localStorage.setItem(LS_KEY, key.trim());
};

export const clearSupabaseOverride = (): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LS_URL);
  localStorage.removeItem(LS_KEY);
};

const ls = (key: string): string =>
  (typeof localStorage !== 'undefined' ? localStorage.getItem(key)?.trim() : '') || '';

/** 第三方邮箱搜索 API（管理后台可覆盖 .env.local） */
export const getEmailSearchKeys = () => ({
  hunter: ls('trade_scout_hunter_api_key') || read('REACT_APP_HUNTER_API_KEY') || read('HUNTER_API_KEY'),
  findymail: ls('trade_scout_findymail_api_key') || read('FINDYMAIL_API_KEY'),
  anymailFinder: ls('trade_scout_anymail_finder_api_key') || read('ANYMAIL_FINDER_API_KEY'),
});

export const saveEmailSearchKeys = (keys: { hunter?: string; findymail?: string; anymailFinder?: string }) => {
  if (typeof localStorage === 'undefined') return;
  if (keys.hunter !== undefined) localStorage.setItem('trade_scout_hunter_api_key', keys.hunter.trim());
  if (keys.findymail !== undefined) localStorage.setItem('trade_scout_findymail_api_key', keys.findymail.trim());
  if (keys.anymailFinder !== undefined) localStorage.setItem('trade_scout_anymail_finder_api_key', keys.anymailFinder.trim());
};

export const env = {
  apiKey: read('API_KEY') || read('REACT_APP_GEMINI_API_KEY'),
  qwenApiKey: read('REACT_APP_QWEN_API_KEY'),
  qwenBaseUrl: read('REACT_APP_QWEN_BASE_URL'),
  qwenModelId: read('REACT_APP_QWEN_MODEL') || read('REACT_APP_QWEN_MODEL_ID'),
  defaultAIModel: (read('REACT_APP_DEFAULT_AI_MODEL') || bakedAppConfig.defaultAIModel || 'qwen') as DefaultAIModel,
  hunterApiKey: read('HUNTER_API_KEY') || read('REACT_APP_HUNTER_API_KEY'),
  findymailApiKey: read('FINDYMAIL_API_KEY'),
  anymailFinderApiKey: read('ANYMAIL_FINDER_API_KEY'),
  get supabaseUrl() { return getSupabaseConfig().url; },
  get supabaseAnonKey() { return getSupabaseConfig().key; },
  githubToken: read('VITE_GITHUB_TOKEN'),
  githubOwner: read('VITE_GITHUB_OWNER'),
  githubRepo: read('VITE_GITHUB_REPO'),
};
