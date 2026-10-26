# 外贸智慧协同 · 桌面客户端

无地址栏应用，连接线上平台；安装包内置加密种子（账号 + API 配置）。

## 安装包

`~/Downloads/外贸智慧协同-桌面端/` 或本目录 `release/`：

| 系统 | 文件 |
|------|------|
| Mac（Apple Silicon） | `外贸智慧协同-1.0.0-arm64.dmg` |
| Mac（Intel） | `外贸智慧协同-1.0.0-x64.dmg` |
| Windows | `外贸智慧协同-1.0.0-Windows-x64.zip` → 解压运行 `外贸智慧协同.exe` |

## 重新打包（含种子）

```bash
# 先把管理后台导出的 seed.private.json 放到 desktop/
cd desktop
npm run pack:seed
CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --mac dmg --arm64
CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --mac dmg --x64
CSC_IDENTITY_AUTO_DISCOVERY=false ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --win dir --x64
cd release && ditto -c -k --keepParent win-unpacked 外贸智慧协同-1.0.0-Windows-x64.zip
```

登录页与工作区名称由线上站点提供（域名仍为 babyworld.ltd，界面显示「外贸智慧协同」）。
