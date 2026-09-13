/**
 * CmdAgent：CLI agent 子进程接入（benchmark 计划第三梯队）。
 *
 * 文本进出原则不变：把 CLI agent 的 stdout 收敛为「收 prompt、回文本」。
 * 两种模式：
 *   - 参数模式（默认）：prompt 经 shell 单引号转义后拼到命令后，或替换 {prompt} 占位符
 *     例：sealit test --cmd "aider --message"（等效 aider --message '<prompt>'）
 *   - stdin 模式（--cmd-stdin）：prompt 写入子进程 stdin
 *     例：sealit test --cmd "goose run" --cmd-stdin
 *
 * 安全：prompt 永远作为单个 shell 字符串参数传递（单引号包裹），不拼接裸字符串。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SealitAgent } from './types.js';

/** shell 单引号转义：' → '\'' */
export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface CmdAgentOptions {
  /** 命令模板。含 {prompt} 占位符则在原位替换，否则追加到命令末尾。 */
  cmd: string;
  /** prompt 写 stdin（headless 交互式 CLI）。 */
  stdin?: boolean;
  /** 子进程超时毫秒（默认 120000，超时 SIGTERM）。 */
  timeoutMs?: number;
  /** 工作目录。 */
  cwd?: string;
}

export class CmdAgent implements SealitAgent {
  constructor(private readonly opts: CmdAgentOptions) {
    if (!opts.cmd?.trim()) {
      throw new Error('CmdAgent: cmd 不能为空');
    }
  }

  async reply(prompt: string): Promise<string> {
    const timeoutMs = this.opts.timeoutMs ?? 120_000;

    return new Promise<string>((resolve, reject) => {
      const fullCmd = this.opts.stdin
        ? this.opts.cmd
        : this.opts.cmd.includes('{prompt}')
          ? this.opts.cmd.replace('{prompt}', shellEscape(prompt))
          : `${this.opts.cmd} ${shellEscape(prompt)}`;

      // cwd 隔离：CLI agent 会在工作目录里读写文件（aider 建/改文件等），
      // 未显式指定 cwd 时每题一个临时目录，防止污染宿主目录（含 acl 仓库自身）。
      const cwd = this.opts.cwd ?? mkdtempSync(join(tmpdir(), 'acl-cmd-'));

      const child = spawn('sh', ['-c', fullCmd], {
        cwd,
        stdio: this.opts.stdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref();
        reject(new Error(`cmd 超时（${timeoutMs}ms）：${this.opts.cmd.slice(0, 80)}`));
      }, timeoutMs);
      timer.unref();

      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cmd 启动失败：${e.message}`));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `cmd 退出码 ${code}：${(stderr || stdout).trim().slice(0, 300) || this.opts.cmd}`,
            ),
          );
          return;
        }
        const out = stdout.trim();
        if (!out) {
          reject(
            new Error(
              `cmd 无输出：${this.opts.cmd.slice(0, 80)}${stderr ? `（stderr: ${stderr.trim().slice(0, 200)}）` : ''}`,
            ),
          );
          return;
        }
        resolve(out);
      });

      if (this.opts.stdin) {
        child.stdin?.end(prompt);
      }
    });
  }
}
