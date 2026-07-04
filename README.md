<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Trade-Pro — 外贸获客助理

基于千问 / Gemini 的智能外贸客户背调与开发工具。

## Cursor 本地开发（推荐）

**前置条件：** Node.js 18+

1. 克隆仓库并安装依赖：
   ```bash
   npm install
   ```

2. 复制环境变量模板并填写你的密钥：
   ```bash
   cp .env.example .env.local
   ```
   必填项：
   - `REACT_APP_SUPABASE_URL` — Supabase 项目地址
   - `REACT_APP_SUPABASE_ANON_KEY` — Supabase anon key
   - `REACT_APP_QWEN_API_KEY` — 千问 MaaS API Key

3. 在 Supabase Dashboard 执行 `scripts/supabase-schema.sql` 创建数据表。

4. 启动开发服务器：
   ```bash
   npm run dev
   ```
   打开 http://localhost:3000 ，登录后管理后台应显示 **Supabase 已连接**。

5. 修改 `.env.local` 后需**重启** `npm run dev` 才能生效。

## 配置说明

| 来源 | 用途 |
|------|------|
| `.env.local` | Cursor 本地开发（主配置，Vite 自动读取） |
| `services/bakedConfig.ts` | 生产构建时的备用配置（`npm run sync:config` 从 .env.local 生成） |
| 管理后台手动填写 | 浏览器 localStorage 覆盖（一般不需要） |

Qwen API Key 保存后会同步到 Supabase `api_configs` 表，换设备登录后自动加载。

## 测试 Supabase 连接

```bash
node scripts/test-supabase.mjs
```

## 生产构建

```bash
npm run sync:config   # 可选：同步 Supabase 配置到 bakedConfig
npm run build
npm run preview
```
