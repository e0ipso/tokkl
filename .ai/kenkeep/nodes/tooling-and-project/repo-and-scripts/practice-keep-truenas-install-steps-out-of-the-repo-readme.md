---
type: practice
title: Keep TrueNAS install steps out of the repo README
description: >-
  The README documents generic Docker use only. Install steps for TrueNAS or
  other NAS admin screens stay out of the repo.
tags:
  - docs
  - readme
  - deployment
  - truenas
kk_schema_version: 3
kk_id: practice-keep-truenas-install-steps-out-of-the-repo-readme
kk_derived_from:
  - '5470b272-9bff-4eb0-8fe5-ffc3d686cda3:practice:0'
kk_relates_to:
  - >-
    practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs
kk_depends_on: []
kk_confidence: medium
---
`README.md` does not carry TrueNAS (or other NAS admin UI) install steps. Steps for a third-party screen that nobody on the project can see or test go stale and wrong. TrueNAS installs belong with the TrueNAS app, which handles storage permissions itself.

The README's Docker section keeps only the generic rule: run with `--user` and mount a directory that UID owns.

<!-- kk:related:start -->
# Related

- Related: [practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs](practice-keep-sift-ticket-ids-and-strikethroo-plans-out-of-code-and-public-docs.md)
<!-- kk:related:end -->

<!-- kk:citations:start -->
# Citations

[1] 5470b272-9bff-4eb0-8fe5-ffc3d686cda3:practice:0
<!-- kk:citations:end -->
