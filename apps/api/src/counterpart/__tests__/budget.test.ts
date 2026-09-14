import { beforeEach, describe, expect, it } from 'vitest';
import {
  chargeDaily, dailyExceeded, dailyUsed, LIVE_MAX_TOKENS_PER_SESSION,
  newSessionBudget, resetBudgetForTests,
} from '../budget';

beforeEach(() => resetBudgetForTests());

describe('SessionBudget', () => {
  it('累加到上限即 over', () => {
    const b = newSessionBudget();
    b.add(LIVE_MAX_TOKENS_PER_SESSION - 1);
    expect(b.over()).toBe(false);
    b.add(2);
    expect(b.over()).toBe(true);
  });
});

describe('日预算', () => {
  it('累加 token；超过日上限 → dailyExceeded', () => {
    expect(dailyUsed()).toBe(0);
    chargeDaily(10);
    expect(dailyUsed()).toBe(10);
    expect(dailyExceeded()).toBe(false);
  });
});
