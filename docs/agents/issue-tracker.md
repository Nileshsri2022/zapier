# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues in `Nileshsri2022/zapier`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## CLI version constraint: no sub-issues, no native dependencies

This sandbox runs **`gh` 2.23.0**. GitHub sub-issues (`gh issue create --parent`) and native issue
dependencies (`/dependencies/blocked_by`) need `gh` 2.94+ / the dependency REST endpoints, so
**always use the text fallbacks below**. Do not retry the native commands and do not upgrade `gh`
mid-flow.

| Need | Use instead |
| --- | --- |
| Child ticket of a parent | `Part of #<parent>` as the first line of the child body |
| Blocking edge | `Blocked by: #<n>, #<n>` near the top of the child body |
| Task list of children | A checklist in the parent body: `- [ ] #<child>` |

A ticket is unblocked when every issue on its `Blocked by:` line is **closed**. A ticket is claimed
when it has an assignee.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with
`gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --json number,title,body,labels,comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue; its **tickets** are child issues.

Labels are not auto-created by `gh issue create`, so run this once before the first map:

```bash
for l in wayfinder:map wayfinder:research wayfinder:prototype wayfinder:grilling wayfinder:task; do
  gh label create "$l" --color 5319e7 --description "Wayfinder" || true
done
```

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
  `gh issue create --label wayfinder:map --title "<destination>" --body "<map body>"`.
- **Child ticket**: create the issue, then add `Part of #<map>` as its first body line and append
  `- [ ] #<child>` to the map's task list. Labels: `wayfinder:<type>`
  (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: `Blocked by: #<n>, #<n>` near the top of the child body.
- **Frontier query**: list open issues labelled by the map's child types, drop any with an assignee
  or with an open issue on its `Blocked by:` line; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a
  context pointer (gist + link) to the map's Decisions-so-far.

## Legacy: `.scratch/`

`.scratch/<feature>/issues/NN-<slug>.md` files predate this configuration (e.g.
`.scratch/discord-send-message/`). Treat them as **historical primary sources, not a live tracker**:
read them when they are relevant, never write new tickets there.
