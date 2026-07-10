## This repo specifically

- **API:** Arcads external API (`https://external-api.arcads.ai`).
- **Auth:** HTTP Basic via `ARCADS_BASIC_AUTH` (pre-encoded `Basic ...` header) or `ARCADS_API_KEY` as the Basic password. Values in `.env` must be **single-quoted** due to special characters.
- **Skills:**
  - `arcads-external-api` — main API reference (endpoints, auth, polling, asset routing).
  - `generate-youtube-thumbnail` — YouTube thumbnail batch workflow on top of the Nano Banana 2 image endpoint.
  - **Image-ad ecosystem** (3 skills + shared 37-template library) — see [shared/skills/image-ad-prompting/OVERVIEW.md](shared/skills/image-ad-prompting/OVERVIEW.md):
    - `chatgpt-image-ad` — generate via Arcads `gpt-image-2` (typography / UI-mimicry creatives)
    - `nano-banana-image-ad` — generate via Arcads `nano-banana-2`/`-pro`/`-edit` (photoreal / lifestyle creatives)
    - `image-ad-clone` — single backend-agnostic skill that reverse-engineers existing ads into reusable templates (asks which backend to validate against at Phase 1; optionally cross-validates at Phase 8)
- **Setup check:** `./scripts/check-arcads-env.sh`.

## Cursor Cloud specific instructions

### KIE Studio web app (`web/`) — the primary runnable application

- **What it is:** an Express (Node, ESM) web UI in `web/` for AI video/image generation via the **KIE.AI** unified API (Veo, Sora, Seedance, Nano Banana), plus a Meta Ad Library "Spy"/clone/publish flow. See `web/README.md` for the full feature tour.
- **Run it (dev):** `npm --prefix web run dev` (uses `node --watch`) or `npm --prefix web start`. Listens on `PORT` (default **4321**) → `http://localhost:4321`.
- **Credentials:** real generation needs `KIE_API_KEY` in `web/.env` (copy from `web/.env.example`). The server **boots and serves the UI without a key**, but `/api/generate`, `/api/credits`, and uploads call the live KIE.AI API and return `Unauthorized` until a valid key is set. **Gotcha:** the startup banner / `/api/config` `hasKey` is truthy for *any* non-empty value (including the `your_kie_api_key_here` placeholder) — it does not validate the key, so "key loaded ✓" does not mean the key works.
- **Chromium/Playwright:** `npm install` in `web/` runs a `postinstall` that auto-downloads Chromium (for the Spy "deep scrape" headless mode). It is best-effort and never fails the install; skip it with `KIE_SKIP_BROWSER=1 npm install` and re-add later via `npm --prefix web run setup:headless`.
- **Meta features are optional:** `META_ACCESS_TOKEN` (+ account/page IDs) enable competitor search and publish-to-Meta. Without them the UI degrades gracefully (shows a disabled-search notice; "upload an ad to clone" still works).

### Arcads skill pack (repo root) — the other, script-based product

- A skill pack of Python (stdlib-only) + bash scripts calling the **Arcads external API**. No server/build/test/lint infra — "running" it means invoking a generator script (e.g. `python3 skills/chatgpt-image-ad/scripts/generate_image.py --prompt ... --aspect-ratio 1:1`).
- Needs `ARCADS_BASIC_AUTH`/`ARCADS_API_KEY` in a root `.env` **file** (`load_env()` errors if `.env` is absent). Create via `./scripts/setup.sh` (interactive — pipe `printf '\n'` to skip the key prompt in automation) or `cp .env.example .env`. Connectivity check: `./scripts/check-arcads-env.sh`.
- Optional per-workflow deps: `meta-ad-builder` needs `requests`+`python-dotenv` (installed by the update script); `caption-video` needs `openai-whisper`+`npx hyperframes`; Pixar/claymation need `ffmpeg`+`jq` (already on the base image).
