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

Before committing changes to `main`, keep these two version declarations synchronized to the exact same `X.Y.Z` SemVer string:

1. **`package.json`** → `"version": "X.Y.Z"` *(Canonical application SemVer read by CI and local runtime fallback)*
2. **`k8s/charts/retrogametalk-sync/Chart.yaml`** → `appVersion: "X.Y.Z"`

> **Helm Chart `version` vs. `appVersion`**:
> - `appVersion` tracks the RetroGameTalk Sync application release (`1.0.0`, `1.0.1`, `1.1.0`, etc.) and must match `package.json`.
> - `Chart.yaml`'s `version` (`0.1.0`) versions the Kubernetes Helm chart package itself and only needs bumping when chart templates, `values.yaml`, or chart dependencies change.

### Runtime Version Visibility
At runtime, the application resolves its active version in the following order:
1. Explicit `APP_VERSION` environment variable / Docker build arg (set to `X.Y.Z` during CI builds).
2. Local `.git` tag pointing at `HEAD` (or current branch name).
3. `package.json` `"version"` (`X.Y.Z`) when running outside Git (e.g., local dev sandboxes).

---

## 3. Automated Git Tagging, GitHub Releases & Container Publishing

Because AI Studio commits externally to GitHub without a local git CLI inside the dev sandbox, **GitHub Actions** automates tagging, release creation, and container publishing inside `.github/workflows/docker-publish.yml`.

### Pipeline Flow on Push to `main`

1. **Job 1 — `release` (`contents: write`)**
   - Reads `version` from `package.json` and verifies strict `X.Y.Z` SemVer formatting.
   - Verifies **`MAJOR == 1`** (unless explicitly overridden for an authorized `2.0.0+` release) and confirms `Chart.yaml` `appVersion` matches `package.json`.
   - Checks whether tag `X.Y.Z` already exists in the repository:
     - **New version**: Creates an annotated git tag (`X.Y.Z`), pushes `refs/tags/X.Y.Z`, and creates a corresponding **GitHub Release** (`gh release create X.Y.Z --generate-notes`) using GitHub's auto-generated release notes from commits/PRs since the previous tag.
     - **Already-tagged version**: Logs a notice and skips duplicate tag/release creation safely so rolling `main` builds still succeed.
2. **Job 2 — `build-and-push` (`needs: [release]`, `packages: write`)**
   - Chained directly behind `release` so newly minted tags immediately trigger the container build without needing a custom Personal Access Token (GitHub Actions suppresses downstream `on: push: tags:` triggers from `GITHUB_TOKEN` pushes).
   - Builds the Docker image with `APP_VERSION=X.Y.Z`, `GIT_SHA`, `GIT_URL`, and `BUILT_AT`, and pushes to `ghcr.io/<owner>/retrogametalk-sync` with the following tags:
     - `X.Y.Z` *(exact SemVer release tag when minted or pushed)*
     - `X.Y` *(floating minor tag when minted or pushed)*
     - `latest` *(on `main`)*
     - `main` *(on `main`)*
     - `sha-<short-commit>`

### Pull Requests & Manual Tag Pushes
- **Pull Requests to `main`**: Skip the `release` job and run `build-and-push` with `push: false` as a build verification check.
- **Manual `[0-9]*.*.*` Tag Push**: Skips the `release` job and runs `build-and-push` directly against the pushed SemVer tag (`X.Y.Z`, `X.Y`, `sha-<short>`).

---

## 4. Authorizing a Future Major (`2.0.0+`) Release

When the maintainer explicitly approves moving to `2.0.0` (or later):
1. Update `package.json` `"version"` and `Chart.yaml` `appVersion` to `"2.0.0"`.
2. Either:
   - Run **Actions → Release and Publish Container Image → Run workflow** with **`allow_major_bump: true`**, **or**
   - Temporarily set repository variable `ALLOW_MAJOR_VERSION_BUMP=true` in **Settings → Secrets and variables → Actions → Variables** before pushing to `main` (and unset or update the constraint afterwards).

---

## 5. Recovery & Troubleshooting

- **`Helm Chart appVersion does not match package.json version`**: Sync `k8s/charts/retrogametalk-sync/Chart.yaml` `appVersion` to match `package.json` `"version"` and push to `main`.
- **Re-running a failed container build after a tag was already minted**: Re-run the failed job in GitHub Actions, or push a patch bump (`1.X.(Y+1)`).
- **Retrying a missed GitHub Release for an existing tag**: Delete or edit the release in GitHub UI, or run locally:
  ```bash
  gh release create 1.X.Y --generate-notes --title "1.X.Y"
  ```
