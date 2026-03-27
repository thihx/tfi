import { config } from '../config.js';

export function formatOperationalTimestamp(date: Date = new Date(), locale = 'vi-VN'): string {
  return date.toLocaleString(locale, { timeZone: config.timezone });
}
