import { test, expect } from '@playwright/test';

const MOCK_SNAPSHOT = {
  overall: 'HEALTHY',
  checkedAt: new Date().toISOString(),
  durationMs: 123,
  services: [
    { id: 'postgres',   label: 'PostgreSQL Database', description: 'Primary data store',   status: 'HEALTHY',        latencyMs: 12,  message: 'Connected',    checkedAt: new Date().toISOString() },
    { id: 'redis',      label: 'Redis Cache',          description: 'Cache & job queue',    status: 'HEALTHY',        latencyMs: 3,   message: 'PONG',         checkedAt: new Date().toISOString() },
    { id: 'gemini',     label: 'Google Gemini AI',     description: 'AI analysis engine',   status: 'HEALTHY',        latencyMs: 210, message: 'OK',           checkedAt: new Date().toISOString() },
    { id: 'telegram',   label: 'Telegram Bot',         description: 'Notification channel', status: 'HEALTHY',        latencyMs: 88,  message: 'OK',           checkedAt: new Date().toISOString() },
    { id: 'google-auth',label: 'Google OAuth',         description: 'Authentication',       status: 'HEALTHY',        latencyMs: 145, message: 'OK',           checkedAt: new Date().toISOString() },
    { id: 'football',   label: 'Football API',         description: 'Match data source',    status: 'NOT_CONFIGURED', latencyMs: 0,   message: 'No API key',   checkedAt: new Date().toISOString() },
    { id: 'odds',       label: 'Odds API',             description: 'Live odds feed',       status: 'NOT_CONFIGURED', latencyMs: 0,   message: 'No API key',   checkedAt: new Date().toISOString() },
  ],
};

test.describe('Integration Health Panel', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the integration health API
    await page.route('**/api/integrations/health', (route) => {
      route.fulfill({ json: MOCK_SNAPSHOT });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'System' }).click();
  });

  test('shows Integration Health section', async ({ page }) => {
    await expect(page.getByText('Integration Health').first()).toBeVisible();
  });

  test('shows "Check all" button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /check all/i })).toBeVisible();
  });

  test('loads service cards after Check all', async ({ page }) => {
    await page.getByRole('button', { name: /check all/i }).click();

    await expect(page.getByText('PostgreSQL Database')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Redis Cache')).toBeVisible();
    await expect(page.getByText('Google Gemini AI')).toBeVisible();
    await expect(page.getByText('Telegram Bot')).toBeVisible();
    await expect(page.getByText('Google OAuth')).toBeVisible();
  });

  test('shows stats: Total, Configured, Healthy, Down', async ({ page }) => {
    await page.getByRole('button', { name: /check all/i }).click();
    await expect(page.getByText('PostgreSQL Database')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('Total', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Configured', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Healthy', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Down', { exact: true }).first()).toBeVisible();
  });

  test('shows last checked time after check', async ({ page }) => {
    await page.getByRole('button', { name: /check all/i }).click();
    await expect(page.getByText('PostgreSQL Database')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/last checked/i)).toBeVisible();
  });
});
