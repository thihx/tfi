import { closePool } from '../db/pool.js';
import { rebuildPerformanceMemoryFromRecommendations } from '../repos/ai-performance.repo.js';

async function main() {
  const summary = await rebuildPerformanceMemoryFromRecommendations();
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...summary,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error('[performance-memory] rebuild failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
