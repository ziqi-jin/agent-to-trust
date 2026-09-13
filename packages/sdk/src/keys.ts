/**
 * 密钥即身份：本地 Ed25519 密钥对（~/.sealit/）。
 *
 * 无账号体系：首次运行生成，同一 agent 的分数只有同一把钥能更新。
 * 钥丢失 = 重新测试即重新绑定（零客服成本）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { sealitDir } from './config.js';

export interface SealitKeypair {
  publicKeyPem: string;
  privateKeyPem: string;
}

const PRIV_FILE = 'ed25519.key';
const PUB_FILE = 'ed25519.pub';

/** 生成（首次）或加载（后续）密钥对。幂等：同目录多次调用同钥。 */
export function ensureKeypair(dir?: string): SealitKeypair {
  const d = sealitDir(dir);
  const privPath = join(d, PRIV_FILE);
  const pubPath = join(d, PUB_FILE);
  if (existsSync(privPath) && existsSync(pubPath)) {
    return {
      privateKeyPem: readFileSync(privPath, 'utf8'),
      publicKeyPem: readFileSync(pubPath, 'utf8'),
    };
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  mkdirSync(d, { recursive: true });
  writeFileSync(privPath, privateKeyPem, { mode: 0o600 });
  writeFileSync(pubPath, publicKeyPem);
  return { publicKeyPem, privateKeyPem };
}

/** 规范化 JSON：递归排序 key——保证签名方与验证方字节一致。 */
function canonicalJson(payload: unknown): string {
  return JSON.stringify(sortKeysDeep(payload));
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, sortKeysDeep(val)]),
    );
  }
  return v;
}

/** Ed25519 签名（base64）。 */
export function signPayload(privateKeyPem: string, payload: unknown): string {
  const data = Buffer.from(canonicalJson(payload), 'utf8');
  return cryptoSign(null, data, createPrivateKey(privateKeyPem)).toString('base64');
}

/** 验签（服务端同款逻辑）。 */
export function verifyPayload(publicKeyPem: string, payload: unknown, signatureB64: string): boolean {
  const data = Buffer.from(canonicalJson(payload), 'utf8');
  return cryptoVerify(null, data, createPublicKey(publicKeyPem), Buffer.from(signatureB64, 'base64'));
}
