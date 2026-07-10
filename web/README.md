# KIE Studio

An Apple-OS–inspired web UI for generating AI **video** and **image** creatives
through the [KIE.AI](https://kie.ai) unified API — built on top of this repo's
creative workflows (Veo, Sora, Seedance, Nano Banana).

It looks and feels like macOS: a frosted-glass window, traffic-light controls,
a menu bar, segmented controls, iOS-style toggles, and system light/dark mode.

![KIE Studio](https://img.shields.io/badge/design-Apple%20OS%20style-0A84FF)

## What it does

- **Create Video** — Veo 3.1 Quality / Fast, Seedance 2.0 / Fast, Sora 2 / Pro
- **Create Image** — Nano Banana 2, Nano Banana Pro, Nano Banana
- **Competitor Spy** — pull a brand's live ads from the **Meta Ad Library** and
  **clone the winners** with AI (see below)
- **Reference images** — drag-and-drop image-to-video / image-to-image refs
- **Per-model controls** — aspect ratio, resolution, duration, audio, format
  (the UI adapts automatically to what each model supports)
- **Live progress** — polls the task until the result is ready
- **Gallery** — every generation is saved locally in your browser

## Competitor Spy + Clone

The **Spy** tab is the competitor "database": type a brand name and it queries
the public **Meta Ad Library** for their running ads, extracts the creative, and
shows them in a grid (sort by *longest running* to find their proven winners).

Hit **Clone** on any ad (or **Upload an ad to clone** from a screenshot) and the
studio recreates it for *your* product:

- **Image ads** → the competitor creative is fed to Nano Banana as a reference,
  with a prompt that keeps the layout / composition / style but swaps in your
  product.
- **Video ads** → the creative seeds an image-to-video generation (Seedance /
  Veo) matching the reference's style and pacing.

> **Ethics/legal:** clone uses only *structure and style* — the prompt explicitly
> instructs the model **not** to reproduce the original brand's logos, names, or
> trademarked text. Use it for inspiration, not counterfeiting.

> **Coverage note:** the Meta Ad Library *API* covers issue/political ads
> everywhere and has the fullest commercial coverage for EU-targeted ads; for
> other regions it can return little. When search comes up empty, use **Upload an
> ad to clone** with a screenshot from the Ad Library website — that path needs
> no Meta token and always works.

For the deep, frame-by-frame video clone (transcription + beat mapping), the
repo's Python `clone-ad` skill still lives at
`skills/arcads-external-api/prompting/clone-ad/` (uses ffmpeg + whisper).

Your API key lives **only on the server** — it is never shipped to the browser.
The server proxies all calls to KIE.AI.

## Setup

1. **Get a KIE.AI key** at <https://kie.ai> (Dashboard → API Keys).

2. **Configure it** (copy the example and paste your key):

```bash
cd web
cp .env.example .env
# then edit web/.env and set KIE_API_KEY=...
```

3. **Install and run:**

```bash
npm install
npm start
```

4. Open <http://localhost:4321>.

> The server also reads `KIE_API_KEY` from the repo-root `.env` if you prefer to
> keep all keys in one place.

## How it maps to KIE.AI

| Studio surface | Upstream endpoint |
|---|---|
| Veo models | KIE `POST /api/v1/veo/generate` → poll `GET /api/v1/veo/record-info` |
| Seedance / Sora / Nano Banana | KIE `POST /api/v1/jobs/createTask` → poll `GET /api/v1/jobs/recordInfo` |
| Reference / clone image upload | KIE `POST /api/v1/file-base64-upload` · `file-url-upload` |
| Credits | KIE `GET /api/v1/chat/credit` |
| Competitor Spy | Meta `GET graph.facebook.com/{v}/ads_archive` + snapshot scrape |
| Clone | rehost creative → KIE generate with it as a reference image |

The model catalog lives in [`models.js`](models.js) — each entry declares its
capabilities (what controls to show) and a `build()` mapper that produces the
exact JSON body KIE expects. **Adding a new KIE model is just one entry.**

## Architecture

```
web/
├── server.js        # Express proxy — keeps keys server-side, normalizes responses
├── models.js        # KIE model catalog + request builders
├── meta.js          # Meta Ad Library search + creative extraction
├── public/
│   ├── index.html   # macOS-style window shell (Video / Image / Spy / Gallery)
│   ├── styles.css   # vibrancy / frosted glass, light + dark
│   └── app.js       # UI state, uploads, generation + polling, spy, clone, gallery
└── .env.example
```

## Notes

- KIE result URLs typically expire after ~24h, so download anything you want to
  keep. The gallery stores the URLs, not the files.
- Credit costs vary by model — check <https://kie.ai/pricing>. The credit counter
  in the menu bar reflects your live KIE balance.
- Model IDs and parameters follow the KIE docs at <https://docs.kie.ai>. If KIE
  renames a model, update the matching entry in `models.js`.
