# SECURITY — Agent Credit Lab

## 上报安全问题

如发现安全漏洞，请勿公开 Issue。请联系维护者（待补充渠道）。

## 安全基线（执行环境）

所有可执行 Agent 至少具备：

- timeout
- CPU / memory 限制
- tool allowlist
- secret isolation
- 可行的网络控制
- audit log

**禁止**为了 Demo 而允许任意 Agent 直接控制宿主机。

## 数据可信度

- simulation / synthetic 数据必须明确标识。
- 所有对外指标带样本量、时间窗口、来源、版本、局限性。
- 不把 benchmark / simulation 结果宣称成真实世界普遍规律。

## 依赖与密钥

- 敏感配置（DB 密码、API key）走环境变量，不提交仓库。
- 参考 `.env.example` 配置本地环境。

## 已知限制（Stage 0）

- 尚未实现沙箱化 Agent 执行；当前阶段不运行任意第三方代码。
