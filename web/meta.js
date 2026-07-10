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

// --------------------------------------------------------------- publish ---
// Everything below powers the "Publish to Meta" step: upload a finished
// creative to the ad account and create a PAUSED ad (or a reusable ad creative).

export function metaPublishConfig() {
  return {
    hasToken: Boolean(process.env.META_ACCESS_TOKEN),
    hasAccount: Boolean(process.env.META_AD_ACCOUNT_ID),
    hasPage: Boolean(process.env.META_PAGE_ID),
  };
}

function adAccountId() {
  const a = process.env.META_AD_ACCOUNT_ID;
  if (!a) throw new Error('META_AD_ACCOUNT_ID is not set (needed to publish to Meta).');
  return a.startsWith('act_') ? a : `act_${a}`;
}

async function graphPost(pathname, form) {
  const body = new URLSearchParams();
  Object.entries(form).forEach(([k, v]) => v != null && body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
  body.set('access_token', token());
  const res = await fetch(`${BASE_URL}/${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(json.error.error_user_msg || json.error.message || 'Meta API error');
  return json;
}

// Verify the token works for Ad Library / basic reads.
export async function testConnection() {
  try {
    const me = await graphGet('me', { access_token: token(), fields: 'id,name' });
    return { ok: true, who: me.name || me.id, scope: 'user token' };
  } catch (e) {
    // App tokens can't hit /me — fall back to a minimal ad-library probe.
    try {
      await graphGet('ads_archive', {
        access_token: token(),
        search_terms: 'a',
        ad_reached_countries: 'US',
        limit: 1,
      });
      return { ok: true, who: 'app/system token', scope: 'ad library' };
    } catch (e2) {
      return { ok: false, error: e2.message || e.message };
    }
  }
}

async function uploadImageToAccount(mediaUrl) {
  const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('Could not download the generated image for upload.');
  const buf = Buffer.from(await res.arrayBuffer());
  const json = await graphPost(`${adAccountId()}/adimages`, {
    bytes: buf.toString('base64'),
    name: `kie-studio-${Date.now()}.png`,
  });
  const first = json.images && Object.values(json.images)[0];
  if (!first?.hash) throw new Error('Meta did not return an image hash.');
  return first.hash;
}

async function uploadVideoToAccount(mediaUrl) {
  const json = await graphPost(`${adAccountId()}/advideos`, {
    file_url: mediaUrl,
    name: `kie-studio-${Date.now()}.mp4`,
  });
  if (!json.id) throw new Error('Meta did not return a video id.');
  // Poll until the video is fully processed (required before ad creation).
  const videoId = json.id;
  let thumb = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    let info;
    try {
      info = await graphGet(videoId, {
        access_token: token(),
        fields: 'status,picture,thumbnails{uri,is_preferred}',
      });
    } catch {
      continue;
    }
    const st = info.status || {};
    const thumbs = info.thumbnails?.data || [];
    thumb = (thumbs.find((t) => t.is_preferred) || thumbs[0] || {}).uri || info.picture || thumb;
    if (st.video_status === 'ready') return { videoId, thumb };
  }
  return { videoId, thumb }; // proceed with best-effort thumb even if still processing
}

export async function publishCreative(opts = {}) {
  const { mediaUrl, kind, link, message, headline, description, cta = 'LEARN_MORE', adsetId } = opts;
  const cfg = metaPublishConfig();
  if (!cfg.hasToken) throw new Error('META_ACCESS_TOKEN is not set.');
  if (!cfg.hasAccount) throw new Error('META_AD_ACCOUNT_ID is not set.');
  if (!cfg.hasPage) throw new Error('META_PAGE_ID is not set (required to build a Meta creative).');
  if (!mediaUrl) throw new Error('No creative to publish.');
  if (!link) throw new Error('A destination URL is required.');

  const pageId = process.env.META_PAGE_ID;
  const igUserId = process.env.META_IG_USER_ID;

  let objectStorySpec;
  if (kind === 'video') {
    const { videoId, thumb } = await uploadVideoToAccount(mediaUrl);
    objectStorySpec = {
      page_id: pageId,
      ...(igUserId ? { instagram_user_id: igUserId } : {}),
      video_data: {
        video_id: videoId,
        ...(thumb ? { image_url: thumb } : {}),
        ...(headline ? { title: headline } : {}),
        ...(message ? { message } : {}),
        ...(description ? { link_description: description } : {}),
        call_to_action: { type: cta, value: { link } },
      },
    };
  } else {
    const imageHash = await uploadImageToAccount(mediaUrl);
    objectStorySpec = {
      page_id: pageId,
      ...(igUserId ? { instagram_user_id: igUserId } : {}),
      link_data: {
        image_hash: imageHash,
        link,
        ...(headline ? { name: headline } : {}),
        ...(message ? { message } : {}),
        ...(description ? { description } : {}),
        call_to_action: { type: cta, value: { link } },
      },
    };
  }

  const creative = { object_story_spec: objectStorySpec, contextual_multi_ads: { enroll_status: 'OPT_OUT' } };
  const name = `KIE Studio ${kind} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  if (adsetId) {
    const ad = await graphPost(`${adAccountId()}/ads`, {
      name,
      adset_id: adsetId,
      status: 'PAUSED', // never launch spend automatically
      creative,
      ...(process.env.META_PIXEL_ID
        ? { tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [process.env.META_PIXEL_ID] }] }
        : {}),
    });
    return { type: 'ad', id: ad.id, status: 'PAUSED', adsetId };
  }

  // No ad set → create a reusable ad creative the user can attach in Ads Manager.
  const cr = await graphPost(`${adAccountId()}/adcreatives`, { name, ...creative });
  return { type: 'creative', id: cr.id, note: 'Reusable ad creative created — attach it to an ad set in Ads Manager.' };
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
