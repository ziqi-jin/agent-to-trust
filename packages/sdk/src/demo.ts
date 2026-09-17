import { DemoAgent } from './agent/demo-agent.js';
import { runSuite, type SuiteResult } from './runner.js';

/**
 * `a2t demo`：用内置演示考生跑一遍完整考场（33 题）。
 *
 * 纯本地演示：**不上传榜单**、不联网、不需要任何 key。
 * 返回与 `test` 相同结构的 SuiteResult，由 CLI 层负责打印。
 */
export async function runDemo(): Promise<SuiteResult> {
  return runSuite(new DemoAgent());
}
