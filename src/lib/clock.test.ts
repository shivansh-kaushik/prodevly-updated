import { beforeEach, describe, expect, it } from 'vitest';
import { onFpsCap, onFrame, resetClock, runFrame, setFpsCap } from './clock';

beforeEach(resetClock);

describe('clock', () => {
  it('runs callbacks in order and stops after unsubscribe', () => {
    const calls: string[] = [];
    const offB = onFrame(() => calls.push('b'), 10);
    onFrame(() => calls.push('a'), 0);
    runFrame(0, 1 / 60);
    offB();
    runFrame(0, 1 / 60);
    expect(calls).toEqual(['a', 'b', 'a']);
  });

  it('a callback that unsubscribes itself does not skip its neighbour', () => {
    const calls: string[] = [];
    const off = onFrame(() => {
      calls.push('a');
      off();
    });
    onFrame(() => calls.push('b'));
    runFrame(0, 0);
    expect(calls).toEqual(['a', 'b']);
  });

  it('publishes fps caps to the ticker owner', () => {
    const seen: number[] = [];
    onFpsCap((fps) => seen.push(fps));
    setFpsCap(60);
    setFpsCap(60);
    setFpsCap(0);
    expect(seen).toEqual([0, 60, 0]);
  });
});
