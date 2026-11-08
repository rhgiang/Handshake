# Automatic backend deployment

Live verification on 2026-11-08 found this workflow active and a successful production deployment of `4e0a991aeda5f8d8e740b74f8d482e23aff0fd0a`. The API service and public HTTPS check passed; a preceding test failure correctly skipped deployment. See [integration evidence](../../docs/evidence/2026-11-08-integration-gaps.md). The setup commands below describe administrator provisioning; they are not needed again on the existing VM. Repository administration permissions are still required to configure branch protection.

## Release policy and architecture

Use `production`, initially based on the deployed guest/n8n release:
`090f6dc04d22038a34f2428592fbb287a51a429b`. Do not branch from or merge current main:
it adds accounts, new schemas, and unfinished production routing. Promote reviewed,
compatible changes selectively. The frontend release is managed separately by Vercel.

The workflow runs on **every push to production**, not main, with no path filters.
It tests the event's immutable SHA on Node 24/Ubuntu 24.04. Only a successful test job
can use repository-level deployment secrets and initiate deployment. No GitHub Actions
environment is required. Action dependencies
are SHA-pinned; the token has `contents: read`; checkout does not retain its credential.
GitHub concurrency prevents simultaneous runs and does not cancel an active deployment.
GitHub may replace pending runs; the server refuses a stale SHA once production advances.
A stale run fails safely; the newest production tip must pass its own tests.

Two separate server accounts are used:

- `handshake-ci`: key-only, forced-command SSH; no interactive shell/forwarding, no app
  write access, no environment read access. Its only sudo permission is the installed
  root-owned deployment helper, which accepts exactly `deploy SHA` or `rollback SHA`.
- `handshake-build`: no login; runs only dependency installation with lifecycle scripts
  disabled and a cleared environment. It has no access to production secrets or sudo.

The helper is installed manually under `/usr/local/sbin`; a deployed commit cannot
replace the privileged helper. It fetches only production from the fixed repository,
requires the requested SHA to be its exact tip and a descendant of the baseline, and
blocks changes to `backend/schema.sql`. A future
schema rollout requires separate reviewed migration work and an administrator-reviewed
helper change. No migrations, n8n actions, Caddy edits, or firewall edits occur.

Each root-owned release lives at `/opt/handshake-releases/SHA/backend`. Only
`/opt/handshake/backend` becomes an atomically replaced symlink. The existing
`/opt/handshake/.env` remains the **same file**, root:handshake 0640, and Caddy stays
unchanged. A release-level `.env` symlink makes the existing relative dotenv loader
work with real release paths. Dependencies install from the release lockfile with
`npm ci --omit=dev --ignore-scripts`; no build step is needed for this Express backend.

The existing systemd unit continues using `/opt/handshake/backend` and the existing
EnvironmentFile. `handshake.service` restarts only after a release is built. Local
Caddy HTTPS and an external Actions HTTPS request must both return the expected
`/api/features` JSON shape. No database rows or emails are created by these probes.
This is a process/TLS check, **not database, Gemini, n8n or Maritime readiness**.

## 1. Prepare production and protect deployment access

After approval, create the branch from the deployed baseline, without pulling main:

```sh
git branch production 090f6dc04d22038a34f2428592fbb287a51a429b
git push origin production
```

That baseline contains no workflow, so this initial branch publication does not deploy.
If production already exists, inspect it instead of resetting or force-pushing it.
Prepare a reviewed commit on that branch containing only the CI/CD files listed below;
do not publish that commit until the remaining setup is complete:

- `.github/workflows/backend-production.yml`
- `backend/deploy/deploy-release.sh`
- `backend/deploy/ssh-command.sh`
- `backend/deploy/tests/releases.test.mjs`
- `backend/deploy/CICD.md` and the deployment README link
- the implementation plan, if retained

The initial CI/CD commit becomes the first automatically tested/deployed release; its
parent is the existing deployed SHA. No main account feature commits are required.

In GitHub Settings:

1. Protect production: reviewed PRs, no force-push/deletion, tightly restrict push/bypass
   access, and review workflow and backend changes. Do not grant untrusted contributors
   the ability to alter a workflow that receives deployment credentials. Use available
   branch protections for your repository plan; do not enable secrets until that access
   boundary is in place. Repository secrets are not isolated to a deployment environment:
   other eligible workflows can reference them. Review workflow changes across the
   repository and restrict who can push trusted branches or edit workflows.
2. Add the two deployment secrets under **Settings → Secrets and variables → Actions →
   Repository secrets**. No Actions environment or environment approval gate is used.
3. Keep repository Actions token permissions read-only. The test job references no
   production secrets. Do not add production `.env` contents to Actions.

## 2. Create a dedicated Actions SSH key and pin the host key

On your trusted local computer, outside the repository:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/handshake-actions -C handshake-actions -N ''
```

Use a new filename if it already exists. This automation-only key has no passphrase;
its private half is stored only in GitHub repository Actions secrets and your secure
local storage. Never reuse your personal/admin SSH key.

From the **trusted Vultr console** (or an already verified admin connection), obtain
this server's host-key fingerprint:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Collect a candidate known-hosts record locally:

```sh
ssh-keyscan -p 22 -t ed25519 45.63.35.253 > ~/.ssh/handshake-vultr-known-hosts
ssh-keygen -lf ~/.ssh/handshake-vultr-known-hosts
```

Compare the fingerprints independently. **Do not trust ssh-keyscan by itself.** Stop
if they differ. Save the verified known-hosts line including `45.63.35.253`, key type,
and public key. The workflow requires it and uses StrictHostKeyChecking=yes; it never
learns host keys at runtime. If the server host key changes, verify it again through
Vultr before updating the secret. Do not disable checking.

Copy only the public deployment key and the reviewed helper files to linuxuser:

```sh
scp ~/.ssh/handshake-actions.pub linuxuser@45.63.35.253:~/
scp backend/deploy/deploy-release.sh backend/deploy/ssh-command.sh \
  linuxuser@45.63.35.253:~/
```

## 3. One-time server accounts and scoped privilege

The following is an administrative session as `linuxuser` using existing sudo access.
Keep the session open and retain Vultr console access. If account/directory names
already exist, inspect them first; these commands assume a fresh CI/CD setup.
Do not rerun the original setup.sh: it overwrites Caddy configuration and is a bootstrap,
not the release updater.

```sh
sudo apt-get update
sudo apt-get install -y git curl python3 util-linux
node --version                         # must be Node 24
sudo systemctl is-active handshake caddy
sudo git -C /opt/handshake rev-parse HEAD  # must be the baseline SHA above

sudo useradd --system --user-group --no-create-home \
  --home-dir /var/lib/handshake-ci --shell /bin/bash handshake-ci
sudo useradd --system --user-group --create-home \
  --home-dir /var/lib/handshake-build --shell /usr/sbin/nologin handshake-build
sudo chmod 700 /var/lib/handshake-build
sudo install -d -o root -g root -m 755 /var/lib/handshake-ci

sudo install -d -o root -g root -m 755 /var/lib/handshake-ci/.ssh
sudo install -d -o root -g root -m 755 /opt/handshake-releases
sudo install -d -o root -g root -m 700 /var/lib/handshake-deploy
sudo install -o root -g root -m 755 ~/deploy-release.sh /usr/local/sbin/handshake-deploy
sudo install -o root -g root -m 755 ~/ssh-command.sh /usr/local/bin/handshake-ssh

printf 'restrict,command="/usr/local/bin/handshake-ssh" %s\n' \
  "$(cat ~/handshake-actions.pub)" | \
  sudo tee /var/lib/handshake-ci/.ssh/authorized_keys > /dev/null
sudo chown root:root /var/lib/handshake-ci/.ssh/authorized_keys
sudo chmod 644 /var/lib/handshake-ci/.ssh/authorized_keys
```

The public key file and its directories are root-owned, readable for authentication,
and not writable by handshake-ci. That account must have no other authorized keys,
supplementary groups, writable startup scripts or sudo grants. `handshake-build` must
have only its own group, not the service's `handshake` group.

Install the narrow sudo rule and validate it:

```sh
sudo tee /etc/sudoers.d/handshake-ci > /dev/null <<'SUDOERS'
Defaults:handshake-ci env_reset
handshake-ci ALL=(root) NOPASSWD: NOSETENV: /usr/local/sbin/handshake-deploy
SUDOERS
sudo chmod 440 /etc/sudoers.d/handshake-ci
sudo visudo -cf /etc/sudoers.d/handshake-ci
sudo -l -U handshake-ci
```

This grants the static helper only, with arguments revalidated inside the helper. It
does not grant `systemctl`, `git`, `npm`, shells, or general passwordless sudo.

For defense in depth, restrict every login for that account, then validate before reload:

```sh
sudo tee /etc/ssh/sshd_config.d/60-handshake-ci.conf > /dev/null <<'SSHD'
Match User handshake-ci
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    PermitTunnel no
    PermitUserEnvironment no
    ForceCommand /usr/local/bin/handshake-ssh
Match all
SSHD
sudo /usr/sbin/sshd -t
sudo systemctl reload ssh
```

Verify the effective Match settings if other SSH includes already exist:

```sh
sudo /usr/sbin/sshd -T -C user=handshake-ci,host=45.63.35.253,addr=127.0.0.1
```

No UFW or Caddy changes are needed. Confirm linuxuser still logs in before closing
this administrator session.

## 4. Configure read-only Git fetching and convert the existing backend layout

Initialize a separate root-only deployment repository. This does not alter the
existing root-owned app checkout or fetch main:

```sh
sudo git init --bare /var/lib/handshake-deploy/repo.git
sudo git --git-dir=/var/lib/handshake-deploy/repo.git remote add origin \
  https://github.com/rhgiang/Handshake.git
sudo git --git-dir=/var/lib/handshake-deploy/repo.git config core.hooksPath /dev/null
```

For a public repository, HTTPS fetch needs no credential. For a private repository,
provision a separate root-only, read-only Git credential helper scoped to this
repository through your approved secret mechanism. It must work noninteractively.
Do not embed a PAT in the remote URL or copy the Actions-to-Vultr private key to the
server. The existing linuxuser Git access alone does not establish root fetch access.
Verify root can read production without printing credentials:

```sh
sudo env GIT_TERMINAL_PROMPT=0 git --git-dir=/var/lib/handshake-deploy/repo.git \
  ls-remote --exit-code origin refs/heads/production
```

The runtime environment remains in place. The next block creates a brief maintenance
window to move only the existing backend into the first retained release. It assumes
the baseline is healthy and has not already been converted. Stop if any precondition
fails; do not reset data or overwrite an existing release.

```sh
sudo bash <<'BOOTSTRAP'
set -euo pipefail
seed=090f6dc04d22038a34f2428592fbb287a51a429b
app=/opt/handshake
release=/opt/handshake-releases/$seed
[[ "$(git -C "$app" rev-parse HEAD)" == "$seed" ]]
git -C "$app" diff --quiet HEAD -- backend
[[ -d "$app/backend" && ! -L "$app/backend" ]]
[[ -f "$app/.env" && ! -L "$app/.env" ]]
[[ "$(stat -c '%U:%G:%a' "$app/.env")" == root:handshake:640 ]]
[[ ! -e "$release" ]]
[[ "$(stat -c '%U:%G:%a' "$app")" == root:root:755 ]]
install -d -o root -g root -m 755 "$release"
ln -s "$app/.env" "$release/.env"
systemctl stop handshake.service
mv -- "$app/backend" "$release/backend"
ln -s "$release/backend" "$app/backend"
systemctl start handshake.service
systemctl is-active --quiet handshake.service
BOOTSTRAP

curl --fail --show-error https://45-63-35-253.sslip.io/api/features
sudo -u handshake-ci test ! -r /opt/handshake/.env
sudo -u handshake-build test ! -r /opt/handshake/.env
sudo -u handshake-ci test ! -w /opt/handshake
sudo -u handshake-build test ! -w /opt/handshake-releases
```

If interrupted after the move, restore the missing stable symlink to the baseline's
backend and restart the service before continuing. Never replace an existing symlink
without inspecting its target. Environment bytes/ownership and Caddy are untouched.
The old app `.git` remains at the baseline and is no longer a release indicator;
`readlink /opt/handshake/backend` identifies the running release. Do not checkout/reset
that original repository or rerun setup.sh after conversion.

## 5. GitHub repository Actions secrets

Only two **repository-level Actions secrets** are required:

| Name | Value |
| --- | --- |
| `VULTR_SSH_PRIVATE_KEY` | Complete automation private key from step 2 |
| `VULTR_SSH_KNOWN_HOSTS` | Independently verified known-hosts record for 45.63.35.253:22 |

Using an authenticated gh CLI locally, after approval:

```sh
gh secret set VULTR_SSH_PRIVATE_KEY --repo rhgiang/Handshake \
  < ~/.ssh/handshake-actions
gh secret set VULTR_SSH_KNOWN_HOSTS --repo rhgiang/Handshake \
  < ~/.ssh/handshake-vultr-known-hosts
```

There is no database password, n8n secret, Gemini key or production .env in CI.
Verify/rotate those existing production values separately. CI/CD does not resolve
existing certificate trust issues, unauthenticated learner UUID APIs, or stats failures
being reported as empty results. Keep Weekly Recap unpublished until separately verified.

## 6. Verify restrictions and the workflow

Local, without production access:

```sh
node --test backend/deploy/tests/releases.test.mjs
npm test --prefix backend
bash -n backend/deploy/deploy-release.sh backend/deploy/ssh-command.sh
# Optional, if installed:
actionlint .github/workflows/backend-production.yml
```

Check forced-command rejection from your trusted computer using the dedicated key:

```sh
ssh -F /dev/null -T -i ~/.ssh/handshake-actions \
  -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/handshake-vultr-known-hosts \
  handshake-ci@45.63.35.253 'id'
```

Expected: nonzero exit, only deploy/rollback permitted. No shell should open. An invalid
SHA must also fail without fetching/building/restarting. From the admin VM session:

```sh
sudo -u handshake-ci sudo -n /bin/sh -c true
```

Expected: denied. The installed helper is the only allowed sudo command.

After setup approval, commit the reviewed CI/CD files on production through your normal
review process and push **production only**. That push tests and deploys its exact SHA.
Observe, without revealing secrets:

```sh
gh run list --repo rhgiang/Handshake --branch production --workflow backend-production.yml
gh run watch RUN_ID --repo rhgiang/Handshake --exit-status
```

Failure/rollback paths are exercised by the local fixture tests. To demonstrate the
GitHub test-failure gate, use a separate sandbox repository: in its temporary workflow
copy, change the repository guard to that sandbox and replace the SSH deployment step
with a harmless marker (no production secrets). A passing test should reach the marker;
a failing test must leave that job skipped. Never promote those sandbox changes. An isolated branch in this repository
will not trigger this production-only workflow. Never intentionally break production
to test the gate. The supplied workflow intentionally has no
manual-dispatch trigger; pushing an approved compatible commit is the release mechanism.

After the first release, admin verification:

```sh
readlink /opt/handshake/backend
sudo cat /var/lib/handshake-deploy/previous
sudo systemctl is-active handshake caddy
sudo ss -ltnp
curl --fail --show-error https://45-63-35-253.sslip.io/api/features
```

The active symlink must contain the Actions event SHA; port 8787 remains loopback-only.
Review journal logs privately and redact before sharing. Test real SSH/sudo/systemd,
TLS failure recovery and public reachability before claiming live CI/CD is verified.
Local tests use isolated filesystem/Git fixtures and service/build boundary substitutes.

## Rollback, failure and retention

Candidate health failure automatically switches back to the prior release, restarts it
and checks it. Actions still fails even if recovery succeeds. External runner HTTPS
failure also requests guarded rollback and leaves the run failed. If both candidates
fail health, the output says CRITICAL and retains pending recovery state. Do not infer
success from a symlink switch or green service status alone.

A server-side flock serializes deployment and rollback. The root-only pending marker
records the prior release before switching. After interruption, further deployments
are refused until recovery. HUP/INT/TERM attempt recovery; SIGKILL/power loss requires
administrator recovery. On an ambiguous SSH disconnect, inspect active and pending
state before retrying; a remote command may have continued after disconnect.

Manual rollback through existing linuxuser sudo access, after approval:

```sh
readlink /opt/handshake/backend
sudo cat /var/lib/handshake-deploy/previous
sudo test ! -e /var/lib/handshake-deploy/pending || \
  sudo cat /var/lib/handshake-deploy/pending

active_sha=$(basename "$(dirname "$(readlink /opt/handshake/backend)")")
sudo /usr/local/sbin/handshake-deploy rollback "$active_sha"
```

Or use the dedicated key and verified host file with command `rollback CURRENT_ACTIVE_SHA`.
The helper refuses rollback if the active SHA has changed. It restores the pending
recovery target, otherwise the last healthy previous release; it does not fetch or
reinstall packages. Successful rollback makes the formerly active release the previous
one. If rollback fails, it attempts to restore the originally active release and reports
failure. Inspect systemd and HTTPS again.

Pause/disable the workflow before an operational rollback if more production pushes are
in flight. Rollback does not move the production branch, so future approved pushes can
redeploy newer code; make the intended corrective/revert commit through normal review.
No automatic release pruning is performed. Retain active, previous and pending targets;
only an administrator should remove older releases after inspection. Dependency-cache
cleanup is likewise an administrator task.

Helper changes need a separate reviewed reinstall under /usr/local/sbin; deploying a
new helper file in app source does not grant it root execution. Future systemd/Caddy,
secret and schema changes remain separate, explicit administrator operations.

Official references: [Actions deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments),
[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[OpenSSH forced-command restrictions](https://man.openbsd.org/sshd.8).
