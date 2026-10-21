# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual
label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

## Repo state

All five labels exist in `Nileshsri2022/zapier`. `wontfix` was already a GitHub default; the other
four were created by `/setup-matt-pocock-skills`.

## Category roles are separate

`/triage` also applies one **category** label alongside the role above:

| Role | Label |
| --- | --- |
| `bug` | `bug` (GitHub default) |
| `enhancement` | `enhancement` (GitHub default) |

Do not reuse the role strings for categorisation, and do not create `bug:triage`-style duplicates.

## When a skill says "apply the AFK-ready triage label"

Apply `ready-for-agent`.

## Tickets made by `/to-tickets` are already agent-ready

`/to-tickets` publishes tickets with `ready-for-agent` set. Do **not** route its output back through
`/triage`; triage is for issues this repo did not create.
