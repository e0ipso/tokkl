---
type: practice
title: Deleting a client detaches its projects and never merges them
description: >-
  deleteClient runs in one transaction; projects lose the client and colliding
  names become "Name (Client)", then "Name (Client) N".
tags:
  - server
  - clients
  - projects
kk_schema_version: 3
kk_id: practice-client-deletion-keeps-projects
kk_derived_from: []
kk_relates_to: []
kk_depends_on: []
kk_confidence: high
---
`deleteClient` in `packages/api/src/models/clients.ts` runs in a single transaction. The client's projects stay, with `client_id` set to null, and keep their IDs, entries and rates. Projects are never merged.

Project names are unique per client, so a detached project can collide with an existing client-less project. Projects with free names move first. A colliding one is renamed `Name (Client)`, then `Name (Client) 2`, `Name (Client) 3` and so on until free; `disambiguatedName` clips the client label and the base name so the result stays within the project name limit.
