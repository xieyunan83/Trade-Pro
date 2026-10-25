#!/usr/bin/env node
/**
 * 将 seed.private.json（明文，勿提交 Git）打成加密 resources/seed.bin
 *
 * 生成 seed.private.json：
 * 1) 浏览器打开平台 → 管理后台 →「导出桌面客户端种子」
 * 2) 或把下载的文件重命名为 desktop/seed.private.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);
const { encryptSeed } = require('../lib/seedCrypto.js');

const privatePath = join(root, 'seed.private.json');
const outDir = join(root, 'resources');
const outPath = join(outDir, 'seed.bin');

if (!existsSync(privatePath)) {
  console.error('❌ 缺少 desktop/seed.private.json');
  console.error('   请在浏览器管理后台点击「导出桌面客户端种子」，保存到该路径后再运行：');
  console.error('   cd desktop && npm run pack:seed');
  process.exit(1);
}

const raw = JSON.parse(readFileSync(privatePath, 'utf8'));
const localStorage =
  raw.localStorage && typeof raw.localStorage === 'object'
    ? raw.localStorage
    : raw && typeof raw === 'object'
      ? raw
      : null;

if (!localStorage || !Object.keys(localStorage).length) {
  console.error('❌ seed.private.json 中没有 localStorage 字段');
  process.exit(1);
}

const payload = {
  version: 1,
  createdAt: Number(raw.createdAt) || Date.now(),
  note: String(raw.note || 'desktop-seed'),
  localStorage,
};

mkdirSync(outDir, { recursive: true });
const bin = encryptSeed(payload);
writeFileSync(outPath, bin);
console.log(`✅ 已写入 ${outPath} (${bin.length} bytes, ${Object.keys(localStorage).length} keys)`);
