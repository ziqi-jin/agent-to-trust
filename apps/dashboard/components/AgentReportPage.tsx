'use client';

/**
 * 报告页客户端壳（2026-09-17，任务② Agent 档案/报告页）。
 *
 * 为什么需要这层壳：AgentDetail 是 client 组件且要一个 onBack 回调函数；
 * server component 不能把函数当 prop 传下去。这里把「回榜单」的导航收进客户端。
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AgentDetail } from './AgentDetail';

export function AgentReportPage({ agentId }: { agentId: string }) {
  const router = useRouter();
  // push('/') 由 Next 负责拼 basePath（部署在 /credit 时也不会漏前缀）
  const onBack = useCallback(() => router.push('/'), [router]);
  return <AgentDetail agentId={agentId} onBack={onBack} />;
}
