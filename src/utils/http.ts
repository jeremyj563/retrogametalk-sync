export interface SafeJsonResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage: string | null;
}

function extractHtmlTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  const cleaned = match[1].replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

export async function readJsonSafely<T>(res: Response): Promise<SafeJsonResult<T>> {
  const text = await res.text();
  const trimmed = text.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as T & { error?: unknown; message?: unknown };
      const errField =
        parsed && typeof parsed === 'object'
          ? (typeof parsed.error === 'string' && parsed.error) ||
            (typeof parsed.message === 'string' && !res.ok ? parsed.message : null)
          : null;
      return {
        ok: res.ok,
        status: res.status,
        data: parsed,
        errorMessage: res.ok ? null : errField || `Request failed (HTTP ${res.status})`,
      };
    } catch {
      // Fall through to non-JSON diagnostic
    }
  }

  const title = trimmed.startsWith('<') ? extractHtmlTitle(trimmed) : null;
  const detail = title
    ? `HTTP ${res.status} (${title})`
    : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;

  return {
    ok: false,
    status: res.status,
    data: null,
    errorMessage: trimmed.startsWith('<')
      ? `Server returned an HTML error page instead of JSON (${detail}). Check that the backend service is running and reachable.`
      : trimmed || `Unexpected non-JSON response (${detail})`,
  };
}
