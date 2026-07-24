/**
 * Device / layout detection (без Yandex SDK — URL, UA, matchMedia).
 * Как в slither: TV отдельно от mobile coarse pointer.
 */

export function isTV() {
  if (typeof document !== 'undefined' && document.body?.classList.contains('platform-tv')) {
    return true;
  }
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('platform') === 'tv' || q.get('tv') === '1') return true;
  } catch {
    /* ignore */
  }
  const ua = navigator.userAgent || '';
  return /SmartTV|SMART-TV|AppleTV|Android TV|TV Safari|CrKey|BRAVIA|Web0S|Tizen|AFT[A-Z]|MiTV/i.test(
    ua
  );
}

export function isMobileLayout() {
  if (isTV()) return false;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('mobile') === '1' || q.get('platform') === 'mobile') return true;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
}

/** Apply body classes once (platform-tv / platform-mobile). */
export function detectPlatform() {
  if (isTV()) {
    document.body.classList.add('platform-tv');
    document.body.classList.remove('platform-mobile');
  } else if (isMobileLayout()) {
    document.body.classList.add('platform-mobile');
    document.body.classList.remove('platform-tv');
  } else {
    document.body.classList.remove('platform-tv', 'platform-mobile');
  }
}
