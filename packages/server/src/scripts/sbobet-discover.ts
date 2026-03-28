/**
 * SBOBET Endpoint Discovery Script
 * ===================================
 * Chạy script này 1 lần để tìm chính xác các endpoint của tài khoản SBO bạn đang dùng.
 *
 * Usage:
 *   SBO_USERNAME=xxx SBO_PASSWORD=yyy SBO_BASE_URL=https://your-sbo-domain.com \
 *     npx tsx packages/server/src/scripts/sbobet-discover.ts
 *
 * Hoặc thêm vào .env rồi chạy:
 *   npx tsx packages/server/src/scripts/sbobet-discover.ts
 *
 * Output: In ra toàn bộ network calls, response shape, và đề xuất config.
 */

import 'dotenv/config';
import { chromium } from 'playwright';

const SBO_URL = process.env['SBO_BASE_URL'] || 'https://www.sbobet.com';
const USERNAME = process.env['SBO_USERNAME'] || '';
const PASSWORD = process.env['SBO_PASSWORD'] || '';

if (!USERNAME || !PASSWORD) {
  console.error('❌  Set SBO_USERNAME and SBO_PASSWORD in .env first');
  process.exit(1);
}

console.log(`\n🔍  SBOBET Discovery — connecting to ${SBO_URL}\n`);

interface CapturedRequest {
  url: string;
  method: string;
  postBody: string | null;
  status: number;
  responseSnippet: string;
  isSoccerRelated: boolean;
  isOddsRelated: boolean;
}

const captured: CapturedRequest[] = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  // ── Intercept all API calls ──────────────────────────────────────────────
  page.on('response', async (response) => {
    const url = response.url();
    const method = response.request().method();
    const status = response.status();
    const postBody = response.request().postData();

    // Only capture JSON API calls (skip static assets)
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.includes('json') && !url.includes('/api/')) return;

    const lowerUrl = url.toLowerCase();
    const isSoccer = lowerUrl.includes('soccer') || lowerUrl.includes('football') || lowerUrl.includes('live');
    const isOdds = lowerUrl.includes('odds') || lowerUrl.includes('match') || lowerUrl.includes('event') || lowerUrl.includes('sport');

    let snippet = '';
    try {
      const body = await response.body();
      const text = body.toString('utf8').slice(0, 500);
      snippet = text;
    } catch {
      snippet = '[could not read body]';
    }

    captured.push({ url, method, postBody, status, responseSnippet: snippet, isSoccerRelated: isSoccer, isOddsRelated: isOdds });
  });

  // ── Step 1: Navigate to main page ────────────────────────────────────────
  console.log('📡  Loading main page...');
  await page.goto(SBO_URL, { waitUntil: 'networkidle', timeout: 30_000 });
  console.log(`    Page title: ${await page.title()}`);

  // ── Step 2: Find and fill login form ─────────────────────────────────────
  console.log('🔐  Looking for login form...');
  await page.waitForTimeout(2000);

  // Try common login selectors
  const usernameSelectors = ['input[name="username"]', 'input[type="text"]', '#username', '#user', 'input[placeholder*="user" i]', 'input[placeholder*="account" i]'];
  const passwordSelectors = ['input[name="password"]', 'input[type="password"]', '#password', '#pass'];

  let loginFound = false;
  for (const sel of usernameSelectors) {
    try {
      await page.fill(sel, USERNAME, { timeout: 2000 });
      console.log(`    ✅ Username field: ${sel}`);
      loginFound = true;
      break;
    } catch { /* try next */ }
  }

  if (loginFound) {
    for (const sel of passwordSelectors) {
      try {
        await page.fill(sel, PASSWORD, { timeout: 2000 });
        console.log(`    ✅ Password field: ${sel}`);
        break;
      } catch { /* try next */ }
    }

    const submitSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")', 'button:has-text("Sign in")', '.login-btn'];
    for (const sel of submitSelectors) {
      try {
        await page.click(sel, { timeout: 2000 });
        console.log(`    ✅ Submitted with: ${sel}`);
        break;
      } catch { /* try next */ }
    }

    console.log('⏳  Waiting for post-login navigation...');
    await page.waitForTimeout(5000);
    console.log(`    Current URL: ${page.url()}`);
  } else {
    console.log('    ⚠️  Could not find login form — may need manual URL or different selectors');
    console.log('    Try setting SBO_BASE_URL to the direct sports betting URL');
  }

  // ── Step 3: Navigate to live soccer ──────────────────────────────────────
  console.log('\n⚽  Navigating to live soccer...');
  const livePaths = ['/betting/soccer/live', '/sports/soccer/live', '/live', '/in-play'];
  for (const path of livePaths) {
    try {
      await page.goto(`${SBO_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.waitForTimeout(3000);
      console.log(`    Tried: ${path} → ${page.url()}`);
      break;
    } catch { /* try next */ }
  }

  // ── Step 4: Wait and collect network calls ────────────────────────────────
  console.log('🕐  Waiting 8s to capture live data API calls...');
  await page.waitForTimeout(8000);

  await browser.close();

  // ── Step 5: Print results ─────────────────────────────────────────────────
  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('                    CAPTURED REQUESTS');
  console.log('══════════════════════════════════════════════════════\n');

  const loginRequests = captured.filter((r) => r.url.toLowerCase().includes('login') || r.url.toLowerCase().includes('auth') || r.method === 'POST');
  const soccerRequests = captured.filter((r) => r.isSoccerRelated || r.isOddsRelated);

  console.log(`📊  Total captured: ${captured.length}`);
  console.log(`🔐  Login/auth calls: ${loginRequests.length}`);
  console.log(`⚽  Soccer/odds calls: ${soccerRequests.length}`);

  if (loginRequests.length > 0) {
    console.log('\n── LOGIN CALLS ─────────────────────────────────────────');
    for (const r of loginRequests.slice(0, 5)) {
      console.log(`\n${r.method} ${r.url}`);
      if (r.postBody) console.log(`  Body: ${r.postBody.slice(0, 200)}`);
      console.log(`  Status: ${r.status}`);
      console.log(`  Response: ${r.responseSnippet.slice(0, 300)}`);
    }
  }

  if (soccerRequests.length > 0) {
    console.log('\n── SOCCER / ODDS CALLS ─────────────────────────────────');
    for (const r of soccerRequests.slice(0, 10)) {
      console.log(`\n${r.method} ${r.url}`);
      console.log(`  Status: ${r.status}`);
      console.log(`  Response snippet: ${r.responseSnippet.slice(0, 400)}`);
    }
  }

  console.log('\n\n══════════════════════════════════════════════════════');
  console.log('                 RECOMMENDED .env CONFIG');
  console.log('══════════════════════════════════════════════════════\n');

  const loginCall = loginRequests.find((r) => r.method === 'POST' && r.status < 400);
  const liveCall = soccerRequests.find((r) => r.url.toLowerCase().includes('live') && r.responseSnippet.includes('{'));

  const loginPath = loginCall ? new URL(loginCall.url).pathname : '/api/auth/login  ← UPDATE THIS';
  const livePath = liveCall ? new URL(liveCall.url).pathname : '/api/sports/live/soccer  ← UPDATE THIS';
  const baseUrl = loginCall ? `${new URL(loginCall.url).protocol}//${new URL(loginCall.url).host}` : SBO_URL;

  console.log('Add these to your .env:\n');
  console.log(`SBO_ENABLED=true`);
  console.log(`SBO_USERNAME=${USERNAME}`);
  console.log(`SBO_PASSWORD=***`);
  console.log(`SBO_BASE_URL=${baseUrl}`);
  console.log(`SBO_LOGIN_PATH=${loginPath}`);
  console.log(`SBO_LIVE_FEED_PATH=${livePath}`);
  console.log(`SBO_SESSION_TTL_MS=1500000`);

  if (!loginCall || !liveCall) {
    console.log('\n⚠️  Some endpoints were not auto-detected.');
    console.log('   Inspect the SOCCER/ODDS CALLS above and set the paths manually.');
    console.log('   Also check: is the SBO_BASE_URL the correct domain for your agent?');
  } else {
    console.log('\n✅  Endpoints detected. Update .env, then restart the server.');
  }

  console.log('\n── RESPONSE SHAPE SAMPLE ────────────────────────────────');
  if (liveCall) {
    console.log('Live feed response (first 600 chars):');
    console.log(liveCall.responseSnippet.slice(0, 600));
    console.log('\n→ Update normalizeLiveFeedResponse() in sbobet-extractor.ts if field names differ.');
  }
})();
