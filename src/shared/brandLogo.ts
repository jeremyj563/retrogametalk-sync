export const DEFAULT_BRAND_TITLE = 'RetroGameTalk Sync';

const VIDEO_EXT_PATTERN = /\.(mp4|webm|m4v|mov)$/i;

export function isVideoBrandLogoUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  const withoutHash = trimmed.split('#')[0] || '';
  const withoutQuery = withoutHash.split('?')[0] || '';
  return VIDEO_EXT_PATTERN.test(withoutQuery);
}

export function validateBrandLogoUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  // Allow root-relative asset paths like /assets/logo.gif (reject protocol-relative //)
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) {
      throw new Error('Invalid Custom Logo URL: protocol-relative URLs (//...) are not allowed.');
    }
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid Custom Logo URL ("${trimmed}"): enter a full https:// or http:// image/video URL, or a root-relative /path.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid Custom Logo URL ("${trimmed}"): protocol must be https://, http://, or a root-relative /path.`,
    );
  }

  if (!parsed.hostname) {
    throw new Error(`Invalid Custom Logo URL ("${trimmed}"): hostname is missing.`);
  }

  return parsed.toString();
}
