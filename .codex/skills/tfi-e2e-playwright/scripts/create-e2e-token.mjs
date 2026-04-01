import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const serverEnvPath = path.join(repoRoot, 'packages', 'server', '.env');

function parseEnvFile(filePath) {
  const env = {};
  if (!existsSync(filePath)) return env;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2];
  }
  return env;
}

const envFile = parseEnvFile(serverEnvPath);
const secret = process.env.JWT_SECRET || envFile.JWT_SECRET;

if (!secret) {
  console.error('Missing JWT_SECRET. Expected packages/server/.env or process.env.JWT_SECRET.');
  process.exit(1);
}

const expiresInSeconds = Number(process.env.JWT_EXPIRES_IN_SECONDS || envFile.JWT_EXPIRES_IN_SECONDS || 604800);
const now = Math.floor(Date.now() / 1000);

const payload = {
  sub: process.env.TFI_E2E_USER_ID || 'b8fe0d0e-30f1-4a0f-90f7-6158ddfdc301',
  email: process.env.TFI_E2E_EMAIL || 'huynhxuanthi@gmail.com',
  role: process.env.TFI_E2E_ROLE || 'admin',
  name: process.env.TFI_E2E_NAME || 'Huynh Xuan Thi',
  picture: process.env.TFI_E2E_PICTURE || '',
  iat: now,
  exp: now + expiresInSeconds,
};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const header = encode({ alg: 'HS256', typ: 'JWT' });
const body = encode(payload);
const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

process.stdout.write(`${header}.${body}.${signature}`);
