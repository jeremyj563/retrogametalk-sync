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

function detectGitHostFlavor(baseUrl: string): 'gitlab' | 'bitbucket' | 'standard' {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes('gitlab')) return 'gitlab';
    if (host === 'bitbucket.org' || host.endsWith('.bitbucket.org')) return 'bitbucket';
  } catch {
    // Fallback to standard GitHub / Gitea / Forgejo / Codeberg tree & commit paths
  }
  return 'standard';
}

/**
 * Dynamically builds the branch/tag URL on top of the configured GIT_URL base.
 */
export function buildGitBranchUrl(
  baseRepoUrl: string | null | undefined,
  branchOrTag: string | null | undefined,
): string | null {
  const base = normalizeGitRepoUrl(baseRepoUrl);
  if (!base) return null;

  const ref = typeof branchOrTag === 'string' ? branchOrTag.trim() : '';
  if (!ref || ref === 'unknown' || ref === 'local') return null;

  const encodedRef = encodeGitRefPath(ref);
  if (!encodedRef) return null;

  const flavor = detectGitHostFlavor(base);
  if (flavor === 'gitlab') {
    return `${base}/-/tree/${encodedRef}`;
  }
  if (flavor === 'bitbucket') {
    return `${base}/branch/${encodedRef}`;
  }
  return `${base}/tree/${encodedRef}`;
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
