import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    // Wait for API data to load before asserting data-dependent elements
    await page.waitForLoadState('networkidle');
  });

  test('shows KPI stat cards', async ({ page }) => {
    await expect(page.getByText('Total Bets')).toBeVisible();
    await expect(page.getByText('Win Rate')).toBeVisible();
    await expect(page.getByText('Total P/L')).toBeVisible();
    await expect(page.getByText('ROI')).toBeVisible();
  });

  test('shows chart sections', async ({ page }) => {
    await expect(page.getByText('Cumulative P/L')).toBeVisible();
    await expect(page.getByText('AI Performance')).toBeVisible();
  });

  test('shows Recent Recommendations table', async ({ page }) => {
    await expect(page.getByText('Recent Recommendations')).toBeVisible();
  });
});
