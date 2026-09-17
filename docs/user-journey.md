# 用户全流程走查（对外介绍底稿）

> 2026-08-31 凌晨以"外部新用户"身份实测。每一步都是真实执行结果，非规划。

## 用户旅程

| # | 用户动作 | 实测结果 |
|---|---------|---------|
| 1 | 浏览器打开 `https://reeftavern.cc/credit` | ✅ 200（35ms），暗色星空双榜单 |
| 2 | 按 quickstart 安装 SDK | ⚠️ npm 包待发布（bin/build 已就绪）；GitHub 直装需仓库 public |
| 3 | 跑考场（自动生成 Ed25519 密钥 = 身份） | ✅ 全新 `--dir` 零配置生成，33 题本地跑完，agent 输出不出用户机器 |
| 4 | 签名上报 `https://reeftavern.cc/credit/api/ingest/results` | ✅ 上榜成功（实测 score=904） |
| 5 | 榜单看分 + 报告页 | ✅ 榜单 API 可查 |
| 6 | 贴 README 徽章 | ✅ `badge/<agentId>.svg` https 200 |

## 三种接入方式（quickstart 已覆盖）

1. **HTTP endpoint**：`--url <your-agent-url>`（有公网入口可拿 verified 徽章）
2. **模型配置式**：`--model` + `--base-url` + `--api-key`（OpenAI 兼容通吃）
3. **CLI agent**：`--cmd "aider … --message {prompt} | 过滤UI噪音"`（对话型 CLI 用对话模式、必须过滤 banner，实测分数 240 vs 647）

## 本轮模拟发现并修复的问题

1. **HTTPS 全断**：nginx 443 从未配置 → letsencrypt 证书（acme.sh webroot）+ 443 server 块，外部实测 200
2. **SDK 不可发布**：无 bin/build/files → esbuild 单文件 bin（core 打包免多包发布）
3. **npm 全局 bin 静默失败**：入口检测不认 symlink → realpathSync 修复
4. **tgz 安装 404**：dependencies 声明了内部包 @a2t/core → 移至 devDependencies
5. **quickstart 缺 CLI agent 章节** → 已补齐实战姿势

## 上线前剩余前置

1. **发布通道二选一**：npm 发布（需 npm 账号 token；包名建议 `a2t`，`@acl` scope 未必可注册）或 仓库转 public 走 `npm i -g github:ziqi-jin/agent-to-trust`
2. `agent-to-trust` 仓库转 public（对外介绍的 GitHub 链接目前 404）
3. Arena 动作解析公平性审查：自由文本 agent（aider 实测）对局 5/5 轮 parse 失败回退 → rejected；prompt 里动作格式说明需更清晰（harness 公平性，非放水）

## 发布后的用户命令（终态）

```bash
npx agent-to-trust test --cmd "aider --chat-mode ask … --message {prompt} | <噪音过滤>" --name my-agent
```
