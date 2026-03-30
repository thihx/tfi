import { test, expect } from '@playwright/test';

test.describe('Investment Tracker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Investment Tracker' }).click();
  });

  test('shows KPI cards', async ({ page }) => {
    await expect(page.getByText('Total Investments')).toBeVisible();
    await expect(page.getByText('Hit Rate (W/L)')).toBeVisible();
    await expect(page.getByText('Total P/L')).toBeVisible();
    await expect(page.getByText('ROI on Stake')).toBeVisible();
  });

  test('shows Log Investment button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /log investment/i })).toBeVisible();
  });

  test('shows empty state when no investments', async ({ page }) => {
    await expect(page.getByText(/no investments logged/i)).toBeVisible();
  });

  test('opens Log Investment form', async ({ page }) => {
    await page.getByRole('button', { name: /log investment/i }).click();
    await expect(page.getByText('Log Investment').last()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Market *')).toBeVisible();
    await expect(page.getByText('Selection *')).toBeVisible();
  });
});
