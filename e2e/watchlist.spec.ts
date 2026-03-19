import { test, expect } from '@playwright/test';

test.describe('Watchlist', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Watchlist' }).click();
  });

  test('shows search input', async ({ page }) => {
    await expect(page.getByPlaceholder(/search teams/i)).toBeVisible();
  });

  test('shows filter controls', async ({ page }) => {
    await expect(page.getByText('Clear Filters')).toBeVisible();
  });

  test('shows table column headers', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: /league/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /match/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /status/i })).toBeVisible();
  });
});
