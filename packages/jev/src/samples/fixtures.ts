import type { Verdict } from '../types.js';

/**
 * R3 构造样本：key 即金标签（构造即真值，零人工）。
 * 只选客观可验的题（数字 / 字符串 / 正误），答案本身无争议。
 * `tricky` 类：貌似正确实则错误（考判官鲁棒性，确定性 grader 最易翻车）。
 */
export const FIXTURES: Record<string, Partial<Record<Verdict | 'tricky', string>>> = {
  'coding-sum': {
    success: '10',
    partial: '1 + 2 + 3 + 4 = 10',
    failure: '12',
    tricky: 'The array has 4 elements, so the answer is 10 out of 10.',
  },
  'coding-reverse-string': {
    success: 'fedcba',
    partial: "The result is 'fedcba' (6 characters).",
    failure: 'abcdef',
    tricky: 'Reversing is not needed: the string is already "abcdef".',
  },
  'coding-array-max': {
    success: '9',
    partial: 'The maximum is 9 (from [3,7,2,9,4]).',
    failure: '7',
  },
  'coding-palindrome': {
    success: 'yes',
    partial: 'Yes, but only if we ignore case.',
    failure: 'no',
    tricky: 'No, racecar is not a palindrome.',
  },
  'reasoning-bat-ball': {
    success: '5',
    partial: 'The ball costs 5 cents, so the bat is $1.05.',
    failure: '10',
  },
  'reasoning-machines': {
    success: '5',
    partial: '5 minutes.',
    failure: '100',
  },
  'reasoning-lily': {
    success: '47',
    partial: 'Day 47.',
    failure: '24',
  },
  'reasoning-sequence': {
    success: '32',
    partial: 'The pattern doubles, so 32.',
    failure: '18',
  },
  'reasoning-speed': {
    success: '90',
    partial: '90 km.',
    failure: '60',
  },
  'reasoning-candles': {
    success: '3',
    partial: '3 candles remain.',
    failure: '4',
    tricky: '7 candles were lit and 3 blew out, so 4 remain.',
  },
};

/** 只在 suite 里真实存在的题上构造。 */
export const FIXTURE_CASE_IDS = Object.keys(FIXTURES);
