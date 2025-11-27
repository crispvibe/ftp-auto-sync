# FTP Auto Sync

<div align="center">

![FTP Auto Sync](ftp.png)

一个现代化的跨平台桌面应用，用于监控本地目录并自动上传修改的文件到多个 FTP 服务器。

[![GitHub](https://img.shields.io/badge/GitHub-开源项目-blue?logo=github)](https://github.com/crispvibe/ftp-auto-sync)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](https://github.com/crispvibe/ftp-auto-sync/releases)
[![Electron](https://img.shields.io/badge/Electron-27.0.0-blue.svg)](https://www.electronjs.org/)

中文文档 | [English](README_EN.md)

</div>

## ✨ 功能特性

- 🎯 **多 FTP 配置支持** - 同时管理多个 FTP 服务器配置
- 📁 **实时文件监控** - 自动检测文件修改并上传
- 🔄 **自动上传** - 文件保存后自动上传到 FTP 服务器
- 📊 **分组日志** - 每个 FTP 配置独立的实时日志显示
- 🎛️ **开关控制** - 独立控制每个 FTP 连接的启动/停止
- 🎨 **现代化 UI** - 美观的深色主题界面
- 🔒 **安全连接** - 支持 FTPS 加密传输
- ⚡ **高性能** - 基于 Electron 和 Chokidar 构建
- 💻 **跨平台** - 支持 macOS (Intel & Apple Silicon) 和 Windows (x64 & ARM64)
- 🔐 **智能验证** - 启动前自动测试 FTP 连接，避免无效配置
- 🔄 **自动重试** - 上传失败时自动重试，支持指数退避策略
- 🔒 **并发控制** - 防止同一文件重复上传，避免连接冲突
- ✂️ **自动清理** - 输入框自动去除首尾空格，避免配置错误
- 🖱️ **快捷操作** - 支持双击编辑、快捷键等便捷操作

## 📸 截图

![应用截图](截屏2025-11-28%2000.46.05_副本.png)

*现代化的深色主题界面，支持多 FTP 配置管理和实时日志显示*

## 🚀 快速开始

### 前置要求

- Node.js 16 或更高版本
- npm 或 yarn

### 安装

```bash
# 克隆仓库
git clone https://github.com/crispvibe/ftp-auto-sync.git

# 进入目录
cd ftp-auto-sync

# 安装依赖
npm install

# 开发模式运行（带开发者工具）
npm run dev

# 或生产模式运行
npm start
```

### 打包

```bash
# 为当前平台打包
npm run build

# 为 macOS 打包
npm run build:mac

# 为 Windows 打包
npm run build:win

# 为所有平台打包
npm run build:all
```

打包后的应用将在 `dist` 目录中。

## 📖 使用说明

### 1. 添加 FTP 配置

- 点击左侧边栏的 "添加新配置" 按钮
- 填写配置信息：
  - **配置名称**: 为这个配置起一个易识别的名字
  - **本地监控目录**: 选择要监控的本地文件夹
  - **FTP 主机**: FTP 服务器地址
  - **端口**: FTP 端口（默认 21）
  - **用户名**: FTP 登录用户名
  - **密码**: FTP 登录密码
  - **远程目录**: 文件上传到 FTP 服务器的目标目录
  - **使用安全连接**: 是否使用 FTPS 加密
  - **上传新文件**: 是否上传新创建的文件（默认只上传修改的文件）

### 2. 测试连接

在保存配置前，可以点击 "测试连接" 按钮验证 FTP 连接是否正常。

### 3. 启动监控

- 保存配置后，点击配置卡片上的 "启动" 按钮
- 应用将开始监控指定目录
- 文件修改后会自动上传到 FTP 服务器

### 4. 查看日志

- 右侧主面板显示所有配置的实时日志
- 日志按配置分组显示
- 不同类型的日志用不同颜色标识：
  - 蓝色：信息日志
  - 绿色：成功上传
  - 红色：错误信息

### 5. 管理配置

- **编辑**: 修改现有配置
- **删除**: 删除不需要的配置
- **启动/停止**: 控制监控的开关

## 🛠️ 技术栈

- **Electron**: 跨平台桌面应用框架
- **Chokidar**: 高性能文件系统监控
- **basic-ftp**: FTP 客户端库
- **Lucide Icons**: 现代图标库

## 📁 项目结构

```
ftp-auto-sync/
├── main.js                 # Electron 主进程
├── renderer.js             # 渲染进程逻辑
├── index.html              # UI 界面
├── package.json            # 项目配置
├── ftp-configs.json        # 配置文件（自动生成）
├── README.md               # 中文文档
├── README_EN.md            # 英文文档
├── LICENSE                 # MIT 许可证
├── CONTRIBUTING.md         # 贡献指南
├── CHANGELOG.md            # 更新日志
├── SECURITY.md             # 安全政策
└── .github/                # GitHub 配置
    ├── workflows/          # CI/CD 工作流
    └── ISSUE_TEMPLATE/     # Issue 模板
```

## ⚙️ 配置文件

配置信息保存在应用目录下的 `ftp-configs.json` 文件中。

- **开发环境**: 配置文件位于项目根目录
- **生产环境**: 配置文件位于应用安装目录下

配置文件格式参考 `ftp-configs.example.json`。

### 备份配置

可以直接复制 `ftp-configs.json` 文件进行备份，或在其他设备上恢复配置。

## 🔒 安全

- 配置信息（包括密码）以明文形式存储在 `ftp-configs.json`，请妥善保管
- 建议使用 FTPS 安全连接
- 使用最小权限的 FTP 账户
- 定期更改 FTP 密码

更多安全信息请查看 [SECURITY.md](SECURITY.md)。

## ⚠️ 注意事项

1. 确保 FTP 服务器允许远程连接
2. 监控大型目录可能会消耗较多系统资源
3. 建议先在测试环境验证配置后再用于生产环境
4. 配置文件已添加到 `.gitignore`，不会被提交到版本控制

## 系统要求

- macOS 10.13 或更高版本
- Node.js 16 或更高版本

## 🤝 贡献

欢迎贡献！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

如果这个项目对你有帮助，请给个 ⭐️ Star 支持一下！

## 📝 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🔗 链接

- **GitHub 仓库**: [https://github.com/crispvibe/ftp-auto-sync](https://github.com/crispvibe/ftp-auto-sync)
- **问题反馈**: [Issues](https://github.com/crispvibe/ftp-auto-sync/issues)
- **功能建议**: [Discussions](https://github.com/crispvibe/ftp-auto-sync/discussions)

## 📮 联系方式

- GitHub: [@crispvibe](https://github.com/crispvibe)

## 🙏 致谢

感谢所有为这个项目做出贡献的人！

- [Electron](https://www.electronjs.org/)
- [Chokidar](https://github.com/paulmillr/chokidar)
- [basic-ftp](https://github.com/patrickjuchli/basic-ftp)
- [Lucide Icons](https://lucide.dev/)

---

Made with ❤️ by [crispvibe](https://github.com/crispvibe)
