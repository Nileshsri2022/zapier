/**
 * The action catalog — the one table that answers "which actions exist?".
 *
 * Before this module the answer lived in five places: the worker's known-type
 * list, the worker's dispatch cascade, the server's seeded catalog, the web's
 * app-grouping table and the web's form switch. Adding one action meant editing
 * several of them, and only one of those edits (a code comment) claimed they
 * had to agree.
 *
 * This package is **data only** — no Prisma, no Node APIs, no runtime
 * dependencies — because the browser bundle imports it. Executors stay in the
 * worker, keyed by `executorKey`; the worker's equality test proves the two
 * tables cover each other.
 */

/**
 * Per-app display data. The image belongs to the app, not to each action: two
 * actions on the same surface share an icon, and repeating the path per entry
 * is how the copies drifted in the first place.
 */
export const APP_META = {
  ai: { name: 'AI Transform', image: '/apps/ai.svg' },
  email: { name: 'Email', image: '/apps/email.svg' },
  solana: { name: 'Solana', image: '/apps/Solana.svg' },
  webhook: { name: 'Webhook', image: '/apps/webhook.svg' },
  whatsapp: { name: 'WhatsApp', image: '/apps/whatsapp.svg' },
  telegram: { name: 'Telegram', image: '/apps/telegram.svg' },
  discord: { name: 'Discord', image: '/apps/discord.svg' },
} as const;

/** The surfaces an action can live on. `as const` above makes this a union. */
export type ActionApp = keyof typeof APP_META;

/**
 * What the worker dispatches. Deliberately a separate vocabulary from
 * `ActionApp`: they are the same seven values today, but the moment one surface
 * grows a second executor ("Solana Read" vs a future "Solana Send"), deriving
 * the key from the app would route both to the same code without a type error.
 */
export type ExecutorKey =
  | 'ai'
  | 'email'
  | 'solana'
  | 'webhook'
  | 'whatsapp'
  | 'telegram'
  | 'discord';

/**
 * Which metadata form the web shows for this action. It is a union, not a
 * string, so the day `Modal.tsx` starts routing on it a missing form is a
 * compile error rather than a blank step.
 *
 * `'none'` is for an action that needs no configuration at all. No catalog
 * entry uses it today; it exists so "no form" is a representable answer instead
 * of an absence once the switch is driven from here.
 */
export type ActionFormKey =
  | 'ai'
  | 'email'
  | 'solana'
  | 'webhook'
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'none';

export interface ActionEntry {
  /** Exact action type — what the worker's guard accepts. No prefix matching. */
  readonly type: string;
  /** Surface this action belongs to; drives grouping, icon and display name. */
  readonly app: ActionApp;
  /** Which form the web renders (documentation today, routing later). */
  readonly formKey: ActionFormKey;
  /** Which worker executor runs it. */
  readonly executorKey: ExecutorKey;
  /**
   * Documentary: this entry exists for backward compatibility and dispatches
   * exactly like the named canonical type. Aliases are accepted but never
   * offered — see `offeredActions()`.
   */
  readonly aliasOf?: string;
}

/**
 * Every accepted action type, in the order the catalog has always been seeded.
 *
 * Aliases are real entries on purpose: a Zap composed before this table existed
 * may hold the bare `WhatsApp`/`Telegram` name, and the worker must keep
 * dispatching it. Typed callers get an exact list to match on, and the web only
 * ever shows the canonical names.
 */
export const ACTION_CATALOG: readonly ActionEntry[] = [
  { type: 'AI Transform', app: 'ai', formKey: 'ai', executorKey: 'ai' },
  { type: 'Email', app: 'email', formKey: 'email', executorKey: 'email' },
  { type: 'Solana', app: 'solana', formKey: 'solana', executorKey: 'solana' },
  {
    type: 'WhatsApp Send Message',
    app: 'whatsapp',
    formKey: 'whatsapp',
    executorKey: 'whatsapp',
  },
  {
    type: 'WhatsApp',
    app: 'whatsapp',
    formKey: 'whatsapp',
    executorKey: 'whatsapp',
    aliasOf: 'WhatsApp Send Message',
  },
  { type: 'Telegram Send Message', app: 'telegram', formKey: 'telegram', executorKey: 'telegram' },
  {
    type: 'Telegram',
    app: 'telegram',
    formKey: 'telegram',
    executorKey: 'telegram',
    aliasOf: 'Telegram Send Message',
  },
  { type: 'Discord Send Message', app: 'discord', formKey: 'discord', executorKey: 'discord' },
  { type: 'Webhook', app: 'webhook', formKey: 'webhook', executorKey: 'webhook' },
];

/**
 * The actions a user may pick: canonical types only. Aliases stay accepted by
 * `findAction` but are never seeded or shown, so one action is one card.
 */
export function offeredActions(): readonly ActionEntry[] {
  return ACTION_CATALOG.filter((entry) => !entry.aliasOf);
}

/** Every accepted type, canonical and alias — what an unknown-type error lists. */
export function acceptedActionTypes(): string[] {
  return ACTION_CATALOG.map((entry) => entry.type);
}

/** The types a user may pick, in catalog order. */
export function offeredActionTypes(): string[] {
  return offeredActions().map((entry) => entry.type);
}

/** Exact lookup. Case matters: `email` is not `Email`. */
export function findAction(type: string): ActionEntry | undefined {
  return ACTION_CATALOG.find((entry) => entry.type === type);
}

/** Display data for an entry's app. */
export function actionAppMeta(entry: ActionEntry) {
  return APP_META[entry.app];
}
