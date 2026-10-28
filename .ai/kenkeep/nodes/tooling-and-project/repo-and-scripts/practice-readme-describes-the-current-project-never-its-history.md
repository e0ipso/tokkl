---
type: practice
title: 'README, docs and comments describe the current project, never its history'
description: >-
  README.md, docs and code comments document how Tokkl works now. No rename
  story, audit dates, before-and-after history or tuning notes.
tags:
  - docs
  - readme
  - comments
kk_schema_version: 3
kk_id: practice-readme-describes-the-current-project-never-its-history
kk_derived_from:
  - 'a8ccde73-a7bd-471e-8daf-eafb3524a6fb:practice:0'
  - 'b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:practice:0'
kk_relates_to:
  - >-
    practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs
  - map-tokkl-rename-legacy-name-fallbacks
kk_depends_on: []
kk_confidence: medium
---
`README.md` describes the project as it is today. It does not document history: no account of the old name, no "upgrading from" sections, no references to past audits or dated events, no notes about files that were renamed or replaced.

When a README section needs context, state the current fact (where a file lives, which command to run) and leave the story of how it got that way to git.

The same rule covers code comments and the other docs (`docs/`, the desktop READMEs). They say what a file, constant or asset is and which constraint a value satisfies. They carry no before-and-after history ("before, this tinted a filled shape") and no tuning notes about which values were tried before one was chosen.

<!-- kk:related:start -->
# Related

- Related: [practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md)
- Related: [map-tokkl-rename-legacy-name-fallbacks](map-tokkl-rename-legacy-name-fallbacks.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] a8ccde73-a7bd-471e-8daf-eafb3524a6fb:practice:0
[2] b647f585-ce8f-44a2-8bb9-fdf30d08dbe4:practice:0
<!-- kk:citations:end -->
