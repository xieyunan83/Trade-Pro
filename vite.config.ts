
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const pick = (...keys: string[]) => keys.map(k => env[k] || '').find(Boolean) || '';

  return {
    plugins: [react()],
    build: {
      sourcemap: false,
      minify: 'esbuild',
    },
    server: {
      proxy: {
        // 开发环境代理千问 API，避免浏览器 CORS / Failed to fetch
        '/qwen-api': {
          target: (() => {
            const raw = env.REACT_APP_QWEN_BASE_URL || '';
            try {
              return raw ? new URL(raw).origin : 'https://dashscope.aliyuncs.com';
            } catch {
              return 'https://dashscope.aliyuncs.com';
            }
          })(),
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/qwen-api/, ''),
        },
      },
    },
    define: {
      'process.env.API_KEY': JSON.stringify(pick('API_KEY', 'REACT_APP_GEMINI_API_KEY')),
      'process.env.REACT_APP_GEMINI_API_KEY': JSON.stringify(pick('REACT_APP_GEMINI_API_KEY', 'API_KEY')),
      'process.env.REACT_APP_QWEN_API_KEY': JSON.stringify(env.REACT_APP_QWEN_API_KEY || ''),
      'process.env.REACT_APP_QWEN_BASE_URL': JSON.stringify(env.REACT_APP_QWEN_BASE_URL || ''),
      'process.env.REACT_APP_QWEN_MODEL': JSON.stringify(env.REACT_APP_QWEN_MODEL || env.REACT_APP_QWEN_MODEL_ID || ''),
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
