#!/usr/bin/env bash
set -euo pipefail

# RetroGameTalk Sync — Git History Screenshot Scrub Helper
#
# Permanently removes historical screenshot binaries (`docs/assets/screenshots/`,
# and optionally `public/assets/aistudio/`) from ALL git commits, branches, and
# tags using `git-filter-repo` inside an isolated temporary `--mirror` clone.
#
# Runs in SAFE DRY-RUN mode by default (no remote changes). Pass `--execute`
# only AFTER verifying that `README.md` renders live previews from the
# `readme-assets` GitHub Release.

DEFAULT_REPO_SLUG="jeremyj563/retrogametalk-sync"
RELEASE_TAG="readme-assets"
REQUIRED_ASSETS=(
  "console-walkthrough.webp"
  "sync-overview.webp"
  "catalog-grid.webp"
  "game-detail-drawer.webp"
  "sd-card-exporter.webp"
)

EXECUTE=false
INCLUDE_AISTUDIO=false
SKIP_ASSET_CHECK=false
REPO_URL=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Scrub historical screenshot binaries from git history safely using a fresh
temporary --mirror clone and git-filter-repo.

Options:
  --repo <url>                Git remote URL to mirror & scrub
                              (default: current repo's origin, or https://github.com/${DEFAULT_REPO_SLUG}.git)
  --include-aistudio-assets   Also scrub public/assets/aistudio/ PNGs from history
  --skip-asset-check          Skip verifying live ${RELEASE_TAG} GitHub Release assets
  --execute                   Force-push rewritten branches/tags to origin (prompts to confirm)
  -h, --help                  Show this help message

Examples:
  # 1. Dry run (default): inspect exact size reduction without modifying GitHub
  ./scripts/scrub-screenshot-history.sh

  # 2. Dry run including AI Studio chat PNGs
  ./scripts/scrub-screenshot-history.sh --include-aistudio-assets

  # 3. Execute history rewrite and force-push cleaned refs to GitHub
  ./scripts/scrub-screenshot-history.sh --execute
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      [[ $# -ge 2 ]] || { echo "Error: --repo requires a URL argument." >&2; exit 1; }
      REPO_URL="$2"
      shift 2
      ;;
    --repo=*)
      REPO_URL="${1#--repo=}"
      shift
      ;;
    --include-aistudio-assets)
      INCLUDE_AISTUDIO=true
      shift
      ;;
    --skip-asset-check)
      SKIP_ASSET_CHECK=true
      shift
      ;;
    --execute)
      EXECUTE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: Unknown option '$1'. Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# 1. Resolve repository URL
if [[ -z "$REPO_URL" ]]; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO_URL="$(git remote get-url origin 2>/dev/null || true)"
  fi
fi
if [[ -z "$REPO_URL" ]]; then
  REPO_URL="https://github.com/${DEFAULT_REPO_SLUG}.git"
fi

# Extract owner/repo slug for GitHub release verification
REPO_SLUG="$DEFAULT_REPO_SLUG"
if [[ "$REPO_URL" =~ github\.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
  REPO_SLUG="${BASH_REMATCH[1]}"
fi

# 2. Verify prerequisites
if ! command -v git >/dev/null 2>&1; then
  echo "Error: 'git' is required but not installed." >&2
  exit 1
fi

if ! git filter-repo --version >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Error: 'git-filter-repo' is required to rewrite git history safely.

Install it via one of:
  macOS (Homebrew):   brew install git-filter-repo
  Ubuntu / Debian:    sudo apt-get install -y git-filter-repo
  Python (pipx/pip):  pipx install git-filter-repo   # or: pip install --user git-filter-repo
EOF
  exit 1
fi

# 3. Pre-flight check: confirm readme-assets release is live before scrubbing
if [[ "$SKIP_ASSET_CHECK" == "false" ]]; then
  echo "==> Verifying live '${RELEASE_TAG}' GitHub Release assets on ${REPO_SLUG}..."
  VERIFIED=false

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    ASSET_NAMES="$(gh release view "$RELEASE_TAG" --repo "$REPO_SLUG" --json assets --jq '.assets[].name' 2>/dev/null || true)"
    if [[ -n "$ASSET_NAMES" ]]; then
      MISSING=()
      for expected in "${REQUIRED_ASSETS[@]}"; do
        if ! grep -qx "$expected" <<<"$ASSET_NAMES"; then
          MISSING+=("$expected")
        fi
      done
      if [[ "${#MISSING[@]}" -eq 0 ]]; then
        VERIFIED=true
        echo "    OK: All ${#REQUIRED_ASSETS[@]} WebP previews are live on release '${RELEASE_TAG}'."
      else
        echo "Error: Release '${RELEASE_TAG}' is missing assets: ${MISSING[*]}" >&2
        echo "Run the 'Update README Visual Previews' workflow first (or pass --skip-asset-check)." >&2
        exit 1
      fi
    fi
  fi

  if [[ "$VERIFIED" == "false" ]]; then
    if command -v curl >/dev/null 2>&1; then
      for expected in "${REQUIRED_ASSETS[@]}"; do
        URL="https://github.com/${REPO_SLUG}/releases/download/${RELEASE_TAG}/${expected}"
        if ! curl -fsIL --max-time 15 "$URL" >/dev/null 2>&1; then
          echo "Error: Could not reach ${URL}" >&2
          echo "Confirm 'Update README Visual Previews' has published '${RELEASE_TAG}' and README.md renders properly before scrubbing history (or pass --skip-asset-check)." >&2
          exit 1
        fi
      done
      echo "    OK: Verified all ${#REQUIRED_ASSETS[@]} live URLs under releases/download/${RELEASE_TAG}/."
    else
      echo "Warning: Neither 'gh' nor 'curl' is available; skipping live URL check." >&2
    fi
  fi
fi

# 4. Clone a fresh isolated --mirror into a temp directory
ORIG_DIR="$(pwd)"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rgt-sync-scrub.XXXXXX")"
MIRROR_DIR="${WORK_DIR}/repo.git"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Cloning fresh mirror of ${REPO_URL}..."
git clone --mirror "$REPO_URL" "$MIRROR_DIR"

# Strip read-only GitHub PR refs so they are never pushed back to GitHub
git --git-dir="$MIRROR_DIR" for-each-ref --format='delete %(refname)' refs/pull/ | \
  git --git-dir="$MIRROR_DIR" update-ref --stdin

# Remove stale screenshot PR branch if present
STALE_BRANCH_EXISTS=false
if git --git-dir="$MIRROR_DIR" show-ref --verify --quiet refs/heads/chore/update-readme-screenshots; then
  STALE_BRANCH_EXISTS=true
  git --git-dir="$MIRROR_DIR" update-ref -d refs/heads/chore/update-readme-screenshots
fi

SIZE_BEFORE="$(du -sh "$MIRROR_DIR" | awk '{print $1}')"
SHOT_COMMITS="$(git --git-dir="$MIRROR_DIR" rev-list --all -- docs/assets/screenshots | wc -l | tr -d ' ')"
AISTUDIO_COMMITS="$(git --git-dir="$MIRROR_DIR" rev-list --all -- public/assets/aistudio | wc -l | tr -d ' ')"

echo ""
echo "==> Mirror audit (before scrub):"
echo "    Mirror .git size:                     ${SIZE_BEFORE}"
echo "    Commits touching docs/assets/screenshots/: ${SHOT_COMMITS}"
echo "    Commits touching public/assets/aistudio/:  ${AISTUDIO_COMMITS}"
if [[ "$AISTUDIO_COMMITS" -gt 0 && "$INCLUDE_AISTUDIO" == "false" ]]; then
  echo "    Tip: Re-run with --include-aistudio-assets to scrub public/assets/aistudio/ too."
fi

# 5. Create a local rollback backup bundle before rewriting when executing
BACKUP_BUNDLE=""
if [[ "$EXECUTE" == "true" ]]; then
  BACKUP_BUNDLE="${ORIG_DIR}/retrogametalk-sync-pre-scrub-$(date -u +%Y%m%dT%H%M%SZ).bundle"
  echo ""
  echo "==> Creating local rollback backup bundle: ${BACKUP_BUNDLE}"
  git --git-dir="$MIRROR_DIR" bundle create "$BACKUP_BUNDLE" --all
fi

# 6. Rewrite history with git-filter-repo
FILTER_ARGS=(
  --force
  --invert-paths
  --path docs/assets/screenshots/
)
if [[ "$INCLUDE_AISTUDIO" == "true" ]]; then
  FILTER_ARGS+=(--path public/assets/aistudio/)
fi

echo ""
echo "==> Running git filter-repo ${FILTER_ARGS[*]}..."
(
  cd "$MIRROR_DIR"
  git filter-repo "${FILTER_ARGS[@]}"
  git remote add origin "$REPO_URL"
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
)

SIZE_AFTER="$(du -sh "$MIRROR_DIR" | awk '{print $1}')"
REMAINING_SHOTS="$(git --git-dir="$MIRROR_DIR" rev-list --all -- docs/assets/screenshots | wc -l | tr -d ' ')"

echo ""
echo "==> Scrub summary:"
echo "    Size before:                          ${SIZE_BEFORE}"
echo "    Size after:                           ${SIZE_AFTER}"
echo "    Remaining docs/assets/screenshots/:   ${REMAINING_SHOTS} commits"
if [[ "$INCLUDE_AISTUDIO" == "true" ]]; then
  REMAINING_AI="$(git --git-dir="$MIRROR_DIR" rev-list --all -- public/assets/aistudio | wc -l | tr -d ' ')"
  echo "    Remaining public/assets/aistudio/:    ${REMAINING_AI} commits"
fi
if [[ "$STALE_BRANCH_EXISTS" == "true" ]]; then
  echo "    Stale branch removed:                 chore/update-readme-screenshots"
fi

if [[ "$EXECUTE" != "true" ]]; then
  echo ""
  echo "DRY RUN COMPLETE — GitHub was NOT modified."
  echo "To push the scrubbed history to ${REPO_URL}, re-run with --execute."
  exit 0
fi

# 7. Interactive gate before force-pushing rewritten history
echo ""
echo "WARNING: About to FORCE-PUSH rewritten git history (all branches & tags) to:"
echo "  ${REPO_URL}"
echo "Local backup bundle saved at:"
echo "  ${BACKUP_BUNDLE}"
echo ""
read -r -p "Type SCRUB to continue (anything else aborts): " CONFIRM
if [[ "$CONFIRM" != "SCRUB" ]]; then
  echo "Aborted. Remote repository was not modified."
  exit 1
fi

echo ""
echo "==> Force-pushing scrubbed branches and tags to origin..."
(
  cd "$MIRROR_DIR"
  git push --force origin --all
  git push --force origin --tags
  if [[ "$STALE_BRANCH_EXISTS" == "true" ]]; then
    git push origin --delete chore/update-readme-screenshots || true
  fi
)

cat <<EOF

==> Git history scrub complete!

Next steps for any existing local working clones:
  git fetch --all --prune --tags
  git reset --hard origin/main
  git reflog expire --expire=now --all && git gc --prune=now --aggressive
  (Or simply take a fresh 'git clone ${REPO_URL}'.)

Notes:
  1. Your GitHub Release '${RELEASE_TAG}' assets remain stored outside git object storage.
     Verify README.md on GitHub; if needed, re-run 'Update README Visual Previews' manually.
  2. GitHub purges unreferenced historical pack objects automatically during periodic GC
     (or you can request immediate GC via GitHub Support if old PR refs linger).
  3. Keep '${BACKUP_BUNDLE}' until you have verified everything on GitHub, then delete it.
EOF
