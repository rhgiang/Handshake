Latest verification: [2026-11-08 integration gap results](2026-11-08-integration-gaps.md). The historical preparation-only record below is superseded where that newer evidence provides live results.

# Deployment evidence — 2026-11-07

Architecture update: the frontend now deploys to Vercel and only the API to a Vultr VM (the database is Tiger Data Cloud); no GoDaddy/domain purchase is planned (see `docs/superpowers/plans/2026-11-07-vercel-vultr-architecture.md`). The text below is the earlier record and is not re-verified.

Status: local deployment preparation only; no VM provisioned, no domain purchased, no public HTTPS origin verified.

## Access and missing inputs

Read-only inspection found no Vultr CLI, common Vultr CLI config files, Vultr API environment variable, or connected Vultr/DNS tool. SSH configuration and an SSH public key exist; this does not establish authorized access to a particular VM. Local app environment names include Gemini/database configuration; values were not printed or copied.

Still required: authorized Vultr account/session or scoped credential, budget and region/plan; a hostname that resolves to the VM IP (e.g. an sslip.io name; no purchase planned); authorized VM IP and SSH host-key/access details if already provisioned; reviewed full release SHA available to the VM; curated production environment file. No arbitrary host from SSH config was contacted. No secrets were transferred and no production settings changed.

Public APP_URL: pending. Deployed revision: pending. Services/TLS/static app/API/external port checks: pending. Physical phone camera verification: pending.

## Tested

- `node --test backend/deploy/tests/*.test.mjs`: 3 tests passed after observing failing credential/domain/revision checks before implementation. Tests cover rejection of mutable refs, URL credentials/query strings and malformed domains, and acceptance of normal pinned deployment inputs.
- `bash -n backend/deploy/setup.sh backend/deploy/preflight.sh`: passed.
- Official current Vultr provisioning/SSH and Caddy package guidance reviewed; links are in `backend/deploy/README.md`.

## Not tested

Ubuntu package installation, Node installation, systemd/Caddy startup, remote repository fetch, DNS propagation, certificate issuance, firewall/external reachability, app on a public origin, physical phone camera. Local tests are not deployment evidence.

## Decisions

Pinned full commit SHA replaces branch-tip pulls because a reviewed worktree is not necessarily published. Existing explicit firewall allow rules are left intact to avoid unexpectedly breaking an existing server; the operator must inspect them before claiming port isolation. Task 7 owns all production configuration edits after initial deployment. Consolidated code/security review is required from the lead before a remote run.
