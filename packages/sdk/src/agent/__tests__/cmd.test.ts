/**
 * CmdAgent 测试：CLI agent 子进程接入（参数/占位符/stdin 三模式 + 转义 + 错误路径）。
 */

import { describe, expect, it } from 'vitest';
import { CmdAgent, shellEscape } from '../cmd.js';

describe('shellEscape', () => {
  it('普通文本单引号包裹', () => {
    expect(shellEscape('hello world')).toBe(`'hello world'`);
  });

  it("单引号转义为 '\\'' 序列", () => {
    expect(shellEscape("it's")).toBe(`'it'\\''s'`);
  });

  it('特殊字符（$ 反引号）不展开', () => {
    const input = '`id` $(whoami) $HOME';
    // 期望：整体单引号包裹，内部原样（无转义序列）
    expect(shellEscape(input)).toBe("'" + input + "'");
  });
});

describe('CmdAgent — 参数模式', () => {
  it('prompt 追加在命令末尾', async () => {
    const agent = new CmdAgent({ cmd: 'echo' });
    const out = await agent.reply('hello acl');
    expect(out).toBe('hello acl');
  });

  it('{prompt} 占位符原位替换', async () => {
    const agent = new CmdAgent({ cmd: 'echo A2T:{prompt}:END' });
    const out = await agent.reply('x');
    expect(out).toBe('A2T:x:END');
  });

  it('prompt 含单引号/美元符/反引号时安全转义', async () => {
    const agent = new CmdAgent({ cmd: 'echo' });
    const tricky = `it's "quoted" \$(rm -rf /) \`id\` \$HOME`;
    const out = await agent.reply(tricky);
    expect(out).toBe(tricky); // 原样回显，未被 shell 展开
  });

  it('多行 prompt', async () => {
    const agent = new CmdAgent({ cmd: 'echo' });
    const out = await agent.reply('line1\nline2\nline3');
    expect(out).toBe('line1\nline2\nline3');
  });
});

describe('CmdAgent — stdin 模式', () => {
  it('prompt 写入 stdin（cat 回显）', async () => {
    const agent = new CmdAgent({ cmd: 'cat', stdin: true });
    const out = await agent.reply('via-stdin');
    expect(out).toBe('via-stdin');
  });
});

describe('CmdAgent — 错误路径', () => {
  it('非 0 退出码抛错（含 stderr 摘要）', async () => {
    const agent = new CmdAgent({ cmd: 'echo boom >&2; exit 3' });
    await expect(agent.reply('x')).rejects.toThrow(/退出码 3/);
  });

  it('超时抛错并终止子进程', async () => {
    // stdin 模式：prompt 不拼到命令行，sleep 忽略 stdin，稳定触发超时
    const agent = new CmdAgent({ cmd: 'sleep 5', stdin: true, timeoutMs: 200 });
    await expect(agent.reply('x')).rejects.toThrow(/超时/);
  }, 5000);

  it('命令不存在抛错', async () => {
    const agent = new CmdAgent({ cmd: 'definitely-not-a-real-cmd-xyz' });
    await expect(agent.reply('x')).rejects.toThrow();
  });

  it('空输出抛错', async () => {
    const agent = new CmdAgent({ cmd: 'true' });
    await expect(agent.reply('x')).rejects.toThrow(/无输出/);
  });

  it('空 cmd 构造即抛错', () => {
    expect(() => new CmdAgent({ cmd: '  ' })).toThrow(/cmd 不能为空/);
  });
});
