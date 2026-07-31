
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { aliyunDevProxyPlugin } from './vite.aliyunProxy'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const pick = (...keys: string[]) => keys.map(k => env[k] || '').find(Boolean) || '';

  let fallbackOrigin = 'https://dashscope.aliyuncs.com';
  try {
    const raw = env.REACT_APP_QWEN_BASE_URL || '';
    if (raw) fallbackOrigin = new URL(raw).origin;
  } catch {
    /* keep default */
  }

  // 供 Vite 代理注入 AnySearch（勿 define 进浏览器包）
  if (env.ANYSEARCH_API_KEY) {
    process.env.ANYSEARCH_API_KEY = env.ANYSEARCH_API_KEY;
  }

  return {
    plugins: [
      react(),
      aliyunDevProxyPlugin(fallbackOrigin, { anysearchApiKey: env.ANYSEARCH_API_KEY || '' }),
    ],
    build: {
      sourcemap: false,
      minify: 'esbuild',
    },
    // 不再使用 server.proxy 的 router（不可靠）；改由 aliyunDevProxyPlugin 处理 /qwen-api
    define: {
      'process.env.API_KEY': JSON.stringify(pick('API_KEY', 'REACT_APP_GEMINI_API_KEY')),
      'process.env.REACT_APP_GEMINI_API_KEY': JSON.stringify(pick('REACT_APP_GEMINI_API_KEY', 'API_KEY')),
      'process.env.REACT_APP_QWEN_API_KEY': JSON.stringify(env.REACT_APP_QWEN_API_KEY || ''),
      'process.env.REACT_APP_QWEN_BASE_URL': JSON.stringify(env.REACT_APP_QWEN_BASE_URL || ''),
      'process.env.REACT_APP_QWEN_MODEL': JSON.stringify(env.REACT_APP_QWEN_MODEL || env.REACT_APP_QWEN_MODEL_ID || ''),
      'process.env.REACT_APP_WAN_API_KEY': JSON.stringify(env.REACT_APP_WAN_API_KEY || ''),
      'process.env.REACT_APP_WAN_BASE_URL': JSON.stringify(env.REACT_APP_WAN_BASE_URL || ''),
      'process.env.REACT_APP_WAN_MODEL': JSON.stringify(env.REACT_APP_WAN_MODEL || 'wan2.7-image'),
      'process.env.REACT_APP_DEFAULT_AI_MODEL': JSON.stringify(env.REACT_APP_DEFAULT_AI_MODEL || 'auto'),
      'process.env.HUNTER_API_KEY': JSON.stringify(pick('HUNTER_API_KEY', 'REACT_APP_HUNTER_API_KEY')),
      'process.env.REACT_APP_HUNTER_API_KEY': JSON.stringify(pick('REACT_APP_HUNTER_API_KEY', 'HUNTER_API_KEY')),
      'process.env.FINDYMAIL_API_KEY': JSON.stringify(env.FINDYMAIL_API_KEY || ''),
      'process.env.ANYMAIL_FINDER_API_KEY': JSON.stringify(env.ANYMAIL_FINDER_API_KEY || ''),
      'process.env.VITE_GITHUB_TOKEN': JSON.stringify(env.VITE_GITHUB_TOKEN || ''),
      'process.env.VITE_GITHUB_OWNER': JSON.stringify(env.VITE_GITHUB_OWNER || ''),
      'process.env.VITE_GITHUB_REPO': JSON.stringify(env.VITE_GITHUB_REPO || ''),
      'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(env.REACT_APP_SUPABASE_URL || ''),
      'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(env.REACT_APP_SUPABASE_ANON_KEY || ''),
    }
  }
})
