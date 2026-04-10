import type { ReplayVsOriginalSummary } from './replay-vs-original-analysis.js';

export interface DataDrivenDeltaGateConfig {
  /** Path relative to packages/server or absolute (resolved from cwd in CLI). */
  deltaPath: string;
  promptVersion: string;
  minScenarios?: number;
  /** Cohort: recommendations that were directional losses in production. */
  onOriginalDirectionalLoss?: {
    minTotal?: number;
    minReplayPushed?: number;
    minAccuracyAmongPushed?: number;
  };
  /** Cohort: recommendations that were directional wins in production. */
  onOriginalDirectionalWin?: {
    minTotal?: number;
    minReplayPushed?: number;
    /** Max replay loss rate among replay pushes (lossAmongPushed / replayPushed). */
    maxLossRateAmongPushed?: number;
  };
}

export interface DataDrivenGateResult {
  ok: boolean;
  failures: string[];
  variant: ReplayVsOriginalSummary | null;
}

export function evaluateDataDrivenDeltaGates(
  config: DataDrivenDeltaGateConfig,
  report: { variants: ReplayVsOriginalSummary[] },
): DataDrivenGateResult {
  const failures: string[] = [];
  const variant =
    report.variants.find((v) => v.promptVersion === config.promptVersion) ?? null;

  if (!variant) {
    return {
      ok: false,
      failures: [`No variant for promptVersion=${config.promptVersion}`],
      variant: null,
    };
  }

  const minN = config.minScenarios ?? 1;
  if (variant.scenarioCount < minN) {
    failures.push(`scenarioCount ${variant.scenarioCount} < minScenarios ${minN}`);
  }

  const loss = config.onOriginalDirectionalLoss;
  if (loss) {
    const c = variant.onOriginalDirectionalLoss;
    if (loss.minTotal != null && c.total < loss.minTotal) {
      failures.push(
        `onOriginalDirectionalLoss.total ${c.total} < minTotal ${loss.minTotal} (insufficient cohort)`,
      );
    }
    if (loss.minReplayPushed != null && c.replayPushed < loss.minReplayPushed) {
      failures.push(
        `onOriginalDirectionalLoss.replayPushed ${c.replayPushed} < minReplayPushed ${loss.minReplayPushed}`,
      );
    }
    if (loss.minAccuracyAmongPushed != null) {
      const settled = c.replayWinAmongPushed + c.replayLossAmongPushed;
      if (settled < 1) {
        failures.push(
          'onOriginalDirectionalLoss: no settled directional replay among pushes (cannot check minAccuracyAmongPushed)',
        );
      } else if (c.replayAccAmongPushed < loss.minAccuracyAmongPushed) {
        failures.push(
          `onOriginalDirectionalLoss.replayAccAmongPushed ${c.replayAccAmongPushed.toFixed(4)} < min ${loss.minAccuracyAmongPushed}`,
        );
      }
    }
  }

  const win = config.onOriginalDirectionalWin;
  if (win) {
    const c = variant.onOriginalDirectionalWin;
    if (win.minTotal != null && c.total < win.minTotal) {
      failures.push(
        `onOriginalDirectionalWin.total ${c.total} < minTotal ${win.minTotal} (insufficient cohort)`,
      );
    }
    if (win.minReplayPushed != null && c.replayPushed < win.minReplayPushed) {
      failures.push(
        `onOriginalDirectionalWin.replayPushed ${c.replayPushed} < minReplayPushed ${win.minReplayPushed}`,
      );
    }
    if (win.maxLossRateAmongPushed != null && c.replayPushed > 0) {
      const rate = c.replayLossAmongPushed / c.replayPushed;
      if (rate > win.maxLossRateAmongPushed) {
        failures.push(
          `onOriginalDirectionalWin loss rate among pushed ${rate.toFixed(4)} > maxLossRateAmongPushed ${win.maxLossRateAmongPushed}`,
        );
      }
    }
  }

  return { ok: failures.length === 0, failures, variant };
}
