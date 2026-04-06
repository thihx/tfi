import { describe, expect, it } from "vitest";
import type { Match } from "@/types";
import { mergeMatchesFromSnapshot } from "./mergeMatchesSnapshot";

function m(partial: Partial<Match> & Pick<Match, "match_id">): Match {
  return {
    date: "2026-04-01",
    kickoff: "15:00",
    league_id: 1,
    league_name: "Test",
    home_team: "H",
    away_team: "A",
    home_logo: "",
    away_logo: "",
    home_score: 0,
    away_score: 0,
    status: "NS",
    ...partial,
  } as Match;
}

describe("mergeMatchesFromSnapshot", () => {
  it("drops rows missing from server snapshot", () => {
    const existing = [m({ match_id: "1", home_team: "A" }), m({ match_id: "2", home_team: "B" })];
    const payload = [m({ match_id: "1", home_team: "A", status: "FT" })];
    const { next, noop } = mergeMatchesFromSnapshot(existing, payload);
    expect(noop).toBe(false);
    expect(next).toHaveLength(1);
    expect(next[0]!.match_id).toBe("1");
    expect(next[0]!.status).toBe("FT");
  });

  it("appends new match ids from payload", () => {
    const existing = [m({ match_id: "1" })];
    const payload = [m({ match_id: "1" }), m({ match_id: "99", away_team: "Z" })];
    const { next, noop } = mergeMatchesFromSnapshot(existing, payload);
    expect(noop).toBe(false);
    expect(next.map((x) => x.match_id)).toEqual(["1", "99"]);
  });

  it("returns noop when nothing changes", () => {
    const row = m({ match_id: "1", status: "1H" });
    const existing = [row];
    const { next, noop } = mergeMatchesFromSnapshot(existing, [row]);
    expect(noop).toBe(true);
    expect(next).toBe(existing);
  });

  it("updates row when field changes", () => {
    const existing = [m({ match_id: "1", status: "1H", current_minute: "45" })];
    const payload = [m({ match_id: "1", status: "HT", current_minute: "45" })];
    const { next, noop } = mergeMatchesFromSnapshot(existing, payload);
    expect(noop).toBe(false);
    expect(next[0]!.status).toBe("HT");
  });
});