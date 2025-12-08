/// <reference types="vite/client" />

/**
 * Type definitions for Vite environment variables.
 * 
 * This file extends the ImportMeta interface to include the env property,
 * which is used by Vite to expose environment variables to the client.
 */

interface ImportMetaEnv {
  /** API URL for backend server */
  readonly VITE_API_URL?: string;
  
  /** Application ID for OAuth */
  readonly VITE_APP_ID?: string;
  
  /** Enable debug view in UI */
  readonly VITE_DEBUG_VIEW?: string | boolean;
  
  /** Node environment (development, production, etc.) */
  readonly MODE: string;
  
  /** Base URL for the application */
  readonly BASE_URL: string;
  
  /** Whether the app is running in production */
  readonly PROD: boolean;
  
  /** Whether the app is running in development */
  readonly DEV: boolean;
  
  /** Whether server-side rendering is enabled */
  readonly SSR: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
