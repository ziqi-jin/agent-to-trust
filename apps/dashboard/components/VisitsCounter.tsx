'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * 页脚访问计数（2026-09-18 老大：两个站都要显示访问数，便于感知流量）。
 *
 * 行为：
 *  - 挂载时 POST /visits 上报一次 PV，并用返回值渲染（一次请求即拿到最新计数）。
 *  - 失败静默（计数是装饰性信息，不能因它影响页面）；重试靠下次刷新。
 *  - 不显示 today（门面只露总量更干净）；总数 ≥1000 时用千分位。
 */
export function VisitsCounter() {
  const t = useT();
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .visit()
      .then((r) => {
        if (alive) setTotal(r.total);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (total === null) return null;

  return (
    <span className="font-mono text-xs text-dim" title="page views">
      {t.footer.visits.replace('{n}', total.toLocaleString('en-US'))}
    </span>
  );
}
