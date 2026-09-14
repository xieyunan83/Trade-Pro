# 已代你完成的配置（无需再手动操作）

## 结论先说

| 原来说要你手动做的事 | 现在状态 |
|----------------------|----------|
| 设 Workspace ID + 跑 RLS SQL | **已跳过（故意）**：继续用 `default`，避免误改云端把现有数据锁死。你本机也连不上 Supabase 管理端，我无法代跑 SQL。 |
| 配置阿里云 DirectMail | **已自动接线**：只要 `.env.local` 里填上三个值，邮件模块会自动读入；本地 `npm run dev` 已支持 `/api/directmail`。你当前这三个值还是**空的**，需要你从阿里云控制台复制一次。 |
| 强制改默认密码 | **已放宽**：可点「暂时跳过，先进入系统」；建议有空再改密。 |

## 你只需要做这一件（若要用真实发信）

打开项目根目录 `.env.local`，把下面三项填上（阿里云 → 邮件推送 → 发信地址 / AccessKey）：

```bash
REACT_APP_ALIYUN_EMAIL_ACCESS_KEY_ID=你的AccessKeyId
REACT_APP_ALIYUN_EMAIL_ACCESS_KEY_SECRET=你的AccessKeySecret
REACT_APP_ALIYUN_EMAIL_FROM=已验证发信地址@你的域名.com
```

保存后重启 `npm run dev`。然后到「邮件营销 → 接口配置」应已自动带出；即可真实群发。

## 备份仍在

出问题可回：`docs/ROLLBACK.md` → 分支 `backup/pre-improvements-20260914`
