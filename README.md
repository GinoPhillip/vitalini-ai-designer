# Vitalini AI Designer

A renewed version of the original Sketchfab jacket designer. It serves the responsive frontend and API from one Cloudflare Worker, generates UV textures with OpenAI's `gpt-image-2.5-sunburst`, projects them onto the correct Sketchfab material, and stores customer history in Cloudflare D1 + R2. Generation stays at medium quality and 1536×1536 with the original UV-preserving prompt. The previous GPT Image 2 per-image estimate does not guarantee GPT Image 2.5 costs; actual usage determines billing.

The frontend also deploys from `public/` to GitHub Pages. The Worker provides invite-only client accounts, private design/logo/request files, a 20-generation daily account limit, and the administrator workflow at `public/admin.html`.

## Custom Studio interface

The client studio uses a four-step workspace: Design, Details, Logos, and Review. The jacket stays visible beside the active tool, with a focus-view toggle and the existing saved-design navigation. Review shows the current composite and chosen trim colors; those color choices are included in the internal design request and displayed in admin. Logo placement supports pointer dragging, individual resizing/removal, and arrow-key movement (Shift for larger steps).

The background uses the supplied halftone Vitalini artwork in `public/assets/vitalini-halftone-bg.png`, rendered responsively by `public/terrain.js`. The client interface includes a persistent English/Italian language selector; user-authored text is never translated.

Each account has a reusable logo library. Placement, size, rotation, trim colors, and draft text are saved separately for each design (including each model's blank base). The last design reopens after signing in. Authenticated workspace endpoints persist edits in D1; a per-account local cache preserves pending edits when offline. The editor uses drag-to-move and size/rotation sliders, with removal buttons below the canvas rather than floating canvas controls.

For isolated interface testing, run `npm run preview:ui` and open `http://127.0.0.1:4173`. Any nonempty sign-in values enter the fixture workspace. This local server uses placeholder designs and simulates generation, uploads, and requests without contacting production or OpenAI. It is outside `public/` and is never deployed. To test the real backend, use the regular Wrangler development workflow instead.

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

Store a separate administrator password as an encrypted Worker secret:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

If a separate frontend origin will call this Worker, add it to the comma-separated `ALLOWED_ORIGINS` value; same-origin deployment needs no value.

Design requests stay entirely inside the portal. The submitted composite preview, client message, original generated texture, and full client profile are available only through the authenticated administrator dashboard.

Deploy:

```bash
npm run deploy
```

Afterward, attach the contractor's custom domain in Cloudflare Workers & Pages → the Worker → Settings → Domains & Routes. The API key remains server-side and is never sent to the browser.

## Production notes

- Native Cloudflare rate limiting allows five generations per account/IP per minute, and D1 atomically enforces 20 generations per account per UTC day. Change the `namespace_id` if `1001` is already used by another limiter in the same Cloudflare account.
- D1 stores account/workflow metadata and prompts; R2 stores generated textures, uploaded logos, and request previews privately.
- Passwords use salted PBKDF2-SHA-256 hashes. Invite codes and bearer sessions are stored only as hashes.
- Private file routes require either the owning client session or the administrator session; client texture download is disabled.
- Administrators can generate single- or multi-use account codes, open focused design requests with the exact preview/message and full client profile, suspend or delete accounts, mark designs Draft/Executive, and move requests through review/finalized states.
- Run `npm test` before deployment.
