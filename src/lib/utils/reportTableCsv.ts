export type ReportTableCell = string | number | { value: string; color: string };

function cellToCsvValue(cell: ReportTableCell): string {
  if (typeof cell === 'object' && cell !== null && 'value' in cell) return cell.value;
  return String(cell ?? '');
}

function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildReportTableCsv(columns: string[], rows: ReportTableCell[][]): string {
  const header = columns.map(escapeCsvField).join(',');
  const body = rows.map((row) =>
    row.map((cell) => escapeCsvField(cellToCsvValue(cell))).join(','),
  );
  return [header, ...body].join('\n');
}

export function downloadReportTableCsv(
  filenameStem: string,
  columns: string[],
  rows: ReportTableCell[][],
): void {
  if (rows.length === 0) return;
  const csv = buildReportTableCsv(columns, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenameStem}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}