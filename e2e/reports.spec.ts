import { test, expect } from '@playwright/test';

test.describe('Reports', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Reports' }).click();
  });

  test('shows period selector buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'All Time' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'This Week' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'This Month' })).toBeVisible();
  });

  test('shows Overview section with KPI cards', async ({ page }) => {
    await expect(page.getByText('Hit Rate (W/L)')).toBeVisible();
    await expect(page.getByText('ROI on Stake')).toBeVisible();
  });

  test('shows report section tabs', async ({ page }) => {
    await expect(page.getByRole('button', { name: /by league/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /by market/i })).toBeVisible();
  });

  test('can switch period without crashing', async ({ page }) => {
    await page.getByRole('button', { name: 'This Week' }).click();
    await expect(page.getByRole('button', { name: 'This Week' })).toBeVisible();
  });
});
