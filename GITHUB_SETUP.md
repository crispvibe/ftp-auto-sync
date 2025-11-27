# GitHub 开源项目设置指南

本文档将指导你完成 FTP Auto Sync 项目在 GitHub 上的开源发布流程。

## 📋 准备清单

### ✅ 已完成的文件

项目已包含以下开源项目必需的文件：

- [x] **README.md** - 中文项目文档
- [x] **README_EN.md** - 英文项目文档
- [x] **LICENSE** - MIT 开源许可证
- [x] **CONTRIBUTING.md** - 贡献指南
- [x] **CODE_OF_CONDUCT.md** - 行为准则
- [x] **CHANGELOG.md** - 更新日志
- [x] **SECURITY.md** - 安全政策
- [x] **.gitignore** - Git 忽略文件配置
- [x] **.gitattributes** - Git 属性配置
- [x] **.github/ISSUE_TEMPLATE/** - Issue 模板
  - bug_report.md - Bug 报告模板
  - feature_request.md - 功能请求模板
- [x] **.github/pull_request_template.md** - PR 模板
- [x] **.github/workflows/build.yml** - CI/CD 自动构建配置
- [x] **package.json** - 项目配置（已更新仓库信息）

## 🚀 发布步骤

### 1. 创建 GitHub 仓库

1. 登录 GitHub
2. 点击右上角 "+" → "New repository"
3. 填写仓库信息：
   - **Repository name**: `ftp-auto-sync`
   - **Description**: `A modern cross-platform desktop app for monitoring directories and auto-uploading to multiple FTP servers`
   - **Public** (公开仓库)
   - **不要**勾选 "Initialize this repository with a README"（我们已有 README）

### 2. 更新个人信息

在以下文件中，将占位符替换为你的真实信息：

#### package.json
```json
"author": "Your Name <your-email@example.com>"
```

#### 所有 GitHub 链接
✅ 已完成：GitHub 用户名已设置为 `crispvibe`

需要更新的文件：
- README.md
- README_EN.md
- CONTRIBUTING.md
- SECURITY.md
- CODE_OF_CONDUCT.md
- CHANGELOG.md
- package.json
- renderer.js

### 3. 初始化 Git 仓库

```bash
cd /Users/oreo/Desktop/macOSftp

# 初始化 Git（如果还没有）
git init

# 添加所有文件
git add .

# 首次提交
git commit -m "feat: initial commit - FTP Auto Sync v1.0.0"

# 添加远程仓库
git remote add origin https://github.com/crispvibe/ftp-auto-sync.git

# 推送到 GitHub
git branch -M main
git push -u origin main
```

### 4. 创建第一个 Release

1. 在 GitHub 仓库页面，点击 "Releases" → "Create a new release"
2. 填写信息：
   - **Tag version**: `v1.0.0`
   - **Release title**: `v1.0.0 - 首次发布`
   - **Description**: 复制 CHANGELOG.md 中的 v1.0.0 内容
3. 点击 "Publish release"

### 5. 配置 GitHub Actions（可选）

如果要启用自动构建：

1. 在仓库 Settings → Secrets and variables → Actions
2. 添加必要的 secrets（如果需要）
3. 推送带 tag 的提交会自动触发构建：
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

### 6. 启用 GitHub Discussions（推荐）

1. 在仓库 Settings → Features
2. 勾选 "Discussions"
3. 设置讨论分类

### 7. 添加 Topics

在仓库主页点击设置图标，添加以下 topics：
- `electron`
- `ftp`
- `ftps`
- `file-monitor`
- `file-sync`
- `macos`
- `windows`
- `cross-platform`
- `desktop-app`
- `typescript`

### 8. 完善仓库描述

在仓库主页点击 "About" 旁边的设置图标：
- **Description**: `A modern cross-platform desktop app for monitoring directories and auto-uploading to multiple FTP servers`
- **Website**: 如果有官网
- **Topics**: 添加相关标签

## 📸 添加截图

1. 运行应用并截图
2. 将截图保存到项目根目录或 `screenshots/` 文件夹
3. 在 README.md 的截图部分添加：

```markdown
## 📸 截图

### 主界面
![主界面](screenshots/main.png)

### 配置管理
![配置管理](screenshots/config.png)

### 实时日志
![实时日志](screenshots/logs.png)
```

## 🎯 推广建议

### 社交媒体
- 在 Twitter 上分享
- 在 Reddit r/opensource, r/electronjs 发帖
- 在 Hacker News 分享

### 开发者社区
- Product Hunt 发布
- Dev.to 写文章介绍
- 掘金/思否等中文社区分享

### 添加徽章

在 README.md 顶部可以添加更多徽章：

```markdown
[![GitHub stars](https://img.shields.io/github/stars/crispvibe/ftp-auto-sync?style=social)](https://github.com/crispvibe/ftp-auto-sync)
[![GitHub forks](https://img.shields.io/github/forks/crispvibe/ftp-auto-sync?style=social)](https://github.com/crispvibe/ftp-auto-sync/fork)
[![GitHub issues](https://img.shields.io/github/issues/crispvibe/ftp-auto-sync)](https://github.com/crispvibe/ftp-auto-sync/issues)
[![Downloads](https://img.shields.io/github/downloads/crispvibe/ftp-auto-sync/total)](https://github.com/crispvibe/ftp-auto-sync/releases)
```

## 📝 维护建议

### 定期更新
- 及时回复 Issues 和 PR
- 定期发布新版本
- 更新 CHANGELOG.md
- 保持依赖包最新

### 社区互动
- 感谢贡献者
- 在 Discussions 中与用户交流
- 收集用户反馈改进产品

### 安全维护
- 定期运行 `npm audit`
- 及时修复安全漏洞
- 更新 SECURITY.md

## ✅ 发布检查清单

发布前确认：

- [ ] 所有占位符已替换为真实信息
- [ ] README 文档完整且准确
- [ ] LICENSE 文件正确
- [ ] .gitignore 配置合理
- [ ] package.json 信息完整
- [ ] 代码已测试通过
- [ ] 添加了项目截图
- [ ] 创建了 GitHub 仓库
- [ ] 推送了代码
- [ ] 创建了第一个 Release
- [ ] 添加了仓库描述和 Topics
- [ ] 启用了 Issues 和 Discussions

## 🎉 完成！

恭喜！你的项目已经准备好开源了。

记得在社交媒体上分享，让更多人知道你的项目！

---

如有问题，请查看 [GitHub 官方文档](https://docs.github.com/)。
