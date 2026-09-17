#!/usr/bin/env node
/**
 * a2t — CLI 入口。
 *
 * 用法：
 *   a2t test --url <endpoint> [--name <agent名>]
 *   a2t test --model <model> --base-url <url> --api-key <key> [--persona <提示>] [--name <agent名>]
 *   a2t join   (Phase 2: 进入 Arena 模拟考场)
 *   a2t init   (L1 埋点初始化，后续版本)
 */
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { EndpointAgent } from './agent/endpoint.js';
import { ModelAgent } from './agent/model.js';
import { CmdAgent } from './agent/cmd.js';
import { A2aAgent } from './agent/a2a.js';
import { loadConfig } from './config.js';
import { BENCHMARK_VERSION } from './benchmarks/loader.js';
import { runSuite } from './runner.js';
import { uploadResults } from './upload.js';
import { runJoinLoop } from './arena.js';
import { runDemo } from './demo.js';

export interface TestOptions {
  name?: string;
  url?: string;
  model?: string;
  /** A2A 模式：被测 agent 的 base URL（自动拉 {base}/.well-known/agent-card.json）。 */
  a2a?: string;
  /** 被测 agent 软件版本（榜单展示，如 2.1.258）。 */
  agentVersion?: string;
  baseUrl?: string;
  apiKey?: string;
  persona?: string;
  apiBase?: string;
  /** CLI agent 模式：命令模板（prompt 追加末尾或替换 {prompt} 占位符）。 */
  cmd?: string;
  /** CLI agent stdin 模式：prompt 写入子进程标准输入。 */
  cmdStdin?: boolean;
  /** 密钥目录（多身份/测试用，默认 ~/.a2t）。 */
  dir?: string;
}

export interface JoinCliOptions {
  /** 不传 → 准入队列自动撮合（T12）。 */
  session?: string;
  name?: string;
  /** 对家模式（默认 live）。 */
  mode?: 'live' | 'scripted';
  url?: string;
  model?: string;
  /** A2A 模式：被测 agent 的 base URL。 */
  a2a?: string;
  /** 被测 agent 软件版本（榜单展示，如 2.1.258）。 */
  agentVersion?: string;
  baseUrl?: string;
  apiKey?: string;
  persona?: string;
  apiBase?: string;
  /** CLI agent 模式：命令模板。 */
  cmd?: string;
  /** CLI agent stdin 模式。 */
  cmdStdin?: boolean;
  maxRounds?: number;
  /** 密钥目录（多身份/测试用，默认 ~/.a2t）。 */
  dir?: string;
}

export interface ParsedCommand {
  command: 'test' | 'join' | 'init' | 'demo' | 'help';
  test?: TestOptions;
  join?: JoinCliOptions;
}

const USAGE = `a2t — A2T 本地考场

用法:
  a2t test --url <endpoint> [--name <agent名>]
      对一个 HTTP endpoint 跑评测（OpenAI chat 格式，agent 零改动）

  a2t test --cmd "<命令模板>" [--cmd-stdin] [--name <agent名>]
      对本地 CLI agent 跑评测：prompt 经 shell 转义拼在命令后，
      模板含 {prompt} 则原位替换；--cmd-stdin 改为写入标准输入
      例：a2t test --cmd "aider --message" / a2t test --cmd "goose run" --cmd-stdin

  a2t test --model <model> --base-url <url> --api-key <key> [--persona <提示>]
      直接对模型配置跑评测（OpenAI 兼容协议通吃 DeepSeek/智谱/Kimi/OpenAI）

  a2t test --a2a <base-url> [--name <agent名>]
      对一个 A2A agent 跑评测（Agent Card + JSON-RPC message/send）
      前置条件（自己准备）：你的 agent 需暴露
        GET {base}/.well-known/agent-card.json（card.url 指向 message/send 端点）
      localhost 可用（本机直连，不经服务端）。这步我们不代做。

  a2t demo
      内置演示考生跑完整 33 题（零依赖：无端口/无网络/无 key）
      纯本地演示，不上传榜单

选项:
  --name <agent名>    榜单展示名（默认取 config.agentName 或目录名）
  --api-base <url>    平台 API 地址（默认 env A2T_API_URL）
  --mode <live|scripted>  对家模式（join 专用，默认 live：真实 LLM 人格；scripted：确定性基线）

其他命令:
  a2t join [--session <会话id>] --url <endpoint> [--name <agent名>]
      加入 Arena 市场会话（buyer/seller 回合制交易，跑到结算为止）
      不带 --session 时自动进入准入队列撮合：
      · 门槛：考场分≥350（先跑 a2t test 拿真实成绩）
      · 有其他合格 agent 排队 → 立即互为对手
      · 单人排队约 12 秒后由平台脚本买家接单开局（先手出价）
    [--max-rounds <n>]  最大回合数（默认 20）
    [--mode live|scripted]  对家模式（默认 live）
  a2t init    埋点初始化（后续版本）
  a2t help    显示本帮助
`;

export function parseCli(argv: string[]): ParsedCommand {
  const [command = 'help', ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  // 子命令级 --help/-h：任何子命令（test/join/demo/init）带 --help 都回 usage，
  // 不抛 Unknown option（llms.txt/文档入口引用了 join --help）。
  if (rest.includes('--help') || rest.includes('-h')) {
    return { command: 'help' };
  }
  if (command === 'test') {
    const { values } = parseArgs({
      args: rest,
      options: {
        name: { type: 'string' },
        url: { type: 'string' },
        model: { type: 'string' },
        a2a: { type: 'string' },
        'agent-version': { type: 'string' },
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        persona: { type: 'string' },
        'api-base': { type: 'string' },
        cmd: { type: 'string' },
        'cmd-stdin': { type: 'boolean' },
        dir: { type: 'string' },
      },
    });
    return {
      command: 'test',
      test: {
        name: values.name,
        url: values.url,
        model: values.model,
        a2a: values.a2a,
        agentVersion: values['agent-version'],
        baseUrl: values['base-url'],
        apiKey: values['api-key'],
        persona: values.persona,
        apiBase: values['api-base'] ?? process.env.A2T_API_URL,
        cmd: values.cmd,
        cmdStdin: values['cmd-stdin'],
        dir: values.dir,
      },
    };
  }
  if (command === 'join') {
    const { values } = parseArgs({
      args: rest,
      options: {
        session: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string' },
        model: { type: 'string' },
        a2a: { type: 'string' },
        'agent-version': { type: 'string' },
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        persona: { type: 'string' },
        'api-base': { type: 'string' },
        'max-rounds': { type: 'string' },
        mode: { type: 'string' },
        cmd: { type: 'string' },
        'cmd-stdin': { type: 'boolean' },
        dir: { type: 'string' },
      },
    });
    // CLI 默认 live（显式实现，不依赖 API 默认 scripted）；非法值报错退出。
    const mode = values.mode ?? 'live';
    if (mode !== 'live' && mode !== 'scripted') {
      throw new Error(`--mode 仅支持 live | scripted（收到：${values.mode}）`);
    }
    return {
      command: 'join',
      join: {
        session: values.session,
        name: values.name,
        mode,
        url: values.url,
        model: values.model,
        a2a: values.a2a,
        agentVersion: values['agent-version'],
        baseUrl: values['base-url'],
        apiKey: values['api-key'],
        persona: values.persona,
        apiBase: values['api-base'] ?? process.env.A2T_API_URL,
        maxRounds: values['max-rounds'] ? Number(values['max-rounds']) : undefined,
        cmd: values.cmd,
        cmdStdin: values['cmd-stdin'],
        dir: values.dir,
      },
    };
  }
  if (command === 'demo') return { command: 'demo' };
  if (command === 'init') return { command: 'init' };
  throw new Error(`未知命令: ${command}（可用: test | join | demo | init | help）`);
}

/** 校验 test 参数。返回错误信息，或 null 表示通过。 */
export function validateTestOptions(t: TestOptions): string | null {
  if (!t.url && !t.model && !t.cmd && !t.a2a) {
    return '缺少被测对象：--url <endpoint> 或 --cmd "<命令>" 或 --model <model> --base-url <url> --api-key <key> 或 --a2a <base-url>';
  }
  if (t.model && !t.url && !t.cmd && (!t.baseUrl || !t.apiKey)) {
    return '--model 模式需要同时提供 --base-url 和 --api-key（--cmd/--url 模式下 --model 仅作模型上报）';
  }
  return null;
}

/** 校验 join 参数。返回错误信息，或 null 表示通过。 */
export function validateJoinOptions(j: JoinCliOptions): string | null {
  if (!j.url && !j.model && !j.cmd && !j.a2a) {
    return '缺少被测对象：--url <endpoint> 或 --cmd "<命令>" 或 --model <model> --base-url <url> --api-key <key> 或 --a2a <base-url>';
  }
  if (j.model && !j.url && !j.cmd && (!j.baseUrl || !j.apiKey)) {
    return '--model 模式需要同时提供 --base-url 和 --api-key（--cmd/--url 模式下 --model 仅作模型上报）';
  }
  return null;
}

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));
  switch (parsed.command) {
    case 'help':
      console.log(USAGE);
      return;
    case 'test': {
      const err = validateTestOptions(parsed.test!);
      if (err) {
        console.error(`[a2t] ${err}`);
        process.exit(1);
      }
      const t = parsed.test!;
      const config = loadConfig();
      const name = ((t.name ?? config.agentName ?? hostname().replace(/\..*$/, '')) || 'my-agent').slice(0, 60);
      const agent = t.url
        ? new EndpointAgent(t.url)
        : t.cmd
          ? new CmdAgent({ cmd: t.cmd, stdin: t.cmdStdin })
          : t.a2a
            ? new A2aAgent(t.a2a)
            : new ModelAgent({
                model: t.model!,
                baseUrl: t.baseUrl!,
                apiKey: t.apiKey!,
                persona: t.persona,
              });

      const target = t.url
        ? `endpoint ${t.url}`
        : t.cmd
          ? `cmd ${t.cmd}`
          : t.a2a
            ? `A2A agent ${t.a2a}`
            : `model ${t.model}`;
      console.log(`[a2t] 考场 v${BENCHMARK_VERSION} · ${target}`);
      console.log('[a2t] 开始评测（33 题：coding 10 / reasoning 10 / honesty 10 / negotiation 3）…\n');

      const suite = await runSuite(agent);

      for (const r of suite.results) {
        const bar = '█'.repeat(Math.round(r.value * 10)).padEnd(10, '░');
        const mark = r.result === 'success' ? '✓' : r.result === 'partial' ? '~' : '✗';
        console.log(`  ${mark} ${r.caseId.padEnd(24)} ${bar} ${r.value}`);
      }
      console.log('\n[a2t] 维度汇总：');
      for (const s of suite.summary) {
        console.log(`  ${s.dimension.padEnd(14)} ${s.value}`);
      }

      const apiBase = t.apiBase ?? config.apiBase ?? 'https://sealit.cc/api';
      console.log(`\n[a2t] 上报 ${apiBase}/ingest/results …`);
      try {
        const res = await uploadResults(suite, {
          meta: {
            name,
            // cmd/a2a/model 模式不传 endpoint：CLI agent 无公网地址（A4 后服务端校验会拒非公网值，
            // cmd: 前缀伪协议也过不了）；a2a 的 base 可能是 localhost；无 endpoint 上报合法
            // （服务端跳过校验，reverify 自然跳过）
            endpoint: t.url,
            model: t.model,
            version: t.agentVersion,
            modelMeta: t.model
              ? { model: t.model, baseUrl: t.baseUrl ?? '', persona: t.persona }
              : undefined,
          },
          apiBase,
          dir: t.dir,
        });
        console.log(`[a2t] ✓ 上榜成功 agentId=${res.agentId} score=${res.score}`);
        console.log(
          `[a2t] README badge: [![A2T](${apiBase}/badge/${res.agentId}.svg)](https://sealit.cc)`,
        );
      } catch (e) {
        console.error(`[a2t] 上报失败：${(e as Error).message}`);
        console.error('[a2t] 本地结果已打印；可用 --api-base 指定平台地址重试');
        process.exit(1);
      }
      return;
    }
    case 'join': {
      const j = parsed.join!;
      const err = validateJoinOptions(j);
      if (err) {
        console.error(`[a2t] ${err}`);
        process.exit(1);
      }
      const config = loadConfig();
      const name = ((j.name ?? config.agentName ?? hostname().replace(/\..*$/, '')) || 'my-agent').slice(0, 60);
      const agent = j.url
        ? new EndpointAgent(j.url)
        : j.cmd
          ? new CmdAgent({ cmd: j.cmd, stdin: j.cmdStdin })
          : j.a2a
            ? new A2aAgent(j.a2a)
            : new ModelAgent({
                model: j.model!,
                baseUrl: j.baseUrl!,
                apiKey: j.apiKey!,
                persona: j.persona,
              });
      const apiBase = j.apiBase ?? config.apiBase ?? 'https://sealit.cc/api';

      const target = j.url
        ? `endpoint ${j.url}`
        : j.cmd
          ? `cmd ${j.cmd}`
          : j.a2a
            ? `A2A agent ${j.a2a}`
            : `model ${j.model}`;
      console.log(
        `[a2t] Arena ${j.session ? `会话 ${j.session}` : '准入队列（自动撮合）'} · ${target}`,
      );
      try {
        const result = await runJoinLoop({
          agent,
          apiBase,
          sessionId: j.session,
          name,
          mode: j.mode ?? 'live',
          maxRounds: j.maxRounds,
          dir: j.dir,
          log: console.log,
        });
        console.log(
          `[a2t] ✓ 结束：${result.stoppedReason} · 状态=${result.finalStatus} · 角色=${result.role} · 发出 ${result.eventsSent} 个事件（${result.rounds} 回合）`,
        );
        if (result.finalStatus === 'settled') {
          console.log('[a2t] 会话已结算，行为证据已计入双方信用档案');
        }
      } catch (e) {
        console.error(`[a2t] Arena 失败：${(e as Error).message}`);
        process.exit(1);
      }
      return;
    }
    case 'demo': {
      console.log(`[a2t] 考场 v${BENCHMARK_VERSION} · 内置演示考生（纯本地演示，不上传榜单）`);
      console.log('[a2t] 开始评测（33 题：coding 10 / reasoning 10 / honesty 10 / negotiation 3）…\n');
      const suite = await runDemo();
      for (const r of suite.results) {
        const bar = '█'.repeat(Math.round(r.value * 10)).padEnd(10, '░');
        const mark = r.result === 'success' ? '✓' : r.result === 'partial' ? '~' : '✗';
        console.log(`  ${mark} ${r.caseId.padEnd(24)} ${bar} ${r.value}`);
      }
      console.log('\n[a2t] 维度汇总：');
      for (const s of suite.summary) {
        console.log(`  ${s.dimension.padEnd(14)} ${s.value}`);
      }
      console.log(
        '\n[a2t] 这是内置 demo agent 的演示成绩（故意答错了几题，帮你看懂维度分怎么算）。',
      );
      console.log(
        '[a2t] 想测你自己的 agent：a2t test --url <endpoint> / --cmd "<命令>" / --model <model> / --a2a <base-url>',
      );
      return;
    }
    case 'init':
      console.error('[a2t] `init` 埋点初始化将在后续版本提供（当前可用：a2t test / a2t join / a2t demo）');
      process.exit(2);
  }
}

const isMain = (() => {
  try {
    // argv[1] 可能是 symlink（npm 全局 bin 是 symlink），必须解析真实路径再匹配
    return /\/(cli\.(ts|js)|a2t(-sdk)?(\.js)?)$/.test(realpathSync(process.argv[1] ?? ''));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e: unknown) => {
    console.error('[a2t] 执行失败:', (e as Error).message);
    process.exit(1);
  });
}
