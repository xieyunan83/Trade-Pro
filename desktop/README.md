# BabyWorld 桌面客户端

无地址栏桌面应用：安装后打开即连接 **babyworld.ltd**，界面与网页版相同，窗口不显示网址。

技术：Electron 壳（响应最快、跨 Mac/Windows）。

## 下载安装包

已复制到：`~/Downloads/BabyWorld-Desktop/`

| 系统 | 文件 | 用法 |
|------|------|------|
| Mac（Apple Silicon / M1–M4） | `BabyWorld-1.0.0-arm64.dmg` | 打开 DMG，拖到「应用程序」 |
| Mac（Intel） | `BabyWorld-1.0.0.dmg` | 同上 |
| Windows | `BabyWorld-1.0.0-Windows-x64.zip` | 解压后运行 `win-unpacked/BabyWorld.exe` |

工程内备份：`desktop/release/`

### Mac 首次打开提示「无法验证开发者」

右键应用 → **打开** → 再点 **打开**（未做 Apple 开发者签名时的正常现象）。

### Windows

解压 zip 后双击 `BabyWorld.exe`。若 SmartScreen 拦截，选「仍要运行」。

## 本地调试

```bash
cd desktop
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start
```

## 重新打包

```bash
cd desktop
# Mac
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --x64
# Windows（在 Apple Silicon 上打绿色版 zip）
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win dir --x64
cd release && ditto -c -k --keepParent win-unpacked BabyWorld-1.0.0-Windows-x64.zip
```

正式 Windows 安装器（`.exe` Setup）建议在 Windows 电脑或 CI 上执行 `npx electron-builder --win nsis`。
