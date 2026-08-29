/**
 * @acl/sdk — 本地配置（~/.acl/config.json）。
 *
 * 无账号体系：本地文件就是用户的全部「账户状态」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AclConfig {
  /** 默认 agent 展示名。 */
  agentName?: string;
  /** 默认被测 endpoint。 */
  defaultEndpoint?: string;
  /** 平台 API 地址（默认 reeftavern.cc/credit/api）。 */
  apiBase?: string;
}

/** 解析 ~/.acl 目录（可注入覆盖，便于测试）。 */
export function aclDir(dir?: string): string {
  return dir ?? join(homedir(), '.acl');
}

export function loadConfig(dir?: string): AclConfig {
  const file = join(aclDir(dir), 'config.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AclConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: AclConfig, dir?: string): void {
  const d = aclDir(dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}
