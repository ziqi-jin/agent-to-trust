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

export interface TestOptions {
  name?: string;
  url?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  persona?: string;
  apiBase?: string;
}

export interface ParsedCommand {
  command: 'test' | 'join' | 'init' | 'help';
  test?: TestOptions;
}

const USAGE = `@acl/sdk — Agent Credit Lab 本地考场

用法:
  acl test --url <endpoint> [--name <agent名>]
      对一个 HTTP endpoint 跑评测（OpenAI chat 格式，agent 零改动）

  acl test --model <model> --base-url <url> --api-key <key> [--persona <提示>]
      直接对模型配置跑评测（OpenAI 兼容协议通吃 DeepSeek/智谱/Kimi/OpenAI）

选项:
  --name <agent名>    榜单展示名（默认取 config.agentName 或目录名）
  --api-base <url>    平台 API 地址（默认 env ACL_API_URL）

其他命令:
  acl join    进入 Arena 模拟考场（Phase 2）
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
        'base-url': { type: 'string' },
        'api-key': { type: 'string' },
        persona: { type: 'string' },
        'api-base': { type: 'string' },
      },
    });
    return {
      command: 'test',
      test: {
        name: values.name,
        url: values.url,
        model: values.model,
        baseUrl: values['base-url'],
        apiKey: values['api-key'],
        persona: values.persona,
        apiBase: values['api-base'] ?? process.env.ACL_API_URL,
      },
    };
  }
  if (command === 'join') return { command: 'join' };
  if (command === 'init') return { command: 'init' };
  throw new Error(`未知命令: ${command}（可用: test | join | init | help）`);
}

/** 校验 test 参数。返回错误信息，或 null 表示通过。 */
export function validateTestOptions(t: TestOptions): string | null {
  if (!t.url && !t.model) {
    return '缺少被测对象：--url <endpoint> 或 --model <model> --base-url <url> --api-key <key>';
  }
  if (t.model && (!t.baseUrl || !t.apiKey)) {
    return '--model 模式需要同时提供 --base-url 和 --api-key';
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
      // Task 4/5 接入：runSuite() + uploadResults()
      console.error('[acl] 评测运行器尚未实现（Task 4/5 进行中）');
      process.exit(2);
    }
    case 'join':
      console.error('[acl] Arena 会话桥将在 Phase 2 提供');
      process.exit(2);
    case 'init':
      console.error('[acl] 埋点初始化将在后续版本提供');
      process.exit(2);
  }
}

const isMain =
  process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js');
if (isMain) {
  main().catch((e: unknown) => {
    console.error('[acl] 执行失败:', (e as Error).message);
    process.exit(1);
  });
}
