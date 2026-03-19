import { test, expect } from '@playwright/test';

// These tests run with VITE_AUTH_ENABLED=false (set in playwright.config.ts webServer env)
// so the app renders the main UI directly without Google OAuth

test.describe('App loads', () => {
  test('shows main navigation sidebar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Live Monitor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  });

  test('default tab is Dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('can navigate to Settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Job Scheduler')).toBeVisible();
    await expect(page.getByText('Integration Health').first()).toBeVisible();
    await expect(page.getByText('Audit Trail')).toBeVisible();
  });

  test('can navigate to Live Monitor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Live Monitor' }).click();
    await expect(page.getByText('Scheduler Control')).toBeVisible();
  });

  test('can navigate to Recommendations', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Recommendations' }).click();
    await expect(page.getByRole('heading', { name: /recommendations/i })).toBeVisible();
  });
});
