// Meta Ad Library ("the competitor database") helpers.
//
// Uses the public Graph API `ads_archive` endpoint to pull a competitor's ads,
// then best-effort extracts the actual creative media (images / videos) by
// reading each ad's public snapshot page. Mirrors the conventions of
// shared/skills/meta-ad-builder/scripts/lib/meta_api.py.
//
// Requires META_ACCESS_TOKEN in the environment. Note: the Ad Library API's
// coverage of purely commercial ads varies by region (fullest for EU-targeted
// ads); issue/political ads are always covered. When the API returns nothing,
// the universal fallback is to upload a screenshot of the ad and clone that.

const API_VERSION = process.env.META_API_VERSION || 'v23.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export function metaConfigured() {
  return Boolean(process.env.META_ACCESS_TOKEN);
}

function token() {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new Error('META_ACCESS_TOKEN is not configured. Add it to web/.env to enable competitor search.');
  return t;
}

const ARCHIVE_FIELDS = [
  'id',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'ad_snapshot_url',
  'page_id',
  'page_name',
  'publisher_platforms',
  'ad_creative_bodies',
  'ad_creative_link_titles',
  'ad_creative_link_captions',
].join(',');

async function graphGet(pathname, params) {
  const url = new URL(`${BASE_URL}/${pathname}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (json.error) {
    const err = new Error(json.error.message || 'Meta API error');
    err.metaCode = json.error.code;
    throw err;
  }
  return json;
}

async function resolvePageId(identifier, countries, dateMin, dateMax) {
  identifier = String(identifier).trim();
  if (/^\d+$/.test(identifier)) return identifier;
  // Search the archive for the name and pick the dominant page_id.
  try {
    const data = await graphGet('ads_archive', {
      access_token: token(),
      search_terms: identifier,
      ad_reached_countries: countries,
      ad_delivery_date_min: dateMin,
      ad_delivery_date_max: dateMax,
      ad_active_status: 'ALL',
      fields: 'page_id,page_name',
      limit: 50,
    });
    const ads = data.data || [];
    const counts = new Map();
    const names = new Map();
    for (const a of ads) {
      if (!a.page_id) continue;
      counts.set(a.page_id, (counts.get(a.page_id) || 0) + 1);
      names.set(a.page_id, a.page_name);
    }
    if (!counts.size) return null;
    const ident = identifier.toLowerCase().replace(/[._]/g, ' ');
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [pid] of sorted) {
      const pname = (names.get(pid) || '').toLowerCase();
      const words = ident.split(' ').filter((w) => w.length > 2);
      if (pname.includes(ident) || (words.length && words.every((w) => pname.includes(w)))) return pid;
    }
    return sorted[0][0];
  } catch {
    return null;
  }
}

function mediaTypeParam(mediaType) {
  if (mediaType === 'image') return 'IMAGE';
  if (mediaType === 'video') return 'VIDEO';
  return null; // all
}

export async function searchAds(opts = {}) {
  const {
    q,
    countries = 'US',
    limit = 12,
    mediaType = 'all',
    activeOnly = false,
    sortBy = 'impressions_high_to_low',
    days = 365,
  } = opts;

  if (!q || !String(q).trim()) throw new Error('A brand name or page ID is required.');

  const now = new Date();
  const dateMax = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const dateMin = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);

  const pageId = await resolvePageId(q, countries, dateMin, dateMax);

  const params = {
    access_token: token(),
    ad_reached_countries: countries,
    ad_delivery_date_min: dateMin,
    ad_delivery_date_max: dateMax,
    ad_active_status: activeOnly ? 'ACTIVE' : 'ALL',
    sort_by: sortBy,
    fields: ARCHIVE_FIELDS,
    limit: Math.min(Number(limit) || 12, 50),
  };
  if (pageId) params.search_page_ids = pageId;
  else params.search_terms = String(q).trim();
  const mt = mediaTypeParam(mediaType);
  if (mt) params.media_type = mt;

  const data = await graphGet('ads_archive', params);
  const ads = (data.data || []).map((ad) => ({
    id: ad.id,
    pageId: ad.page_id,
    pageName: ad.page_name,
    snapshotUrl: ad.ad_snapshot_url,
    startTime: ad.ad_delivery_start_time,
    stopTime: ad.ad_delivery_stop_time || null,
    platforms: ad.publisher_platforms || [],
    body: (ad.ad_creative_bodies || [])[0] || '',
    title: (ad.ad_creative_link_titles || [])[0] || '',
    preview: null,
    images: [],
    videos: [],
  }));

  await enrichCreative(ads);
  return { pageResolved: pageId, ads };
}

// Best-effort: read each ad's public snapshot page and pull out media URLs.
async function enrichCreative(ads) {
  await mapLimit(ads, 5, async (ad) => {
    if (!ad.snapshotUrl) return;
    try {
      const res = await fetch(ad.snapshotUrl, {
        signal: AbortSignal.timeout(9000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KIEStudio/1.0)' },
      });
      const html = await res.text();
      const media = extractCreative(html);
      ad.images = media.images;
      ad.videos = media.videos;
      ad.preview = media.preview;
    } catch {
      /* leave preview null; UI falls back to the snapshot link */
    }
  });
}

const unescapeUrl = (s) =>
  s.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/\\u003D/gi, '=').replace(/&amp;/g, '&');

export function extractCreative(html) {
  const images = new Set();
  const videos = new Set();
  const posters = new Set();

  const grab = (re, into) => {
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = unescapeUrl(m[1]);
      if (url.startsWith('http')) into.add(url);
    }
  };

  grab(/"original_image_url":"(https:[^"]+)"/g, images);
  grab(/"resized_image_url":"(https:[^"]+)"/g, images);
  grab(/"video_hd_url":"(https:[^"]+)"/g, videos);
  grab(/"video_sd_url":"(https:[^"]+)"/g, videos);
  grab(/"video_preview_image_url":"(https:[^"]+)"/g, posters);

  const imgList = [...images];
  const preview = [...posters][0] || imgList[0] || null;
  return { images: imgList, videos: [...videos], preview };
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}
