export function sortIndicator<T extends string>(
  sortCol: T,
  col: T,
  sortDir: 'asc' | 'desc',
): string {
  if (sortCol !== col) return ' ↕';
  return sortDir === 'asc' ? ' ↑' : ' ↓';
}