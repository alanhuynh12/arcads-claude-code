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

/* ------------------------------------------------------------- navigation - */
function setView(view) {
  state.view = view;
  $$('.sidenav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

  const compose = $('#view-compose');
  const gallery = $('#view-gallery');
  if (view === 'gallery') {
    compose.classList.add('hidden');
    gallery.classList.remove('hidden');
    renderGallery();
    return;
  }
  gallery.classList.add('hidden');
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
