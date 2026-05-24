import { describe, expect, test } from "vitest";
import {
  applyLinePatiencePolicy,
  DEFAULT_LINE_PATIENCE_CONFIG,
  formatSelectionForMarket,
} from "../lib/line-patience-policy.js";

const exceptional = {
  confidence: 9,
  valuePercent: 8,
  evidenceMode: "full_live_data",
};

describe("applyLinePatiencePolicy", () => {
  test("blocks under quarter lines without conservative remap", () => {
    const result = applyLinePatiencePolicy({
      selection: "Under 0.75 Goals",
      betMarket: "under_0.75",
      minute: 70,
      score: "0-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 0.75, over: 2.1, under: 1.8 },
      },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_UNDER_QUARTER_LINE");
  });

  test("remaps under quarter line to under 1.0 when quote exists", () => {
    const result = applyLinePatiencePolicy({
      selection: "Under 0.75 Goals",
      betMarket: "under_0.75",
      minute: 70,
      score: "0-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 1.0, over: 2.0, under: 1.85 },
        ou_adjacent: { line: 1.25, over: 1.7, under: 2.2 },
      },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(false);
    expect(result.remapped).toBe(true);
    expect(result.betMarket).toBe("under_1");
    expect(result.warnings).toContain("LLP_REMAP_UNDER_CONSERVATIVE_LINE");
  });

  test("allows under quarter line when exceptional", () => {
    const result = applyLinePatiencePolicy({
      selection: "Under 0.75 Goals",
      betMarket: "under_0.75",
      minute: 70,
      score: "0-0",
      ...exceptional,
      oddsCanonical: { ou: { line: 1.5, over: 2.1, under: 1.8 } },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(false);
    expect(result.warnings).not.toContain("LLP_BLOCK_UNDER_QUARTER_LINE");
  });

  test("remaps goals over above max line when lower quote exists", () => {
    const result = applyLinePatiencePolicy({
      selection: "Over 1.5 Goals",
      betMarket: "over_1.5",
      minute: 55,
      score: "0-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 1.5, over: 2.0, under: 1.9 },
        ou_adjacent: { line: 1.0, over: 1.85, under: 2.1 },
      },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(false);
    expect(result.remapped).toBe(true);
    expect(result.betMarket).toBe("over_1");
    expect(result.warnings).toContain("LLP_REMAP_OVER_CONSERVATIVE_LINE");
  });

  test("blocks aggressive goals over when no lower quote", () => {
    const result = applyLinePatiencePolicy({
      selection: "Over 1.5 Goals",
      betMarket: "over_1.5",
      minute: 55,
      score: "0-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: { ou: { line: 1.5, over: 2.0, under: 1.9 } },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_OVER_AGGRESSIVE_LINE");
  });

  test("blocks corners over above preferred max on main line", () => {
    const result = applyLinePatiencePolicy({
      selection: "Over 8.5 Corners",
      betMarket: "corners_over_8.5",
      minute: 50,
      score: "1-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: { corners_ou: { line: 8.5, over: 1.9, under: 1.9 } },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_CORNERS_OVER_AGGRESSIVE_LINE");
  });

  test("blocks AH chalk when O/U main line still high", () => {
    const result = applyLinePatiencePolicy({
      selection: "Asian Handicap Home -0.75",
      betMarket: "asian_handicap_home_-0.75",
      minute: 55,
      score: "0-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 2.5, over: 1.9, under: 2.0 },
        ah: { line: -0.75, home: 1.9, away: 2.0 },
      },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_AH_WAIT_OU_OVER_LINE");
  });

  test("allows AH chalk when compressed over line is quoted", () => {
    const result = applyLinePatiencePolicy({
      selection: "Asian Handicap Home -0.75",
      betMarket: "asian_handicap_home_-0.75",
      minute: 55,
      score: "0-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 2.5, over: 1.9, under: 2.0 },
        ou_adjacent: { line: 1.0, over: 1.85, under: 2.05 },
        ah: { line: -0.75, home: 1.9, away: 2.0 },
      },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(false);
  });

  test("blocks after recent goal within cooldown", () => {
    const result = applyLinePatiencePolicy({
      selection: "Over 1.0 Goals",
      betMarket: "over_1",
      minute: 52,
      score: "1-0",
      confidence: 7,
      valuePercent: 6,
      evidenceMode: "full_live_data",
      oddsCanonical: { ou: { line: 1.0, over: 1.9, under: 2.0 } },
      eventsCompact: [{ minute: 51, type: "Goal", detail: "Normal Goal" }],
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_POST_EVENT_COOLDOWN");
  });

  test("formatSelectionForMarket builds readable under label", () => {
    expect(formatSelectionForMarket("under_1")).toBe("Under 1 Goals");
  });

  test("blocks under 4.75 at 72' with 4 goals when no conservative remap exists", () => {
    const result = applyLinePatiencePolicy({
      selection: "Under 4.75 Goals",
      betMarket: "under_4.75",
      minute: 72,
      score: "1-3",
      confidence: 6,
      valuePercent: 7,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 4.75, over: 2.0, under: 1.95 },
      },
      config: DEFAULT_LINE_PATIENCE_CONFIG,
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_UNDER_THIN_CUSHION_NO_REMAP");
  });

  test("blocks thin cushion in 60-74 band when line stays below min cushion", () => {
    const result = applyLinePatiencePolicy({
      selection: "Under 4.5 Goals",
      betMarket: "under_4.5",
      minute: 72,
      score: "1-3",
      confidence: 6,
      valuePercent: 7,
      evidenceMode: "full_live_data",
      oddsCanonical: {
        ou: { line: 4.5, over: 2.0, under: 1.9 },
      },
      config: {
        ...DEFAULT_LINE_PATIENCE_CONFIG,
        goalsUnderBlockWhenRemapFails: false,
      },
    });
    expect(result.blocked).toBe(true);
    expect(result.warnings).toContain("LLP_BLOCK_LOW_CUSHION");
  });
});