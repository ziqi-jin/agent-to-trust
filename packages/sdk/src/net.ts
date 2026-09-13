/**
 * 网络工具：判定 URL 是否为「公网可回访」的 http(s) 地址。
 *
 * 用途（2026-09-13 真用户实测修复）：本地考场模式（`sealit test --url http://localhost:…`）
 * 的 endpoint 是私网地址——平台服务端回访不了它（reverify 本就对它跳过）。
 * 若把它当 agentEndpoint 上报，会被服务端 SSRF 卡口 400 拒绝，导致「localhost 也能上榜」的
 * 核心承诺失效。因此 SDK 只上报公网地址，私网/环回一律省略（分数与公钥照常上报）。
 */

/** IPv4 私网 / 环回 / 链路本地 / 保留段。 */
function isPrivateV4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 环回
  if (a === 0) return true; // 本机
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // 组播/保留
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // 去掉 IPv6 方括号
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '::') return true;
  // 纯 IPv4
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return isPrivateV4([+m[1], +m[2], +m[3], +m[4]]);
  // IPv6（粗略：ULA / 链路本地 / 未指定）
  if (h.includes(':')) {
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
    if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb'))
      return true; // fe80::/10
    return false;
  }
  return false;
}

/** 是否为公网可回访的 http(s) 地址。 */
export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (!u.hostname) return false;
  return !isPrivateHost(u.hostname);
}
