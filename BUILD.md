# FTP Monitor - 打包说明

## 版本信息
- **应用名称**: FTP
- **版本号**: 1.0.0
- **图标**: ftp.png
- **支持平台**: macOS, Windows

## 打包前准备

1. 确保已安装所有依赖：
```bash
npm install
```

2. 确保 `ftp.png` 图标文件存在于项目根目录

## 打包命令

### 打包 macOS 应用（DMG + ZIP）
```bash
npm run build:mac
```

**打包输出** (在 `dist` 目录)：
- `FTP-1.0.0.dmg` - DMG 安装包
- `FTP-1.0.0-mac.zip` - ZIP 压缩包
- `FTP-1.0.0-arm64-mac.zip` - Apple Silicon 版本
- `FTP-1.0.0-x64-mac.zip` - Intel 版本

**支持的架构**：
- x64 (Intel Mac)
- arm64 (Apple Silicon M1/M2/M3/M4)

### 打包 Windows 应用（NSIS + ZIP）
```bash
npm run build:win
```

**打包输出** (在 `dist` 目录)：
- `FTP Setup 1.0.0.exe` - NSIS 安装程序
- `FTP-1.0.0-win.zip` - ZIP 压缩包
- `FTP-1.0.0-arm64-win.zip` - ARM64 版本
- `FTP-1.0.0-x64-win.zip` - x64 版本

**支持的架构**：
- x64 (64位 Windows)
- arm64 (ARM Windows，如 Surface Pro X)

### 打包所有平台
```bash
npm run build:all
```

这将同时打包 macOS 和 Windows 版本。

### 通用打包命令
```bash
npm run build
```

这将根据当前系统打包对应平台的应用。

## 图标要求

### macOS 图标
- 推荐使用 `.icns` 格式（可以使用 PNG 但 ICNS 更好）
- 如果使用 PNG，建议尺寸：1024x1024px
- 图标应该是正方形

### Windows 图标
- 推荐使用 `.ico` 格式（可以使用 PNG）
- 如果使用 PNG，建议尺寸：256x256px 或更大
- 图标应该是正方形
- electron-builder 会自动将 PNG 转换为 ICO

### 将 PNG 转换为 ICNS（可选）

如果需要更好的图标质量，可以将 ftp.png 转换为 ftp.icns：

```bash
# 创建临时目录
mkdir ftp.iconset

# 生成不同尺寸
sips -z 16 16     ftp.png --out ftp.iconset/icon_16x16.png
sips -z 32 32     ftp.png --out ftp.iconset/icon_16x16@2x.png
sips -z 32 32     ftp.png --out ftp.iconset/icon_32x32.png
sips -z 64 64     ftp.png --out ftp.iconset/icon_32x32@2x.png
sips -z 128 128   ftp.png --out ftp.iconset/icon_128x128.png
sips -z 256 256   ftp.png --out ftp.iconset/icon_128x128@2x.png
sips -z 256 256   ftp.png --out ftp.iconset/icon_256x256.png
sips -z 512 512   ftp.png --out ftp.iconset/icon_256x256@2x.png
sips -z 512 512   ftp.png --out ftp.iconset/icon_512x512.png
sips -z 1024 1024 ftp.png --out ftp.iconset/icon_512x512@2x.png

# 转换为 icns
iconutil -c icns ftp.iconset

# 清理
rm -rf ftp.iconset
```

然后在 package.json 中将图标改为 `"icon": "ftp.icns"`

## 测试应用

打包前可以先测试：
```bash
npm start
```

开发模式（带开发者工具）：
```bash
npm run dev
```

## 平台特定说明

### macOS
- 在 macOS 上可以打包 macOS 和 Windows 版本
- 需要安装 Xcode Command Line Tools
- DMG 安装包提供拖放安装体验

### Windows
- 在 Windows 上只能打包 Windows 版本
- NSIS 安装程序提供标准的 Windows 安装向导
- 支持自定义安装目录
- 自动创建桌面快捷方式和开始菜单项

### 跨平台打包
如果需要在一个平台上打包另一个平台的应用：
- 在 macOS 上可以打包 Windows 应用（推荐）
- 在 Windows 上打包 macOS 应用需要额外配置（不推荐）

## 配置文件位置

### macOS
- 开发环境: `项目根目录/ftp-configs.json`
- 生产环境: `应用.app/Contents/Resources/ftp-configs.json`

### Windows
- 开发环境: `项目根目录\ftp-configs.json`
- 生产环境: `应用安装目录\resources\ftp-configs.json`

## 注意事项

1. **首次打包**: 首次打包可能需要下载依赖，请耐心等待
2. **代码签名**: 生产环境建议配置代码签名证书
3. **自动更新**: 可以配置 electron-updater 实现自动更新
4. **架构选择**: 用户应根据自己的系统架构下载对应版本
