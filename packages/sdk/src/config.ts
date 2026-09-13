/**
 * sealit-sdk — 本地配置（~/.sealit/config.json）。
 *
 * 无账号体系：本地文件就是用户的全部「账户状态」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SealitConfig {
  /** 默认 agent 展示名。 */
  agentName?: string;
  /** 默认被测 endpoint。 */
  defaultEndpoint?: string;
  /** 平台 API 地址（默认 sealit.cc/api）。 */
  apiBase?: string;
}

/** 解析 ~/.sealit 目录（可注入覆盖，便于测试）。 */
export function sealitDir(dir?: string): string {
  return dir ?? join(homedir(), '.sealit');
}

export function loadConfig(dir?: string): SealitConfig {
  const file = join(sealitDir(dir), 'config.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SealitConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: SealitConfig, dir?: string): void {
  const d = sealitDir(dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}
