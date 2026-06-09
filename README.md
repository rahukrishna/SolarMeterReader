# Solar Meter Reader

A local-first web app to track solar + KSEB meter readings with:
- KSEB Import by T1/T2/T3
- KSEB Export by T1/T2/T3 (T2/T3 can stay 0)
- Net units (Import - Export)
- Solar generated units
- Bank logic for exported surplus
- Billing cycle aligned to bill date (1-28 day)
- March 31 settlement (bank payout then reset to 0)
- KSEB bill upload (PDF/image) to auto-detect key fields and pre-fill reading form
- Optional free cloud sync (Supabase + OTP login)
- Flexible date filters: 2 days, 1 week, 2 weeks, 1 month, 6 months, 1 year, YTD, custom, all-time

## Seed Data Included

The app starts with your sample readings:
- 2026-05-26: Import 1, Export 1, Net 0, Solar 0
- 2026-06-02: Import 63, Export 71, Net -8, Solar 103
- 2026-06-07: Import 95, Export 90, Net 5, Solar 136

## Tech Stack

- Frontend: React + TypeScript + Vite
- Charts: Recharts
- Date handling: Day.js
- Storage: Browser LocalStorage + optional Supabase Cloud (free tier)

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL shown in terminal (usually http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

## How Billing Logic Works

1. Per reading:
- Input is treated as cumulative meter snapshot.
- Usage is derived by differences between consecutive readings.

2. Per billing cycle:
- If `Net > 0`: consume from bank first, remaining becomes payable units.
- If `Net < 0`: add `abs(Net)` to bank.

3. Bill-driven cycle alignment:
- In the Manage tab, set **KSEB Billing Date** and click **Apply Bill Cycle**.
- The app updates billing day and range to match the selected bill cycle.

4. Bill upload (PDF/Image):
- In Manage tab, upload bill file using **Upload KSEB Bill (PDF/Image)**.
- The app extracts available fields (date/import/export/T1-T3 where present) and opens Add Reading modal with pre-filled values.
- Review values and save the reading.

5. Settlement:
- On cycle containing March 31, current bank is marked as settlement payout and bank is reset to 0.

## Backup

Use the **Export JSON Backup** button to download your readings.

## Free Cloud DB (Supabase)

This project now supports optional free cloud sync so you can use it from mobile and laptop.

### 1. Create Supabase project (free)

1. Create project at supabase.com.
2. In SQL Editor, run script from [supabase/schema.sql](supabase/schema.sql).
3. In Authentication -> Providers, enable **Email**.

### 2. Add environment file

1. Copy `.env.example` to `.env`.
2. Fill values from Supabase project settings:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

### 3. Use cloud sync in app

1. Start app: `npm run dev`.
2. In **Cloud Sync (Free)** section:
- Enter email and click **Send Magic Link**.
- Open magic link on device/browser.
- Click **Upload To Cloud** to push local data.
- On another device, sign in and click **Download From Cloud**.

## Free Hosting on GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml` to auto-deploy on push to `main`.

### One-time GitHub setup

1. Push this project to GitHub (branch `main`).
2. In repository settings:
- Go to **Settings -> Pages**.
- Set **Source** to **GitHub Actions**.
3. Push to `main` again (or run workflow manually).
4. Your app URL will appear in the workflow summary.

## Android APK (One-Click Download + Install)

This repo now includes Android build support using Capacitor and GitHub Actions.

### Build Android locally

```bash
npm install
npm run android:build:debug
```

Debug APK output:

```bash
android/app/build/outputs/apk/debug/app-debug.apk
```

### Auto-build APK on every push

Workflow: `.github/workflows/android-apk.yml`

- Every push to `main` builds APK automatically.
- APK is uploaded as a workflow artifact.
- Latest APK is also published in GitHub Releases with tag `android-latest`.

### Production-ready signed release APK

To publish signed release APK (installable for production), add these repository secrets:

- `ANDROID_KEYSTORE_BASE64` (base64 of your keystore file)
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

If secrets are missing, workflow falls back to debug APK.

### One-click mobile install flow

1. Open your repo on mobile.
2. Go to **Releases**.
3. Open release **Android Latest APK**.
4. Tap the APK asset to download and install.

If Android blocks install, allow install from browser/files app once.

## Notes

- Data is stored in browser LocalStorage. If you change browser/device, data does not sync automatically.
- For future Android/mobile sync, we can move to a backend (Supabase/Firebase free tier) and keep this UI as PWA.
