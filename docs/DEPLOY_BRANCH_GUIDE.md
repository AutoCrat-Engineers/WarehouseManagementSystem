# Deploy Branch Guide — `deploy/pre-prod`

**Status:** Active contract. Enforced by CI.
**Companion doc:** [DEPLOYMENT_FIXES_2026-04-30.md](DEPLOYMENT_FIXES_2026-04-30.md) (incident report — root causes that motivated this contract).
**Operational reference:** [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) (how to actually run a deploy).

This document defines what `deploy/pre-prod` is, what it must contain, what it must **not** contain, and how that's enforced.

---

## 1. Purpose of `deploy/pre-prod`

`deploy/pre-prod` is a **release artifact branch**, not a development branch. Its sole job is to be the input to the production-deploy GitHub Actions workflow ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)). On every push, the workflow builds a Docker image of the Vite frontend and rolls it out to the Azure VM at `http://20.164.2.189`.

Because the branch is **only** consumed by the build pipeline, the smaller and more deterministic its contents, the better:

- Faster `docker build` (small build context).
- No risk of accidentally shipping dev secrets, scratch scripts, or stale architecture docs.
- No chance of edge-function source files on disk drifting away from what's actually live in Supabase.
- Clear separation: a reviewer looking at a diff on this branch can tell at a glance whether the change is operational or accidentally pulling in dev work.

---

## 2. What lives on `deploy/pre-prod`

### Source needed by the Vite build

| Path | Why |
|---|---|
| `src/` | Application code that gets compiled into the bundle. |
| `public/` | Static assets copied verbatim into the bundle (`logo.png`, `quotes.json`, etc.). |
| `index.html` | Vite entry point. |
| `package.json`, `package-lock.json` | `npm ci` reads both at build time. |
| `vite.config.ts` | Build config. |
| `tsconfig.json`, `tsconfig.node.json` | TypeScript compile config (only affects type-checking; Vite still bundles). |

### Deployment infrastructure

| Path | Why |
|---|---|
| `Dockerfile` | Multi-stage image build (Vite → nginx). |
| `.dockerignore` | Keeps build context small. |
| `docker-compose.yml` | Local-equivalent of the production run command. |
| `devops/nginx/nginx.conf` | Container nginx config (PDF service proxy). |
| `devops/nginx/host-reverse-proxy.conf` | Reference for the host nginx site (installed on the VM separately). |
| `.github/workflows/deploy.yml` | Build-and-deploy CI/CD workflow. |
| `.github/workflows/protect-deploy-branch.yml` | This branch's path-allowlist gate (see §4). |

### Repo metadata

| Path | Why |
|---|---|
| `.env.example` | Documents required env vars. Real `.env` values come from GitHub Secrets, not from this file. |
| `.gitignore`, `.gitattributes` | Standard git hygiene. `.gitattributes` enforces "ours" merge for forbidden paths (see §4). |
| `LICENSE` | Required. |
| `README.md`, `CHANGELOG.md` | Project-level info. Kept lightweight. |
| `docs/DEPLOY_BRANCH_GUIDE.md` | This document. |
| `docs/DEPLOYMENT_GUIDE.md` | Operational deploy runbook. |
| `docs/DEPLOYMENT_FIXES_2026-04-30.md` | Incident report. |

---

## 3. What MUST NOT live on `deploy/pre-prod`

These categories are **forbidden** on this branch. CI ([.github/workflows/protect-deploy-branch.yml](../.github/workflows/protect-deploy-branch.yml)) fails any push or PR that contains them.

### 3.1 `supabase/`

The `supabase/` folder contains:
- `supabase/functions/**` — Edge function source (TypeScript, runs on Supabase's Deno edge runtime).
- `supabase/migrations/**` — SQL migrations.
- `supabase/config.toml` — Supabase CLI config.

**Why these don't belong on `deploy/pre-prod`:**

1. **They aren't deployed by this pipeline.** Edge functions go live via `supabase functions deploy <name>` (run by a developer or a separate CI job pointed at the Supabase project). Migrations are applied via `supabase db push` or the dashboard. The Docker image we build here is **frontend only** — it doesn't touch Supabase.
2. **Drift risk.** Having a copy of the edge function source in this branch creates two sources of truth: the file on disk and the version actually deployed on Supabase. A developer fixing a bug in the live function might forget to PR the change here, or vice versa.
3. **Build context bloat.** The folder is ~1.6 MB / ~96 files. Every `docker build --no-cache` ships that into the image even though it's never used.

**Where these files DO live:** `develop-test`, `develop-stable`, `main`. Developers push edge function changes there and deploy them via the Supabase CLI.

### 3.2 `scripts/`

Dev-only tooling — data import scripts, smoke tests, one-off migrations. The deploy pipeline doesn't run any of it. Lives on `develop-test`.

### 3.3 `azure-pipelines.yml`

Legacy Azure DevOps pipeline config. We use GitHub Actions ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)). Removing this avoids confusion about which CI is authoritative.

### 3.4 Dev-reference docs

The full `docs/` tree on `develop-test` includes architecture write-ups, ADRs, release notes, schema diagrams, module overviews. None of those are needed at deploy time. Specifically forbidden:

```
docs/architecture/**
docs/adr/**
docs/reference/**
docs/releases/**
docs/workflows/**
docs/CONTRIBUTING.md
docs/DATABASE_SCHEMA.md
docs/DISPATCH_EMAIL_SYSTEM.md
docs/GRBAC_SYSTEM.md
docs/MIGRATION_NOTES.md
docs/MODULE_OVERVIEW.md
docs/SCHEMA_MIGRATION_item_code_to_part_number.md
docs/architecture.md
```

Allowed in `docs/` on this branch: only operational docs (`DEPLOYMENT_GUIDE.md`, `DEPLOY_BRANCH_GUIDE.md`, `DEPLOYMENT_FIXES_*.md`).

---

## 4. Enforcement

Two layers, both already in place on `deploy/pre-prod`.

### Layer 1 — `.gitattributes` (soft, merge-time)

[.gitattributes](../.gitattributes) declares `merge=ours` on every forbidden path. When someone runs `git merge develop-test` into `deploy/pre-prod`, git asks the "ours" driver what to do for those paths and the driver always answers "keep the deploy/pre-prod version" — which is nothing. So merges don't reintroduce these files.

**One-time setup per developer machine:**

```bash
git config --global merge.ours.driver true
```

(The driver is built into git but must be wired to the literal name `ours`. This is a documented git idiom — see `gitattributes(5)`.)

**Limitation:** `.gitattributes` only kicks in on **conflicts**. If a file is brand-new on `develop-test` and absent from `deploy/pre-prod`, git treats it as an "add" and merges it without consulting the attribute. That's why we also need Layer 2.

### Layer 2 — CI gate (hard, push/PR-time)

[.github/workflows/protect-deploy-branch.yml](../.github/workflows/protect-deploy-branch.yml) runs on every push and PR targeting `deploy/pre-prod`. It greps `git ls-files` against the forbidden-path regex and fails the workflow if any match.

A failing run means the PR cannot merge until the offending paths are removed. The error message includes the exact `git rm` command to fix it.

This is the real teeth — it works regardless of how the files got onto the branch (manual commit, merge, rebase, cherry-pick, force push from someone with bypass perms… all of them get caught at CI time).

---

## 5. Workflow: how to land changes on `deploy/pre-prod`

**Direction is one-way only:**

```
feature/* (e.g. Migration/Dispatch)
       │  ← develop here, edge functions land in supabase/ on this branch
       ▼
   develop-test
       │  ← QA, integration, edge function deploys to Supabase happen from here
       ▼
   deploy/pre-prod   ← this branch — frontend Docker build only
       │
       ▼
   deploy/production
```

**Never** merge `deploy/pre-prod` back into a dev branch. That was commit `318a16b` in the 2026-04-30 incident — it dragged old conflict resolutions back into `develop-test` and is the reason for §10 of the incident report.

If `develop-test` falls behind on infra changes (Dockerfile, deploy.yml, nginx conf), **cherry-pick** the specific infra commits over rather than doing a back-merge.

### Standard merge into `deploy/pre-prod`

```bash
git checkout deploy/pre-prod
git pull
git merge --no-ff develop-test
# .gitattributes keeps supabase/ etc. out automatically
# CI gate verifies on push
git push
```

If CI fails the path-gate after a merge, the offending files came in as "adds" not "modifies". Fix by:

```bash
git rm -r supabase scripts # ...whatever the CI log lists
git commit -m "chore: drop dev-only paths from merge"
git push
```

---

## 6. What changed on 2026-04-30 to introduce this contract

Before this date, `deploy/pre-prod` carried the full `supabase/` folder, full `docs/` tree, `scripts/`, and `azure-pipelines.yml`. Symptoms:

- Build context was ~5 MB and slow.
- Frequent merge conflicts on edge function files that nobody on the deploy branch was actually editing.
- Drift: the edge function source on `deploy/pre-prod` was occasionally out of sync with what was actually deployed to Supabase, masking bugs.
- Docs duplication between `develop-test` and `deploy/pre-prod` led to outdated architecture docs being shipped in the deploy branch's diff history.

Cleanup commit removed:

- `supabase/` (96 files, 1.6 MB)
- `scripts/` (1 file)
- `azure-pipelines.yml`
- 14 dev-reference doc files / directories

Plus added:
- `.gitattributes` with `merge=ours` rules
- `.github/workflows/protect-deploy-branch.yml` CI gate
- Populated `.dockerignore` (was empty — `docker build` was copying the entire repo as context)
- This guide

---

## 7. FAQ

### "Where do I push my edge function changes?"
`develop-test`. The Supabase deploy is a separate step (`supabase functions deploy <name>` against the project ref `sugvmurszfcneaeyoagv`). The deploy/pre-prod Docker pipeline doesn't touch Supabase.

### "I need to update the Dockerfile / deploy.yml / nginx config. Where?"
Open a PR directly against `deploy/pre-prod`, or land it on `develop-test` and merge forward. Either is fine for infra files since they live on both branches.

### "I get a CI failure: 'deploy/pre-prod contains paths that belong on develop-test'."
Your branch contains forbidden paths. The CI log lists them. Run the `git rm -r` command from the log message in your branch, commit, and push.

### "Can I bypass the CI gate for an emergency?"
Don't. The forbidden paths are forbidden for a reason — they cause drift between repo state and Supabase state. If you truly need a one-off, the right move is to update `.github/workflows/protect-deploy-branch.yml` itself in a separate PR with sign-off, then revert it after.

### "What if I add a new doc that should live on deploy/pre-prod?"
Drop it in `docs/` with a name that doesn't match the forbidden patterns (anything except the explicitly-listed dev-reference filenames). Operational docs like deploy guides, incident reports, runbooks are welcome.

### "What about `develop-test`? Is anything banned there?"
No. `develop-test` is a normal dev branch with everything in it. The contract here only applies to `deploy/*` branches.

---

## 8. Maintaining this contract

If we add a new category of forbidden path (e.g., a future `terraform/` folder for infra-as-code that lives on dev branches but not deploy):

1. Add the path to the regex in [.github/workflows/protect-deploy-branch.yml](../.github/workflows/protect-deploy-branch.yml).
2. Add the path with `merge=ours` to [.gitattributes](../.gitattributes).
3. Add it to `.dockerignore`.
4. Update §3 of this document.

Keep the three lists in sync — a path that's in the CI gate but not in `.gitattributes` will produce noisy merge conflicts; a path in `.gitattributes` but not in the CI gate has no real enforcement.
