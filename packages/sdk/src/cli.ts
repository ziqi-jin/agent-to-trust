#!/usr/bin/env node
/**
 * @acl/sdk — CLI 入口。
 *
 * 用法：
 *   acl test --url <endpoint> [--name <agent名>]
 *   acl test --model <model> --base-url <url> --api-key <key> [--persona <提示>] [--name <agent名>]
 *   acl join   (Phase 2: 进入 Arena 模拟考场)
 *   acl init   (L1 埋点初始化，后续版本)
 */
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { EndpointAgent } from './agent/endpoint.js';
import { ModelAgent } from './agent/model.js';
import { CmdAgent } from './agent/cmd.js';
import { loadConfig } from './config.js';
import { BENCHMARK_VERSION, loadSuite } from './benchmarks/loader.js';
import { runSuite } from './runner.js';
import { uploadResults } from './upload.js';
import { runJoinLoop } from './arena.js';

export interface TestOptions {
  name?: string;
  url?: string;
  model?: string;
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
  /** 密钥目录（多身份/测试用，默认 ~/.acl）。 */
  dir?: string;
}

export interface JoinCliOptions {
  /** 不传 → 准入队列自动撮合（T12）。 */
  session?: string;
  name?: string;
  url?: string;
  model?: string;
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
  /** 密钥目录（多身份/测试用，默认 ~/.acl）。 */
  dir?: string;
}

export interface ParsedCommand {
  command: 'test' | 'join' | 'init' | 'help';
  test?: TestOptions;
  join?: JoinCliOptions;
}

const USAGE = `@acl/sdk — Agent Credit Lab 本地考场

用法:
  acl test --url <endpoint> [--name <agent名>]
      对一个 HTTP endpoint 跑评测（OpenAI chat 格式，agent 零改动）

  acl test --cmd "<命令模板>" [--cmd-stdin] [--name <agent名>]
      对本地 CLI agent 跑评测：prompt 经 shell 转义拼在命令后，
      模板含 {prompt} 则原位替换；--cmd-stdin 改为写入标准输入
      例：acl test --cmd "aider --message" / acl test --cmd "goose run" --cmd-stdin

  acl test --model <model> --base-url <url> --api-key <key> [--persona <提示>]
      直接对模型配置跑评测（OpenAI 兼容协议通吃 DeepSeek/智谱/Kimi/OpenAI）

选项:
  --name <agent名>    榜单展示名（默认取 config.agentName 或目录名）
  --api-base <url>    平台 API 地址（默认 env ACL_API_URL）

其他命令:
  acl join [--session <会话id>] --url <endpoint> [--name <agent名>]
      加入 Arena 市场会话（buyer/seller 回合制交易，跑到结算为止）
      不带 --session 时自动进入准入队列撮合：
      · 门槛：考场分≥400（先跑 acl test 拿真实成绩）
      · 有其他合格 agent 排队 → 立即互为对手
      · 单人排队约 12 秒后由平台脚本买家接单开局（先手出价）
    [--max-rounds <n>]  最大回合数（默认 20）
  acl init    埋点初始化（后续版本）
  acl help    显示本帮助
`;

export function parseCli(argv: string[]): ParsedCommand {
  const [command = 'help', ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help' };
  }
  if (command === 'test') {
    const { values } = parseArgs({
      args: rest,
      options: {
        name: { type: 'string' },
        url: { type: 'string' },
        model: { type: 'string' },
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
        agentVersion: values['agent-version'],
        baseUrl: values['base-url'],
        apiKey: values['api-key'],
        persona: values.persona,
        apiBase: values['api-base'] ?? process.env.ACL_API_URL,
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
        'agent-version': { type: 'string' },
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        persona: { type: 'string' },
        'api-base': { type: 'string' },
        'max-rounds': { type: 'string' },
        cmd: { type: 'string' },
        'cmd-stdin': { type: 'boolean' },
        dir: { type: 'string' },
      },
    });
    return {
      command: 'join',
      join: {
        session: values.session,
        name: values.name,
        url: values.url,
        model: values.model,
        agentVersion: values['agent-version'],
        baseUrl: values['base-url'],
        apiKey: values['api-key'],
        persona: values.persona,
        apiBase: values['api-base'] ?? process.env.ACL_API_URL,
        maxRounds: values['max-rounds'] ? Number(values['max-rounds']) : undefined,
        cmd: values.cmd,
        cmdStdin: values['cmd-stdin'],
        dir: values.dir,
      },
    };
  }
  if (command === 'init') return { command: 'init' };
  throw new Error(`未知命令: ${command}（可用: test | join | init | help）`);
}

/** 校验 test 参数。返回错误信息，或 null 表示通过。 */
export function validateTestOptions(t: TestOptions): string | null {
  if (!t.url && !t.model && !t.cmd) {
    return '缺少被测对象：--url <endpoint> 或 --cmd "<命令>" 或 --model <model> --base-url <url> --api-key <key>';
  }
  if (t.model && !t.url && !t.cmd && (!t.baseUrl || !t.apiKey)) {
    return '--model 模式需要同时提供 --base-url 和 --api-key（--cmd/--url 模式下 --model 仅作模型上报）';
  }
  return null;
}

/** 校验 join 参数。返回错误信息，或 null 表示通过。 */
export function validateJoinOptions(j: JoinCliOptions): string | null {
  if (!j.url && !j.model && !j.cmd) {
    return '缺少被测对象：--url <endpoint> 或 --cmd "<命令>" 或 --model <model> --base-url <url> --api-key <key>';
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
        console.error(`[acl] ${err}`);
        process.exit(1);
      }
      const t = parsed.test!;
      const config = loadConfig();
      const name = ((t.name ?? config.agentName ?? hostname().replace(/\..*$/, '')) || 'my-agent').slice(0, 60);
      const agent = t.url
        ? new EndpointAgent(t.url)
        : t.cmd
          ? new CmdAgent({ cmd: t.cmd, stdin: t.cmdStdin })
          : new ModelAgent({
              model: t.model!,
              baseUrl: t.baseUrl!,
              apiKey: t.apiKey!,
              persona: t.persona,
            });

      const target = t.url ? `endpoint ${t.url}` : t.cmd ? `cmd ${t.cmd}` : `model ${t.model}`;
      console.log(`[acl] 考场 v${BENCHMARK_VERSION} · ${target}`);
      console.log('[acl] 开始评测（33 题：coding 10 / reasoning 10 / honesty 10 / negotiation 3）…\n');

      const suite = await runSuite(agent);

      for (const r of suite.results) {
        const bar = '█'.repeat(Math.round(r.value * 10)).padEnd(10, '░');
        const mark = r.result === 'success' ? '✓' : r.result === 'partial' ? '~' : '✗';
        console.log(`  ${mark} ${r.caseId.padEnd(24)} ${bar} ${r.value}`);
      }
      console.log('\n[acl] 维度汇总：');
      for (const s of suite.summary) {
        console.log(`  ${s.dimension.padEnd(14)} ${s.value}`);
      }

      const apiBase = t.apiBase ?? config.apiBase ?? 'https://reeftavern.cc/credit/api';
      console.log(`\n[acl] 上报 ${apiBase}/ingest/results …`);
      try {
        const res = await uploadResults(suite, {
          meta: {
            name,
            endpoint: t.url ?? (t.cmd ? `cmd:${t.cmd.slice(0, 120)}` : undefined),
            model: t.model,
            version: t.agentVersion,
            modelMeta: t.model
              ? { model: t.model, baseUrl: t.baseUrl ?? '', persona: t.persona }
              : undefined,
          },
          apiBase,
          dir: t.dir,
        });
        console.log(`[acl] ✓ 上榜成功 agentId=${res.agentId} score=${res.score}`);
        console.log(
          `[acl] README badge: [![ACL](${apiBase}/badge/${res.agentId}.svg)](https://reeftavern.cc/credit)`,
        );
      } catch (e) {
        console.error(`[acl] 上报失败：${(e as Error).message}`);
        console.error('[acl] 本地结果已打印；可用 --api-base 指定平台地址重试');
        process.exit(1);
      }
      return;
    }
    case 'join': {
      const j = parsed.join!;
      const err = validateJoinOptions(j);
      if (err) {
        console.error(`[acl] ${err}`);
        process.exit(1);
      }
      const config = loadConfig();
      const name = ((j.name ?? config.agentName ?? hostname().replace(/\..*$/, '')) || 'my-agent').slice(0, 60);
      const agent = j.url
        ? new EndpointAgent(j.url)
        : j.cmd
          ? new CmdAgent({ cmd: j.cmd, stdin: j.cmdStdin })
          : new ModelAgent({
              model: j.model!,
              baseUrl: j.baseUrl!,
              apiKey: j.apiKey!,
              persona: j.persona,
            });
      const apiBase = j.apiBase ?? config.apiBase ?? 'https://reeftavern.cc/credit/api';

      const target = j.url ? `endpoint ${j.url}` : j.cmd ? `cmd ${j.cmd}` : `model ${j.model}`;
      console.log(
        `[acl] Arena ${j.session ? `会话 ${j.session}` : '准入队列（自动撮合）'} · ${target}`,
      );
      try {
        const result = await runJoinLoop({
          agent,
          apiBase,
          sessionId: j.session,
          name,
          maxRounds: j.maxRounds,
          dir: j.dir,
          log: console.log,
        });
        console.log(
          `[acl] ✓ 结束：${result.stoppedReason} · 状态=${result.finalStatus} · 角色=${result.role} · 发出 ${result.eventsSent} 个事件（${result.rounds} 回合）`,
        );
        if (result.finalStatus === 'settled') {
          console.log('[acl] 会话已结算，行为证据已计入双方信用档案');
        }
      } catch (e) {
        console.error(`[acl] Arena 失败：${(e as Error).message}`);
        process.exit(1);
      }
      return;
    }
    case 'init':
      console.error('[acl] 埋点初始化将在后续版本提供');
      process.exit(2);
  }
}

const isMain = (() => {
  try {
    // argv[1] 可能是 symlink（npm 全局 bin 是 symlink），必须解析真实路径再匹配
    return /\/(cli\.(ts|js)|acl(\.js)?)$/.test(realpathSync(process.argv[1] ?? ''));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((e: unknown) => {
    console.error('[acl] 执行失败:', (e as Error).message);
    process.exit(1);
  });
}
