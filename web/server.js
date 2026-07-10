import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { getModel, publicCatalog } from './models.js';
import { metaConfigured, searchAds } from './meta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load web/.env first, then fall back to the repo-root .env.
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 4321;
const KIE_BASE_URL = (process.env.KIE_BASE_URL || 'https://api.kie.ai').replace(/\/$/, '');
const KIE_API_KEY = process.env.KIE_API_KEY || process.env.KIE_AI_API_KEY || '';

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------- helpers ---
class KieError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

async function kieFetch(pathname, { method = 'GET', body } = {}) {
  if (!KIE_API_KEY) {
    throw new KieError('KIE_API_KEY is not configured on the server. Add it to web/.env.', 500);
  }
  let res;
  try {
    res = await fetch(`${KIE_BASE_URL}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new KieError(`Could not reach KIE.AI: ${err.message}`, 502);
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new KieError(`Unexpected non-JSON response from KIE.AI (HTTP ${res.status}).`, 502);
  }

  // KIE wraps everything in { code, msg, data }. code 200 means success.
  if (typeof json.code === 'number' && json.code !== 200) {
    throw new KieError(json.msg || `KIE.AI returned code ${json.code}.`, res.ok ? 400 : res.status);
  }
  if (!res.ok) {
    throw new KieError(json.msg || `KIE.AI HTTP ${res.status}.`, res.status);
  }
  return json;
}

function safeParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// KIE upload host/paths shift between /api/v1/... and /api/...; try both.
async function kieUpload(paths, body) {
  let lastErr;
  for (const p of paths) {
    try {
      const json = await kieFetch(p, { method: 'POST', body });
      const url = json.data?.downloadUrl || json.data?.url || json.data?.fileUrl;
      if (url) return url;
      lastErr = new KieError('Upload returned no URL.', 502);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new KieError('Upload failed.', 502);
}

function uploadBase64(dataUrl, dir = 'kie-studio/uploads') {
  return kieUpload(['/api/v1/file-base64-upload', '/api/file-base64-upload'], {
    base64Data: dataUrl,
    uploadPath: dir,
    fileName: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

function uploadFromUrl(fileUrl, dir = 'kie-studio/spy') {
  return kieUpload(['/api/v1/file-url-upload', '/api/file-url-upload'], {
    fileUrl,
    uploadPath: dir,
    fileName: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
}

function asyncRoute(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err instanceof KieError ? err.status : 500;
      res.status(status).json({ error: err.message || 'Server error.' });
    });
  };
}

// ---------------------------------------------------------------- routes ----
app.get('/api/config', (req, res) => {
  res.json({ hasKey: Boolean(KIE_API_KEY), hasMetaToken: metaConfigured(), baseUrl: KIE_BASE_URL });
});

app.get('/api/models', (req, res) => {
  res.json({ models: publicCatalog() });
});

app.get(
  '/api/credits',
  asyncRoute(async (req, res) => {
    const json = await kieFetch('/api/v1/chat/credit');
    // Response shape: { code, msg, data: <number|object> }
    const data = json.data;
    const credits = typeof data === 'number' ? data : data?.credits ?? data?.remaining ?? null;
    res.json({ credits, raw: data });
  })
);

// Upload reference images (data URLs) to KIE temp storage -> public URLs.
app.post(
  '/api/upload',
  asyncRoute(async (req, res) => {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) throw new KieError('No images provided.', 400);
    if (images.length > 8) throw new KieError('Too many images (max 8).', 400);

    const urls = [];
    for (const dataUrl of images) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        throw new KieError('Each image must be a base64 data URL.', 400);
      }
      urls.push(await uploadBase64(dataUrl));
    }
    res.json({ urls });
  })
);

// Kick off a generation.
app.post(
  '/api/generate',
  asyncRoute(async (req, res) => {
    const { modelId } = req.body || {};
    const model = getModel(modelId);
    if (!model) throw new KieError('Unknown model.', 400);

    const prompt = (req.body.prompt || '').trim();
    if (!prompt) throw new KieError('A prompt is required.', 400);

    const normalized = {
      prompt,
      aspectRatio: req.body.aspectRatio,
      resolution: req.body.resolution,
      duration: req.body.duration,
      referenceImageUrls: Array.isArray(req.body.referenceImageUrls) ? req.body.referenceImageUrls : [],
      generateAudio: req.body.generateAudio,
      outputFormat: req.body.outputFormat,
    };

    const body = model.build(normalized);
    const createPath = model.endpoint === 'veo' ? '/api/v1/veo/generate' : '/api/v1/jobs/createTask';
    const json = await kieFetch(createPath, { method: 'POST', body });
    const taskId = json.data?.taskId || json.data?.task_id;
    if (!taskId) throw new KieError('KIE.AI did not return a task id.', 502);

    res.json({ taskId, endpoint: model.endpoint, modelId: model.id, kind: model.kind });
  })
);

// Poll a task. Normalizes both the jobs and veo response shapes.
app.get(
  '/api/task',
  asyncRoute(async (req, res) => {
    const taskId = req.query.taskId;
    const endpoint = req.query.endpoint;
    if (!taskId) throw new KieError('taskId is required.', 400);

    if (endpoint === 'veo') {
      const json = await kieFetch(`/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`);
      const data = json.data || {};
      const flag = data.successFlag;
      const info = data.response || data.info || {};
      let resultUrls = info.resultUrls || info.result_urls || [];
      if (typeof resultUrls === 'string') resultUrls = safeParse(resultUrls) || [];

      let state = 'generating';
      if (flag === 1) state = 'success';
      else if (flag === 2 || flag === 3) state = 'fail';
      else if (flag === 0 || flag === undefined) state = 'generating';

      return res.json({
        state,
        progress: null,
        resultUrls,
        error: state === 'fail' ? data.errorMessage || 'Generation failed.' : null,
      });
    }

    // jobs
    const json = await kieFetch(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    const data = json.data || {};
    const parsed = safeParse(data.resultJson) || {};
    let resultUrls = parsed.resultUrls || parsed.result_urls || [];
    if (typeof resultUrls === 'string') resultUrls = safeParse(resultUrls) || [];

    let state = data.state || 'generating';
    if (state === 'queuing' || state === 'waiting') state = 'generating';

    return res.json({
      state,
      progress: typeof data.progress === 'number' ? data.progress : null,
      resultUrls,
      error: state === 'fail' ? data.failMsg || data.failCode || 'Generation failed.' : null,
    });
  })
);

// Competitor "database": search the Meta Ad Library for a brand's ads.
app.get(
  '/api/spy',
  asyncRoute(async (req, res) => {
    if (!metaConfigured()) {
      throw new KieError('Competitor search needs a META_ACCESS_TOKEN in web/.env.', 400);
    }
    try {
      const result = await searchAds({
        q: req.query.q,
        countries: req.query.countries || 'US',
        limit: req.query.limit || 12,
        mediaType: req.query.mediaType || 'all',
        activeOnly: req.query.activeOnly === 'true',
        sortBy: req.query.sortBy || 'impressions_high_to_low',
        days: Number(req.query.days) || 365,
      });
      res.json(result);
    } catch (err) {
      throw new KieError(err.message || 'Meta Ad Library request failed.', 400);
    }
  })
);

// Clone a competitor ad: use it as a reference and regenerate for the user's product.
app.post(
  '/api/clone',
  asyncRoute(async (req, res) => {
    const kind = req.body.kind === 'video' ? 'video' : 'image';
    const product = (req.body.product || '').trim();
    if (!product) throw new KieError('Describe your product to clone the ad for.', 400);

    const modelId = req.body.modelId || (kind === 'video' ? 'seedance-2' : 'nano-banana-pro');
    const model = getModel(modelId);
    if (!model || model.kind !== kind) throw new KieError('Invalid clone model.', 400);
    if (!model.caps.referenceImages) throw new KieError('This model cannot take a reference image.', 400);

    // Resolve the reference creative to a KIE-hosted URL.
    let refUrl = null;
    if (req.body.referenceImageDataUrl?.startsWith('data:')) {
      refUrl = await uploadBase64(req.body.referenceImageDataUrl, 'kie-studio/clone');
    } else if (req.body.referenceImageUrl) {
      try {
        refUrl = await uploadFromUrl(req.body.referenceImageUrl);
      } catch {
        refUrl = req.body.referenceImageUrl; // fall back to the raw URL
      }
    }
    if (!refUrl) throw new KieError('Provide a reference ad image (upload or URL) to clone.', 400);

    const brand = (req.body.brand || '').trim();
    const forWhom = brand ? `${product} by ${brand}` : product;
    const prompt =
      kind === 'video'
        ? `Recreate this advertisement as a short, modern video ad, matching the reference's overall style, pacing, framing, lighting, and energy — but for this product: ${forWhom}. Swap in the new product naturally. Keep it authentic and high-quality. Do NOT reproduce the original brand's logos, names, or trademarked elements.`
        : `Recreate this advertisement as a new image creative. Keep the same overall layout, composition, framing, typography style, and color mood as the reference image, but replace the product, branding, and any text so the ad is for this product: ${forWhom}. Photorealistic, clean, professional ad creative. Do NOT reproduce the original brand's logos, names, or trademarked text.`;

    const body = model.build({
      prompt,
      aspectRatio: req.body.aspectRatio,
      resolution: req.body.resolution,
      duration: req.body.duration,
      referenceImageUrls: [refUrl],
      generateAudio: req.body.generateAudio,
      outputFormat: req.body.outputFormat,
    });
    const createPath = model.endpoint === 'veo' ? '/api/v1/veo/generate' : '/api/v1/jobs/createTask';
    const json = await kieFetch(createPath, { method: 'POST', body });
    const taskId = json.data?.taskId || json.data?.task_id;
    if (!taskId) throw new KieError('KIE.AI did not return a task id.', 502);

    res.json({ taskId, endpoint: model.endpoint, modelId: model.id, kind, referenceUrl: refUrl });
  })
);

// SPA fallback.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  KIE Studio running at http://localhost:${PORT}`);
  console.log(`  KIE base URL: ${KIE_BASE_URL}`);
  console.log(`  KIE key: ${KIE_API_KEY ? 'loaded ✓' : 'MISSING ✗  (add KIE_API_KEY to web/.env)'}`);
  console.log(`  Meta token: ${metaConfigured() ? 'loaded ✓ (competitor search enabled)' : 'not set (competitor search disabled)'}\n`);
});
