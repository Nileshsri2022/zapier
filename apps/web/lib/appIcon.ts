/**
 * Local app icons — NEVER a CDN.
 *
 * Icons ship in the repo at public/apps-v2/*.svg and are served same-origin.
 * DB rows seeded before that change may still store old remote URLs
 * (icons8/flaticon — some now 404). appIcon() normalizes whatever it is
 * given to a local file, by trigger/action type first, then by the stored
 * URL's filename, so old rows can never trigger an external request or
 * render a broken image.
 */
const BY_KEYWORD: Array<[RegExp, string]> = [
  [/gmail/, '/apps-v2/gmail.svg'],
  [/sheet/, '/apps-v2/sheets.svg'],
  [/calendar/, '/apps-v2/calendar.svg'],
  [/github/, '/apps-v2/github.svg'],
  [/whatsapp/, '/apps-v2/whatsapp.svg'],
  [/telegram/, '/apps-v2/telegram.svg'],
  [/solana/, '/apps-v2/Solana.svg'],
  [/schedule/, '/apps-v2/schedule.svg'],
  [/webhook/, '/apps-v2/webhook.svg'],
  [/email|mail/, '/apps-v2/email.svg'],
];

export const FALLBACK_ICON = '/apps-v2/webhook.svg';

/** Resolve a local icon path for a trigger/action type and/or stored image value. */
export function appIcon(type?: string | null, image?: string | null): string {
  // Already local (new seeds / APPS constants) — serve as-is.
  if (image && image.startsWith('/')) return image;

  const haystack = `${type ?? ''} ${image ?? ''}`.toLowerCase();
  for (const [pattern, icon] of BY_KEYWORD) {
    if (pattern.test(haystack)) return icon;
  }
  return FALLBACK_ICON;
}
