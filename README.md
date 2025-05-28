# LibroSphere - 智能电子书云存储系统

## 项目概述

LibroSphere是一个基于Cloudflare Workers和R2存储构建的现代化电子书管理系统，提供WebDAV服务接口，完美兼容WebDAV协议。它让您可以随时随地访问和管理您珍贵的电子书收藏。

## 核心功能

- **云端存储** - 基于Cloudflare R2
- **跨平台支持** - 完全兼容WebDAV客户端
- **安全可靠** - 基本身份验证保护，确保数据安全
- **零维护** - 无服务器架构，免去服务器维护烦恼
- **简洁界面** - 提供直观的上传、浏览和管理界面


## 快速部署

### 前提准备

- Cloudflare账户
- GitHub账户

### 部署步骤

1. **创建R2存储桶**
   - 登录Cloudflare控制面板
   - 创建名为`librosphere`的R2存储桶

2. **获取API凭证**
   - 创建Cloudflare API令牌，确保有R2和Workers权限
   - 记录您的Cloudflare账户ID

3. **配置仓库**
   - 复刻LibroSphere仓库
   - 添加`CF_API_TOKEN`和`CF_ACCOUNT_ID`密钥

4. **启动部署**
   - 运行GitHub Actions部署工作流
   - 设置Workers应用的用户名(USERNAME)和密码(PASSWORD)

5. **访问您的LibroSphere**
   - 使用`https://LibroSphere-worker.username.workers.dev/web`

LibroSphere - 让您的电子书触手可及，随时随地享受阅读。
