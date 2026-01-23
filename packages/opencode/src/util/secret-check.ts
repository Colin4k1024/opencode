/**
 * Scan text for patterns that may indicate hardcoded secrets.
 * Returns the first matched pattern (or null). Used to attach likelySecret metadata to edit permission.
 */
const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "password_assignment", re: /password\s*=\s*['"][^'"]+['"]/i },
  { name: "api_key", re: /api[_-]?key\s*=\s*['"]?\w+['"]?/i },
  { name: "secret_assignment", re: /secret\s*=\s*['"][^'"]+['"]/i },
  { name: "bearer_token", re: /Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/i },
  { name: "aws_key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "private_key_header", re: /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/ },
]

export function scanSecrets(text: string): { pattern: string; snippet: string } | null {
  for (const { name, re } of PATTERNS) {
    const m = text.match(re)
    if (m) {
      const snippet = m[0].length > 80 ? m[0].slice(0, 77) + "..." : m[0]
      return { pattern: name, snippet }
    }
  }
  return null
}
