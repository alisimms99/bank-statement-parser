# Firebase Hosting Setup

## Current Status
- Cloud Run deployment: ✅ Complete
- Cloud Run URL: https://bank-statement-parser-439007645938.us-central1.run.app
- Firebase Hosting: ⚠️ Site needs to be created

## Steps to Complete Firebase Hosting Setup

### Option 1: Create Site via Firebase Console (Recommended)
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: `ojpm-bank-statement-parser`
3. Navigate to **Hosting** in the left sidebar
4. Click **Get Started** or **Add Site**
5. Create a site with ID: `ojpm-bank-statement-parser`
6. Once created, run: `firebase deploy --only hosting`

### Option 2: Use Firebase CLI (if permissions allow)
```bash
firebase hosting:sites:create ojpm-bank-statement-parser
firebase deploy --only hosting
```

## Configuration
The `firebase.json` is already configured to:
- Serve static files from `dist/public`
- Proxy `/api/**` requests to Cloud Run (if using rewrites)
- Or use direct API calls via `VITE_API_URL` environment variable

## Build and Deploy
```bash
# Build the app
pnpm build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

## Environment Variables
If deploying static files separately, set `VITE_API_URL` during build:
```bash
VITE_API_URL=https://bank-statement-parser-439007645938.us-central1.run.app pnpm build
firebase deploy --only hosting
```
