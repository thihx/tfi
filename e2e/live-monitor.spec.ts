import { test, expect } from '@playwright/test';

test.describe('Live Monitor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Live Monitor' }).click();
    await expect(page.getByText('Scheduler Control')).toBeVisible();
  });

  test('shows Start and Run Once buttons when idle', async ({ page }) => {
    await expect(page.getByRole('button', { name: /start/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /run once/i })).toBeVisible();
  });

  test('shows scheduler status fields', async ({ page }) => {
    await expect(page.getByText('Runs')).toBeVisible();
    await expect(page.getByText('Errors')).toBeVisible();
    await expect(page.getByText('Last Run')).toBeVisible();
    await expect(page.getByText('Next Run')).toBeVisible();
  });
});
