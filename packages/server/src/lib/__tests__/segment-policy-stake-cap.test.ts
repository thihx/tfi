import { describe, expect, it } from 'vitest';
import { parseSegmentPolicyStakeCapJson } from '../segment-policy-stake-cap.js';

describe('parseSegmentPolicyStakeCapJson', () => {
  it('parses caps and drops invalid entries', () => {
    const m = parseSegmentPolicyStakeCapJson(
      JSON.stringify({
        caps: { '30-44::goals_over': 2, '': 1, bad: 'nope', neg: -1 },
      }),
    );
    expect(m.get('30-44::goals_over')).toBe(2);
    expect(m.has('bad')).toBe(false);
    expect(m.has('neg')).toBe(false);
  });
});
