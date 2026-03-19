import { test, expect } from '@playwright/test';

test.describe('Recommendations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Recommendations' }).click();
    await expect(page.getByRole('heading', { name: /recommendations/i })).toBeVisible();
  });

  test('shows search input', async ({ page }) => {
    await expect(page.getByPlaceholder(/search match/i)).toBeVisible();
  });

  test('shows table column headers after switching to table view', async ({ page }) => {
    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.getByRole('columnheader', { name: /league/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('columnheader', { name: /match/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /selection/i })).toBeVisible();
  });
});
