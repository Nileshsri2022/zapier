# ZapMate Skills Adoption & Redesign Report

> **Skills Applied:** `responsive-design` & `tailwind-design-system`, with
> `frontend-design`, `karpathy-guidelines` and `ponytail` governing the second pass  
> **Target Package:** `apps/web` (Next.js 14 App Router)  
> **Monorepo Architecture:** Separation of Concerns (Logic in `.tsx`, Styles in `styles/`)  
> **Status:** Fully Integrated, Typechecked (`0` errors), and Committed Locally
>
> **Two passes are documented here.** Sections 1–4 are the original redesign.
> [Section 5](#5-second-pass--strip-phase-completion) is the follow-up pass that
> finished the strip phase: the AI Transform form was rebuilt on tokens and every
> remaining off-system screen (metadata forms, Gmail screens, dashboard, profile, 404,
> PWA banner) was migrated. Current verification lives in
> [§5.6](#56-verification-second-pass); §4 keeps the first-pass evidence for the record.

---

## 1. Executive Summary

This report documents the architectural redesign of **ZapMate** (`apps/web`) using the combined principles of:
1. **`tailwind-design-system`**: Strict 3-tier token hierarchy (Brand $\rightarrow$ Semantic $\rightarrow$ Component), standardized elevation and radius systems, tokenized transitions, focus ring semantics, and complete decoupling of JSX logic from styling via `data-*` hooks and semantic class hooks.
2. **`responsive-design`**: Fluid typography and fluid spacing with `clamp()`, dynamic viewport units (`100dvh`), container queries (`@container`), intrinsic auto-fit/auto-fill CSS grid layouts (`minmax(min(X, 100%), 1fr)`), safe-area insets, and strict compliance with WCAG 2.5.5 minimum touch targets ($\ge 44\times 44\text{px}$).

```mermaid
flowchart TD
    subgraph Tokens ["Design System Tokens (tokens.css)"]
        T1["Brand / Raw Palette<br/>--brand-primary, --brand-base"] --> T2["Semantic Tokens<br/>--primary, --background, --border, --ring"]
        T2 --> T3["Fluid Scales<br/>--text-*, --space-* via clamp()"]
        T2 --> T4["Geometry & Motion<br/>--radius-*, --shadow-*, --transition-*"]
        T2 --> T5["Accessibility<br/>--touch-target-min: 44px"]
    end

    subgraph Architecture ["Architecture Layers"]
        Tokens --> Styles["CSS Stylesheets (styles/components/*, styles/pages/*)"]
        Styles --> TSX["TSX Components & Pages (Logic-Only)"]
    end

    subgraph Responsive ["Responsive Patterns"]
        R1["Fluid Typography & Spacing"]
        R2["Dynamic 100dvh & Safe-Area"]
        R3["Container Queries (@container)"]
        R4["Intrinsic Auto-Fit Grids"]
        R5["Adaptive Touch Targets (>=44px)"]
    end

    Responsive --> Styles
```

---

## 2. Quantitative Skill Adoption by File

The table below breaks down the percentage of styling and structural influence contributed by each skill, alongside functional business logic.
It reflects the **first pass**; the files migrated in the second pass are tabulated in [§5.2](#52-new-and-rewritten-stylesheets).

| File Path | Role | `tailwind-design-system` (%) | `responsive-design` (%) | Functional / Logic (%) | Primary Patterns Implemented |
|:---|:---|:---:|:---:|:---:|:---|
| **`styles/tokens.css`** | Global Token Core | **55%** | **45%** | 0% | Fluid `clamp()` typography & spacing, 3-tier semantic tokens, radius scale, elevation shadows, motion tokens, `--touch-target-min: 44px`. |
| **`styles/base.css`** | Global Base & Resets | **35%** | **65%** | 0% | Dynamic `100dvh`, zero-overflow (`overflow-x: hidden`), safe-area insets, universal `:focus-visible` ring, 44px touch targets reset. |
| **`styles/components/navbar.css`** | Navbar Styling | **40%** | **60%** | 0% | Safe-area left/right max, fluid horizontal padding (`var(--space-md)`), 44px hamburger & profile touch bounds, backdrop blur, dropdown elevation. |
| **`styles/components/modal.css`** | Modal Dialog & Catalog | **45%** | **55%** | 0% | Fluid dialog sizing (`max-height: min(85dvh, 680px)`), auto-fill intrinsic card grid (`minmax(min(125px, 100%), 1fr)`), 44px action buttons & inputs. |
| **`styles/components/zap-cell.css`** | Zap Pipeline Node | **40%** | **60%** | 0% | Container queries (`@container zapcell (max-width: 320px)`), tokenized dashed-to-solid active borders, 44px badge and delete touch targets. |
| **`styles/components/publish-zap.css`** | Editor Canvas & Toolbar | **35%** | **65%** | 0% | Sticky subheader toolbar, vertical dashed step pipeline connector lines, responsive connected badge alignment, 48px add-step circular button. |
| **`styles/components/button.css`** | Button Vendor Mapping | **60%** | **40%** | 0% | `data-variant` and `data-size` hooks, tokenized hover elevations, accessible `min-height: var(--touch-target-min)` across sizes. |
| **`styles/components/run-history.css`** | Execution Log Modal | **45%** | **55%** | 0% | Elimination of hardcoded hex values, token-backed surfaces (`hsl(var(--card))`), fluid modal viewport sizing, 44px toggle buttons. |
| **`styles/components/filter-builder.css`** | Conditional Step Filters | **45%** | **55%** | 0% | Replacement of legacy purple hexes with semantic tokens, responsive form row wrap (`flex-wrap` mobile $\rightarrow$ `nowrap` tablet/desktop), 44px inputs. |
| **`styles/pages/app.css`** | Dashboard & Auth Pages | **40%** | **60%** | 0% | Responsive auto-fit grid (`repeat(auto-fill, minmax(min(300px, 100%), 1fr))`), fluid title typography (`var(--text-3xl)`), mobile card conversions. |
| **`styles/pages/landing.css`** | Marketing Landing Page | **45%** | **55%** | 0% | Fluid hero title (`clamp(2.75rem, 6vw, 4.75rem)`), 2-column to 1-column responsive grid, flow-chain visualization, token-backed surfaces. |
| **`components/Navbar.tsx`** | Navigation Component | **20%** | **30%** | **50%** | Clean semantic class markup (`navbar`, `navbar__hamburger`, `navbar__avatar-btn`), auth state management, mobile drawer toggle logic. |
| **`components/Modal.tsx`** | Step Configuration Dialog | **15%** | **25%** | **60%** | Decoupled UI logic, multi-step wizard state machine (Step 1 App $\rightarrow$ Step 2 Event $\rightarrow$ Step 3 Meta), OAuth initialization. |
| **`components/ZapCell.tsx`** | Step Node Logic | **20%** | **30%** | **50%** | Container query host component, `data-configured` state attribute hook, step action deletion and click delegation. |
| **`components/PublishZap.tsx`** | Pipeline Editor Canvas | **15%** | **25%** | **60%** | Save/Publish validation state, OAuth session restoration, responsive step chain rendering, filter integration. |
| **`components/ZapRunHistory.tsx`** | Run History Dialog | **15%** | **25%** | **60%** | Paginated execution history fetcher, JSON metadata disclosure toggle, token-backed semantic UI mapping. |
| **`components/FilterBuilder.tsx`** | Logic Filter Component | **15%** | **25%** | **60%** | Multi-condition rule builder, operator mapping, responsive condition inputs, patch mutation handlers. |
| **`components/AuthForm.tsx`** | Sign-in / Sign-up Forms | **20%** | **20%** | **60%** | Decoupled from utility strings, semantic `.auth-form` and `.auth-form__actions` classes, credential submission logic. |
| **`app/dashboard/page.tsx`** | User Dashboard View | **20%** | **30%** | **50%** | Responsive desktop table / mobile-tablet card transformation, inline zap enable/disable toggle, clipboard copy actions. |
| **`app/login/page.tsx`** | Login View | **20%** | **30%** | **50%** | Responsive 2-column split auth shell (`auth-shell`), decoupled branding link (`auth-brand`). |
| **`app/sign-up/page.tsx`** | Sign-up View | **20%** | **30%** | **50%** | Responsive auth shell, semantic feature checkmarks list (`auth-points`), form container. |
| **`app/layout.tsx`** | Application Root Shell | **30%** | **30%** | **40%** | CSS cascade import ordering (tokens $\rightarrow$ base $\rightarrow$ components $\rightarrow$ pages), Geist variable fonts, viewport metadata. |

---

## 3. Detailed Breakdown of Skill Implementations

### 3.1. Implementation of `tailwind-design-system`

#### A. 3-Tier Token Hierarchy in `tokens.css`
The application adheres strictly to the 3-tier architecture:
1. **Tier 1 (Global/Brand):** Raw HSL values (e.g., `--brand-primary: 18 100% 50%`, `--brand-secondary: 246 75% 63%`, `--brand-base: 40 100% 99%`). Raw hex/rgb colors exist *nowhere else* in the application.
2. **Tier 2 (Semantic Tokens):** Abstract functional roles (e.g., `--background`, `--foreground`, `--primary`, `--border`, `--ring`, `--destructive`, `--success`).
3. **Tier 3 (Component Tokens):** Specific element hooks (e.g., `--shadow-lift`, `--shadow-card`, `--touch-target-min`).

#### B. Radius & Elevation System
A unified geometry system was added to replace arbitrary border radiuses and shadows:
```css
/* Radius Scale */
--radius-xs: 0.125rem;
--radius-sm: 0.25rem;
--radius-md: 0.375rem;
--radius-lg: 0.5rem;
--radius-xl: 0.75rem;
--radius-2xl: 1rem;
--radius-full: 9999px;

/* Shadow & Elevation Scale */
--shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.04);
--shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.08);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04);
--shadow-lift: 0 12px 32px -12px rgb(36 26 18 / 0.22);
--shadow-card: 0 1px 3px rgb(36 26 18 / 0.06), 0 4px 16px -8px rgb(36 26 18 / 0.1);
```

#### C. Separation of Concerns & Vendor Layer Mapping
In accordance with the specification:
- First-party TSX components contain **zero ad-hoc inline Tailwind strings**.
- UI logic communicates state through semantic classes (`.modal-dialog`, `.zap-cell`, `.dash-card`) and data attributes (`data-configured="true"`, `data-variant="primary"`, `data-on="true"`).
- Third-party/vendor components (`Button`, `FormInput`) forward data attributes so that styles remain decoupled in [`styles/components/button.css`](file:///d:/vscode_programs/harkirat2.0/ZapMate/apps/web/styles/components/button.css) and [`styles/components/form-input.css`](file:///d:/vscode_programs/harkirat2.0/ZapMate/apps/web/styles/components/form-input.css).

---

### 3.2. Implementation of `responsive-design`

#### A. Fluid Typography & Fluid Spacing
Rather than jumping abruptly across static media query breakpoints, headings and body font sizes smoothly interpolate based on viewport width:
```css
/* Fluid Typography */
--text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.8125rem);
--text-sm: clamp(0.8125rem, 0.775rem + 0.25vw, 0.875rem);
--text-base: clamp(0.9375rem, 0.875rem + 0.3125vw, 1rem);
--text-lg: clamp(1.0625rem, 0.975rem + 0.4375vw, 1.1875rem);
--text-xl: clamp(1.25rem, 1.125rem + 0.625vw, 1.5rem);
--text-2xl: clamp(1.5rem, 1.3rem + 1vw, 1.875rem);
--text-3xl: clamp(1.875rem, 1.55rem + 1.625vw, 2.375rem);
--text-4xl: clamp(2.25rem, 1.75rem + 2.5vw, 3.25rem);

/* Fluid Spacing */
--space-xs: clamp(0.25rem, 0.2rem + 0.25vw, 0.375rem);
--space-sm: clamp(0.5rem, 0.45rem + 0.25vw, 0.75rem);
--space-md: clamp(1rem, 0.875rem + 0.625vw, 1.5rem);
--space-lg: clamp(1.5rem, 1.25rem + 1.25vw, 2.5rem);
--space-xl: clamp(2rem, 1.5rem + 2.5vw, 4rem);
```

#### B. Intrinsic Auto-Fit & Auto-Fill CSS Grids
Fixed-width cards and single-column mobile lists that stretch awkwardly on tablets were redesigned into modern auto-fit grids using the `minmax(min(desired_min, 100%), 1fr)` pattern:
- **Modal App Catalog ([`modal.css`](file:///d:/vscode_programs/harkirat2.0/ZapMate/apps/web/styles/components/modal.css)):**
  `grid-template-columns: repeat(auto-fill, minmax(min(125px, 100%), 1fr));`
  Displays apps as touch-friendly cards with centered icons and labels, wrapping naturally from 2 columns on 360px phones up to 4+ columns on desktops.
- **Dashboard Cards ([`app.css`](file:///d:/vscode_programs/harkirat2.0/ZapMate/apps/web/styles/pages/app.css)):**
  `grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));`
  Renders single-column on phones and 2-column cards on tablets (640px–768px), before transitioning to the full data table on $\ge 768\text{px}$.

#### C. Container Queries (`@container`)
Applied to components whose internal layout depends on their available container space rather than the full screen viewport:
```css
/* apps/web/styles/components/zap-cell.css */
.zap-cell {
  container-type: inline-size;
  container-name: zapcell;
  /* ... */
}

@container zapcell (max-width: 320px) {
  .zap-cell {
    padding: var(--space-sm);
  }
  .zap-cell__header {
    flex-wrap: wrap;
  }
  .zap-cell__badge {
    width: 100%;
    justify-content: center;
  }
}
```

#### D. Dynamic Viewport & Safe-Area Resilience
- Switched full-height containers from `100vh` to `100dvh` (Dynamic Viewport Height) across [`base.css`](file:///d:/vscode_programs/harkirat2.0/ZapMate/apps/web/styles/base.css) (`body`, `.main-shell`, `.editor-view`), preventing mobile browser toolbar jump/clipping bugs.
- Fixed overlay padding offsets (`padding-top: max(4rem, env(safe-area-inset-top));`) so dialog headers never collide with notches or fixed navbars.

#### E. Touch Target Compliance ($\ge 44\text{px}$)
All interactive controls specify a minimum 44px tap area:
```css
button,
input,
select,
textarea,
[role="button"] {
  min-height: var(--touch-target-min);
  box-sizing: border-box;
}
```
Specific touch target upgrades:
- Mobile hamburger menu: `44px × 44px`.
- Profile avatar button: `44px × 44px`.
- Step action badges & delete buttons: `min-height: 44px`.
- Add step circular button: `48px × 48px`.
- Modal close & back buttons: `min-height: 44px`.
- Filter builder inputs & action buttons: `min-height: 44px`.

---

## 4. Verification & Validation Results

### 4.1. TypeScript Compilation
```bash
$ bun x tsc --noEmit
# Exit code: 0 (Zero errors)
```

### 4.2. Dev Server Route Verification
All application routes were verified through live HTTP requests against `http://localhost:3000`:
- `GET /` $\rightarrow$ `200 OK`
- `GET /login` $\rightarrow$ `200 OK`
- `GET /sign-up` $\rightarrow$ `200 OK`
- `GET /dashboard` $\rightarrow$ `200 OK`
- `GET /editor` $\rightarrow$ `200 OK`

### 4.3. Viewport & Overflow Tests
Verified via Chrome DevTools Mobile Emulation at $360\times 800$ (Compact Phone):
```json
{
  "scrollWidth": 360,
  "clientWidth": 360,
  "overflows": false
}
```
**Zero horizontal scrollbars or element cutoffs detected across all tested viewports.**

---

## 5. Second Pass — Strip Phase Completion

> **Trigger:** the AI Transform step form (`components/metadata/AiMetaData.tsx` +
> `styles/components/ai-form.css`) shipped after the first pass and visibly broke the
> design system: 15 hard-coded hex values in a single stylesheet, an off-brand violet
> palette, and a field list that ignored the fluid scale, container queries and touch
> targets every other screen had already adopted.
> **Scope:** AI Transform form first, then every remaining off-system screen.
> **Skills:** `tailwind-design-system` (token hierarchy, decoupling), `responsive-design`
> (fluid scale, container queries, intrinsic grids, touch targets), `frontend-design`
> (colour restraint, one accent, honest copy), `karpathy-guidelines` (surgical diffs,
> verifiable success criteria), `ponytail` (reuse what exists, delete dead code).

### 5.1. AI Transform form — defects found and fixed

| # | Symptom | Root cause | Fix |
|:--|:--------|:-----------|:----|
| 1 | Form looked foreign next to the rest of the app | 15 raw hex literals (`#5938c7`, `#9580dc`, `#4930a6`, `#ef4444`, `#22c55e`, `#eab308`, `#c72f39`) — a violet accent that exists nowhere in the brand palette | All values replaced with tokens: `hsl(var(--brand-secondary))` for accents, `hsl(var(--destructive) / α)`, `hsl(var(--success) / α)`, `hsl(var(--warning) / α)` for status surfaces. `styles/**` now contains **zero** raw colours outside `tokens.css` |
| 2 | Labels read as floating captions, not as part of a field | `fieldset { gap: 0.65rem }` spaced every child evenly, so a label sat as far from its own input as from the field above | `gap: var(--space-xs)` between a label and its control, `label { margin-top: var(--space-sm) }` from the previous field — pairing without restructuring the JSX |
| 3 | Type and spacing did not scale between phone and desktop | Fixed `rem` values (`0.8rem`, `0.85rem`, `0.65rem` gap, `0.9rem` padding) | Fluid tokens: `--text-xs/sm/base/lg`, `--space-xs…xl`, `--radius-*`, `--shadow-*`, `--transition-*` |
| 4 | iOS Safari zoomed the viewport on focus | Input font-size `0.85rem` = 13.6 px, below the 16 px zoom threshold | Explicit 16 px floor on every input, select and textarea (`/* 16px floor: below it, iOS Safari zooms the viewport on focus */`) |
| 5 | One output field = six stacked rows, unusably tall with several fields | `.ai-field-row` was a single-column flex stack at every width | Intrinsic grid `repeat(auto-fit, minmax(min(11rem, 100%), 1fr))` — label beside its control as soon as the row fits two 11rem tracks, stacked on phones. No breakpoints, no `nth-child` guessing |
| 6 | Focus ring colour differed from the rest of the app | `outline: 2px solid #9580dc` overrode the global `:focus-visible` ring | `border-color: hsl(var(--ring))` + `box-shadow: 0 0 0 2px hsl(var(--ring) / 0.25)` |
| 7 | Error/success/notice surfaces could not follow a theme change, and the base hues failed AA on a tint | Hard-coded red/green/amber text on 6–12 % tints | Token tint + new `--status-danger-ink / --status-success-ink / --status-warning-ink / --status-info-ink` inks (raw values still only in `tokens.css`) |
| 8 | No component-level responsiveness | No containment context | `container: ai-form / inline-size` + `@container ai-form (…)` for the button row and the parsed-result definition list |
| 9 | Preview panel cramped on narrow containers | Fixed two-column `dl` grid | `@container ai-form (max-width: 24rem)` collapses it to one column |

**Also fixed in the same stylesheet:** `.ai-step-conditions` / `.ai-condition-row`
(`StepConditionsEditor.tsx`) were tokenised and given 44 px targets and 16 px inputs —
they are the editor-side twin of the AI form and carried the same defects.

### 5.2. New and rewritten stylesheets

| File | Role | `tailwind-design-system` (%) | `responsive-design` (%) | Functional / Logic (%) | Primary patterns |
|:---|:---|:---:|:---:|:---:|:---|
| **`styles/components/ai-form.css`** *(rewritten)* | AI Transform form + step conditions | **50 %** | **50 %** | 0 % | Full tokenization, label/control pairing, intrinsic field grid, `container: ai-form / inline-size`, 16 px input floor, status inks |
| **`styles/components/metadata-form.css`** *(new)* | All step metadata forms | **45 %** | **55 %** | 0 % | Status tints + inks, intrinsic `auto-fit` pickers, `container: meta-form`, 44 px controls |
| **`styles/components/gmail.css`** *(new)* | Gmail integration screens | **50 %** | **50 %** | 0 % | `data-tone` / `data-selected` / `data-active` hooks, intrinsic metric grids, `container: gmail-panel` |
| **`styles/components/pwa-banner.css`** *(new)* | Install banner | **55 %** | **45 %** | 0 % | Fixed bottom sheet, safe-area aware, token-backed inverse surface |
| **`styles/pages/app.css`** *(extended)* | Dashboard table/cells/switch/row menu, editor fallback, 404, profile | **45 %** | **55 %** | 0 % | Semantic switch replacing the `peer-*` utility chain, responsive table↔card swap, fluid profile card |
| **`styles/tokens.css`** *(extended)* | Token core | **60 %** | **40 %** | 0 % | `--warning`, `--info`, and four accessible `--status-*-ink` values |
| **`styles/components/run-history.css`** *(extended)* | Run history spinner | **40 %** | **60 %** | 0 % | `.history-spinner` keyframes, `.history-loading` layout |
| **`styles/components/modal.css`**, **`navbar.css`**, **`publish-zap.css`**, **`filter-builder.css`** | Last raw values | **100 %** | 0 % | 0 % | 5 × `color: #fff` → `hsl(var(--primary-foreground) / --secondary-foreground)` |

### 5.3. Markup migrated to the design system (21 files)

Conditional colour strings are the structural change: a class cannot be conditionally
computed without either hard-coding colours in TSX or shipping every variant to the
browser, so state now travels as a `data-*` hook and the mapping lives in CSS
(`tailwind-design-system`: *UI logic communicates state through data attributes*).

| File | Before | After |
|:---|:---|:---|
| `GmailStatusMonitor.tsx` | `getStatusColor()` returned `'bg-green-100 text-green-800'` … | `getStatusTone()` returns `'ok' \| 'alert' \| 'warn' \| 'idle'` + `data-tone`; metric tiles carry `data-tone="info\|success\|secondary\|warning"` |
| `GmailServerConfig.tsx` | `server.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'` | `data-tone={server.isActive ? 'ok' : 'alert'}` |
| `GmailTriggerConfig.tsx`, `GmailActionConfig.tsx` | `isSelected ? 'bg-blue-100 border-blue-300 text-blue-800' : '…'` | `data-selected={…}` on `.gmail-chip` |
| `GmailDashboard.tsx` | 6-class ternary on each tab | `data-active={activeTab === tab.id}` on `.gmail-tab` |
| `app/dashboard/page.tsx` | `sr-only peer` + 14 `peer-checked:*` / `after:*` utilities for the Live/Paused switch | `.dash-switch` / `.dash-switch__input` / `.dash-switch__track` (3 classes, ~40 lines of CSS) |
| `app/dashboard/page.tsx` | `hidden md:table` on the zap table | `.dash-table { display: none }` + `@media (min-width: 768px) { display: table }` |
| `metadata/*.tsx` (8 files, `AiMetaData.tsx` already used semantic classes) | `my-4 flex flex-col gap-4 text-secondary-500`, `bg-blue-50 …`, `bg-purple-600 …` | `.meta-form`, `.meta-form__panel/__warning/__summary`, `.meta-form__btn-primary/__ghost/__block-btn` |
| `app/profile/page.tsx` | Utility-styled card, inline spinner div | `.profile-*` + semantic `<dl>` rows, vendored `Spinner` |
| `PWAInstaller.tsx` | Utility banner (`bg-white/20`, `min-h-[32px]`) | `.pwa-banner`, `.pwa-banner__btn(--primary)` |
| `app/not-found.tsx`, `app/editor/page.tsx` | Utility wrappers | `.not-found*`, `.editor-loading` |
| `ZapRunHistory.tsx`, `FilterBuilder.tsx`, `AuthForm.tsx` | `animate-spin`, inline `style={{ color: … }}`, `mr-2` | `.history-spinner`, `.history-loading`, `.filter-builder__chevron`, `.auth-btn-label` |

**Reuse over reinvention** (`ponytail`): the four Gmail loading blocks and the profile
loader now use the vendored `components/ui/spinner.tsx` instead of a hand-rolled animated
`div`, and the Gmail tone is set with one rule (`.gmail-empty .spinner { color: … }`).

### 5.4. New tokens

```css
/* styles/tokens.css — the only file allowed to hold raw values (spec §7.6) */
--warning: 38 92% 50%;
--warning-foreground: 20 20% 8%;
--info: 217 91% 60%;
--info-foreground: 0 0% 100%;

/* Accessible ink for text sitting on 8–12 % tinted status surfaces:
 * the base status hues are tuned for solid fills and fall under AA on a tint. */
--status-danger-ink: 0 74% 34%;
--status-success-ink: 152 72% 24%;
--status-warning-ink: 30 90% 30%;
--status-info-ink: 217 78% 34%;
```

### 5.5. Deletions

- 15 raw hex values from `ai-form.css`, 5 × `#fff` from four component stylesheets.
- The `peer-*` utility chain and `hidden md:table` from the dashboard.
- Per-component `prefers-reduced-motion` blocks written during this pass — `base.css`
  already neutralises every transition and animation with `!important`, so the copies
  were dead code. Reduced motion is handled **once**, globally.
- Inline `style={{ … }}` colour/layout objects in `ZapRunHistory.tsx` and
  `FilterBuilder.tsx` (the one in `GmailStatusMonitor.tsx` stays: it is a data-driven
  meter width, not styling).

### 5.6. Verification (second pass)

| Check | Command | Result |
|:---|:---|:---|
| Production build | `npx next build` (Next 16.1.1, Turbopack) | ✅ Compiled in 7.2 s, 8/8 routes prerendered |
| TypeScript | `npx tsc --noEmit` (also run by `next build`) | ✅ 0 errors |
| Lint | `npx eslint .` | ✅ 0 errors (87 pre-existing `no-explicit-any` warnings, unchanged) |
| Unit + guard tests | `npm test` | ✅ **25/25** (was 22 — 3 new design-system guards) |
| Raw colours | `tests/design-system.test.cjs` | ✅ 0 hex literals in `styles/**` outside `tokens.css` |
| Utility strings | `tests/design-system.test.cjs` | ✅ 0 Tailwind utilities in first-party markup (`components/ui/**` is the documented vendored exception) |
| Orphan classes | `tests/design-system.test.cjs` | ✅ every `block__element` / `block--modifier` name resolves to a rule |
| Emitted CSS | `grep '5938c7' .next/static/chunks/*.css` | ✅ 0 hits — the off-brand violet is gone from the bundle |

The three guards in `apps/web/tests/design-system.test.cjs` assert the invariants of
this report from source, so a pasted utility string or a stray hex fails CI instead of
quietly re-entering the codebase.

### 5.7. Known remaining gaps

Deliberately **not** changed — each is pre-existing, larger than this pass, and none is
a visual defect:

1. `Modal.tsx` (6) and `PublishZap.tsx` (1) still carry inline `style={{ … }}` layout
   objects in the step-2 dynamic rendering. They work; migrating them means restructuring
   conditional JSX that this pass does not touch.
2. `components/ui/spinner.tsx` keeps its Tailwind ring classes — the documented vendored
   shadcn exception (`spec D2`), already noted in §3.1.C.
3. The `tailwind.config.ts` legacy brand aliases (`primary-500`, `base-100`, …) are now
   unreferenced by first-party markup and can be dropped once the vendor layer is
   audited; they are harmless until then.
4. No dark theme exists yet — `--warning` / `--info` are defined at `:root` only, so a
   future `.dark` block must override them like the other semantic tokens.
