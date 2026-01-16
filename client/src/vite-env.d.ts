/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEBUG_VIEW?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
