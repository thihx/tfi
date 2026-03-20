import { config } from '../config.js';
import {
  createProviderOddsSample,
  type CreateProviderOddsSampleInput,
} from '../repos/provider-odds-samples.repo.js';
import {
  createProviderStatsSample,
  type CreateProviderStatsSampleInput,
} from '../repos/provider-stats-samples.repo.js';

export function extractStatusCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const match = message.match(/\b(\d{3})\b/);
  return match ? Number(match[1]) : null;
}

export async function recordProviderOddsSampleSafe(sample: CreateProviderOddsSampleInput): Promise<void> {
  if (!config.providerSamplingEnabled) return;
  try {
    await createProviderOddsSample(sample);
  } catch (err) {
    console.warn(
      `[provider-sampling] odds sample failed for ${sample.match_id}/${sample.provider}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function recordProviderStatsSampleSafe(sample: CreateProviderStatsSampleInput): Promise<void> {
  if (!config.providerSamplingEnabled) return;
  try {
    await createProviderStatsSample(sample);
  } catch (err) {
    console.warn(
      `[provider-sampling] stats sample failed for ${sample.match_id}/${sample.provider}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
