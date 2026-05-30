import { describe, expect, it } from 'vitest';
import { buildReportTableCsv } from './reportTableCsv';

describe('reportTableCsv', () => {
  it('builds escaped csv with colored cells flattened to values', () => {
    const csv = buildReportTableCsv(
      ['League', 'P/L'],
      [
        ['Premier League', { value: '+$10.00', color: 'green' }],
        ['La Liga', '5'],
      ],
    );
    expect(csv).toBe('"League","P/L"\n"Premier League","+$10.00"\n"La Liga","5"');
  });
});