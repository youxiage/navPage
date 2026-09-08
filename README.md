# navPage

一个部署在 Cloudflare Workers 上的个人导航页。静态页面和 API 由同一个 Worker 提供，导航数据保存在 D1。

本项目基于 [yvyan/MyPage](https://github.com/yvyan/MyPage) 改造。

## 功能

- 分组和链接管理
- 公开与私密分组
- 百度、Google、Bing 搜索
- 管理员登录与在线编辑
- 自动读取网页标题和描述
- 响应式页面
- GitHub 连接 Cloudflare 后自动部署

## 安全改造

- HMAC-SHA-256 会话签名
- API 同源校验
- 页面动态内容转义
- 管理接口 URL 校验
- 网页信息抓取仅限管理员，并限制协议、目标、响应大小、超时和重定向
- D1 batch 原子删除
- Secret 不进入代码仓库

## 本地运行

```bash
npm install
npx wrangler d1 migrations apply nav-page-db --local
npm run dev
```

本地 Secret 保存在不会提交的 `.dev.vars`：

```dotenv
ADMIN_PASSWORD=你的管理员密码
JWT_SECRET=足够长的随机字符串
```

## 部署

```bash
npx wrangler d1 migrations apply nav-page-db --remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
npm run check
npm run deploy
```

默认自定义域名为 `nav.992698.xyz`。也可以在 Cloudflare Workers Builds 中连接本仓库，构建命令使用 `npm run deploy`。

## 管理员密码

密码通过 Cloudflare Secret 保存。如需立即让所有设备退出登录，同时更新 `JWT_SECRET`。
