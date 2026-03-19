import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('shows Default Betting Mode dropdown', async ({ page }) => {
    await expect(page.getByText('Default Betting Mode')).toBeVisible();
    await expect(page.getByRole('button', { name: /save settings/i })).toBeVisible();
  });

  test('shows Job Scheduler section', async ({ page }) => {
    await expect(page.getByText('Job Scheduler')).toBeVisible();
  });

  test('shows Integration Health section with Check all button', async ({ page }) => {
    await expect(page.getByText('Integration Health').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /check all/i })).toBeVisible();
  });

  test('shows Audit Trail section', async ({ page }) => {
    await expect(page.getByText('Audit Trail')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /category/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /action/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /outcome/i })).toBeVisible();
  });

  test('can change betting mode and save', async ({ page }) => {
    const select = page.getByRole('combobox').first();
    await select.selectOption('A - Aggressive');
    await page.getByRole('button', { name: /save settings/i }).click();
    // Restore
    await select.selectOption('B - Balanced');
    await page.getByRole('button', { name: /save settings/i }).click();
  });
});
