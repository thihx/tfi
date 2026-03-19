const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://fkr:Panda%40241205@fkr-database.postgres.database.azure.com:5432/tfi?sslmode=require' });

(async () => {
  const schema = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='audit_logs' ORDER BY ordinal_position"
  );
  console.log('=== audit_logs SCHEMA ===');
  schema.rows.forEach(r => console.log(r.column_name, r.data_type));

  const schema2 = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='recommendations' ORDER BY ordinal_position"
  );
  console.log('\n=== recommendations SCHEMA ===');
  schema2.rows.forEach(r => console.log(r.column_name, r.data_type));

  await pool.end();
})();
