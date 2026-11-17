/**
 * Normalizes an optional GIT_URL environment variable into a clean HTTP(S) base repository URL.
 * Supports standard HTTPS URLs, trailing `.git` suffixes, trailing slashes, and git SSH clone URLs.
 */
export function normalizeGitRepoUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let candidate = raw.trim();
  if (!candidate) return null;

  // Support SCP-style SSH clone URLs: git@github.com:owner/repo.git -> https://github.com/owner/repo.git
  const scpMatch = /^git@([a-zA-Z0-9.-]+):(.+)$/.exec(candidate);
  if (scpMatch) {
    candidate = `https://${scpMatch[1]}/${scpMatch[2].replace(/^\/+/, '')}`;
  } else if (candidate.startsWith('ssh://')) {
    // Support ssh://git@host/owner/repo.git -> https://host/owner/repo.git
    candidate = candidate.replace(/^ssh:\/\/(?:[^@]+@)?/i, 'https://');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  if (!parsed.hostname) {
    return null;
  }

  const cleanPath = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  return `${parsed.origin}${cleanPath}`;
}

function encodeGitRefPath(ref: string): string {
  return ref
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function detectGitHostFlavor(baseUrl: string): 'gitlab' | 'bitbucket' | 'gitea' | 'github' {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes('gitlab')) return 'gitlab';
    if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) return 'bitbucket';
    if (host === 'codeberg.org' || host.includes('gitea') || host.includes('forgejo')) {
      return 'gitea';
    }
  } catch {
    // Fallback to GitHub-compatible routes
  }
  return 'github';
}

export type GitRefKind = 'release' | 'branch' | 'pr';

export interface GitRefDestination {
  url: string;
  kind: GitRefKind;
  refName: string;
}

const SEMVER_TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PR_REF_PATTERN = /^(?:refs\/)?(?:pull|merge-requests)\/(\d+)(?:\/.*)?$/i;

/**
 * Classifies a GIT_REF (e.g. "refs/tags/1.0.2", "refs/heads/main", "refs/pull/42/merge",
 * "1.0.2", or "feature/xyz") and resolves the appropriate upstream web URL on top of GIT_URL.
 */
export function resolveGitRefDestination(
  baseRepoUrl: string | null | undefined,
  gitRef: string | null | undefined,
  fallbackVersion?: string | null | undefined,
): GitRefDestination | null {
  const base = normalizeGitRepoUrl(baseRepoUrl);
  if (!base) return null;

  const rawRef =
    (typeof gitRef === 'string' && gitRef.trim()) ||
    (typeof fallbackVersion === 'string' && fallbackVersion.trim()) ||
    '';
  if (
    !rawRef ||
    rawRef === 'unknown' ||
    rawRef === 'local' ||
    rawRef === 'dev' ||
    rawRef === 'HEAD'
  ) {
    return null;
  }

  const flavor = detectGitHostFlavor(base);

  const prMatch = PR_REF_PATTERN.exec(rawRef);
  if (prMatch) {
    const prNum = prMatch[1];
    const url =
      flavor === 'gitlab'
        ? `${base}/-/merge_requests/${prNum}`
        : flavor === 'bitbucket'
          ? `${base}/pull-requests/${prNum}`
          : `${base}/pull/${prNum}`;
    return { url, kind: 'pr', refName: `#${prNum}` };
  }

  let kind: GitRefKind;
  let refName: string;

  if (rawRef.startsWith('refs/tags/')) {
    kind = 'release';
    refName = rawRef.slice('refs/tags/'.length).trim();
  } else if (rawRef.startsWith('refs/heads/')) {
    kind = 'branch';
    refName = rawRef.slice('refs/heads/'.length).trim();
  } else if (rawRef.startsWith('refs/remotes/')) {
    const afterRemotes = rawRef.slice('refs/remotes/'.length).replace(/^[^/]+\//, '').trim();
    kind = 'branch';
    refName = afterRemotes;
  } else if (SEMVER_TAG_PATTERN.test(rawRef)) {
    kind = 'release';
    refName = rawRef;
  } else {
    kind = 'branch';
    refName = rawRef.startsWith('refs/') ? rawRef.replace(/^refs\/[^/]+\//, '').trim() : rawRef;
  }

  const encodedRef = encodeGitRefPath(refName);
  if (!encodedRef) return null;

  if (kind === 'release') {
    const url =
      flavor === 'gitlab'
        ? `${base}/-/tags/${encodedRef}`
        : flavor === 'bitbucket'
          ? `${base}/src/${encodedRef}`
          : `${base}/releases/tag/${encodedRef}`;
    return { url, kind: 'release', refName };
  }

  const url =
    flavor === 'gitlab'
      ? `${base}/-/tree/${encodedRef}`
      : flavor === 'bitbucket'
        ? `${base}/branch/${encodedRef}`
        : `${base}/tree/${encodedRef}`;
  return { url, kind: 'branch', refName };
}

/**
 * Dynamically builds the release, branch, or PR URL on top of the configured GIT_URL base.
 */
export function buildGitBranchUrl(
  baseRepoUrl: string | null | undefined,
  branchOrTag: string | null | undefined,
): string | null {
  return resolveGitRefDestination(baseRepoUrl, branchOrTag)?.url ?? null;
}

/**
 * Dynamically builds the commit URL on top of the configured GIT_URL base.
 */
export function buildGitCommitUrl(
  baseRepoUrl: string | null | undefined,
  commitSha: string | null | undefined,
): string | null {
  const base = normalizeGitRepoUrl(baseRepoUrl);
  if (!base) return null;

  const sha = typeof commitSha === 'string' ? commitSha.trim() : '';
  if (!sha || sha === 'unknown' || sha === 'local') return null;

  const encodedSha = encodeURIComponent(sha);
  const flavor = detectGitHostFlavor(base);
  if (flavor === 'gitlab') {
    return `${base}/-/commit/${encodedSha}`;
  }
  if (flavor === 'bitbucket') {
    return `${base}/commits/${encodedSha}`;
  }
  return `${base}/commit/${encodedSha}`;
}
