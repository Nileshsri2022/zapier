/**
 * Gmail search-query matcher for the `Gmail Matching Search` trigger
 * (docs/ask-matt/triggers/gmail.md §2 E2, answers Q-GMAIL-01/02).
 *
 * History deltas do not carry a server-side query, so matching runs against
 * the hydrated run payload — same seam as the label/sender/subject filters
 * in GmailDispatch.shouldTrigger. Pure and synchronous: unit-testable with
 * hand-built payloads, no Google calls.
 *
 * Supported syntax (documented subset of Gmail search, AND semantics):
 *   from:term          sender contains term (case-insensitive)
 *   to:term            recipient list contains term
 *   subject:term       subject contains term
 *   label:NAME         exact label match (case-insensitive)
 *   has:attachment     payload hasAttachments
 *   is:starred         STARRED label present
 *   is:read            message is read
 *   is:unread          message is unread
 *   "quoted phrase"    matches subject OR from OR snippet OR body
 *   bare term          matches subject OR from OR snippet OR body
 *
 * Unsupported operators are treated as bare terms (best-effort) — they never
 * silently widen the match beyond AND semantics. An empty query matches
 * nothing: the controller rejects creating the trigger without a query, and
 * a stray empty value must not fan out the whole mailbox.
 */

export interface SearchableEmail {
  from?: string;
  to?: string | string[];
  subject?: string;
  labels?: string[];
  hasAttachments?: boolean;
  isRead?: boolean;
  snippet?: string;
  body?: string;
  bodyPlain?: string;
}

type QueryToken =
  | { kind: 'field'; field: string; value: string }
  | { kind: 'text'; value: string };

/** Tokenize a Gmail-style query into field and free-text tokens. */
export function tokenizeGmailQuery(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  const re = /"([^"]*)"|(\w+):(?:"([^"]*)"|(\S+))|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const [, quoted, field, fieldValue, bareValue, freeText] = m;
    if (quoted !== undefined) {
      const value = quoted.trim();
      if (value) tokens.push({ kind: 'text', value });
      continue;
    }
    if (field !== undefined) {
      const value = (fieldValue ?? bareValue ?? '').trim();
      if (value) tokens.push({ kind: 'field', field: field.toLowerCase(), value });
      continue;
    }
    if (freeText) tokens.push({ kind: 'text', value: freeText });
  }
  return tokens;
}

function includesCI(haystack: string | undefined | null, needle: string): boolean {
  return String(haystack ?? '')
    .toLowerCase()
    .includes(needle.toLowerCase());
}

function matchesToken(token: QueryToken, email: SearchableEmail): boolean {
  if (token.kind === 'text') {
    const fields = [
      email.subject,
      email.from,
      email.snippet,
      email.bodyPlain ?? email.body,
    ];
    return fields.some((f) => includesCI(f, token.value));
  }

  const { field, value } = token;
  switch (field) {
    case 'from':
      return includesCI(email.from, value);
    case 'to': {
      const recipients = Array.isArray(email.to) ? email.to : [email.to ?? ''];
      return recipients.some((r) => includesCI(r, value));
    }
    case 'subject':
      return includesCI(email.subject, value);
    case 'label': {
      const labels = email.labels ?? [];
      return labels.some((l) => l.toLowerCase() === value.toLowerCase());
    }
    case 'has':
      if (value.toLowerCase() === 'attachment') return Boolean(email.hasAttachments);
      return true; // unknown has:* — best-effort neutral, still AND-ed
    case 'is': {
      const v = value.toLowerCase();
      if (v === 'starred') return (email.labels ?? []).some((l) => l.toUpperCase() === 'STARRED');
      if (v === 'read') return Boolean(email.isRead);
      if (v === 'unread') return !email.isRead;
      return true; // unknown is:* — best-effort neutral
    }
    default:
      // Unknown operator: treat the whole `field:value` as free text so the
      // token still constrains the match instead of being dropped.
      return [email.subject, email.from, email.snippet, email.bodyPlain ?? email.body].some((f) =>
        includesCI(f, `${field}:${value}`)
      );
  }
}

/**
 * Does `email` satisfy the Gmail query? AND semantics across tokens;
 * empty/whitespace queries match nothing.
 */
export function matchesGmailQuery(query: string, email: SearchableEmail): boolean {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return false;
  const tokens = tokenizeGmailQuery(trimmed);
  if (tokens.length === 0) return false;
  return tokens.every((token) => matchesToken(token, email));
}
