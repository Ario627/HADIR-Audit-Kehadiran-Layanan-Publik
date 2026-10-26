const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return null;
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return null;
  }
  return url.toString();
}