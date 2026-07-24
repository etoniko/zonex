/**
 * Production game host (zonex.su client → this WSS).
 * Localhost / ?local=1 → plain WS on same machine.
 */

export const SERVER_HOST = 'ffa.agar.su:6012';
export const SERVER_WS_URL = `wss://${SERVER_HOST}`;

/** Ratings over HTTPS on the game port (same cert as WSS). */
export const RATINGS_HTTP_URL = `https://${SERVER_HOST}/ratings`;

function isLocalHost() {
  const h = location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h === '' ||
    /(?:^|[?&])local=1(?:&|$)/.test(location.search)
  );
}

/** WebSocket URL for the authority server. */
export function resolveWsUrl() {
  if (isLocalHost()) {
    const port = Number(location.port) || 6012;
    // Same-origin when serving client from the game process; else fixed local port
    if (location.port && location.hostname) {
      return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    }
    return `ws://127.0.0.1:${port}`;
  }
  return SERVER_WS_URL;
}

/** HTTP(S) ratings endpoint (paginated JSON). */
export function resolveRatingsUrl() {
  if (isLocalHost()) {
    if (location.port && location.hostname) {
      return `${location.protocol}//${location.host}/ratings`;
    }
    return 'http://127.0.0.1:6012/ratings';
  }
  return RATINGS_HTTP_URL;
}
