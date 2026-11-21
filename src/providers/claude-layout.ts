import { isAbsolute } from 'node:path';

// Claude Agent SDK 0.3.328 sdk.mjs Oa/Ra/eR. The installed implementation
// uses a signed 31-based UTF-16 hash, despite its SessionKey declaration
// describing the suffix as djb2. Callers must canonicalize the workspace
// before invoking this function; it deliberately does not normalize Unicode.
export function claudeProjectKey(canonicalWorkspace: string): string {
  if (!isAbsolute(canonicalWorkspace) || canonicalWorkspace.includes('\0')) {
    throw new Error('Claude project lookup requires an absolute workspace path');
  }
  const encoded = canonicalWorkspace.replace(/[^a-zA-Z0-9]/g, '-');
  if (encoded.length <= 200) return encoded;
  let hash = 0;
  for (let index = 0; index < canonicalWorkspace.length; index++) {
    hash = ((hash << 5) - hash + canonicalWorkspace.charCodeAt(index)) | 0;
  }
  return `${encoded.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}
