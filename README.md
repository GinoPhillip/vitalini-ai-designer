# Vitalini AI Designer

A renewed version of the original Sketchfab jacket designer. It serves the responsive frontend and API from one Cloudflare Worker, generates UV textures with OpenAI's `gpt-image-2`, projects them onto the correct Sketchfab material, and stores customer history in Cloudflare D1 + R2.

The frontend also deploys from `public/` to GitHub Pages. The Worker provides invite-only client accounts, private design/logo/request files, a 20-generation daily account limit, and the administrator workflow at `public/admin.html`.

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

### Direct request email

Every design request is stored in D1/R2 even when email delivery is unavailable. Without an email binding, the client is given a prefilled email to `REQUEST_EMAIL` as a fallback. To send automatically, onboard a sender domain in Cloudflare Email Service, add an Email Service binding named `EMAIL`, and set `EMAIL_FROM` to an address on that onboarded domain. The submitted preview is attached when it is 5 MB or smaller.

Deploy:

```bash
npm run deploy
```

Afterward, attach the contractor's custom domain in Cloudflare Workers & Pages → the Worker → Settings → Domains & Routes. The API key remains server-side and is never sent to the browser.

## Production notes

- Native Cloudflare rate limiting allows five generations per account/IP per minute, and D1 atomically enforces 20 generations per account per UTC day. Change the `namespace_id` if `1001` is already used by another limiter in the same Cloudflare account.
- D1 stores account/workflow metadata and prompts; R2 stores generated textures, uploaded logos, and request previews privately.
- Passwords use salted PBKDF2-SHA-256 hashes. Invite codes and bearer sessions are stored only as hashes.
- Private file routes require either the owning client session or the administrator session. The client download button intentionally remains enabled for now.
- Administrators can generate single- or multi-use account codes, inspect every creation for one client, suspend access, mark designs Draft/Executive, and move requests through review/finalized states.
- Run `npm test` before deployment.
