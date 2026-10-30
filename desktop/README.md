# 外贸智慧协同 · 桌面客户端

加载线上站点（默认 `https://babyworld.ltd`）。**账号 / API 配置以云端为准，日常升级无需重打安装包。**

分工说明见仓库 `docs/WORKSTATION.md`。

## 朋友打不开 / Windows 深蓝空白窗

客户端**不是离线安装包**，必须能访问线上站点。若浏览器也打不开同一网址，客户端只会空白或提示「无法打开登录界面」。

常见原因：

1. 网络访问 `babyworld.ltd`（Vercel 海外节点）慢/超时/被拦截  
2. 旧客户端每次启动清缓存 + 强刷，弱网下更易一直空白（已在本版修复）

处理：

- 先在对方电脑用浏览器打开 `https://babyworld.ltd` 验证  
- 换热点 / 调整代理后再开客户端  
- 发**本版重新打包**的 Windows 客户端（含错误页与弱网修复）  
- 若国内长期打不开：需给域名接国内可达 CDN / 镜像，并在客户端放入 `resources/app-origin.txt`（一行镜像地址）或设环境变量 `TRADE_APP_ORIGIN`

## 安装包

`~/Downloads/外贸智慧协同-桌面端/`：

| 系统 | 文件 |
|------|------|
| Mac（Apple Silicon） | `外贸智慧协同-1.0.0-arm64.dmg` |
| Mac（Intel） | `外贸智慧协同-1.0.0-x64.dmg` |
| Windows | `外贸智慧协同-1.0.0-Windows-x64.zip` |

## 行为要点

- 已打开窗口**不会**因 GitHub 部署而自动刷新 → 批量背调可继续
- 刷新 / 退出会弹确认（避免误停背调）
- 关闭后台节流 + 阻止系统挂起应用，便于 Windows 最小化跑队列
- 登录后若有未完成 pending 任务会自动续跑
- 种子包仅首次空机兜底；配置变更请管理员「保存配置」到云端
- 连不上站点时显示本地错误页（重试 / 用浏览器打开），不再无限深蓝空白

## 可选：重打安装包（仅外壳或种子变更时）

```bash
cd desktop
# 可选：npm run pack:seed   # 需 seed.private.json
CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --mac dmg --arm64
```
