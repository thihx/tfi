import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.e2e manually (avoid extra dependency)
const envPath = path.resolve(process.cwd(), '.env.e2e');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/);
    if (match) process.env[match[1]!] = match[2]!.trim();
  }
}

const AUTH_FILE = path.resolve(process.cwd(), 'e2e/.auth.json');

export default async function globalSetup() {
  const token = process.env['E2E_TOKEN'];

  if (!token) {
    throw new Error(
      '\n\nE2E_TOKEN chưa được set.\n' +
      'Cách lấy token:\n' +
      '  1. Mở app và đăng nhập bằng Google\n' +
      '  2. Mở DevTools → Application → Local Storage → http://localhost:3000\n' +
      '  3. Copy giá trị của "tfi_auth_token"\n' +
      '  4. Tạo file .env.e2e ở root project:\n' +
      '       E2E_TOKEN=<dán token vào đây>\n' +
      '  5. Chạy lại npm run test:e2e\n'
    );
  }

  // Validate JWT shape
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('E2E_TOKEN không đúng định dạng JWT (cần 3 phần ngăn cách bởi dấu chấm).');
  }

  // Check expiry
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    const exp = payload.exp as number | undefined;
    if (exp && exp < Math.floor(Date.now() / 1000)) {
      throw new Error('E2E_TOKEN đã hết hạn. Vui lòng đăng nhập lại và cập nhật .env.e2e.');
    }
  } catch (e) {
    if ((e as Error).message?.includes('hết hạn')) throw e;
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');
  await page.evaluate((t: string) => {
    localStorage.setItem('tfi_auth_token', t);
  }, token);

  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();

  console.log('✓ Auth state saved →', AUTH_FILE);
}
