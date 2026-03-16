import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement } from 'react';

/**
 * Custom render with userEvent setup.
 * Use this instead of raw `render()` for tests that need user interactions.
 */
export function renderWithUser(ui: ReactElement, options?: RenderOptions) {
  const user = userEvent.setup();
  return {
    user,
    ...render(ui, options),
  };
}

/**
 * Create a typed mock for API functions.
 */
export function createApiMock<T>(resolvedValue: T) {
  return vi.fn().mockResolvedValue(resolvedValue);
}

/**
 * Wait for async state updates to flush.
 */
export async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Re-export everything from testing-library
export { render, screen, within, waitFor, act } from '@testing-library/react';
export { userEvent };
