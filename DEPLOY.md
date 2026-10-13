# 磨耳朵 · 部署指南（回家操作，约 5 分钟）

代码已准备好，两个平台任选其一。推荐 **EdgeOne Pages**（腾讯云，国内手机访问更快，微信扫码即可注册）。

## 第一步：推送到 GitHub（两个平台都需要）

```bash
cd app
gh repo create moerduo --private --source . --push
```

（没装 `gh` 的话：在 github.com 网页上新建一个名为 `moerduo` 的私有仓库，然后按页面提示 `git remote add origin ... && git push -u origin main`）

## 方案 A：EdgeOne Pages（推荐）

1. 打开 <https://edgeone.ai/zh/products/pages>，微信扫码登录
2. 「创建项目」→「导入 Git 仓库」→ 授权 GitHub → 选择 `moerduo`
3. 构建配置：
   - 构建命令：`npm run build`
   - 输出目录：`dist`
   - （`functions/` 目录会被自动识别为边缘函数，无需配置）
4. 点「部署」，等 1-2 分钟，得到 `https://xxx.edgeone.app` 网址
5. 手机浏览器打开该网址 → 菜单 →「添加到主屏幕」→ 完成

## 方案 B：Vercel

1. 打开 <https://vercel.com>，用 GitHub 账号登录
2. 「Add New → Project」→ 导入 `moerduo` 仓库
3. 无需改任何配置（`vercel.json` 已备好，`api/` 目录自动成为函数）
4. Deploy，得到 `https://xxx.vercel.app` 网址
5. 同上，添加到手机主屏幕

## 部署后

- 手机上的词库从云端网址重新开始（浏览器数据按网址存储），原局域网地址的词可在旧页面里「设置 → 复制全部文本」导出，再粘贴到新地址
- 部署后是 HTTPS，离线能力（PWA）自动生效：读过的发音离线可听，应用加到主屏幕后全屏独立运行
- 以后我这边改了代码，你 `git push` 一下平台就会自动重新部署

## 遇到问题

直接把报错截图发给 Kimi 这个会话即可。
