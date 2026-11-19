# Repository Agent Conventions

## Source of Truth (`/docs` Policy)

- **Codebase Is the Sole Source of Truth**: Always inspect and rely on the live source code, database migrations, and configuration—never treat files under `/docs/` as an architectural or implementation specification.
- **Historical Changelog Only**: Everything under `/docs/` exists strictly as a point-in-time historical archive for human readers to understand how the app evolved; earlier archived plans may be superseded by later changes and are intentionally not retroactively rewritten.

## Archiving Plan Documents (`/docs/plans`)

Whenever executing an approved implementation plan (or when asked to archive a reviewed plan without implementing it):

1. Save a versioned Markdown copy to `/docs/plans/YYYY-MM-DD-<slug>.md`.
2. Include YAML frontmatter at the top of the file:
   ```yaml
   ---
   title: <Plan Title>
   status: implemented # or planned
   created_at: <ISO-8601 UTC timestamp>
   implemented_at: <ISO-8601 UTC timestamp or null>
   ---
   ```
3. Update the index table in `/docs/plans/README.md`.
4. Note that during AI Studio's Planning Phase (before `Proceed`), workspace modifications are restricted to the temporary `implementation_plan.md` artifact, so `/docs/plans/` entries are written during execution (`Proceed`) or upon explicit post-review archive request.

## Versioning, SemVer & Release Policy (`1.x.y`)

- **Strict `1.x.y` Major Version Lock**: Keep all releases within **`1.x.y`** (`MAJOR = 1`). **Never** bump to `2.0.0` (or any higher major version) unless the user explicitly gives the go-ahead.
- **Bare SemVer Tags (No `v` Prefix)**: Git tags, GitHub Releases, container tags, and runtime version strings use bare `X.Y.Z` (e.g., `1.0.0`, **never** `v1.0.0`) so tags stay directly compatible with Helm, Kubernetes, and artifact registries without stripping prefixes.
- **Synchronized Version Files & Changelog**: On every commit-ready change batch, bump all three version declarations to the same `X.Y.Z` SemVer string and prepend a concise `## [X.Y.Z] - YYYY-MM-DD` summary entry to `CHANGELOG.md`:
  - `package.json` → `"version": "X.Y.Z"`
  - `k8s/charts/retrogametalk-sync/Chart.yaml` → `version: X.Y.Z`
  - `k8s/charts/retrogametalk-sync/Chart.yaml` → `appVersion: "X.Y.Z"`
  - `CHANGELOG.md` → `## [X.Y.Z] - YYYY-MM-DD` with concise bulleted summary of changes *(used automatically as the GitHub Release notes body)*
  *(Keeping Helm chart `version` and `appVersion` in lockstep guarantees Git-tag chart deployments always install the matching chart and container release.)*
- **Patch vs. Minor Increment Rules** *(agent judgment call)*:
  - **Patch (`1.X.(Y+1)`)**: Bug fixes, regression patches, typo/copy corrections, log level tweaks, styling/CSS polish, CI adjustments, dependency updates, Helm chart default `values.yaml`/template fixes, or documentation-only changes.
  - **Minor (`1.(X+1).0`)**: New user-facing features, new UI panels or workflows, new API endpoints, SQLite schema migrations, new deployment/Helm capabilities, or substantive architectural additions (backward-compatible within `v1`).
- **Packaged Deployment Changes Trigger Releases**: Any modification to shipped deployment artifacts—including `Dockerfile`, Helm chart templates, or default `k8s/charts/retrogametalk-sync/values.yaml`—must include a lockstep version bump (`package.json`, `Chart.yaml`, `CHANGELOG.md`) so CI cuts a new GitHub Release and republishes the updated package(s).
- **Published Artifacts & GitHub Release Manifest**: Every GitHub Release must list all published artifacts under `## Published Artifacts` in `.github/workflows/docker-publish.yml` (currently multi-arch GHCR container image, optional Docker Hub mirror, GHCR OCI Helm chart reference, and downloadable `.tgz` Helm chart asset attached via `gh release upload`). Whenever any new distributable package, registry target, template archive, or binary is added to the project, update `.github/workflows/docker-publish.yml` in the same change so it is automatically documented in the release notes and attached to each GitHub Release where applicable.
- **Automated Tagging & GitHub Releases**: Pushing a bumped version to `main` triggers CI (`.github/workflows/docker-publish.yml`) to validate the `1.x.y` constraint, create the annotated `X.Y.Z` git tag, publish a GitHub Release with the concise summary from `CHANGELOG.md` (or commit-log fallback) plus the Published Artifacts manifest, push matching multi-arch container tags, publish the OCI Helm chart, and attach the packaged `.tgz` chart asset. See `/docs/release/README.md` for full details.

