-- ============================================================
-- Migration 029: Seed system admin principal for huynhxuanthi@gmail.com
-- Ensures the internal user exists and is promoted to admin.
-- ============================================================

BEGIN;

UPDATE users
   SET role = 'admin',
       status = 'active',
       updated_at = NOW()
 WHERE LOWER(email) = LOWER('huynhxuanthi@gmail.com');

INSERT INTO users (id, email, display_name, avatar_url, role, status)
SELECT 'b8fe0d0e-30f1-4a0f-90f7-6158ddfdc301',
     'huynhxuanthi@gmail.com',
     'huynhxuanthi@gmail.com',
       '',
       'admin',
       'active'
 WHERE NOT EXISTS (
   SELECT 1
     FROM users
   WHERE LOWER(email) = LOWER('huynhxuanthi@gmail.com')
 );

COMMIT;