'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 自动轮播的步骤状态：每 duration 毫秒前进一步；悬停时暂停；
 * 用户手动选步后，暂停一轮再继续（给人看清楚的时间）。
 * cycle 每绕完一圈 +1，可用作 key 让入场动画重播。
 */
export function useAutoStep(count: number, duration = 4200) {
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hold, setHold] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(
      () => {
        setHold(false);
        setStep((s) => {
          const next = (s + 1) % count;
          if (next === 0) setCycle((c) => c + 1);
          return next;
        });
      },
      hold ? duration * 2 : duration,
    );
    return () => window.clearTimeout(id);
  }, [step, paused, hold, count, duration]);

  const select = useCallback((i: number) => {
    setStep(i);
    setHold(true);
  }, []);

  return {
    step,
    cycle,
    paused,
    select,
    bind: { onPointerEnter: () => setPaused(true), onPointerLeave: () => setPaused(false) },
  };
}
