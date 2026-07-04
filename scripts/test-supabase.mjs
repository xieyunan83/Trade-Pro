import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envPath = new URL('../.env.local', import.meta.url);
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = process.env.REACT_APP_SUPABASE_URL;
const key = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('FAIL: Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const testId = `test-${Date.now()}`;

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✅ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message || String(e) });
    console.log(`❌ ${name}: ${e.message || e}`);
  }
}

console.log('\n=== Supabase 连接测试 ===\n');
console.log(`URL: ${url.substring(0, 30)}...`);

// 1. api_configs
await test('api_configs - insert/upsert', async () => {
  const { error } = await supabase.from('api_configs').upsert({
    user_id: 'default',
    provider: 'test-provider',
    encrypted_key: Buffer.from('test-key').toString('base64'),
    model_id: 'test-model',
  }, { onConflict: 'user_id,provider' });
  if (error) throw error;
});

await test('api_configs - read', async () => {
  const { data, error } = await supabase.from('api_configs').select('*').eq('provider', 'test-provider').single();
  if (error) throw error;
  if (!data) throw new Error('No data returned');
});

await test('api_configs - delete test row', async () => {
  const { error } = await supabase.from('api_configs').delete().eq('provider', 'test-provider');
  if (error) throw error;
});

await test('knowledge_base - upsert with uuid id', async () => {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('knowledge_base').upsert({
    id,
    user_id: 'default',
    title: testId + '-uuid',
    content: 'uuid id test',
    category: 'test',
  });
  if (error) throw error;
  const { error: delErr } = await supabase.from('knowledge_base').delete().eq('id', id);
  if (delErr) throw delErr;
});

await test('knowledge_base - short string id rejected (uuid required)', async () => {
  const id = Math.random().toString(36).substr(2, 9);
  const { error } = await supabase.from('knowledge_base').upsert({
    id,
    user_id: 'default',
    title: testId + '-short',
    content: 'short id test',
    category: 'test',
  });
  if (!error) {
    await supabase.from('knowledge_base').delete().eq('id', id);
    throw new Error('Expected uuid validation error but insert succeeded');
  }
  if (!error.message.includes('uuid')) throw error;
});

await test('knowledge_base - insert (auto id)', async () => {
  const { error } = await supabase.from('knowledge_base').insert({
    user_id: 'default',
    title: testId,
    content: 'Supabase test content',
    category: 'test',
  });
  if (error) throw error;
});

await test('knowledge_base - read', async () => {
  const { data, error } = await supabase.from('knowledge_base').select('*').eq('title', testId);
  if (error) throw error;
  if (!data?.length) throw new Error('No rows found');
});

await test('knowledge_base - saveKnowledgeFile roundtrip', async () => {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('knowledge_base').upsert({
    id,
    user_id: 'default',
    title: `${testId}-file.txt`,
    content: 'Hello Supabase KB test',
    category: 'txt',
  });
  if (error) throw error;
  const { data, error: readErr } = await supabase.from('knowledge_base').select('*').eq('id', id).single();
  if (readErr) throw readErr;
  if (data.content !== 'Hello Supabase KB test') throw new Error('Content mismatch');
  const { error: delErr } = await supabase.from('knowledge_base').delete().eq('id', id);
  if (delErr) throw delErr;
});

// Storage bucket (optional — 需要 RLS 策略，文件内容已存 DB)
await test('knowledge-files storage - upload (optional)', async () => {
  const blob = new Blob(['Supabase storage test file'], { type: 'text/plain' });
  const fileName = `${testId}.txt`;
  const { error } = await supabase.storage.from('knowledge-files').upload(fileName, blob, { upsert: true });
  if (error) throw error;
});

await test('knowledge-files storage - list (optional)', async () => {
  const { data, error } = await supabase.storage.from('knowledge-files').list('', { search: testId });
  if (error) throw error;
  if (!data?.some(f => f.name.includes(testId))) throw new Error('Uploaded file not found in bucket');
});

await test('knowledge-files storage - delete', async () => {
  const { error } = await supabase.storage.from('knowledge-files').remove([`${testId}.txt`]);
  if (error) throw error;
});

// 4. customers
await test('customers - insert', async () => {
  const { error } = await supabase.from('customers').insert({
    company_name: testId,
    country: 'Test',
  });
  if (error) throw error;
});

await test('customers - read', async () => {
  const { data, error } = await supabase.from('customers').select('*').eq('company_name', testId);
  if (error) throw error;
  if (!data?.length) throw new Error('No customer found');
});

await test('customers - delete test row', async () => {
  const { error } = await supabase.from('customers').delete().eq('company_name', testId);
  if (error) throw error;
});

// 5. investigation_history
await test('investigation_history - upsert/read', async () => {
  const localId = `hist-${testId}`;
  const report = { id: localId, type: 'BACKGROUND', domain: 'example.com', timestamp: Date.now(), data: { companyInfo: { name: 'Test Co' } } };
  const { error } = await supabase.from('investigation_history').upsert({
    user_id: 'default',
    local_id: localId,
    domain: 'example.com',
    module_type: 'BACKGROUND',
    report_data: report,
  }, { onConflict: 'user_id,local_id' });
  if (error) throw error;
  const { data, error: readErr } = await supabase.from('investigation_history').select('report_data').eq('local_id', localId).single();
  if (readErr) throw readErr;
  if (data.report_data.id !== localId) throw new Error('History roundtrip mismatch');
  const { error: delErr } = await supabase.from('investigation_history').delete().eq('local_id', localId);
  if (delErr) throw delErr;
});

// 6. discovery_searches
await test('discovery_searches - insert/read', async () => {
  const { error } = await supabase.from('discovery_searches').insert({
    user_id: 'default',
    product: testId,
    country: 'US',
    industry: '',
    client_type: '进口商',
    results: [{ name: 'Acme', website: 'acme.com', country: 'US', description: 'test' }],
    has_searched: true,
  });
  if (error) throw error;
  const { data, error: readErr } = await supabase.from('discovery_searches').select('*').eq('product', testId).limit(1);
  if (readErr) throw readErr;
  if (!data?.length) throw new Error('Discovery search not found');
  const { error: delErr } = await supabase.from('discovery_searches').delete().eq('product', testId);
  if (delErr) throw delErr;
});

// 7. crm_clients
await test('crm_clients - upsert/read/delete', async () => {
  const localId = `crm-${testId}`;
  const client = { id: localId, name: 'Test Client', country: 'CN', type: '进口商', status: '新建/潜在', productType: 'x', industry: 'y', priceRange: 'Low', isSampleNeeded: false, lastOrderDate: '', lastContactSent: '', lastContactReceived: '', nextFollowUpDate: '2026-01-01', activityLog: 'test' };
  const { error } = await supabase.from('crm_clients').upsert({
    user_id: 'default',
    local_id: localId,
    client_data: client,
  }, { onConflict: 'user_id,local_id' });
  if (error) throw error;
  const { data, error: readErr } = await supabase.from('crm_clients').select('client_data').eq('local_id', localId).single();
  if (readErr) throw readErr;
  if (data.client_data.name !== 'Test Client') throw new Error('CRM roundtrip mismatch');
  const { error: delErr } = await supabase.from('crm_clients').delete().eq('local_id', localId);
  if (delErr) throw delErr;
});

await test('knowledge_base - delete test row', async () => {
  const { error } = await supabase.from('knowledge_base').delete().eq('title', testId);
  if (error) throw error;
});

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
const optionalFailed = failed.filter(f => f.name.includes('optional'));

console.log(`\n=== 结果: ${passed}/${results.length} 通过 ===`);
if (optionalFailed.length) {
  console.log('\n⚠️  可选项失败（不影响 DB 知识库保存）:');
  optionalFailed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
}
const criticalFailed = failed.filter(f => !f.name.includes('optional'));
if (criticalFailed.length) {
  console.log('\n❌ 关键失败项:');
  criticalFailed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
