<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1PGiWKhwDlNaX7szKIPdxVdLXpnonT6FJ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.local.example` or create `.env.local` with API keys (see below)
3. Sync deploy config (optional, for GitHub / AI Studio):
   `npm run sync:config`
4. Run the app:
   `npm run dev`

## Deploy (GitHub / AI Studio)

The mounted version does **not** read `.env.local`. Supabase connection is loaded from:

1. `app-config.json` at repo root (and `public/app-config.json` for Vite builds)
2. Admin → API 配置 → Supabase URL / Anon Key (saved in browser localStorage)

After changing `.env.local` locally, run `npm run sync:config` and push so the cloud version uses the same Supabase project.

Required in `app-config.json`:

- `supabaseUrl`
- `supabaseAnonKey`

Qwen API keys are stored in Supabase `api_configs` once connected — configure them once in Admin on any device.
