import type { ApiFixture } from "../lib/football-api.js";
import { extractHalftimeScoreFromFixture } from "../lib/settle-context.js";
import { settleByRule } from "../lib/settle-rules.js";

describe("extractHalftimeScoreFromFixture", () => {
  test("returns H1 score when halftime is present", () => {
    const fx = {
      score: { halftime: { home: 1, away: 0 } },
    } as ApiFixture;
    expect(extractHalftimeScoreFromFixture(fx)).toEqual({ home: 1, away: 0 });
  });

  test("returns null when halftime missing", () => {
    const fx = { score: {} } as ApiFixture;
    expect(extractHalftimeScoreFromFixture(fx)).toBeNull();
  });
});

describe("first half (H1) settle by rule", () => {
  test("ht_under uses H1 goal sum; missing H1 scores returns null", () => {
    expect(
      settleByRule({
        market: "ht_under_1.5",
        selection: "",
        homeScore: 3,
        awayScore: 2,
      }),
    ).toBeNull();

    expect(
      settleByRule({
        market: "ht_under_1.5",
        selection: "",
        homeScore: 3,
        awayScore: 2,
        htHomeScore: 1,
        htAwayScore: 0,
      }),
    ).toEqual({
      result: "win",
      explanation: expect.stringContaining("(H1)"),
    });
  });

  test("ht_over 1.5 loses when H1 has one goal", () => {
    const out = settleByRule({
      market: "ht_over_1.5",
      selection: "",
      homeScore: 4,
      awayScore: 4,
      htHomeScore: 1,
      htAwayScore: 0,
    });
    expect(out?.result).toBe("loss");
  });
});
