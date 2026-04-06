import type { Match } from "@/types";

/**
 * Merge GET /api/matches snapshot into existing client state.
 * Drops rows the server no longer returns (e.g. archived/deleted) so stale fixtures disappear without a full reload.
 */
export function mergeMatchesFromSnapshot(existing: Match[], payload: Match[]): { next: Match[]; noop: boolean } {
  const incoming = new Map(payload.map((m) => [String(m.match_id), m]));
  let changed = false;
  const merged: Match[] = [];

  for (const row of existing) {
    const fresh = incoming.get(String(row.match_id));
    if (!fresh) {
      changed = true;
      continue;
    }
    incoming.delete(String(row.match_id));

    const allKeys = new Set([
      ...Object.keys(row),
      ...Object.keys(fresh),
    ]) as Set<keyof Match>;
    const isDiff = Array.from(allKeys).some(
      (k) => String(row[k] ?? "") !== String(fresh[k] ?? ""),
    );
    if (isDiff) {
      changed = true;
      merged.push(fresh);
    } else {
      merged.push(row);
    }
  }

  const rest = Array.from(incoming.values());
  if (rest.length > 0) changed = true;

  const next = [...merged, ...rest];

  if (!changed) {
    return { next: existing, noop: true };
  }
  return { next, noop: false };
}