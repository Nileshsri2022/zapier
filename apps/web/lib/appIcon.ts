/**
 * Local app icons — NEVER a CDN.
 *
 * Icons ship in the repo at public/apps/*.svg and are served same-origin.
 * DB rows seeded before that change may still store old remote URLs
 * (icons8/flaticon — some now 404). appIcon() normalizes whatever it is
 * given to a local file, by trigger/action type first, then by the stored
 * URL's filename, so old rows can never trigger an external request or
 * render a broken image.
 */
const BY_KEYWORD: Array<[RegExp, string]> = [
  [/gmail/, '/apps/gmail.svg'],
  [/sheet/, '/apps/sheets.svg'],
  [/calendar/, '/apps/calendar.svg'],
  [/github/, '/apps/github.svg'],
  [/whatsapp/, '/apps/whatsapp.svg'],
  [/telegram/, '/apps/telegram.svg'],
  [/discord/, '/apps/discord.svg'],
  [/solana/, '/apps/Solana.svg'],
  [/schedule/, '/apps/schedule.svg'],
  [/webhook/, '/apps/webhook.svg'],
  [/^ai\b|openai|anthropic|claude|puter/, '/apps/ai.svg'],
  [/email|mail/, '/apps/email.svg'],
];

export const FALLBACK_ICON = '/apps/webhook.svg';

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
