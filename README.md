# EZSTARTAgentDSH

EZSTART Agent 的 DeepSeek Harness 插件：把 DSH 侧边栏品牌改成 **deepseek EZAgent**，并在左侧菜单底部加一个 **EZCloud 登录入口**。

登录后插件会在你的 EZCloud 账号下创建（或复用）一个名为 `EZAgent` 的长期 API 密钥，并保存在本机。之后只要本机存在这个密钥，插件就认为处于登录状态。

![插件图标](icon.png)

## 功能

- **左侧菜单登录入口**：固定在侧边栏底部、设置按钮上方。未登录显示「登录」，已登录显示账号名与首字母头像。
- **登录弹窗**：账号 + 密码登录，自动识别手机号（走手机号分支）或用户名；登录成功后展示账号、显示名与脱敏后的密钥，并可一键复制。
- **自动签发密钥**：登录时读取账号下的密钥列表，已存在 `EZAgent` 则直接复用，否则创建 `unlimited_quota`、永不过期的同名密钥，再回读明文 `sk-` 值。
- **登录态 = 密钥存在**：`readSession()` 只认本机存储中带有非空 `apiKey` 的会话，刷新页面、重启应用都不会丢登录态。
- **退出登录**：先清空本地会话，再尽力撤销本次登录签发的 device key。
- **品牌更名**：侧边栏 wordmark 显示为 `deepseek EZAgent`。

## 安装

1. 把本仓库克隆（或链接）到任意目录，例如：

   ```powershell
   git clone https://github.com/YeshengSu/EZSTARTAgentDSH "$HOME\Documents\deepseek-harness\default-workspace\EZAgent"
   ```

2. 在 DSH 配置档（`%USERPROFILE%\.dsh\profiles\desktop\package.json`）中加入链接依赖与 bundle 条目：

   ```json
   {
     "dependencies": {
       "EZAgent": "link:C:/Users/<you>/Documents/deepseek-harness/default-workspace/EZAgent"
     },
     "dsh": {
       "profile": {
         "bundles": ["...", "EZAgent"]
       }
     }
   }
   ```

3. 重启 DeepSeek Harness。

> 宿主角色的代码（`index.js`）只在应用启动时加载，改动后必须重启；只改 `client.js` 时刷新页面即可。

## 使用

1. 点击左侧菜单最下方的登录入口。
2. 输入 EZCloud 账号与密码，点「登录」。
3. 看到账号、显示名和 `sk-…` 密钥即登录成功；密钥会自动保存在本机，供后续使用。
4. 需要退出时再次点开入口，选择「退出登录」。

## 架构

插件由两个半端组成，都放在同一个包里：

```
EZAgent/
├─ client.js          # 浏览器半端：侧边栏入口、弹窗、本地登录态
├─ index.js           # 宿主半端：/ezagent/ezcloud/* 路由，真正发请求给 EZCloud
├─ cordis.patch.yml   # 把插件挂进 DSH 插件树
├─ package.json       # 插件清单（dsh.client / dsh.bundle）
└─ icon.png           # 插件图标
```

**为什么登录请求要走宿主端？** 线上 EZCloud 只在 `OPTIONS` 预检里返回 `Access-Control-*`，真实响应没有这些头，浏览器里任何跨域 `fetch` 都会失败。因此浏览器半端不发请求给 EZCloud，而是把 `sign-in` / `sign-out` 交给插件宿主端，由 Node 侧发请求：

```
页面 fetch('ezagent/ezcloud/sign-in')   （相对页面基址解析）
   └─ dsh-app://app/ezagent/ezcloud/sign-in
        └─ 桌面外壳转发到宿主 HTTP 服务（同源）
             └─ index.js: POST https://api.ezstartai.com/api/user/login?turnstile=
```

宿主端路由：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/ezagent/ezcloud/sign-in` | POST | 账号密码登录，返回 `{ok:true, session:{…, apiKey}}` |
| `/ezagent/ezcloud/sign-out` | POST | 撤销 device key，返回 `{ok:true, result:{revoked}}` |

失败时统一返回 `{ok:false, error:{code, message}}`，`message` 直接透出给弹窗。

宿主端还会：只接受 `POST`、限制请求体 64 KiB、20 秒超时，并在 `connection` 服务可用时复用其同源/登录票据校验拒绝跨站调用。

## 登录态与本地数据

登录态保存在浏览器 `localStorage` 的 `ezagent.ezcloud.session.v1` 中，只包含：

- `apiKey` / `apiKeyId` / `apiKeyName` —— 判断是否登录的唯一依据
- `username` / `displayName` / `userId` / `group` —— 仅用于界面展示
- `deviceKey` —— 退出登录时撤销用

**不保存** dashboard 的 `access_token` 与 session id：它们在宿主端用完即弃，不进浏览器存储。

## 安全说明

- 账号密码只在一次登录请求中出现，交给宿主端后立即用于 EZCloud 认证，不落盘、不回显。
- 密钥以明文存在本机 localStorage，用于调用 EZCloud；退出登录会清空本地会话并撤销 device key。
- 宿主端路由默认同源可用；`connection` 服务存在时，跨站请求会被 403 拒绝。
- 尚未实现：二次验证（2FA）账号会收到明确提示并中止登录；套餐/余额等信息未接入。

## 常见问题

**点登录后提示「无法连接 EZCloud 服务，请检查本机网络」**
宿主端拿不到请求：确认已重启 DSH（宿主端代码需要重新加载），并检查本机能否访问 `https://api.ezstartai.com`。

**提示「该账号已开启二次验证」**
当前版本不支持 2FA 账号，请先在 EZCloud 网页端关闭二次验证，或换用未开启 2FA 的账号。

**左侧菜单没有登录入口**
确认 `package.json` 里的 profile 已包含 `EZAgent`，且侧边栏底部区域没有被其它插件占用；重启应用后再看。

## English

A DeepSeek Harness plugin for EZSTART Agent. It rebrands the sidebar wordmark to **deepseek EZAgent** and adds an **EZCloud sign-in entry** at the bottom of the left menu.

Signing in creates (or reuses) a long-lived API key named `EZAgent` under your EZCloud account; the key is stored on this machine, and its presence is what counts as "signed in".

The browser half never calls EZCloud directly — the deployed gateway omits CORS headers on real responses — so sign-in is proxied through the plugin's host half at `/ezagent/ezcloud/*`. Only the API key, account labels, and the revocable device key are kept in local storage; the dashboard access token is not persisted.

Install by linking the package into your DSH profile's `dependencies` and adding it to `dsh.profile.bundles`, then restart DeepSeek Harness.

## License

未附带许可证文件；如需对外分发，请先与仓库所有者确认授权方式。
