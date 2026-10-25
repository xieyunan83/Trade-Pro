# BabyWorld 桌面客户端

无地址栏应用，打开后连接线上平台；**安装包可内置加密种子**（账号 + API 配置），换电脑也能直接用。

## 给业务员的安装包

放在 `~/Downloads/BabyWorld-Desktop/` 或本目录 `release/`：

| 系统 | 文件 |
|------|------|
| Mac（Apple Silicon） | `BabyWorld-*-arm64.dmg` |
| Mac（Intel） | `BabyWorld-*.dmg`（非 arm64） |
| Windows | `BabyWorld-*-Windows-x64.zip` → 解压运行 `BabyWorld.exe` |

## 管理员：把「本机有的账号/配置」打进安装包

1. 用**已配置好的浏览器**打开平台，管理员登录  
2. 后台 **API 密钥配置** → **导出桌面客户端种子**（下载 `seed.private.json`）  
3. 把文件放到：`Trade-Pro/desktop/seed.private.json`（勿提交 Git）  
4. 打包：

```bash
cd desktop
npm run pack:seed
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --x64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win dir --x64
cd release && ditto -c -k --keepParent win-unpacked BabyWorld-1.0.0-Windows-x64.zip
```

种子以 AES 加密为 `resources/seed.bin` 打进安装包；客户端首次打开会写入本机。  
改密码或 Key 后请重新导出种子并重打安装包（或依赖云端同步覆盖）。

## 安全说明

安装包内的种子可被专业用户解开。适合「公司内发客户端」；对外公开下载请仍以云端权限为准，勿把含生产 Key 的安装包发到公网。

## 本地调试

```bash
cd desktop
npm install
npm run pack:seed   # 若已有 seed.private.json
npm start
```
