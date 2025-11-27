# 更新日志 Changelog

所有重要的项目变更都会记录在这个文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
并且本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中
- SFTP 支持
- 文件删除同步
- 批量配置导入/导出
- 上传队列管理
- 带宽限制功能

## [1.0.0] - 2025-11-28

### ✨ 新增
- 🎉 首次发布
- 📁 多 FTP 配置管理
- 👁️ 实时文件监控（基于 chokidar）
- 🔄 自动文件上传到 FTP 服务器
- 📊 分组实时日志显示
- 🎛️ 独立的启动/停止控制
- 🔒 FTPS 安全连接支持
- 🎨 现代化深色主题 UI
- 💻 跨平台支持（macOS 和 Windows）
- 🔧 配置测试功能
- 📝 配置文件持久化存储
- 🌐 GitHub 开源链接

### 🐛 修复
- Windows 路径分隔符兼容性问题
- 文件监控稳定性优化

### 📝 文档
- 完整的 README 文档
- 安装和使用指南
- 构建说明文档
- 贡献指南

### 🔧 技术栈
- Electron 27.0.0
- Chokidar 3.5.3
- basic-ftp 5.0.3
- Lucide Icons

---

## 版本说明

### 语义化版本格式
- **主版本号（Major）**: 不兼容的 API 变更
- **次版本号（Minor）**: 向后兼容的功能新增
- **修订号（Patch）**: 向后兼容的问题修复

### 变更类型
- `新增` - 新功能
- `变更` - 现有功能的变更
- `弃用` - 即将移除的功能
- `移除` - 已移除的功能
- `修复` - Bug 修复
- `安全` - 安全相关的修复

[Unreleased]: https://github.com/crispvibe/ftp-auto-sync/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/crispvibe/ftp-auto-sync/releases/tag/v1.0.0
