# 外贸智慧协同 · 桌面客户端

加载线上站点（域名不变）。**账号 / API 配置以云端为准，日常升级无需重打安装包。**

分工说明见仓库 `docs/WORKSTATION.md`。

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

## 可选：重打安装包（仅外壳或种子变更时）

```bash
cd desktop
# 可选：npm run pack:seed   # 需 seed.private.json
CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --mac dmg --arm64
```
