import type { BenchmarkCase } from 'agent-to-trust';
import type { JudgeVerdict } from '../types.js';

export interface Judge {
  name: string;
  grade(c: BenchmarkCase, output: string): Promise<JudgeVerdict>;
}
