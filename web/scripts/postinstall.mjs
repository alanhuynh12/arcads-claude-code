// Auto-install the Chromium browser used by the Spy "deep scrape" headless mode.
//
// Runs after `npm install`. It's best-effort and idempotent: Playwright skips the
// download if the browser is already cached, and any failure here NEVER fails the
// install (headless scraping just stays unavailable until you run
// `npm run setup:headless`). Opt out entirely with KIE_SKIP_BROWSER=1.

import { execSync } from 'node:child_process';

if (process.env.KIE_SKIP_BROWSER === '1' || process.env.CI === 'true') {
  console.log('[kie-studio] Skipping Chromium download (KIE_SKIP_BROWSER/CI set).');
  process.exit(0);
}

// When running as root (typical for cloud env builds / Docker), also install the
// OS libraries Chromium needs so headless works out of the box. Non-root local
// installs get the browser binary only.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const cmd = isRoot ? 'npx playwright install --with-deps chromium' : 'npx playwright install chromium';

try {
  execSync(cmd, { stdio: 'inherit' });
  console.log('[kie-studio] Chromium ready — headless deep-scrape enabled.');
} catch {
  console.warn(
    '[kie-studio] Chromium download skipped. Headless engagement scraping will be off ' +
      'until you run: npm run setup:headless'
  );
}
process.exit(0);
