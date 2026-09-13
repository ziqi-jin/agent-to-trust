import { randomUUID } from 'node:crypto';
import type { AgentMeta } from './agent/types.js';
import { ensureKeypair, signPayload } from './keys.js';
import type { SuiteResult } from './runner.js';

export interface IngestResponse {
  agentId: string;
  verified: boolean;
  /** 同钥重复上报（更新分数）。 */
  reuse?: boolean;
  /** 服务端重算后的信用分。 */
  score?: number | null;
  verificationLevel?: string;
}

export interface UploadOptions {
  meta: AgentMeta;
  /** 平台 API 地址（如 https://sealit.cc/api）。 */
  apiBase: string;
  /** 密钥目录（默认 ~/.sealit）。 */
  dir?: string;
  /** 注入（测试用）。 */
  fetchImpl?: typeof fetch;
  /** 注入密钥（测试用；默认从 ensureKeypair 取）。 */
  keypair?: { publicKeyPem: string; privateKeyPem: string };
}

/** 组装并签名上报 payload。公开给服务端测试复用同款结构。 */
export function buildIngestPayload(
  suite: SuiteResult,
  meta: AgentMeta,
  keypair: { publicKeyPem: string; privateKeyPem: string },
): Record<string, unknown> & { signature: string } {
  const body = {
    agentName: meta.name ?? 'unnamed-agent',
    agentEndpoint: meta.endpoint,
    agentModel: meta.model ?? meta.modelMeta?.model,
    agentVersion: meta.version,
    modelMeta: meta.modelMeta,
    benchmarkVersion: suite.benchmarkVersion,
    seed: suite.seed,
    startedAt: suite.startedAt,
    finishedAt: suite.finishedAt,
    results: suite.results,
    pubkey: keypair.publicKeyPem,
    nonce: randomUUID(),
    timestamp: Date.now(),
  };
  return { ...body, signature: signPayload(keypair.privateKeyPem, body) };
}

/**
 * 上报评测结果到平台（签名防篡改，nonce+timestamp 防重放）。
 * 网络错误/5xx 重试 1 次；4xx 不重试。
 */
export async function uploadResults(suite: SuiteResult, opts: UploadOptions): Promise<IngestResponse> {
  const keypair = opts.keypair ?? ensureKeypair(opts.dir);
  const payload = buildIngestPayload(suite, opts.meta, keypair);
  const doFetch = opts.fetchImpl ?? fetch;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(`${opts.apiBase.replace(/\/+$/, '')}/ingest/results`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        return (await res.json()) as IngestResponse;
      }
      if (res.status < 500) {
        throw new Error(`平台拒绝上报（${res.status}）：${await res.text()}`);
      }
      lastError = new Error(`平台错误 ${res.status}`);
    } catch (e) {
      if (e instanceof Error && /平台拒绝上报/.test(e.message)) throw e;
      lastError = e;
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
  }
  throw lastError instanceof Error ? lastError : new Error('上报失败');
}
