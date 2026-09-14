# 改进批次说明（2026-09-14）

备份：`backup/pre-improvements-20260914` / 标签 `backup-pre-improvements-20260914`（详见 [ROLLBACK.md](./ROLLBACK.md)）

## 已落地（不影响未配置新功能时的原有流程）

### P0 安全 / 信任
- 密码：PBKDF2 + 盐；旧 SHA-256 仍可登录并自动升级；默认密码强制改密后再进系统
- 云端 API Key：v2 混淆编解码（兼容旧 Base64）
- 可选 RLS 收紧脚本：`scripts/supabase-rls-harden.sql` + `VITE_WORKSPACE_ID`
- 邮件营销：去掉假 `console.log` 发送；未配置 DirectMail 时按钮禁用

### 邮件闭环
- 本地持久化任务/模板/配置
- `/api/directmail` 同源签名代理（阿里云 SingleSendMail）
- 真实发送成功后回写 CRM `lastContactSent` + 活动时间线
- 生成 Mail Group 只记「已生成未发送」，不假装已触达

### 成本 / 架构
- 背调结果本地缓存（同指纹 7 天）
- 用量按登录用户隔离
- 导航元数据抽出 `services/moduleNav.ts`
- Hash 深链 `#/module/strategy` 等
- 补齐 `api/_firewall.ts`；CI：`tsc` + `build`

## 需你手动执行（可选，生产建议）

1. 设随机 `VITE_WORKSPACE_ID`，把云端 `user_id` 迁过去后执行 `supabase-rls-harden.sql`
2. Vercel 配置 `ALIYUN_DM_*`（可替代浏览器里填 AK）
3. 全员改掉默认密码（首次登录会强制）
