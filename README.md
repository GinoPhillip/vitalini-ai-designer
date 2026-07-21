# Vitalini AI Designer

A renewed version of the original Sketchfab jacket designer. It serves the responsive frontend and API from one Cloudflare Worker, generates UV textures with OpenAI's `gpt-image-2`, projects them onto the correct Sketchfab material, and stores customer history in Cloudflare D1 + R2.

The frontend also deploys from `public/` to GitHub Pages. Until the Cloudflare Worker is deployed, the public site supports the 3D viewer, model switching, and live material colors; AI generation and server history require the Worker URL in `public/config.js`.

## Included model mappings

| Model | Sketchfab UID | AI texture material | Editable trim |
| --- | --- | --- | --- |
| VP9655 | `81627c97044d48c48acf09dc4dd81aae` | `Giacca1_FRONT_2563` | Contrast, zipper |
| VP9109 | `58f6159cf20a482eb3c1cbdc319dbce4` | `Copri_Zip_FRONT_2569` | Contrast, zipper |

Add future models in both `public/app.js` (viewer/material mapping) and `src/index.js` (trusted UV template allowlist). Keeping the backend allowlist prevents callers from turning the Worker into an arbitrary image-edit proxy.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local secrets file named `.dev.vars`:

   ```text
   OPENAI_API_KEY=your_key_here
   ```

   `.dev.vars` is ignored by Git. Never put the key in `public/app.js`, HTML, Wrangler vars, or any browser-visible file.

3. Create the local D1 schema and start Wrangler:

   ```bash
   npm run db:migrate:local
   npm run dev
   ```

The 3D models require internet access because Sketchfab hosts the viewer and model data.

## Cloudflare provisioning and deployment

Authenticate Wrangler once:

```bash
npx wrangler login
```

Create the database and copy the returned UUID into `wrangler.jsonc` as `database_id`:

```bash
npx wrangler d1 create vitalini-designer-db
```

Create the private R2 bucket:

```bash
npx wrangler r2 bucket create vitalini-designer-images
```

Apply the production migration:

```bash
npm run db:migrate:remote
```

Store the provider key as an encrypted Worker secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Optionally change `IMAGE_QUALITY` to `low` for cheaper drafts or `high` for final output. If a separate frontend origin will call this Worker, add it to the comma-separated `ALLOWED_ORIGINS` value; same-origin deployment needs no value.

Deploy:

```bash
npm run deploy
```

Afterward, attach the contractor's custom domain in Cloudflare Workers & Pages → the Worker → Settings → Domains & Routes. The API key remains server-side and is never sent to the browser.

## Production notes

- Native Cloudflare rate limiting allows five generations per designer ID per minute. Change the `namespace_id` if `1001` is already used by another limiter in the same Cloudflare account.
- D1 stores only metadata and prompts; R2 stores PNG texture files privately.
- Generated image routes verify the browser's private designer ID before returning a file.
- The browser keeps that random ID in `localStorage`. For authenticated customer accounts, replace it with a signed server session or Cloudflare Access identity.
- Run `npm test` before deployment.
