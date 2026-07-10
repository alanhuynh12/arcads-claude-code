// Ad snapshot scraper.
//
// The Meta Ad Library API returns almost no creative detail, but each ad's
// public `ad_snapshot_url` render page embeds a big JSON blob. We parse it
// statically (no browser) for the fields that ARE there:
//   - page_like_count (advertiser follower count — a real brand-size signal)
//   - caption / title / body / cta / destination link / display format
//   - all image + video variants
//
// Engagement (reactions/comments/shares) is NOT present on commercial ad
// snapshots. `deepScrape()` optionally spins up a headless browser (Playwright,
// an OPTIONAL dependency) to try to read counts when a snapshot embeds the
// organic post — gated behind SPY_HEADLESS=true and degrading gracefully.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const unescapeStr = (s) =>
  (s || '')
    .replace(/\\u0040/g, '@')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003C/gi, '<')
    .replace(/\\u003E/gi, '>')
    .replace(/\\u003D/gi, '=')
    .replace(/\\\//g, '/')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/&amp;/g, '&');

const firstMatch = (html, re) => {
  const m = re.exec(html);
  return m ? m[1] : null;
};

function grabAll(html, re) {
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const v = unescapeStr(m[1]);
    if (v.startsWith('http')) out.add(v);
  }
  return [...out];
}

// Structured, browser-free extraction from a snapshot page's HTML.
export function extractSnapshotData(html) {
  const images = new Set();
  grabAll(html, /"original_image_url":"(https:[^"]+)"/g).forEach((u) => images.add(u));
  grabAll(html, /"resized_image_url":"(https:[^"]+)"/g).forEach((u) => images.add(u));

  const videos = new Set();
  grabAll(html, /"video_hd_url":"(https:[^"]+)"/g).forEach((u) => videos.add(u));
  grabAll(html, /"video_sd_url":"(https:[^"]+)"/g).forEach((u) => videos.add(u));

  const posters = grabAll(html, /"video_preview_image_url":"(https:[^"]+)"/g);

  const likeRaw = firstMatch(html, /"page_like_count":\s*(\d+)/);
  const pageLikeCount = likeRaw != null ? Number(likeRaw) : null;

  const cta = unescapeStr(firstMatch(html, /"cta_text":"([^"]*)"/) || '') || null;
  const linkUrl = unescapeStr(firstMatch(html, /"link_url":"([^"]*)"/) || '') || null;
  const caption = unescapeStr(firstMatch(html, /"caption":"([^"]*)"/) || '') || null;
  const title = unescapeStr(firstMatch(html, /"title":"([^"]*)"/) || '') || null;
  const displayFormat = unescapeStr(firstMatch(html, /"display_format":"([^"]*)"/) || '') || null;
  const bodyText = unescapeStr(firstMatch(html, /"body":\{"text":"([^"]*)"/) || '') || null;

  const imgList = [...images];
  const preview = posters[0] || imgList[0] || null;

  return {
    images: imgList,
    videos: [...videos],
    preview,
    pageLikeCount,
    cta,
    linkUrl,
    caption,
    title,
    body: bodyText,
    displayFormat,
  };
}

// Legacy shape used by the quick media grid.
export function extractCreative(html) {
  const d = extractSnapshotData(html);
  return { images: d.images, videos: d.videos, preview: d.preview };
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  return res.text();
}

// Best-effort headless engagement read. Only runs when SPY_HEADLESS=true AND
// Playwright is installed. Returns { reactions, comments, shares } when found.
async function headlessEngagement(url) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { unavailable: 'playwright-not-installed' };
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const text = await page.evaluate(() => document.body?.innerText || '');
    const num = (label) => {
      const re = new RegExp('([\\d.,]+\\s*[KMB]?)\\s+' + label, 'i');
      const m = re.exec(text);
      return m ? m[1].trim() : null;
    };
    return {
      reactions: num('(?:reactions|likes)'),
      comments: num('comments'),
      shares: num('shares'),
    };
  } catch (e) {
    return { headlessError: e.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function deepScrape(snapshotUrl) {
  if (!snapshotUrl) throw new Error('snapshotUrl is required.');
  const html = await fetchHtml(snapshotUrl);
  const data = extractSnapshotData(html);
  data.source = 'static';
  data.headlessEnabled = process.env.SPY_HEADLESS === 'true';

  if (data.headlessEnabled) {
    const eng = await headlessEngagement(snapshotUrl);
    if (eng?.unavailable) {
      data.engagementNote = 'Headless enabled but Playwright is not installed. Run: npm i playwright && npx playwright install chromium';
    } else if (eng?.headlessError) {
      data.engagementNote = 'Headless scrape error: ' + eng.headlessError;
    } else if (eng && (eng.reactions || eng.comments || eng.shares)) {
      data.engagement = eng;
      data.source = 'headless';
    } else {
      data.engagementNote = 'No public engagement counts were present on this ad snapshot.';
    }
  } else {
    data.engagementNote =
      'Per-ad likes/comments are not in the Ad Library snapshot for commercial ads. Set SPY_HEADLESS=true (+ Playwright) to attempt extraction where a post is embedded.';
  }
  return data;
}
