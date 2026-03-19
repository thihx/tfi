import { test, expect } from '@playwright/test';

test.describe('Matches', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Matches' }).click();
  });

  test('shows search and filter controls', async ({ page }) => {
    await expect(page.getByPlaceholder(/search teams/i)).toBeVisible();
  });
});

test.describe('Leagues', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Leagues' }).click();
  });

  test('shows search input', async ({ page }) => {
    await expect(page.getByPlaceholder(/search name/i)).toBeVisible();
  });

  test('shows Sync API button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /sync api/i })).toBeVisible();
  });

  test('shows stats bar', async ({ page }) => {
    await expect(page.getByText('Total', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  });
});
