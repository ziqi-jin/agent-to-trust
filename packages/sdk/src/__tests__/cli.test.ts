import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCli, validateJoinOptions, validateTestOptions } from '../cli.js';
import { loadConfig, saveConfig } from '../config.js';

describe('parseCli', () => {
  it('parses url mode', () => {
    const p = parseCli(['test', '--url', 'http://localhost:3000/agent', '--name', 'my-agent']);
    expect(p.command).toBe('test');
    expect(p.test?.url).toBe('http://localhost:3000/agent');
    expect(p.test?.name).toBe('my-agent');
  });

  it('parses model mode with kebab-case flags', () => {
    const p = parseCli([
      'test',
      '--model',
      'deepseek-v4-flash',
      '--base-url',
      'https://api.deepseek.com/v1',
      '--api-key',
      'sk-x',
      '--persona',
      '客服小明',
    ]);
    expect(p.test?.model).toBe('deepseek-v4-flash');
    expect(p.test?.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(p.test?.apiKey).toBe('sk-x');
    expect(p.test?.persona).toBe('客服小明');
  });

  it('parses cmd mode with stdin flag', () => {
    const p = parseCli(['test', '--cmd', 'goose run', '--cmd-stdin']);
    expect(p.test?.cmd).toBe('goose run');
    expect(p.test?.cmdStdin).toBe(true);
    expect(validateTestOptions(p.test!)).toBeNull();
  });

  it('parses join --cmd without session (admission queue)', () => {
    const p = parseCli(['join', '--cmd', 'aider --message', '--name', 'cmd-agent']);
    expect(p.command).toBe('join');
    expect(p.join?.cmd).toBe('aider --message');
    expect(p.join?.session).toBeUndefined();
    expect(validateJoinOptions(p.join!)).toBeNull();
  });

  it('apiBase falls back to env', () => {
    process.env.SEALIT_API_URL = 'http://test-api';
    try {
      const p = parseCli(['test', '--url', 'http://x']);
      expect(p.test?.apiBase).toBe('http://test-api');
    } finally {
      delete process.env.SEALIT_API_URL;
    }
  });

  it('empty argv → help', () => {
    expect(parseCli([]).command).toBe('help');
  });

  it('unknown command throws', () => {
    expect(() => parseCli(['foo'])).toThrow(/未知命令/);
  });
});

describe('validateTestOptions', () => {
  it('requires url, model, or cmd', () => {
    expect(validateTestOptions({})).toMatch(/--url/);
    expect(validateTestOptions({ model: 'm' })).toMatch(/--base-url/);
    expect(validateTestOptions({ url: 'http://x' })).toBeNull();
    expect(validateTestOptions({ model: 'm', baseUrl: 'u', apiKey: 'k' })).toBeNull();
    expect(validateTestOptions({ cmd: 'aider --message' })).toBeNull();
  });
});

describe('validateJoinOptions', () => {
  it('session optional; cmd accepted; missing target rejected', () => {
    expect(validateJoinOptions({})).toMatch(/--url/);
    expect(validateJoinOptions({ session: 'as-x', url: 'http://x' })).toBeNull();
    expect(validateJoinOptions({ session: 'as-x', cmd: 'goose run' })).toBeNull();
  });
});

describe('config roundtrip', () => {
  it('save then load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-sdk-test-'));
    expect(loadConfig(dir)).toEqual({});
    saveConfig({ agentName: 'x' }, dir);
    expect(loadConfig(dir).agentName).toBe('x');
  });

  it('corrupted config → empty object', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acl-sdk-test-'));
    saveConfig({ agentName: 'y' }, dir);
    // 模拟损坏：直接覆盖坏 JSON
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'config.json'), '{broken');
    expect(loadConfig(dir)).toEqual({});
  });
});
