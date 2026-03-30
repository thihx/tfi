import { test, expect } from '@playwright/test';

test.describe('Live Monitor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Live Monitor' }).click();
    await expect(page.getByText('Live Monitor Dashboard')).toBeVisible();
  });

  test('shows Refresh and Run Check Live actions', async ({ page }) => {
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /run check live/i })).toBeVisible();
  });

  test('shows engine status fields', async ({ page }) => {
    await expect(page.getByText('Engine', { exact: true })).toBeVisible();
    await expect(page.getByText('Interval', { exact: true })).toBeVisible();
    await expect(page.getByText('Runs', { exact: true })).toBeVisible();
    await expect(page.getByText('Last Run', { exact: true })).toBeVisible();
    await expect(page.getByText('Latest Run Summary')).toBeVisible();
  });
});
