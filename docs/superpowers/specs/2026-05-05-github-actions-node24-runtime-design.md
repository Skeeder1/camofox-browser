# GitHub Actions Node 24 Runtime Follow-Up Design

## Problem

`main` is now green again, but GitHub Actions warns that some JavaScript actions in the current workflows still run on the deprecated Node 20 action runtime. The warning does not break CI today, but it creates a future maintenance risk because GitHub plans to move JavaScript actions to Node 24 by default.

The immediate goal is to remove or reduce this warning without reopening release risk, changing the product build matrix, or broadening the work into a full CI redesign.

## Goals

1. Remove the current Node 20 action-runtime deprecation warning from the repo's active workflows where practical.
2. Keep workflow behavior stable for CI and release publishing.
3. Limit the change to tracked GitHub workflow files and action versions.
4. Verify that the update does not regress CI or release packaging behavior.

## Non-Goals

- Changing the application Node support policy (`>=20`)
- Changing the test matrix (`20`, `22`)
- Refactoring workflow structure, permissions, or job topology for style reasons
- Adding new jobs, release channels, or deployment behavior
- Performing a full GitHub Actions modernization sweep outside the currently used CI and Release workflows

## Options Considered

### Option 1: Minimal CI-only bump

Update only the actions that emit the warning in `.github/workflows/ci.yml`.

- Pros: smallest possible diff
- Cons: leaves release workflow drift in place and does not fully close the repo-level follow-up

### Option 2: Balanced workflow refresh

Update the relevant actions in both `.github/workflows/ci.yml` and `.github/workflows/release.yml`, while keeping workflow behavior unchanged.

- Pros: addresses the real follow-up cleanly, keeps scope narrow, reduces drift between active workflows
- Cons: slightly larger than the CI-only patch

### Option 3: Full Actions modernization

Audit and upgrade the broader GitHub Actions stack now.

- Pros: most future-proof in one pass
- Cons: too broad for the current follow-up and more likely to introduce unrelated churn

## Chosen Approach

Use **Option 2**.

## Files In Scope

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

## Proposed Changes

### 1. Upgrade relevant GitHub-hosted actions

Update the active first-party actions that currently drive the warning to versions that are aligned with GitHub's newer JavaScript runtime support path.

This applies to:

- `actions/checkout`
- `actions/setup-node`

The release workflow should also be checked for adjacent active actions, but only upgraded when the change is a version/runtime alignment update rather than a workflow redesign.

### 2. Preserve workflow semantics

The update must keep the current behavior intact:

- CI still runs on pushes and PRs to `main`
- CI still tests Node `20` and `22`
- Release still triggers on `v*` tags
- Docker publish behavior, tags, and permissions remain unchanged

### 3. Keep the change configuration-only

No product code, package metadata, or release-note content should change as part of this follow-up unless the workflow version bump explicitly requires a tracked compatibility note.

## Verification Plan

1. Re-run local repo verification after the workflow edit:
   - `npm run lint`
   - `npm test`
   - `npm run verify:package`
2. Push `main`
3. Confirm the updated CI run succeeds
4. Inspect workflow annotations/logs to confirm the Node 20 JavaScript action-runtime warning is removed or reduced as expected

## Risks and Constraints

- Some warnings may come from transitive or third-party actions outside the directly edited first-party actions; if so, the implementation should document exactly what was resolved vs. what remains.
- The repo should not trade a cosmetic warning cleanup for a release-lane regression.
- Because this is post-release hardening, correctness and stability matter more than maximum upgrade breadth.

## Acceptance Criteria

1. The repo contains a narrow workflow-only change in `.github/workflows/ci.yml` and `.github/workflows/release.yml`.
2. Local verification still passes after the workflow update.
3. A fresh GitHub Actions run on the updated `main` succeeds.
4. The Node 20 action-runtime warning is eliminated for the updated first-party actions, or any remaining warning is explicitly identified as outside the chosen narrow scope.
