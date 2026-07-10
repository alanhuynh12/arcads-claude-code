/* KIE Studio — frontend logic */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  models: [],
  view: 'video', // video | image | gallery
  kind: 'video',
  selectedId: null,
  options: {},
  refs: [], // { dataUrl, url, uploading, failed }
  polling: null,
};

const GALLERY_KEY = 'kie-studio-gallery';

/* ------------------------------------------------------------- utilities -- */
function api(path, opts) {
  return fetch(path, opts).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function loadGallery() {
  try {
    return JSON.parse(localStorage.getItem(GALLERY_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveGalleryItem(item) {
  const list = loadGallery();
  list.unshift(item);
  localStorage.setItem(GALLERY_KEY, JSON.stringify(list.slice(0, 60)));
}

/* ------------------------------------------------------------------ clock - */
function tickClock() {
  const now = new Date();
  const opts = { weekday: 'short', hour: 'numeric', minute: '2-digit' };
  $('#menuClock').textContent = now.toLocaleString(undefined, opts);
}
setInterval(tickClock, 15000);
tickClock();

/* ----------------------------------------------------------------- config - */
async function initConfig() {
  const statusEl = $('#keyStatus');
  try {
    const cfg = await api('/api/config');
    state.hasMetaToken = cfg.hasMetaToken;
    state.canPublish = cfg.canPublish;
    state.metaPublish = cfg.metaPublish || {};
    if (cfg.hasKey) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'kie-card-sub ok';
      refreshCredits();
    } else {
      statusEl.textContent = 'No API key — add KIE_API_KEY to web/.env';
      statusEl.className = 'kie-card-sub bad';
    }
  } catch (e) {
    statusEl.textContent = 'Server unreachable';
    statusEl.className = 'kie-card-sub bad';
  }
}

async function refreshCredits() {
  try {
    const { credits } = await api('/api/credits');
    if (credits != null) $('#menuCredits').textContent = `${Number(credits).toLocaleString()} credits`;
  } catch {
    /* silent */
  }
}

/* ----------------------------------------------------------------- models - */
async function initModels() {
  const { models } = await api('/api/models');
  state.models = models;
  renderModelGrid();
}

function modelsForKind() {
  return state.models.filter((m) => m.kind === state.kind);
}

function currentModel() {
  return state.models.find((m) => m.id === state.selectedId) || null;
}

function renderModelGrid() {
  const grid = $('#modelGrid');
  const list = modelsForKind();
  if (!list.some((m) => m.id === state.selectedId)) {
    state.selectedId = list[0]?.id || null;
    applyDefaultOptions();
  }
  grid.innerHTML = '';
  list.forEach((m) => {
    const card = document.createElement('button');
    card.className = 'model-card' + (m.id === state.selectedId ? ' selected' : '');
    card.innerHTML = `
      <div class="m-name">${m.label} <span class="m-prov">· ${m.provider}</span></div>
      <div class="m-tag">${m.tagline || ''}</div>`;
    card.addEventListener('click', () => {
      state.selectedId = m.id;
      applyDefaultOptions();
      renderModelGrid();
      renderOptions();
      renderRefBlock();
    });
    grid.appendChild(card);
  });
  renderOptions();
  renderRefBlock();
}

function pick(list, preferred) {
  for (const p of preferred) if (list.includes(p)) return p;
  return list[0];
}

function applyDefaultOptions() {
  const m = currentModel();
  if (!m) return;
  const c = m.caps;
  const o = {};
  if (c.aspectRatios?.length) o.aspectRatio = pick(c.aspectRatios, ['9:16', '16:9']);
  if (c.resolutions?.length) o.resolution = pick(c.resolutions, ['1080p', '720p', '2K', '1K']);
  if (c.durations?.length) o.duration = pick(c.durations, [8, 5, 6]);
  if (c.outputFormats?.length) o.outputFormat = pick(c.outputFormats, ['png']);
  if (c.audioToggle) o.generateAudio = true;
  state.options = o;
}

/* --------------------------------------------------------------- options -- */
function segmented(values, current, onPick, fmt = (v) => v) {
  const wrap = document.createElement('div');
  wrap.className = 'segmented';
  values.forEach((v) => {
    const b = document.createElement('button');
    b.textContent = fmt(v);
    if (String(v) === String(current)) b.classList.add('active');
    b.addEventListener('click', () => {
      onPick(v);
      $$('button', wrap).forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function optionRow(label, control) {
  const row = document.createElement('div');
  row.className = 'option-row';
  const l = document.createElement('span');
  l.className = 'o-label';
  l.textContent = label;
  row.appendChild(l);
  row.appendChild(control);
  return row;
}

function renderOptions() {
  const box = $('#options');
  box.innerHTML = '';
  const m = currentModel();
  if (!m) return;
  const c = m.caps;

  if (c.aspectRatios?.length) {
    box.appendChild(
      optionRow('Aspect ratio', segmented(c.aspectRatios, state.options.aspectRatio, (v) => (state.options.aspectRatio = v)))
    );
  }
  if (c.resolutions?.length) {
    box.appendChild(
      optionRow('Resolution', segmented(c.resolutions, state.options.resolution, (v) => (state.options.resolution = v)))
    );
  }
  if (c.durations?.length) {
    box.appendChild(
      optionRow('Duration', segmented(c.durations, state.options.duration, (v) => (state.options.duration = v), (v) => `${v}s`))
    );
  }
  if (c.outputFormats?.length) {
    box.appendChild(
      optionRow('Format', segmented(c.outputFormats, state.options.outputFormat, (v) => (state.options.outputFormat = v), (v) => v.toUpperCase()))
    );
  }
  if (c.audioToggle) {
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.innerHTML = `<input type="checkbox" ${state.options.generateAudio ? 'checked' : ''}/><span class="track"><span class="knob"></span></span>`;
    $('input', sw).addEventListener('change', (e) => (state.options.generateAudio = e.target.checked));
    box.appendChild(optionRow('Generate audio', sw));
  }
}

/* ---------------------------------------------------------- reference imgs - */
function renderRefBlock() {
  const m = currentModel();
  const block = $('#refBlock');
  const caps = m?.caps?.referenceImages;
  if (!caps) {
    block.classList.add('hidden');
    state.refs = [];
    renderThumbs();
    return;
  }
  block.classList.remove('hidden');
  $('#refLabel').textContent = caps.label || 'Reference images';
  $('#refHint').textContent = caps.hint || `Up to ${caps.max} images.`;
  renderThumbs();
}

function renderThumbs() {
  const box = $('#thumbs');
  box.innerHTML = '';
  state.refs.forEach((ref, i) => {
    const t = document.createElement('div');
    t.className = 'thumb' + (ref.uploading ? ' uploading' : '');
    t.innerHTML = `<img src="${ref.dataUrl}" alt=""/><button class="rm" title="Remove">×</button>`;
    $('.rm', t).addEventListener('click', () => {
      state.refs.splice(i, 1);
      renderThumbs();
    });
    box.appendChild(t);
  });
}

async function addFiles(files) {
  const m = currentModel();
  const max = m?.caps?.referenceImages?.max || 0;
  if (!max) return;
  for (const file of files) {
    if (state.refs.length >= max) break;
    if (!file.type.startsWith('image/')) continue;
    const dataUrl = await fileToDataUrl(file);
    const ref = { dataUrl, url: null, uploading: true };
    state.refs.push(ref);
    renderThumbs();
    try {
      const { urls } = await api('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: [dataUrl] }),
      });
      ref.url = urls[0];
      ref.uploading = false;
    } catch (e) {
      ref.uploading = false;
      ref.failed = true;
      showError(`Upload failed: ${e.message}`);
    }
    renderThumbs();
  }
}

/* ------------------------------------------------------------- generation - */
function showError(msg) {
  const el = $('#errorLine');
  if (!msg) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setStage(mode) {
  $('#stageEmpty').classList.toggle('hidden', mode !== 'empty');
  $('#stageLoading').classList.toggle('hidden', mode !== 'loading');
  $('#stageResult').classList.toggle('hidden', mode !== 'result');
}

async function generate() {
  showError('');
  const m = currentModel();
  if (!m) return;
  const prompt = $('#prompt').value.trim();
  if (!prompt) {
    showError('Please enter a prompt.');
    return;
  }
  if (state.refs.some((r) => r.uploading)) {
    showError('Reference images are still uploading — hold on a moment.');
    return;
  }

  const btn = $('#generateBtn');
  btn.disabled = true;
  $('#generateLabel').textContent = 'Generating…';
  setStage('loading');
  $('#loadingText').textContent = 'Submitting to KIE.AI…';
  setProgress(6);

  const referenceImageUrls = state.refs.filter((r) => r.url).map((r) => r.url);

  try {
    const payload = {
      modelId: m.id,
      prompt,
      referenceImageUrls,
      ...state.options,
    };
    const { taskId, endpoint, kind } = await api('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await pollTask(taskId, endpoint, kind, m, prompt);
  } catch (e) {
    showError(e.message);
    setStage('empty');
  } finally {
    btn.disabled = false;
    $('#generateLabel').textContent = 'Generate';
  }
}

let fakeProgress = 0;
function setProgress(p) {
  fakeProgress = p;
  $('#progressFill').style.width = `${Math.min(p, 100)}%`;
}

function pollTask(taskId, endpoint, kind, model, prompt) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      try {
        const r = await api(`/api/task?taskId=${encodeURIComponent(taskId)}&endpoint=${endpoint}`);
        const elapsed = (Date.now() - start) / 1000;
        $('#loadingText').textContent = `Generating${kind === 'video' ? ' video' : ''}… ${Math.round(elapsed)}s`;

        if (typeof r.progress === 'number' && r.progress > 0) {
          setProgress(Math.max(fakeProgress, r.progress));
        } else if (fakeProgress < 92) {
          setProgress(fakeProgress + (kind === 'video' ? 2 : 5));
        }

        if (r.state === 'success') {
          setProgress(100);
          const url = r.resultUrls?.[0];
          if (!url) return reject(new Error('Completed but no result URL returned.'));
          renderResult(url, kind, model, prompt);
          refreshCredits();
          return resolve();
        }
        if (r.state === 'fail') {
          return reject(new Error(r.error || 'Generation failed.'));
        }
        if (elapsed > 900) return reject(new Error('Timed out after 15 minutes.'));
        setTimeout(tick, 3000);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

function renderResult(url, kind, model, prompt) {
  const box = $('#stageResult');
  box.innerHTML = '';
  const media =
    kind === 'video'
      ? Object.assign(document.createElement('video'), { src: url, controls: true, autoplay: true, loop: true, muted: false, playsInline: true })
      : Object.assign(document.createElement('img'), { src: url, alt: prompt });
  box.appendChild(media);

  const actions = document.createElement('div');
  actions.className = 'result-actions';
  const dl = document.createElement('a');
  dl.className = 'pill-btn primary';
  dl.href = url;
  dl.target = '_blank';
  dl.rel = 'noopener';
  dl.textContent = 'Download';
  dl.setAttribute('download', '');
  const again = document.createElement('button');
  again.className = 'pill-btn';
  again.textContent = 'New';
  again.addEventListener('click', () => setStage('empty'));
  actions.append(dl, again);
  const pub = publishButton(url, kind);
  if (pub) actions.appendChild(pub);
  box.appendChild(actions);

  setStage('result');
  saveGalleryItem({ id: Date.now(), kind, modelLabel: model.label, prompt, url, ts: Date.now() });
}

/* ------------------------------------------------------------- gallery ---- */
function renderGallery() {
  const grid = $('#galleryGrid');
  const empty = $('#galleryEmpty');
  const list = loadGallery();
  grid.innerHTML = '';
  if (!list.length) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  grid.classList.remove('hidden');
  empty.classList.add('hidden');
  list.forEach((it) => {
    const card = document.createElement('div');
    card.className = 'g-card';
    const media =
      it.kind === 'video'
        ? `<video class="g-media" src="${it.url}" muted loop onmouseover="this.play()" onmouseout="this.pause()"></video>`
        : `<img class="g-media" src="${it.url}" alt=""/>`;
    card.innerHTML = `${media}<div class="g-meta"><div class="g-model">${it.modelLabel}</div><div class="g-prompt">${it.prompt}</div></div>`;
    card.addEventListener('click', () => window.open(it.url, '_blank'));
    grid.appendChild(card);
  });
}

/* ----------------------------------------------------------------- spy ---- */
function fmtDate(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return s;
  }
}

async function runSpy() {
  if (!state.hasMetaToken) return;
  const q = $('#spyQuery').value.trim();
  if (!q) return;
  const status = $('#spyStatus');
  const grid = $('#spyGrid');
  status.textContent = `Searching the Meta Ad Library for “${q}”…`;
  grid.innerHTML = '';
  $('#spyGo').disabled = true;
  try {
    const params = new URLSearchParams({
      q,
      countries: $('#spyCountries').value.trim() || 'US',
      mediaType: $('#spyMedia').value,
      sortBy: $('#spySort').value,
      activeOnly: $('#spyActive').checked ? 'true' : 'false',
      limit: '12',
    });
    const { ads } = await api('/api/spy?' + params.toString());
    status.textContent = ads.length ? `Found ${ads.length} ad(s).` : 'No ads found. Try another brand, country, or “Upload an ad to clone”.';
    renderAds(ads);
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
  } finally {
    $('#spyGo').disabled = false;
  }
}

function renderAds(ads) {
  const grid = $('#spyGrid');
  grid.innerHTML = '';
  ads.forEach((ad) => {
    const card = document.createElement('div');
    card.className = 'ad-card';
    const media = ad.preview
      ? `<img class="ad-media" src="${ad.preview}" alt="" loading="lazy" onerror="this.classList.add('placeholder');this.replaceWith(Object.assign(document.createElement('div'),{className:'ad-media placeholder',textContent:'Preview unavailable — open snapshot'}))"/>`
      : `<div class="ad-media placeholder">Preview unavailable — open snapshot to view</div>`;
    const plats = (ad.platforms || []).map((p) => `<span class="ad-plat">${p}</span>`).join('');
    const dates = `${fmtDate(ad.startTime)}${ad.stopTime ? ' – ' + fmtDate(ad.stopTime) : ' – active'}`;
    card.innerHTML = `
      ${media}
      <div class="ad-meta">
        <div class="ad-page">${ad.pageName || 'Unknown page'}</div>
        <div class="ad-dates">${dates}</div>
        <div class="ad-plats">${plats}</div>
        ${ad.body ? `<div class="ad-body">${ad.body}</div>` : ''}
        <div class="ad-actions">
          <a class="pill-btn" href="${ad.snapshotUrl}" target="_blank" rel="noopener">View</a>
          <button class="pill-btn primary clone-this">Clone</button>
        </div>
      </div>`;
    $('.clone-this', card).addEventListener('click', () => {
      const imgUrl = ad.preview || ad.images?.[0];
      if (!imgUrl) {
        alert('No downloadable creative was found for this ad. Open the snapshot, screenshot it, then use “Upload an ad to clone”.');
        return;
      }
      openCloneSheet({ referenceImageUrl: imgUrl, previewSrc: imgUrl, meta: `${ad.pageName} · ${dates}` });
    });
    grid.appendChild(card);
  });
}

/* ---------------------------------------------------------------- clone ---- */
let cloneCtx = null;

function openCloneSheet(ctx) {
  cloneCtx = ctx;
  $('#cloneRefImg').src = ctx.previewSrc;
  $('#cloneRefMeta').textContent = ctx.meta || 'Reference creative';
  $('#cloneError').classList.add('hidden');
  $('#cloneResult').classList.add('hidden');
  $('#cloneResult').innerHTML = '';
  // default to image output
  $$('#cloneKind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === 'image'));
  populateCloneModels('image');
  $('#cloneBackdrop').classList.remove('hidden');
}

function closeCloneSheet() {
  $('#cloneBackdrop').classList.add('hidden');
  cloneCtx = null;
}

function populateCloneModels(kind) {
  const sel = $('#cloneModel');
  sel.innerHTML = '';
  state.models
    .filter((m) => m.kind === kind && m.caps.referenceImages)
    .forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.label} · ${m.provider}`;
      sel.appendChild(opt);
    });
}

async function runClone() {
  if (!cloneCtx) return;
  const product = $('#cloneProduct').value.trim();
  const err = $('#cloneError');
  if (!product) {
    err.textContent = 'Describe your product first.';
    err.classList.remove('hidden');
    return;
  }
  err.classList.add('hidden');
  const kind = $('#cloneKind button.active').dataset.kind;
  const modelId = $('#cloneModel').value;
  const btn = $('#cloneGo');
  btn.disabled = true;
  $('#cloneGoLabel').textContent = 'Cloning…';
  const resultBox = $('#cloneResult');
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = `<div class="clone-loading"><div class="spinner"></div><p>Recreating the ad for your product…</p></div>`;

  try {
    const payload = { kind, modelId, product, brand: $('#cloneBrand').value.trim() };
    if (cloneCtx.referenceImageDataUrl) payload.referenceImageDataUrl = cloneCtx.referenceImageDataUrl;
    else payload.referenceImageUrl = cloneCtx.referenceImageUrl;

    const { taskId, endpoint } = await api('/api/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const model = state.models.find((m) => m.id === modelId);
    const url = await pollClone(taskId, endpoint, kind);
    renderCloneResult(url, kind, model, product);
    refreshCredits();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
    resultBox.classList.add('hidden');
  } finally {
    btn.disabled = false;
    $('#cloneGoLabel').textContent = 'Generate clone';
  }
}

function pollClone(taskId, endpoint, kind) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = async () => {
      try {
        const r = await api(`/api/task?taskId=${encodeURIComponent(taskId)}&endpoint=${endpoint}`);
        const elapsed = (Date.now() - start) / 1000;
        const load = $('.clone-loading p', $('#cloneResult'));
        if (load) load.textContent = `Recreating the ad… ${Math.round(elapsed)}s`;
        if (r.state === 'success') {
          const url = r.resultUrls?.[0];
          if (!url) return reject(new Error('Completed but no result URL.'));
          return resolve(url);
        }
        if (r.state === 'fail') return reject(new Error(r.error || 'Generation failed.'));
        if (elapsed > 900) return reject(new Error('Timed out.'));
        setTimeout(tick, 3000);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

function renderCloneResult(url, kind, model, prompt) {
  const box = $('#cloneResult');
  box.innerHTML = '';
  const media =
    kind === 'video'
      ? Object.assign(document.createElement('video'), { src: url, controls: true, autoplay: true, loop: true, playsInline: true })
      : Object.assign(document.createElement('img'), { src: url, alt: prompt });
  const actions = document.createElement('div');
  actions.className = 'result-actions';
  actions.style.marginTop = '14px';
  const dl = document.createElement('a');
  dl.className = 'pill-btn primary';
  dl.href = url;
  dl.target = '_blank';
  dl.rel = 'noopener';
  dl.textContent = 'Download';
  actions.appendChild(dl);
  const pub = publishButton(url, kind);
  if (pub) actions.appendChild(pub);
  box.append(media, actions);
  saveGalleryItem({ id: Date.now(), kind, modelLabel: `Clone · ${model?.label || ''}`, prompt, url, ts: Date.now() });
}

async function handleAdUpload(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const dataUrl = await fileToDataUrl(file);
  openCloneSheet({ referenceImageDataUrl: dataUrl, previewSrc: dataUrl, meta: 'Uploaded ad · ' + file.name });
}

/* ------------------------------------------------------- meta test/publish - */
async function testMeta() {
  const note = $('#spyNote');
  note.textContent = 'Testing Meta connection…';
  try {
    const r = await api('/api/meta/test');
    note.textContent = r.ok ? `✅ Meta connected (${r.scope}${r.who ? ' · ' + r.who : ''}).` : `❌ Meta error: ${r.error}`;
  } catch (e) {
    note.textContent = '❌ ' + e.message;
  }
}

let pubCtx = null;
function openPublishSheet(mediaUrl, kind) {
  pubCtx = { mediaUrl, kind };
  const box = $('#pubPreview');
  box.innerHTML =
    kind === 'video'
      ? `<video src="${mediaUrl}" muted loop autoplay playsinline></video>`
      : `<img src="${mediaUrl}" alt="creative"/>`;
  $('#pubError').classList.add('hidden');
  $('#pubSuccess').classList.add('hidden');
  $('#pubGoLabel').textContent = 'Publish (paused)';
  $('#pubGo').disabled = false;
  $('#pubBackdrop').classList.remove('hidden');
}
function closePublishSheet() {
  $('#pubBackdrop').classList.add('hidden');
  pubCtx = null;
}

async function runPublish() {
  if (!pubCtx) return;
  const err = $('#pubError');
  const ok = $('#pubSuccess');
  err.classList.add('hidden');
  ok.classList.add('hidden');
  const link = $('#pubLink').value.trim();
  if (!link) {
    err.textContent = 'A destination URL is required.';
    err.classList.remove('hidden');
    return;
  }
  const btn = $('#pubGo');
  btn.disabled = true;
  $('#pubGoLabel').textContent = pubCtx.kind === 'video' ? 'Uploading video to Meta…' : 'Publishing…';
  try {
    const r = await api('/api/meta/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaUrl: pubCtx.mediaUrl,
        kind: pubCtx.kind,
        link,
        message: $('#pubMessage').value.trim(),
        headline: $('#pubHeadline').value.trim(),
        cta: $('#pubCta').value,
        adsetId: $('#pubAdset').value.trim(),
      }),
    });
    const mgr = 'https://adsmanager.facebook.com/adsmanager/manage/ads';
    ok.innerHTML =
      r.type === 'ad'
        ? `✅ Created <strong>PAUSED ad</strong> <code>${r.id}</code> in ad set <code>${r.adsetId}</code>.<br/>Review &amp; launch it in <a href="${mgr}" target="_blank" rel="noopener">Ads Manager</a>.`
        : `✅ Created a reusable <strong>ad creative</strong> <code>${r.id}</code>.<br/>${r.note} Open <a href="${mgr}" target="_blank" rel="noopener">Ads Manager</a>.`;
    ok.classList.remove('hidden');
    $('#pubGoLabel').textContent = 'Published ✓';
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    $('#pubGoLabel').textContent = 'Publish (paused)';
  }
}

function publishButton(mediaUrl, kind) {
  if (!state.canPublish) return null;
  const b = document.createElement('button');
  b.className = 'pill-btn meta';
  b.textContent = 'Publish to Meta';
  b.addEventListener('click', () => openPublishSheet(mediaUrl, kind));
  return b;
}

/* ------------------------------------------------------------- navigation - */
function setView(view) {
  state.view = view;
  $$('.sidenav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  const compose = $('#view-compose');
  const gallery = $('#view-gallery');
  const spy = $('#view-spy');
  [compose, gallery, spy].forEach((el) => el.classList.add('hidden'));

  if (view === 'gallery') {
    gallery.classList.remove('hidden');
    renderGallery();
    return;
  }
  if (view === 'spy') {
    spy.classList.remove('hidden');
    const note = $('#spyNote');
    note.textContent = state.hasMetaToken
      ? 'Tip: sort by “Longest running” to find their proven winners. Cloning uses only layout & style — never their logos/trademarks.'
      : 'Competitor search is disabled (no META_ACCESS_TOKEN). You can still “Upload an ad to clone” to clone any screenshot with AI.';
    $('#spyGo').disabled = !state.hasMetaToken;
    $('#spyQuery').disabled = !state.hasMetaToken;
    return;
  }
  compose.classList.remove('hidden');
  state.kind = view; // 'video' | 'image'
  $('#composeTitle').textContent = view === 'video' ? 'Create Video' : 'Create Image';
  $('#composeSub').textContent =
    view === 'video'
      ? 'Pick a model, describe your creative, and generate.'
      : 'Generate on-brand still creatives and reference frames.';
  state.refs = [];
  renderModelGrid();
  setStage('empty');
  showError('');
}

/* ------------------------------------------------------------- wire-up ---- */
function wireEvents() {
  $$('.sidenav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#generateBtn').addEventListener('click', generate);

  const dz = $('#dropzone');
  const fi = $('#fileInput');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', (e) => {
    addFiles([...e.target.files]);
    fi.value = '';
  });
  ['dragover', 'dragenter'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  dz.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

  // Spy
  $('#spyGo').addEventListener('click', runSpy);
  $('#spyQuery').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runSpy();
  });
  $('#metaTestBtn').addEventListener('click', testMeta);
  $('#spyUploadBtn').addEventListener('click', () => $('#spyUploadInput').click());
  $('#spyUploadInput').addEventListener('change', (e) => {
    if (e.target.files[0]) handleAdUpload(e.target.files[0]);
    e.target.value = '';
  });

  // Publish sheet
  $('#pubClose').addEventListener('click', closePublishSheet);
  $('#pubBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'pubBackdrop') closePublishSheet();
  });
  $('#pubGo').addEventListener('click', runPublish);

  // Clone sheet
  $('#cloneClose').addEventListener('click', closeCloneSheet);
  $('#cloneBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'cloneBackdrop') closeCloneSheet();
  });
  $('#cloneGo').addEventListener('click', runClone);
  $$('#cloneKind button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('#cloneKind button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      populateCloneModels(b.dataset.kind);
    })
  );
}

/* -------------------------------------------------------------- bootstrap - */
(async function init() {
  wireEvents();
  initConfig();
  try {
    await initModels();
  } catch (e) {
    showError('Could not load models: ' + e.message);
  }
  setView('video');
})();
