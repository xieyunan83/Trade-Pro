/**
 * 运行时配置：部署环境（AI Studio / GitHub 挂载）没有 .env.local，
 * 因此按优先级合并：构建时 env → localStorage → public/app-config.json
 */

export interface AppRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  defaultAIModel: 'qwen' | 'gemini' | 'auto';
}

const LS_URL = 'trade_scout_supabase_url';
const LS_KEY = 'trade_scout_supabase_anon_key';

const readEnv = (key: string): string =>
  (process.env[key] as string | undefined) || '';

let cached: AppRuntimeConfig | null = null;
let initPromise: Promise<AppRuntimeConfig> | null = null;

const fromLocalStorage = (): Partial<AppRuntimeConfig> => {
  if (typeof localStorage === 'undefined') return {};
  return {
    supabaseUrl: localStorage.getItem(LS_URL) || '',
    supabaseAnonKey: localStorage.getItem(LS_KEY) || '',
  };
};

const fromBuildEnv = (): Partial<AppRuntimeConfig> => ({
  supabaseUrl: readEnv('REACT_APP_SUPABASE_URL'),
  supabaseAnonKey: readEnv('REACT_APP_SUPABASE_ANON_KEY'),
  defaultAIModel: (readEnv('REACT_APP_DEFAULT_AI_MODEL') || 'qwen') as AppRuntimeConfig['defaultAIModel'],
});

const fetchPublicConfig = async (): Promise<Partial<AppRuntimeConfig>> => {
  const candidates = [
    './app-config.json',
    '/app-config.json',
    'app-config.json',
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.supabaseUrl && data.supabaseAnonKey) {
        return {
          supabaseUrl: data.supabaseUrl,
          supabaseAnonKey: data.supabaseAnonKey,
          defaultAIModel: data.defaultAIModel || 'qwen',
        };
      }
    } catch {
      /* try next */
    }
  }
  return {};
};

const mergeConfig = (...parts: Partial<AppRuntimeConfig>[]): AppRuntimeConfig => {
  const merged = parts.reduce((acc, p) => ({ ...acc, ...p }), {} as Partial<AppRuntimeConfig>);
  return {
    supabaseUrl: merged.supabaseUrl || '',
    supabaseAnonKey: merged.supabaseAnonKey || '',
    defaultAIModel: merged.defaultAIModel || 'qwen',
  };
};

/** 应用启动时调用，确保部署版也能读到 Supabase 配置 */
export const initRuntimeConfig = async (): Promise<AppRuntimeConfig> => {
  if (cached) return cached;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const publicCfg = await fetchPublicConfig();
    cached = mergeConfig(fromBuildEnv(), publicCfg, fromLocalStorage());
    return cached;
  })();

  return initPromise;
};

export const getRuntimeConfig = (): AppRuntimeConfig =>
  cached || mergeConfig(fromBuildEnv(), fromLocalStorage());

export const isSupabaseConfigured = (): boolean => {
  const cfg = getRuntimeConfig();
  return !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
};

export const saveSupabaseConfig = (url: string, anonKey: string): void => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_URL, url.trim());
    localStorage.setItem(LS_KEY, anonKey.trim());
  }
  cached = mergeConfig(getRuntimeConfig(), {
    supabaseUrl: url.trim(),
    supabaseAnonKey: anonKey.trim(),
  });
};

export const clearSupabaseConfigCache = (): void => {
  cached = null;
  initPromise = null;
};
