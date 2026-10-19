import { beforeEach, describe, expect, it } from 'vitest';
import { clampStageData, initialOf, resetStageInput, setInput, signalSent, stageInput } from '@/lib/stage-data';

describe('stage data', () => {
  beforeEach(resetStageInput);

  it('takes the first letter of a name, upper-cased, and a dot when there is none', () => {
    expect(initialOf('  asha sample')).toBe('A');
    expect(initialOf('élan')).toBe('É');
    expect(initialOf('')).toBe('.');
  });

  it('draws pieces for at most six projects, four plans and eight people', () => {
    const d = clampStageData({ projects: 9, plans: 7, people: Array.from({ length: 12 }, (_, i) => String.fromCharCode(97 + i)) });
    expect(d.projects).toBe(6);
    expect(d.plans).toBe(4);
    expect(d.people).toHaveLength(8);
    expect(d.people[0]).toBe('A');
    expect(clampStageData({ projects: -2, plans: 1.9, people: [] })).toEqual({ projects: 0, plans: 1, people: [] });
  });

  it('records page input and counts sends', () => {
    setInput('service', 3);
    expect(stageInput.service).toBe(3);
    signalSent();
    signalSent();
    expect(stageInput.sent).toBe(2);
    resetStageInput();
    expect(stageInput).toEqual({ service: -1, project: 0, plan: -1, person: -1, sent: 0 });
  });
});
