# Release & Semantic Versioning Process

**RetroGameTalk Sync** follows [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`), constrained to the **`1.x.y`** series unless an explicit major release (`2.0.0+`) is authorized by the maintainer. All git tags, GitHub Releases, container image tags, and runtime version strings omit any leading `v` prefix (e.g., `1.0.0`, not `v1.0.0`) for frictionless compatibility with Helm, Kubernetes, and artifact registries.

---

## 1. Version Increment Policy (`1.x.y` Constraint)

Starting from **`1.0.0`**, every commit-ready change batch bumps either **PATCH** or **MINOR** while keeping **MAJOR locked at `1`**:

| Increment | Format | When to Use |
| :--- | :--- | :--- |
| **PATCH** | `1.X.(Y+1)` | Bug fixes, regression patches, typo/copy corrections, CSS/UI polish, log-level adjustments, CI tweaks, dependency updates, and documentation updates. |
| **MINOR** | `1.(X+1).0` | New user-facing features, new UI panels or controls, new API endpoints, SQLite schema migrations, new Helm/deployment capabilities, or backward-compatible architectural additions. |
| **MAJOR** | `2.0.0+` | **Explicit maintainer approval required.** Never bump `MAJOR` automatically; CI enforces `MAJOR == 1` by default. |

---

## 2. Synchronized Version Files

Before committing changes to `main`, keep these three version declarations synchronized to the exact same `X.Y.Z` SemVer string and add a concise release summary entry:

1. **`package.json`** → `"version": "X.Y.Z"` *(Canonical application SemVer read by CI and local runtime fallback)*
2. **`k8s/charts/retrogametalk-sync/Chart.yaml`** → `version: X.Y.Z` *(Helm chart packaging version)*
3. **`k8s/charts/retrogametalk-sync/Chart.yaml`** → `appVersion: "X.Y.Z"` *(Application version deployed by the chart)*
4. **`CHANGELOG.md`** → `## [X.Y.Z] - YYYY-MM-DD` *(Concise bulleted summary used as the GitHub Release notes body)*

> **Why Chart `version` and `appVersion` Stay in Lockstep**:
> Because every commit on `main` mints a `X.Y.Z` release tag, keeping `Chart.yaml`'s `version` and `appVersion` identical ensures deploying or GitOps-tracking the chart from any Git SemVer tag always yields matching chart metadata and container image versions.

### Runtime Version Visibility
At runtime, the application resolves its active version in the following order:
1. Explicit `APP_VERSION` environment variable / Docker build arg (set to `X.Y.Z` during CI builds).
2. Local `.git` tag pointing at `HEAD` (or current branch name).
3. `package.json` `"version"` (`X.Y.Z`) when running outside Git (e.g., local dev sandboxes).

---

## 3. Automated Git Tagging, GitHub Releases & Container Publishing

Because AI Studio commits externally to GitHub without a local git CLI inside the dev sandbox, **GitHub Actions** automates tagging, release creation, and container publishing inside `.github/workflows/docker-publish.yml`.

### Pipeline Flow on Push to `main`

1. **Job 1 — `validate` (All Pushes & PRs)**
   - Validates `deploy/unraid/retrogametalk-sync.xml` & `ca_profile.xml` (`xmllint --noout`), checks `docker-compose.yml` & `deploy/truenas/docker-compose.yaml` (`docker compose config -q`), and runs `helm lint k8s/charts/retrogametalk-sync`.
2. **Job 2 — `release` (`contents: write`)**
   - Reads `version` from `package.json` and verifies strict `X.Y.Z` SemVer formatting.
   - Verifies **`MAJOR == 1`** (unless explicitly overridden for an authorized `2.0.0+` release) and confirms `Chart.yaml` `version` and `appVersion` both match `package.json`.
   - Checks whether tag `X.Y.Z` already exists in the repository:
     - **New version**: Creates an annotated git tag (`X.Y.Z`), pushes `refs/tags/X.Y.Z`, and creates a corresponding **GitHub Release** (`gh release create X.Y.Z --notes-file ...`) populated from the matching `## [X.Y.Z]` section in `CHANGELOG.md` (automatically falling back to commit subjects since the previous tag if missing), along with the `ghcr.io` image reference and full compare link.
     - **Already-tagged version**: Logs a notice and skips duplicate tag/release creation safely so rolling `main` builds still succeed.
3. **Job 3 — `build` (`needs: [validate, release]`, Native Matrix: `ubuntu-24.04` + `ubuntu-24.04-arm`)**
   - Compiles **`linux/amd64`** and **`linux/arm64`** natively on dedicated GitHub-hosted x86_64 and ARM64 runners (no QEMU emulation) with per-arch GHA caching (`scope=build-amd64` / `scope=build-arm64`), `APP_VERSION`, `GIT_SHA`, `GIT_URL`, `GIT_REF`, `BUILT_AT`, plus SBOM and `provenance: mode=max` attestations, pushing tagless digests to GHCR.
4. **Job 4 — `merge` (`needs: [release, build]`, `packages: write`)**
   - Combines the `amd64` and `arm64` digests + attestations via `docker buildx imagetools create` into unified multi-arch manifest tags on **`ghcr.io/<owner>/retrogametalk-sync`** (`X.Y.Z`, `X.Y`, `latest`, `main`, `sha-<short>`), and packages/pushes the Helm chart to **`oci://ghcr.io/<owner>/charts/retrogametalk-sync`** on tagged releases.
   - **Gated Docker Hub Mirroring:** Mirrors the merged multi-arch manifest to **Docker Hub** via `imagetools create` **only** when a SemVer tag is active *and* maintainer secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) are configured (defaulting target repo to `<DOCKERHUB_USERNAME>/retrogametalk-sync` or optional `vars.DOCKERHUB_REPOSITORY`).

### Pull Requests & Manual Tag Pushes
- **Pull Requests to `main`**: Run `validate` and native `build` (`push: false`) across both `linux/amd64` and `linux/arm64` runners without publishing or running `merge`.
- **Manual `[0-9]*.*.*` Tag Push**: Skips the `release` job and runs `validate` + native `build` + `merge` directly against the pushed bare SemVer tag (`X.Y.Z`, `X.Y`, `sha-<short>`).

---

## 4. Authorizing a Future Major (`2.0.0+`) Release

When the maintainer explicitly approves moving to `2.0.0` (or later):
1. Update `package.json` `"version"`, `Chart.yaml` `version`, and `Chart.yaml` `appVersion` to `"2.0.0"`.
2. Either:
   - Run **Actions → Release and Publish Container Image → Run workflow** with **`allow_major_bump: true`**, **or**
   - Temporarily set repository variable `ALLOW_MAJOR_VERSION_BUMP=true` in **Settings → Secrets and variables → Actions → Variables** before pushing to `main` (and unset or update the constraint afterwards).

---

## 5. Recovery & Troubleshooting

- **`Helm Chart version or appVersion does not match package.json version`**: Sync both `version` and `appVersion` in `k8s/charts/retrogametalk-sync/Chart.yaml` to match `package.json` `"version"` and push to `main`.
- **Re-running a failed container build after a tag was already minted**: Re-run the failed job in GitHub Actions, or push a patch bump (`1.X.(Y+1)`).
- **Retrying a missed GitHub Release for an existing tag**: Delete or edit the release in GitHub UI, or run locally:
  ```bash
  gh release create 1.X.Y --generate-notes --title "1.X.Y"
  ```
