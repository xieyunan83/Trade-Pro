/** Template — run `npm run sync:config` to generate bakedConfig.ts from .env.local */
export const bakedAppConfig = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  defaultAIModel: 'qwen',
} as const;
