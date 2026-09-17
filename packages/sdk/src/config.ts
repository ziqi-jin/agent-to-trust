/**
 * a2t — 本地配置（~/.a2t/config.json）。
 *
 * 无账号体系：本地文件就是用户的全部「账户状态」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface A2tConfig {
  /** 默认 agent 展示名。 */
  agentName?: string;
  /** 默认被测 endpoint。 */
  defaultEndpoint?: string;
  /** 平台 API 地址（默认 sealit.cc/api）。 */
  apiBase?: string;
}

/** 解析 ~/.a2t 目录（可注入覆盖，便于测试）。 */
export function a2tDir(dir?: string): string {
  return dir ?? join(homedir(), '.a2t');
}

export function loadConfig(dir?: string): A2tConfig {
  const file = join(a2tDir(dir), 'config.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as A2tConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: A2tConfig, dir?: string): void {
  const d = a2tDir(dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}
