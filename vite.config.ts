
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    build: {
      sourcemap: false,
      minify: 'esbuild',
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ''),
      'process.env.HUNTER_API_KEY': JSON.stringify(env.HUNTER_API_KEY || ''),
      'process.env.FINDYMAIL_API_KEY': JSON.stringify(env.FINDYMAIL_API_KEY || ''),
      'process.env.ANYMAIL_FINDER_API_KEY': JSON.stringify(env.ANYMAIL_FINDER_API_KEY || ''),
      // NEW: GitHub Integration Keys
      'process.env.VITE_GITHUB_TOKEN': JSON.stringify(env.VITE_GITHUB_TOKEN || ''),
      'process.env.VITE_GITHUB_OWNER': JSON.stringify(env.VITE_GITHUB_OWNER || ''),
      'process.env.VITE_GITHUB_REPO': JSON.stringify(env.VITE_GITHUB_REPO || '')
    }
  }
})
