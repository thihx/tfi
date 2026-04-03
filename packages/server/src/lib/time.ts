import { config } from '../config.js';

export function formatOperationalTimestamp(date: Date = new Date(), locale = 'vi-VN'): string {
  return date.toLocaleString(locale, { timeZone: config.timezone });
}

export function formatOperationalDateTime(
  value: string | Date | null | undefined,
  locale = 'vi-VN',
): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '-';
  return `${date.toLocaleString(locale, { timeZone: config.timezone })} (${config.timezone})`;
}
