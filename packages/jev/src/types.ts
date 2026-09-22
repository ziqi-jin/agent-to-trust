/** 三档判定（对齐 @a2t/sdk 的 EvidenceResult）。 */
export type Verdict = 'success' | 'partial' | 'failure';

/** 判官统一输出。 */
export interface JudgeVerdict {
  result: Verdict;
  /** 0..1。success=1，partial=0.5，failure=0。 */
  value: number;
  /** 判官原始返回（deterministic: Grading；llm: 文本；jev: answers 片段）。 */
  raw?: unknown;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type QuestionType = 'choice' | 'score' | 'noul';

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
}
export type JevQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface JevChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities?: Record<string, number>;
}
export interface JevNoulAnswer {
  type: 'noul';
  noul: number;
}
export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
