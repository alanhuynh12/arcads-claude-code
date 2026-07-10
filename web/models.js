// KIE.AI model catalog.
//
// Each entry describes a model the studio can drive, the capabilities the UI
// should expose, and a `build()` mapper that turns the studio's normalized
// request into the exact JSON body KIE expects for that model.
//
// Two KIE surfaces are used:
//   - "veo"  -> POST /api/v1/veo/generate     (poll GET /api/v1/veo/record-info)
//   - "jobs" -> POST /api/v1/jobs/createTask  (poll GET /api/v1/jobs/recordInfo)
//
// Docs: https://docs.kie.ai/

const clampDuration = (value, allowed, fallback) => {
  const n = Number(value);
  if (allowed.includes(n)) return n;
  return fallback;
};

export const MODELS = [
  // ---------------------------------------------------------------- VIDEO ---
  {
    id: 'veo3',
    label: 'Veo 3.1 Quality',
    provider: 'Google',
    kind: 'video',
    endpoint: 'veo',
    tagline: 'Flagship cinematic video with native audio.',
    caps: {
      aspectRatios: ['16:9', '9:16', 'Auto'],
      resolutions: ['720p', '1080p', '4k'],
      durations: [4, 6, 8],
      referenceImages: { max: 2, label: 'Start / end frame', hint: '1 image = first frame · 2 images = first + last frame' },
      audioToggle: false,
    },
    build(req) {
      const body = {
        model: 'veo3',
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '16:9',
        resolution: req.resolution || '1080p',
        duration: clampDuration(req.duration, [4, 6, 8], 8),
      };
      if (req.referenceImageUrls?.length) body.imageUrls = req.referenceImageUrls.slice(0, 2);
      return body;
    },
  },
  {
    id: 'veo3_fast',
    label: 'Veo 3.1 Fast',
    provider: 'Google',
    kind: 'video',
    endpoint: 'veo',
    tagline: 'Cost-efficient Veo — great for volume iteration.',
    caps: {
      aspectRatios: ['16:9', '9:16', 'Auto'],
      resolutions: ['720p', '1080p'],
      durations: [4, 6, 8],
      referenceImages: { max: 2, label: 'Start / end frame', hint: '1 image = first frame · 2 images = first + last frame' },
      audioToggle: false,
    },
    build(req) {
      const body = {
        model: 'veo3_fast',
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '16:9',
        resolution: req.resolution || '720p',
        duration: clampDuration(req.duration, [4, 6, 8], 8),
      };
      if (req.referenceImageUrls?.length) body.imageUrls = req.referenceImageUrls.slice(0, 2);
      return body;
    },
  },
  {
    id: 'seedance-2',
    label: 'Seedance 2.0',
    provider: 'ByteDance',
    kind: 'video',
    endpoint: 'jobs',
    kieModel: 'bytedance/seedance-2',
    tagline: 'Multimodal UGC video with native speech & audio.',
    caps: {
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['480p', '720p', '1080p'],
      durations: [4, 5, 6, 8, 10, 12, 15],
      referenceImages: { max: 3, label: 'Reference images', hint: 'Image-to-video subject / style guidance (up to 3)' },
      audioToggle: true,
    },
    build(req) {
      const input = {
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '16:9',
        resolution: req.resolution || '720p',
        duration: clampDuration(req.duration, [4, 5, 6, 8, 10, 12, 15], 8),
        generate_audio: req.generateAudio !== false,
      };
      if (req.referenceImageUrls?.length) input.reference_image_urls = req.referenceImageUrls.slice(0, 3);
      return { model: 'bytedance/seedance-2', input };
    },
  },
  {
    id: 'seedance-2-fast',
    label: 'Seedance 2.0 Fast',
    provider: 'ByteDance',
    kind: 'video',
    endpoint: 'jobs',
    kieModel: 'bytedance/seedance-2-fast',
    tagline: 'Faster Seedance for quick creative passes.',
    caps: {
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      resolutions: ['480p', '720p'],
      durations: [4, 5, 6, 8, 10, 12, 15],
      referenceImages: { max: 3, label: 'Reference images', hint: 'Image-to-video subject / style guidance (up to 3)' },
      audioToggle: true,
    },
    build(req) {
      const input = {
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '16:9',
        resolution: req.resolution || '720p',
        duration: clampDuration(req.duration, [4, 5, 6, 8, 10, 12, 15], 8),
        generate_audio: req.generateAudio !== false,
      };
      if (req.referenceImageUrls?.length) input.reference_image_urls = req.referenceImageUrls.slice(0, 3);
      return { model: 'bytedance/seedance-2-fast', input };
    },
  },
  {
    id: 'sora-2',
    label: 'Sora 2',
    provider: 'OpenAI',
    kind: 'video',
    endpoint: 'jobs',
    kieModel: 'sora-2-text-to-video',
    tagline: 'Coherent text-to-video with synced ambient audio.',
    caps: {
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p'],
      durations: [5, 10, 15, 20],
      referenceImages: null,
      audioToggle: false,
    },
    build(req) {
      return {
        model: 'sora-2-text-to-video',
        input: {
          prompt: req.prompt,
          aspect_ratio: req.aspectRatio || '16:9',
          duration: String(clampDuration(req.duration, [5, 10, 15, 20], 10)),
        },
      };
    },
  },
  {
    id: 'sora-2-pro',
    label: 'Sora 2 Pro',
    provider: 'OpenAI',
    kind: 'video',
    endpoint: 'jobs',
    kieModel: 'sora-2-pro-text-to-video',
    tagline: 'Premium Sora quality, up to 1080p.',
    caps: {
      aspectRatios: ['16:9', '9:16'],
      resolutions: ['720p', '1080p'],
      durations: [5, 10, 15, 20],
      referenceImages: null,
      audioToggle: false,
    },
    build(req) {
      return {
        model: 'sora-2-pro-text-to-video',
        input: {
          prompt: req.prompt,
          aspect_ratio: req.aspectRatio || '16:9',
          resolution: req.resolution || '1080p',
          duration: String(clampDuration(req.duration, [5, 10, 15, 20], 10)),
        },
      };
    },
  },

  // ---------------------------------------------------------------- IMAGE ---
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    provider: 'Google',
    kind: 'image',
    endpoint: 'jobs',
    kieModel: 'nano-banana-2',
    tagline: 'Default still model — crisp, on-brand image ads.',
    caps: {
      aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto'],
      resolutions: [],
      durations: [],
      referenceImages: { max: 8, label: 'Reference images', hint: 'Add up to 8 refs to guide subject / style' },
      audioToggle: false,
      outputFormats: ['png', 'jpg'],
    },
    build(req) {
      const input = {
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '1:1',
        output_format: req.outputFormat || 'png',
      };
      if (req.referenceImageUrls?.length) input.image_input = req.referenceImageUrls.slice(0, 8);
      return { model: 'nano-banana-2', input };
    },
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    provider: 'Google',
    kind: 'image',
    endpoint: 'jobs',
    kieModel: 'nano-banana-pro',
    tagline: 'Gemini 3 Pro Image — 4K & tight character consistency.',
    caps: {
      aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto'],
      resolutions: ['1K', '2K', '4K'],
      durations: [],
      referenceImages: { max: 8, label: 'Reference images', hint: 'Add up to 8 refs to lock identity / style' },
      audioToggle: false,
      outputFormats: ['png', 'jpg'],
    },
    build(req) {
      const input = {
        prompt: req.prompt,
        aspect_ratio: req.aspectRatio || '1:1',
        resolution: req.resolution || '1K',
        output_format: req.outputFormat || 'png',
      };
      if (req.referenceImageUrls?.length) input.image_input = req.referenceImageUrls.slice(0, 8);
      return { model: 'nano-banana-pro', input };
    },
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana',
    provider: 'Google',
    kind: 'image',
    endpoint: 'jobs',
    kieModel: 'google/nano-banana',
    tagline: 'Original Nano Banana — fast generate & edit.',
    caps: {
      aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', 'auto'],
      resolutions: [],
      durations: [],
      referenceImages: { max: 8, label: 'Reference images', hint: 'Provide refs to edit / transform them' },
      audioToggle: false,
      outputFormats: ['png', 'jpg'],
    },
    build(req) {
      const input = {
        prompt: req.prompt,
        output_format: req.outputFormat || 'png',
        image_size: req.aspectRatio || '1:1',
      };
      if (req.referenceImageUrls?.length) input.image_input = req.referenceImageUrls.slice(0, 8);
      return { model: 'google/nano-banana', input };
    },
  },
];

export function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

// Public-safe catalog (no builders) for the frontend to render controls from.
export function publicCatalog() {
  return MODELS.map(({ build, kieModel, ...rest }) => rest);
}
