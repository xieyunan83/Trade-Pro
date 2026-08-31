/**
 * 删除 Supabase crm_clients 中 2026-06-01 之前的记录
 * 用法: node scripts/purge-crm-before-june-2026.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUTOFF_MS = new Date('2026-06-01T00:00:00+08:00').getTime();

function loadConfig() {
  const bakedPath = join(__dirname, '../services/bakedConfig.ts');
  try {
    const raw = readFileSync(bakedPath, 'utf8');
    const url = raw.match(/"supabaseUrl":\s*"([^"]+)"/)?.[1];
    const key = raw.match(/"supabaseAnonKey":\s*"([^"]+)"/)?.[1];
    if (url && key) return { url, key };
  } catch {
    /* ignore */
  }
  const url = process.env.REACT_APP_SUPABASE_URL;
  const key = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (url && key) return { url, key };
  throw new Error('未找到 Supabase 配置（bakedConfig 或环境变量）');
}

function resolveClientTime(client) {
  if (client.lastBackgroundCheckAt > 0) return client.lastBackgroundCheckAt;
  const id = (client.id || '').trim();
  const m = id.match(/^(\d{10,13})/);
  if (m) {
    let ts = Number(m[1]);
    if (ts > 0 && ts < 1e12) ts *= 1000;
    if (ts > 1e11 && ts < 2e13) return ts;
  }
  const log = client.activityLog || '';
  const analyzed = log.match(/Analyzed\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (analyzed) {
    const d = new Date(analyzed[1]);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const iso = log.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  for (const raw of [client.lastContactSent, client.lastContactReceived, client.lastOrderDate]) {
    const s = (raw || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T12:00:00`);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }
  const fu = (client.nextFollowUpDate || '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fu)) {
    const d = new Date(`${fu}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return undefined;
}

const { url, key } = loadConfig();
const supabase = createClient(url, key);

const { data, error } = await supabase.from('crm_clients').select('local_id, client_data, updated_at');
if (error) {
  console.error('拉取 CRM 失败:', error.message);
  process.exit(1);
}

const rows = data || [];
const toDelete = [];
const toKeep = [];

for (const row of rows) {
  const client = row.client_data || {};
  const t = resolveClientTime(client);
  if (t != null && t < CUTOFF_MS) {
    toDelete.push({ local_id: row.local_id, name: client.name, time: new Date(t).toISOString() });
  } else {
    toKeep.push(row.local_id);
  }
}

console.log(`CRM 总计 ${rows.length} 条，将删除 ${toDelete.length} 条（早于 2026-06-01），保留 ${toKeep.length} 条`);

if (!toDelete.length) {
  console.log('无需删除。');
  process.exit(0);
}

let deleted = 0;
for (const item of toDelete) {
  const { error: delErr } = await supabase.from('crm_clients').delete().eq('local_id', item.local_id);
  if (delErr) {
    console.warn(`删除失败 ${item.local_id} (${item.name}):`, delErr.message);
  } else {
    deleted += 1;
    if (deleted <= 5) console.log(`  ✓ 已删: ${item.name || item.local_id} (${item.time})`);
  }
}

if (toDelete.length > 5) console.log(`  … 共删除 ${deleted} 条`);
else console.log(`完成，已删除 ${deleted} 条。`);
