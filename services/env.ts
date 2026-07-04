export type DefaultAIModel = 'qwen' | 'gemini' | 'auto';

const read = (key: string): string =>
  (process.env[key] as string | undefined) || '';

export const env = {
  apiKey: read('API_KEY') || read('REACT_APP_GEMINI_API_KEY'),
  qwenApiKey: read('REACT_APP_QWEN_API_KEY'),
  qwenBaseUrl: read('REACT_APP_QWEN_BASE_URL'),
  qwenModelId: read('REACT_APP_QWEN_MODEL') || read('REACT_APP_QWEN_MODEL_ID'),
  defaultAIModel: (read('REACT_APP_DEFAULT_AI_MODEL') || 'qwen') as DefaultAIModel,
  hunterApiKey: read('HUNTER_API_KEY') || read('REACT_APP_HUNTER_API_KEY'),
  findymailApiKey: read('FINDYMAIL_API_KEY'),
  anymailFinderApiKey: read('ANYMAIL_FINDER_API_KEY'),
  supabaseUrl: read('REACT_APP_SUPABASE_URL'),
  supabaseAnonKey: read('REACT_APP_SUPABASE_ANON_KEY'),
  githubToken: read('VITE_GITHUB_TOKEN'),
  githubOwner: read('VITE_GITHUB_OWNER'),
  githubRepo: read('VITE_GITHUB_REPO'),
};

export const isSupabaseConfigured = (): boolean =>
  !!(env.supabaseUrl && env.supabaseAnonKey);
