#!/usr/bin/env node
/** 从 .env.local 同步 Supabase 配置到 public/ 与根目录 app-config.json（供部署版读取） */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const envPath = new URL('../.env.local', import.meta.url);
const envContent = readFileSync(envPath, 'utf8');
const get = (key) => {
  const m = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].replace(/^["']|["']$/g, '') : '';
};

const cfg = {
  supabaseUrl: get('REACT_APP_SUPABASE_URL'),
  supabaseAnonKey: get('REACT_APP_SUPABASE_ANON_KEY'),
  defaultAIModel: get('REACT_APP_DEFAULT_AI_MODEL') || 'qwen',
};

if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  console.error('Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}

const json = JSON.stringify(cfg, null, 2);
mkdirSync(new URL('../public', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/app-config.json', import.meta.url), json);
writeFileSync(new URL('../app-config.json', import.meta.url), json);
console.log('✅ app-config.json synced (public/ + root)');
