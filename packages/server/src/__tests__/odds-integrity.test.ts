import { detectGoalsCornersLineContamination } from '../lib/odds-integrity.js';

describe('odds integrity', () => {
  test('detects suspicious goals/corners line contamination when the same line is far above current goals', () => {
    const result = detectGoalsCornersLineContamination(
      {
        ou: { line: 10, over: 2.1, under: 2.2 },
        corners_ou: { line: 10, over: 2.1, under: 2.2 },
      },
      5,
    );

    expect(result.contaminated).toBe(true);
    expect(result.reason).toContain('goals line 10 exactly matches corners line 10');
  });

  test('does not flag identical lines when the goals line is not wildly above the current total', () => {
    const result = detectGoalsCornersLineContamination(
      {
        ou: { line: 2.5, over: 1.88, under: 1.96 },
        corners_ou: { line: 2.5, over: 1.88, under: 1.96 },
      },
      1,
    );

    expect(result.contaminated).toBe(false);
  });

  test('does not flag when only one market is present', () => {
    const result = detectGoalsCornersLineContamination(
      {
        corners_ou: { line: 10, over: 2.1, under: 2.2 },
      },
      2,
    );

    expect(result.contaminated).toBe(false);
  });
});
