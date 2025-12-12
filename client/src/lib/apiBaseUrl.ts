/**
 * API base URL support for deployments where the UI and API are hosted separately.
 *
 * - Set `VITE_API_URL` to an absolute origin (e.g. "https://api.example.com")
 * - If unset, we default to same-origin relative URLs (works for local dev + Cloud Run single artifact)
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? "").trim();
  if (!base) return path;
  return new URL(path, base).toString();
}

