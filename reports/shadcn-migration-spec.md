# Spec: shadcn/ui Migration with Style Separation & Tailwind Minimization

| | |
|---|---|
| **Target app** | `apps/web` (Next.js 16, React 18, Tailwind CSS v3.4) |
| **Branch** | `arena/f0c028cc-zapier` |
| **Date** | 2026-10-17 |
| **Status** | ✅ Spec authored · 🚧 **Pilot delivered: P1 Foundation + P2 Primitives + Wave A** — awaiting approval before Waves B–F |
| **Checklist** | See [§12 Completion Checklist](#12-completion-checklist--status) for what is done vs pending |

---

## 1. Context — Audit Findings (Current State)

Verified by repository audit on 2026-10-17:

| Metric | Value |
|---|---|
| shadcn/ui usage | **0%** — no `components.json`, no `components/ui/`, **0** `@radix-ui` entries in `package-lock.json`/`bun.lock`, no `class-variance-authority`/`tailwind-merge` |
| Hand-built components | **100%** — 26 component files (`components/*.tsx` = 18, `components/metadata/*.tsx` = 8), **4,490 LOC** |
| Pages with inline UI | 9 pages + layout, **~833 LOC** (`app/**/page.tsx`) |
| Inline `className` attributes | **524** across all `.tsx` |
| Arbitrary-value utilities | **45+** (`w-[272px]`, `bg-[#2a2a4a]`, `min-h-[400px]`, `z-[999]`, …) |
| Responsive-prefixed classes | **65** (`xs:` 16, `sm:` 17, `md:` 18, `lg:` 14) — against **non-default custom breakpoints** (`xs` 320, `sm` 375, `md` 640, `lg` 768, `xl` 1024, `2xl` 1280) |
| Toast system | `react-toastify` in **13 files**, **61 calls** (`toast.error` 45, `toast.success` 13, `toast.info` 3) + `ToastContainer` & CSS import in `layout.tsx` |
| Stylesheet count | **1** (`app/globals.css`, 86 lines: `@tailwind` directives + resets + scrollbar + canvas + 320px support) |
| Known config bugs | `bg-primary-600` used once but **not defined** in `tailwind.config.ts`; `backgroundImage.canvas` in config is **never used** (dead) |
| Styles in code | Styles are **tightly coupled**: every component embeds Tailwind utilities + `clsx` conditionals directly in TSX |

**Problem statement:** styling lives inline in TSX (524 `className` strings), there is no component library, CSS is scattered across TSX instead of files, and Tailwind usage is verbose, arbitrary-value-heavy, and partly broken (undefined class, dead config, non-standard breakpoints that also break stock shadcn responsive behavior).

---

## 2. Goals & Non-Goals

### Goals
1. **G1 — shadcn/ui for all UI:** every visible, interactive element is built on (or composed from) shadcn primitives in `components/ui/*`; custom bespoke primitives are replaced.
2. **G2 — Separate code from styles:** first-party `.tsx` files contain **zero Tailwind utility classes and zero `<style>`/CSS strings**. All styling lives in dedicated `.css` files under `apps/web/styles/`.
3. **G3 — Minimal Tailwind, then simple Tailwind with best practices:**
   - **Step A (strip):** remove *all* Tailwind classes & scattered CSS from component/page code.
   - **Step B (re-introduce):** bring back the *simplest possible* Tailwind setup governed by the best-practice rules in §8 — tokens/variables instead of literals, no arbitrary values, default breakpoints, no dead config, `@apply` only inside `styles/` files.
4. **G4 — No visual redesign:** brand look is preserved (orange `#FF4F00`, purple `#695BE8`, cream `#FFFDF9`/`#F5F3EB` all become design tokens).
5. **G5 — Enforced, not aspirational:** automated grep/CI gates prevent inline styles from creeping back.

### Non-Goals
- No backend/API changes (`apps/server`, workers, packages untouched).
- No React/Next/Tailwind major upgrades (stay on React 18, Next 16, **Tailwind v3** — see D6).
- No redesign of information architecture, routes, or data flow — behavior of each component stays the same.
- Accessibility fixes beyond what shadcn primitives bring for free are out of scope (but tracked as follow-up).

---

## 3. Design Decisions (ADR-style)

| # | Decision | Rationale |
|---|---|---|
| **D1** | Three layers: **`styles/`** (tokens + component CSS) · **`components/ui/`** (vendored shadcn primitives) · **`components/` + `app/`** (logic-only first-party code) | Gives shadcn its standard home while guaranteeing first-party code is style-free. |
| **D2** | **Vendor exception:** stock shadcn primitives in `components/ui/*` keep their Tailwind classes inline (this is shadcn's copy-paste model and keeps `shadcn add/diff/fix` upgrades working). First-party files have **zero** utilities. A future optional "strict mode" phase can extract them too (§11, unchecked). | Balances G2 with shadcn's update model. Called out explicitly so the exception is conscious, not accidental. |
| **D3** | **Style files are semantic plain CSS**, one file per component: `styles/components/<name>.css`, classes named `block__element--modifier`. Component code references only semantic names (`className="btn btn--primary"` → replaced by `data-*` hooks where dynamic, see §7). | This is what "separate code from styles" means in practice; keeps CSS greppable and TSX clean. |
| **D4** | **Dynamic styling via native attrs / `data-*`**, not class concat: TSX sets `disabled`, `aria-*`, or `data-variant="primary"`; CSS selects `[data-variant='primary']`. `clsx`/`cn()` is banned from first-party files (kept only inside vendored `ui/*`). | Eliminates conditional class strings (the `clsx` problem) entirely. |
| **D5** | **Revert to Tailwind default breakpoints** (`sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280 / `2xl` 1536); drop custom `xs`. | Current custom screens (sm=375, md=640, lg=768…) contradict stock shadcn responsive classes — shadcn components would misbehave. App CSS uses plain px media queries, so first-party styles are unaffected by the change. |
| **D6** | **Stay on Tailwind v3.4**; vendor **v3-compatible** versions of shadcn components. | Repo-wide framework upgrades are out of scope; shadcn fully supports v3. Pitfall: newer registry output targets v4 (`@theme inline`, renamed utilities like `shadow-sm→shadow-xs`) — must be adapted down, not pasted blindly. |
| **D7** | **Toasts: `react-toastify` → `sonner`** (shadcn's standard toast, `<Toaster />` from `components/ui/sonner.tsx`). | G1 says *all* UI on shadcn; mechanical codemod of 61 `toast.*` calls. |
| **D8** | **How to obtain shadcn components:** primary path `npx shadcn@latest init/add` (registry); **fallback for restricted networks** (this sandbox cannot reach `ui.shadcn.com`): vendor sources from the official `github.com/shadcn-ui/ui` repo (allowed host) and adapt to v3 per D6. | Ensures the plan is executable both locally and in the sandbox. |
| **D9** | Brand colors map to shadcn CSS variables: `--primary: 18 100% 50%` (hsl of `#FF4F00`), `--secondary: 244 37% 61%` (`#695BE8`), `--background: 43 33% 99%` (`#FFFDF9`), `--muted: 48 21% 95%` (`#F5F3EB`). | One token source of truth; kills hex literals in code (G3). |

---

## 4. Target Architecture

```
apps/web/
├── app/
│   ├── globals.css              # ONLY: @tailwind directives + @import of styles/ files
│   └── layout.tsx               # imports globals.css, <Toaster /> (sonner), no toastify CSS
├── styles/                      # ★ ALL styles live here — nothing styled in TSX
│   ├── tokens.css               # :root CSS variables — shadcn theme + brand tokens (D9)
│   ├── base.css                 # resets, fonts, scrollbar, .canvas, focus/a11y, 320px support
│   ├── utilities.css            # small set of shared @apply helpers — plain rules (Tailwind v3 forbids @layer outside the @tailwind file)
│   ├── components/              # one file per first-party component (§7)
│   │   ├── navbar.css
│   │   ├── modal.css
│   │   ├── auth-form.css
│   │   ├── button.css           # only if a wrapper keeps semantic classes
│   │   └── … (26 files, only for components that remain visible)
│   └── pages/                   # one file per page with custom layout
│       ├── dashboard.css
│       ├── profile.css
│       └── …
├── components/
│   ├── ui/                      # ★ shadcn primitives (vendored, stock — exception D2)
│   │   ├── button.tsx  dialog.tsx  tooltip.tsx  input.tsx  label.tsx
│   │   ├── card.tsx  tabs.tsx  select.tsx  dropdown-menu.tsx  popover.tsx
│   │   ├── switch.tsx  badge.tsx  table.tsx  alert.tsx  sheet.tsx
│   │   ├── sonner.tsx  spinner.tsx
│   │   └── …only what §6 actually needs
│   ├── [FirstParty].tsx         # ★ LOGIC ONLY: JSX + handlers + data-* attrs, no tailwind
│   └── metadata/                # same rule
├── lib/
│   └── utils.ts                 # export cn = twMerge(clsx(x))  (used ONLY inside ui/*)
└── tailwind.config.ts           # slim: default screens, CSS-var colors, only used keyframes
```

**Import order in `app/globals.css`:** `@tailwind` directives → `@import '../styles/tokens.css'` → `base.css` → `utilities.css` → (component/page CSS imported by `layout.tsx` or by pages that need them — pick ONE convention and stick to it: **layout imports everything** for this app's size).

---

## 5. Component → shadcn Mapping

Replaces **all 26 components + toast layer**. LOC = current size (effort proxy).

### Wave A — primitives (small, 122 LOC)
| Existing | shadcn primitive(s) | Notes |
|---|---|---|
| `Button.tsx` (47) | `ui/button` (cva) | variant map: `primary→default` (brand orange), `secondary→secondary` (purple), `outline→outline`, `link→link`, `lg w-[272px]→size="lg"` + token width |
| `FormInput.tsx` (38) | `ui/input` + `ui/label` | keep `FormInput` as a thin logic wrapper (error text → `ui/alert` or `aria-describedby`) |
| `Spinner.tsx` (22) | `ui/spinner` (lucide `Loader2` + `animate-spin`) | stock shadcn spinner component |
| `Tooltip.tsx` (15) | `ui/tooltip` (Radix) | replaces hand-rolled group-hover tooltip |

### Wave B — layout & chrome (614 LOC)
| Existing | shadcn primitive(s) | Notes |
|---|---|---|
| `Navbar.tsx` (162) | `ui/sheet` (mobile menu) + `ui/button` + `ui/dropdown-menu` | desktop links plain `<a>`/`next/link` |
| `AuthForm.tsx` (139) | `ui/card` + `ui/tabs` + `ui/input` + `ui/label` + `ui/button` + `ui/alert` | sign-in/sign-up toggle via `ui/tabs`; errors via `ui/alert` |
| `ZapCell.tsx` (71) | `ui/card` + `ui/badge` + `ui/dropdown-menu` | row actions menu |
| `MainSection.tsx` (24) | `ui/card` / plain semantic markup | trivial |
| `PWAInstaller.tsx` (60) | **none — logic-only** | no visual output; strip any stray classes only |

### Wave C — complex interactive (1,561 LOC)
| Existing | shadcn primitive(s) | Notes |
|---|---|---|
| `Modal.tsx` (651) | `ui/dialog` (+ `ui/button`, `ui/input`, `ui/badge`, `ui/scroll-area` optional) | **highest-risk refactor:** split orchestration logic (OAuth, app list, selections) from presentation; dialog chrome comes from `ui/dialog`; keep `modal/constants.ts` & `modal/types.ts` |
| `PublishZap.tsx` (327) | `ui/dialog` + `ui/input` + `ui/button` + `ui/tooltip` + sonner | |
| `ZapRunHistory.tsx` (179) | `ui/table` + `ui/badge` + `ui/button` | |
| `FilterBuilder.tsx` (204) | `ui/select` + `ui/popover` + `ui/badge` + `ui/button` (+ `ui/command` optional) | lucide icons already align with shadcn |

### Wave D — Gmail suite (1,477 LOC)
| Existing | shadcn primitive(s) | Notes |
|---|---|---|
| `GmailActionConfig.tsx` (479) | `ui/card` + `ui/select` + `ui/input` + `ui/label` + `ui/switch` + `ui/button` + `ui/badge` | biggest config form |
| `GmailTriggerConfig.tsx` (330) | same set | |
| `GmailStatusMonitor.tsx` (326) | `ui/card` + `ui/badge` + `ui/button` + `ui/separator` | status pills → `ui/badge` |
| `GmailServerConfig.tsx` (223) | `ui/card` + `ui/input` + `ui/label` + `ui/button` + `ui/alert` | |
| `GmailDashboard.tsx` (119) | `ui/card` + `ui/badge` + `ui/table` (optional) | |

### Wave E — metadata forms (974 LOC)
| Existing | shadcn primitive(s) | Notes |
|---|---|---|
| `metadata/GoogleCalendarMetaData.tsx` (247) | `ui/label` + `ui/input` + `ui/select` + `ui/card` | pattern repeats for all 8 |
| `metadata/ScheduleMetaData.tsx` (199) | `ui/label` + `ui/input` + `ui/select` | |
| `metadata/GmailMetaData.tsx` (181) | `ui/label` + `ui/input` | |
| `metadata/GitHubMetaData.tsx` (165) | `ui/label` + `ui/input` | |
| `metadata/GoogleSheetsMetaData.tsx` (156) | `ui/label` + `ui/input` + `ui/select` | |
| `metadata/WebhookMetaData.tsx` (56) | `ui/label` + `ui/input` | |
| `metadata/EmailMetaData.tsx` (39) | `ui/label` + `ui/input` | |
| `metadata/SolanaMetaData.tsx` (31) | `ui/label` + `ui/input` | |

### Wave F — pages (833 LOC)
| Page (LOC) | Approach |
|---|---|
| `dashboard/page.tsx` (487) | compose `ui/*`; layout CSS → `styles/pages/dashboard.css` |
| `profile/page.tsx` (107) | same |
| `sign-up` (71) / `login` (26) | `ui/card` + `AuthForm` |
| `editor` (28), `page` (20), `not-found` (19), `gmail` (5), `layout` (70) | minimal; `layout` swaps toastify for `<Toaster />` |

### Toast layer
| Existing | Replacement |
|---|---|
| `react-toastify` (13 files, 61 calls, `ToastContainer` + CSS import) | `sonner` via `ui/sonner.tsx` + `<Toaster />` in `layout.tsx`; codemod `toast.error/success/info(msg)` → `sonner.toast.error/success/info(msg)` (API-compatible for basic usage) |

---

## 6. Dependency Changes

**Add** (`apps/web`):
```
class-variance-authority     # shadcn variant engine
tailwind-merge                # cn() correctness
@radix-ui/react-slot
@radix-ui/react-dialog        # + react-alert-dialog only if confirm-dialog needed in Modal refactor
@radix-ui/react-tooltip
@radix-ui/react-label
@radix-ui/react-select
@radix-ui/react-dropdown-menu
@radix-ui/react-popover
@radix-ui/react-switch
@radix-ui/react-tabs
@radix-ui/react-separator     # optional (GmailStatusMonitor)
@radix-ui/react-scroll-area   # optional (Modal overflow)
sonner                        # toasts (D7)
```
> Install only what §5 actually consumes — after each wave, prune unused Radix packages (verification gate in §10).

**Remove (after migration):**
- `react-toastify` (+ its CSS import in `layout.tsx`)
- direct `clsx` imports from first-party files (`cn()` remains for `ui/*` only)

**Remove (bonus cleanup — unused deps found in the earlier dependency audit):**
- `apps/web` `dependencies`: `dotenv`, `sharp` (Next 16 bundles it), `@types/axios` (deprecated), `@types/minimatch` (unused)

**Keep:** `lucide-react` (shadcn's icon library), `axios` (used in 10 files — converting to `fetch` is optional follow-up, not in scope), `@vercel/analytics`, `@vercel/speed-insights`.

---

## 7. Style-Separation Conventions (normative)

1. **One CSS file per component** that has visual presence: `styles/components/<kebab-name>.css`. Pages: `styles/pages/<route>.css`.
2. **Naming:** BEM-lite — `.modal`, `.modal__header`, `.modal--open`. No Tailwind utility names in first-party CSS selectors either (write `.card__title { font-size: … }`, not `.text-lg`).
3. **No styling in TSX:** no `style={{…}}` props, no `<style>` tags, no template-literal classNames. Allowed in TSX: `className` with **semantic names only**, plus `data-*`/`aria-*`/native props.
4. **Dynamic variants:** `data-variant="primary"`, `data-state="open|closed"`, `data-loading="true"` → selected in CSS: `[data-variant='primary'] { … }`. Zero conditional class concatenation (`clsx` banned from first-party files, D4).
5. **State styles** (`:hover`, `:focus-visible`, `:disabled`, `[aria-invalid='true']`) live in the component's CSS file — never as `hover:` utilities in TSX.
6. **Tokens only:** colors, radii, shadows, spacing scale referenced via `var(--…)` (from `styles/tokens.css`). **No hex/rgb literals** in component CSS (only `tokens.css` may hold raw values).
7. **Responsiveness:** plain media queries with **default Tailwind breakpoints** in the component's CSS file (`@media (min-width: 768px)`), since responsive prefixes are banned in first-party TSX (D5).

---

## 8. Tailwind Minimization Policy (G3)

### Step A — Strip (executed per component during its wave)
Delete from the `.tsx` **all** of:
- every Tailwind utility class (the 524 `className` strings — replaced by semantic classes / `data-*` per §7);
- arbitrary values (`*-[…]`) — re-express with tokens/scale, **never** port `w-[272px]` literally;
- `clsx` conditional class logic;
- responsive prefixes (`sm:` …) — replaced by media queries in CSS files;
- any `style={{…}}` props.

> Strip is **re-expression, not 1:1 move**: re-derive each style cleanly against tokens instead of pasting old utilities into CSS.

### Step B — Re-introduce "simple Tailwind, best practices" (after all waves)
Tailwind's remaining role: **preflight + CSS-variable theming + a tiny shared-utility layer** — nothing else in first-party code.

Rules (each is a verification gate in §10):
1. **Default breakpoints** only (D5) — config `theme.screens` reset to Tailwind defaults, `xs` removed.
2. **Colors as CSS variables only:** config maps `primary/secondary/background/muted/border/ring… → hsl(var(--x))` (D9). Brand hexes exist **once**, in `styles/tokens.css`.
3. **No arbitrary values** anywhere (`grep -E '[a-z-]+-\[[^]]+\]'` → 0 in `apps/web`).
4. **No `!important`** in any stylesheet.
5. **`@apply` policy:** allowed **only** inside `styles/**.css`, only in `utilities.css`/`base.css`, only for multi-property patterns used ≥3 times (e.g. focus-ring, center-flex). Target: ≤10 shared utilities. Component CSS prefers plain properties + `var(--…)`.
6. **Config hygiene:** remove dead entries (`backgroundImage.canvas`, unused keyframes — re-check per wave); keep only used animations (`wiggle`, `zoom_in`, `slide_in` move into `tokens.css`/`base.css` and leave the config empty of them if possible); `content` globs cover `./app`, `./components`, `./styles` (for `@apply` detection).
7. **Fix `bg-primary-600`:** map to token (`--primary` hover) or define — no dangling class names.
8. **Typography/scale:** prefer theme scale (spacing multiples of 4) — no one-off px values outside `tokens.css`.
9. **Bundle check:** utilities used only by first-party code disappear automatically once classes are gone — confirm `.next` CSS size shrinks vs baseline.

---

## 9. Migration Phases

> Commit convention: one commit per wave (`shadcn(wave-a): …`), so rollback = revert one commit.

- [ ] **P1 — Foundation**
  - [ ] Add deps from §6 (`class-variance-authority`, `tailwind-merge`, Radix set, `sonner`)
  - [ ] Create `lib/utils.ts` with `cn()`
  - [ ] Create `styles/` skeleton: `tokens.css` (D9 mapping), `base.css` (absorb current `globals.css` content), `utilities.css`
  - [ ] Rewrite `app/globals.css` to directives + imports only
  - [ ] Reset `tailwind.config.ts` to defaults + CSS-var colors (D5, D9); fix `bg-primary-600`; drop dead `canvas` entry
  - [ ] Obtain shadcn (`npx shadcn init` **or** GitHub-vendored fallback per D8); confirm v3-compatible (D6)
- [ ] **P2 — Primitives**
  - [ ] Vendor `ui/` components required by Wave A (`button`, `input`, `label`, `tooltip`, `spinner`)
  - [ ] Smoke-test each in isolation (temporary `/dev/ui` preview page, deleted at end of P2)
- [ ] **P3 — Component waves** (per component: replace UI → strip styles to `styles/components/*.css` → verify → commit)
  - [ ] Wave A — Button, FormInput, Spinner, Tooltip (122 LOC)
  - [ ] Wave B — Navbar, AuthForm, ZapCell, MainSection, PWAInstaller (614 LOC)
  - [ ] Wave C — Modal, PublishZap, ZapRunHistory, FilterBuilder (1,561 LOC)
  - [ ] Wave D — Gmail suite ×5 (1,477 LOC)
  - [ ] Wave E — metadata ×8 (974 LOC)
  - [ ] Wave F — pages ×9 + layout (833 LOC)
- [ ] **P4 — Toast migration**
  - [ ] Add `ui/sonner.tsx`, render `<Toaster />` in `layout.tsx`
  - [ ] Codemod 61 `toast.*` calls across 13 files → sonner
  - [ ] Remove `ToastContainer`, `react-toastify` CSS import, then the dependency
- [ ] **P5 — Strip gate (enforcement)**
  - [ ] Script `apps/web/scripts/check-no-inline-styles.sh` implementing the greps in §10
  - [ ] Wire into CI (`.github/workflows`) and `bun run lint`
  - [ ] Add ESLint rule banning `clsx`/`cn` imports in first-party files (allowlist: `components/ui/**`)
- [ ] **P6 — Simple-Tailwind pass** (apply all §8 Step-B rules; prune config; verify CSS size)
- [ ] **P7 — Cleanup**
  - [ ] Remove `react-toastify` remnants; prune unused Radix packages (post-wave audit)
  - [ ] Remove dead web deps: `dotenv`, `sharp`, `@types/axios`, `@types/minimatch`
  - [ ] Delete any temporary `/dev/ui` preview page
- [ ] **P8 — Verification** (§10 gates all green + visual QA checklist)

---

## 10. Verification Gates (must all pass at DoD)

**Automated:**
```bash
# 1) No tailwind utilities / arbitrary values in first-party TSX
grep -rEn 'className="[^"]*(\bflex\b|\bgrid\b|\bp-[0-9|\bm-[0-9]|\bw-|\bh-|\btext-(xs|sm|lg|xl|primary|secondary)|\bbg-(primary|secondary|base|white|black)|\bhover:|\bfocus:|\bsm:|\bmd:|\blg:)' \
  apps/web/components apps/web/app --include='*.tsx' | grep -v 'components/ui/'   # → 0 results
grep -rhoE '[a-z-]+-\[[^]]+\]' apps/web --include='*.tsx' | grep -v 'components/ui/' # → 0 results
grep -rn 'style={{' apps/web --include='*.tsx' | grep -v 'components/ui/'           # → 0 results
# 2) No toastify, no clsx outside ui/
grep -rn 'react-toastify' apps/web            # → 0
grep -rn "from 'clsx'" apps/web | grep -v 'components/ui/' | grep -v 'lib/utils'   # → 0
# 3) No banned CSS content
grep -rn '!important' apps/web/styles         # → 0
grep -rnE '#[0-9a-fA-F]{3,6}' apps/web/styles/components apps/web/styles/pages      # → 0 (tokens.css only)
# 4) Config sanity
grep -n 'xs:' apps/web/tailwind.config.ts     # → 0 (default screens)
# 5) Build & lint
bun run build && bun run lint                 # → pass
```
**Manual visual QA (per page, desktop + 360px):** `/`, `/login`, `/sign-up`, `/dashboard` (incl. open Modal, FilterBuilder, ZapRunHistory, PublishZap), `/profile`, `/editor`, `/gmail` (all 5 Gmail components), toast appearance on success + error, PWA install prompt still fires.

**Regression watch-list:** Modal focus trap & scroll lock (Radix `dialog`), Navbar mobile sheet, keyboard navigation in Select/Dropdown (Radix), breakpoint behavior change from D5 (custom → default screens).

---

## 11. Risks & Rollback

| Risk | Mitigation |
|---|---|
| `ui.shadcn.com` unreachable in sandbox | D8 GitHub-vendoring fallback (`github.com/shadcn-ui/ui`) |
| Tailwind v4-only component code pasted into v3 project | D6 checklist: verify `@theme`/renamed utilities per component at vendoring time |
| `Modal.tsx` (651 LOC) refactor regressions | Wave C isolated commit; manual QA items in §10; keep `modal/constants.ts`/`types.ts` untouched |
| D5 breakpoint change alters responsive behavior | First-party responsive CSS uses explicit px media queries; QA at 360/768/1280 |
| Visual drift while restyling | G4: match tokens to current hexes exactly; screenshot-compare before/after per wave |
| Rollback | One commit per wave; revert a single wave without undoing others |

---

## 12. Completion Checklist & Status

Legend: **[x] = completed** · **[ ] = not yet started**

**Phase 0 — Audit & Specification**
- [x] Audit current state (shadcn 0%, 26 custom components / 4,490 LOC, 524 inline `className`s, 45+ arbitrary values, react-toastify 13 files/61 calls, 1 stylesheet, config bugs found)
- [x] Inventory & LOC sizing of all 26 components + 9 pages
- [x] Define target architecture (3-layer: `styles/` · `components/ui/` · logic-only first-party)
- [x] Define full component → shadcn mapping (Waves A–F, §5)
- [x] Define style-separation conventions & naming rules (§7)
- [x] Define Tailwind strip-then-reintroduce policy (§8)
- [x] Define dependency add/remove list (§6)
- [x] Define verification gates, risks & rollback (§10–11)
- [x] **Write this spec** → `reports/shadcn-migration-spec.md`

**P1 — Foundation**
- [x] Install deps (`class-variance-authority`, `tailwind-merge`, Radix set, `sonner`, `tailwindcss-animate`); add `lib/utils.ts` `cn()`
- [x] Create `styles/` skeleton (`tokens.css`, `base.css`, `utilities.css`); rewrite `app/globals.css`
- [x] Reset `tailwind.config.ts` (default breakpoints, CSS-var colors, fix `bg-primary-600`, drop dead entries)
- [x] Init/vendor shadcn (registry or GitHub fallback), v3-verified — *done via hand-vendored v3 components (D8 fallback: registry unreachable from sandbox)*

**P2 — Primitives**
- [x] Vendor Wave-A `ui/` components (`button`, `input`, `label`, `tooltip`, `spinner`) + smoke test — *build-verified*

**P3 — Component waves (style files split out, Tailwind stripped from TSX)**
- [x] Wave A — Button, FormInput, Spinner, Tooltip — **pilot delivered**: 4 logic-only components + `styles/components/{button,form-input,spinner,tooltip}.css`; gates green (0 utilities / 0 arbitrary values / 0 inline styles / semantic classNames only); `next build` ✅
- [ ] Wave B — Navbar, AuthForm, ZapCell, MainSection, PWAInstaller
- [ ] Wave C — Modal, PublishZap, ZapRunHistory, FilterBuilder
- [ ] Wave D — Gmail suite ×5
- [ ] Wave E — metadata ×8
- [ ] Wave F — pages ×9 + layout

**P4 — Toasts**
- [ ] Migrate 61 `toast.*` calls → sonner; `<Toaster />` in layout; remove `react-toastify`

**P5 — Enforcement**
- [ ] Inline-style check script + CI wiring + ESLint `clsx`/`cn` ban outside `components/ui/`

**P6 — Simple-Tailwind best-practices pass**
- [ ] Apply all §8 rules; prune config; measure `.next` CSS size vs baseline

**P7 — Cleanup**
- [ ] Remove dead deps (`dotenv`, `sharp`, `@types/axios`, `@types/minimatch`); prune unused Radix pkgs; delete temp preview page

**P8 — Verification**
- [ ] All §10 automated gates green (`bun run build`, `bun run lint`, greps → 0)
- [ ] Manual visual QA checklist passed (all pages, 360/768/1280, toasts, Modal a11y)

**Definition of Done** = every box above checked; first-party TSX contains zero Tailwind/CSS; 100% of UI routed through shadcn primitives; all styles living in `apps/web/styles/**`; Tailwind limited to tokens + preflight + ≤10 shared utilities.

---
*Authored during session `arena/f0c028cc-zapier`. **Progress (2026-10-17):** Phase 0 ✅ · P1 ✅ · P2 ✅ · Wave A ✅ (pilot) — remaining phases open pending pilot approval. Implementation answers locked: semantic CSS files per component · shadcn vendor layer keeps its classes (D2) · toasts → sonner (D7) · pilot-first rollout.*
