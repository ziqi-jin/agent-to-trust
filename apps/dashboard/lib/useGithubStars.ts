'use client';

import { useEffect, useState } from 'react';

/**
 * 实时 star 数：访客浏览器直连 GitHub 公开 API（无认证、无用户系统），失败静默降级。
 * 模块级缓存一个 Promise：刊头与 Hero 同时用时只发一次请求。
 */
let pending: Promise<number | null> | null = null;

function fetchStars(): Promise<number | null> {
  if (!pending) {
    pending = fetch('https://api.github.com/repos/ziqi-jin/agent-to-trust', {
      headers: { accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (typeof d?.stargazers_count === 'number' ? d.stargazers_count : null))
      .catch(() => null);
  }
  return pending;
}

export function useGithubStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetchStars().then((n) => {
      if (alive) setStars(n);
    });
    return () => {
      alive = false;
    };
  }, []);
  return stars;
}

export function fmtStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}
