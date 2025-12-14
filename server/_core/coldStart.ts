/**
 * Cold Start Tracking
 * 
 * Tracks Cloud Run cold start durations for observability dashboards.
 * A cold start occurs when a new container instance is created.
 */

// Track the module initialization time (this runs once per container instance)
const containerStartTime = Date.now();
let firstRequestTime: number | null = null;
let coldStartDuration: number | null = null;

/**
 * Record the first request timestamp and calculate cold start duration.
 * Should be called at the start of the first request to the container.
 */
export function recordFirstRequest(): number | null {
  if (firstRequestTime !== null) {
    // Not a cold start - container was already warmed up
    return null;
  }
  
  firstRequestTime = Date.now();
  coldStartDuration = firstRequestTime - containerStartTime;
  
  return coldStartDuration;
}

/**
 * Get the cold start duration if available.
 * Returns null if this is not the first request or if no request has been made yet.
 */
export function getColdStartDuration(): number | null {
  return coldStartDuration;
}

/**
 * Check if the current request is the first request (cold start)
 */
export function isColdStart(): boolean {
  return firstRequestTime === null;
}

/**
 * Get the container start time (for debugging)
 */
export function getContainerStartTime(): number {
  return containerStartTime;
}
