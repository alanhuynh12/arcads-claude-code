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

**Filters** (server-side, sent to the Ad Library API): country, time range,
media type, platform (FB / IG / Messenger / Audience Network), language, sort
(top reach / longest running / most recent), ad type, and active-only.

**Re-rank / refine** (client-side, instant): min **days running**, re-rank by
days running / reach / impressions / newest, and "only ads with metrics".

Each ad card shows the metrics the API actually returns:

- **Days running** 🗓 — always available; the badge turns *hot* at 30+ days
  (long-running ads are usually profitable — this is your best winner signal).
- **Reach** 👁 — for EU-delivered ads (`eu_total_reach`).
- **Impressions** 📊 / **Spend** 💰 / **Audience size** 🎯 — only for
  **political / issue** ads (set the *Type* filter to unlock them).

> **Honest limitation:** the Meta Ad Library **API** does **not** expose per-ad
> **likes, comments, shares, or organic views** for commercial ads, and
> impressions/spend are returned **only** for political/issue ads (reach only for
> EU ads). That's a Meta restriction, not a bug. For commercial competitors,
> **days running** is the reliable "is this a winner?" signal, which is why it's
> shown on every card and is filterable/sortable.

### Deep scrape

Each ad card has a **Scrape** button that reads the ad's public snapshot page
and pulls out what the API leaves out — with **no browser required**:

- **Followers** 👥 (advertiser `page_like_count` — a brand-size signal)
- **Display format**, **CTA**, **destination link**, and full **caption**
- All **image + video** variants

Because per-ad engagement isn't in the snapshot for commercial ads, a
**headless mode** tries to read reaction/comment/share counts where an ad embeds
the organic post. **It's on by default and works out of the box** — `npm install`
automatically downloads Chromium (via a postinstall hook; as root it also pulls
the required system libraries with `--with-deps`).

- Disable the headless step: set `SPY_HEADLESS=false` in `web/.env`.
- Skip the browser download at install time: `KIE_SKIP_BROWSER=1 npm install`.
- Re-install the browser later: `npm run setup:headless`.

If Chromium isn't present, Scrape still returns all the static fields above plus
a one-line hint on how to enable the headless step — it never errors.

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

## Publish to Meta (paused)

Any generated or cloned creative has a **Publish to Meta** button. It:

1. Uploads the media to your ad account (`/adimages` for images, `/advideos` +
   processing wait for videos).
2. Builds an ad creative (`object_story_spec` with your page, link, copy, CTA).
3. If you enter an **Ad set ID**, creates a **PAUSED ad** in it. If you leave it
   blank, it creates a **reusable ad creative** you can attach in Ads Manager.

Every ad is created **PAUSED** — nothing spends until you launch it manually.

Enable it by adding to `web/.env` (needs the `ads_management` scope):

```bash
META_ACCESS_TOKEN=...      # also powers the Spy tab
META_AD_ACCOUNT_ID=act_...
META_PAGE_ID=...
META_IG_USER_ID=...        # optional
META_PIXEL_ID=...          # optional (adds conversion tracking)
```

The **Test connection** button in the Spy tab verifies your Meta token.

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
| Competitor Spy | Meta `GET graph.facebook.com/{v}/ads_archive` |
| Deep scrape | fetch `ad_snapshot_url` → parse embedded data (optional Playwright) |
| Clone | rehost creative → KIE generate with it as a reference image |
| Publish to Meta | Meta `/adimages` · `/advideos` → `/ads` (PAUSED) or `/adcreatives` |

The model catalog lives in [`models.js`](models.js) — each entry declares its
capabilities (what controls to show) and a `build()` mapper that produces the
exact JSON body KIE expects. **Adding a new KIE model is just one entry.**

## Architecture

```
web/
├── server.js        # Express proxy — keeps keys server-side, normalizes responses
├── models.js        # KIE model catalog + request builders
├── meta.js          # Meta Ad Library search / filters / metrics + publish
├── scraper.js       # Ad snapshot scraper (static fields + optional headless engagement)
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
