import { describe, expect, it } from 'vitest';
import { createStageFade, CUT_IN, CUT_OUT } from './stage-fade';

const steps = (fade: ReturnType<typeof createStageFade>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 1000); i++) fade.step(1 / 1000);
};

describe('stage fade', () => {
  it('starts dark and reveals on release', () => {
    const fade = createStageFade();
    expect(fade.opacity).toBe(0);
    expect(fade.cutReady()).toBe(false); // dark, but no cut pending
    fade.release(0.4);
    steps(fade, 0.2);
    expect(fade.opacity).toBeCloseTo(0.5, 2);
    steps(fade, 0.25);
    expect(fade.opacity).toBe(1);
  });

  it('fades out for a cut, reports ready when dark, fades back in', () => {
    const fade = createStageFade();
    fade.release(0.01);
    steps(fade, 0.05);
    fade.request(CUT_OUT);
    fade.request(CUT_OUT); // ignored while under way
    expect(fade.cuts).toBe(1);
    steps(fade, CUT_OUT / 2);
    expect(fade.cutReady()).toBe(false);
    steps(fade, CUT_OUT);
    expect(fade.cutReady()).toBe(true);
    fade.release(CUT_IN);
    expect(fade.cutReady()).toBe(false);
    steps(fade, CUT_IN + 0.01);
    expect(fade.opacity).toBe(1);
  });

  it('hide() goes dark at once with nothing pending', () => {
    const fade = createStageFade();
    fade.release(0.01);
    steps(fade, 0.05);
    fade.hide();
    expect(fade.opacity).toBe(0);
    expect(fade.cutReady()).toBe(false);
  });
});
