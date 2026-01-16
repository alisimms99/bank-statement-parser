/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG_VIEW?: string;
  readonly VITE_FRONTEND_FORGE_API_KEY?: string;
  readonly VITE_FRONTEND_FORGE_API_URL?: string;
  readonly VITE_OAUTH_PORTAL_URL?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_ANALYTICS_ENDPOINT?: string;
  readonly VITE_ANALYTICS_WEBSITE_ID?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
