---
schema_version: 3
nodes_hash: 'sha256:6767be40de8a5919c2c7b7d03eb3ab858a4c9d0febd69aadd53e8f01ef47d624'
node_count: 114
---
# kenkeep

> kenkeep navigation: the injected body above is the root index node, the top-level catalog of branches and root-level leaves. Do not expect the whole knowledge base here; descend on demand. Read the root index node, pick one or more branches whose intent and tags match your task (several branches can be relevant), and read those branch `index.md` nodes. Descend further only where the task needs it, opening only the leaves you have confirmed are relevant. Follow each leaf's `relates_to` and `depends_on` cross edges to reach related leaves in other branches. You decide how deep to go per branch.

## Branches
- Load [`api-and-data/`](nodes/api-and-data/index.md) for more information on the API's data rules: reports, writes, restore, auth and timestamps; read before changing a route, model, migration or import.
- Load [`tooling-and-project/`](nodes/tooling-and-project/index.md) for more information on workspace layout, commit and tracker-reference rules, the Tokkl rename fallbacks, tests, e2e, bench, generated assets, the KDE desktop companion and the macOS and GNOME desktop apps; read before adding a package, script or test, committing, running a check or changing desktop/.
- Load [`web-ui-behaviour/`](nodes/web-ui-behaviour/index.md) for more information on web UI logic: page states, keyboard focus, time entry parsing, wall-clock math, refetch handling and clipboard; read before changing components or client-side helpers.
- Load [`web-ui-styling-and-layout/`](nodes/web-ui-styling-and-layout/index.md) for more information on app shell, styles.css tokens, themes, contrast and phone and calendar layout; read before changing CSS, colours or page layout.
