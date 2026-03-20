import pg from './packages/server/node_modules/pg/lib/index.js';
const pool = new pg.Pool({
  connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

// 1. Scheduler start events (confirm v1.0.22 deployed)
const sched = await pool.query(`
  SELECT action, timestamp::text, metadata::text
  FROM audit_logs 
  WHERE category = 'SYSTEM' OR category = 'SCHEDULER'
  ORDER BY timestamp DESC LIMIT 5
`);
console.log('=== LATEST SCHEDULER EVENTS ===');
for (const r of sched.rows) {
  console.log(`  ${r.timestamp} | ${r.action} | ${(r.metadata||'').substring(0,200)}`);
}

// 2. Check watchdog logs
const wd = await pool.query(`
  SELECT action, outcome, timestamp::text, metadata::text
  FROM audit_logs 
  WHERE category = 'WATCHDOG' OR action ILIKE '%watchdog%' OR action ILIKE '%HEALTH_WATCHDOG%'
  ORDER BY timestamp DESC LIMIT 10
`);
console.log('\n=== WATCHDOG LOGS ===');
if (wd.rows.length === 0) console.log('  (none yet - watchdog may not have detected overdue jobs)');
for (const r of wd.rows) {
  console.log(`  ${r.timestamp} | ${r.action} | ${r.outcome} | ${(r.metadata||'').substring(0,150)}`);
}

// 3. Recent job runs (confirms all jobs running)
const jobs = await pool.query(`
  SELECT action, outcome, COUNT(*) as cnt, MAX(timestamp)::text as last
  FROM audit_logs 
  WHERE category = 'JOB' AND timestamp > NOW() - INTERVAL '10 minutes'
  GROUP BY action, outcome
  ORDER BY action
`);
console.log('\n=== JOB RUNS (LAST 10 MIN) ===');
for (const r of jobs.rows) {
  console.log(`  ${r.action} | ${r.outcome} | ${r.cnt}x | last: ${r.last}`);
}

await pool.end();
