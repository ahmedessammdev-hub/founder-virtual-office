const REDACTED = "[REDACTED_SECRET]";

interface SecretRule {
  pattern: RegExp;
  replacement: string;
}

const SECRET_RULES: SecretRule[] = [
  // PEM private key blocks
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  // Anthropic keys
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, replacement: REDACTED },
  // OpenAI / OpenRouter / Stripe-style sk- tokens
  { pattern: /\b(?:sk|rk|pk)-(?:proj-|live-|test-|or-v1-)?[A-Za-z0-9_-]{16,}\b/g, replacement: REDACTED },
  // Google API keys
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: REDACTED },
  // GitHub tokens
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replacement: REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: REDACTED },
  // Slack tokens
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: REDACTED },
  // Telegram bot tokens (digits:alphanum)
  { pattern: /\b\d{7,12}:[A-Za-z0-9_-]{25,}\b/g, replacement: REDACTED },
  // Authorization Bearer tokens
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi, replacement: `$1${REDACTED}` },
  // Sensitive env assignments
  {
    pattern:
      /((?:API_KEY|SECRET_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|PRIVATE_KEY|PASSWORD|DATABASE_URL|BOT_TOKEN|CLIENT_SECRET)\s*[:=]\s*["']?)[^\s"'`\r\n]{8,}(["']?)/gi,
    replacement: `$1${REDACTED}$2`,
  },
];

/**
 * Redacts common API keys, bearer tokens, private key blocks, and sensitive key=value lines.
 */
export function redactSecrets(input: string): string {
  if (!input) {
    return input;
  }

  let output = input;
  for (const rule of SECRET_RULES) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
}

const ALLOWED_ENV_EXAMPLES = new Set([".env.example", ".env.sample", ".env.template"]);

/**
 * Identifies sensitive project files (.env, private keys, credentials, secrets)
 * that must be blocked by default from employee file-reading tools unless unlocked via Tier 3 approval.
 */
export function isSensitiveFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const baseName = (segments[segments.length - 1] ?? "").toLowerCase();

  if (ALLOWED_ENV_EXAMPLES.has(baseName)) {
    return false;
  }

  if (baseName === ".env" || baseName.startsWith(".env.")) {
    return true;
  }

  if (
    baseName.endsWith(".pem") ||
    baseName.endsWith(".key") ||
    baseName.endsWith(".p12") ||
    baseName.endsWith(".pfx") ||
    baseName.endsWith(".keystore")
  ) {
    return true;
  }

  if (
    baseName.startsWith("id_rsa") ||
    baseName.startsWith("id_ed25519") ||
    baseName.startsWith("id_ecdsa")
  ) {
    return true;
  }

  if (
    (baseName.includes("credentials") || baseName.includes("service-account") || baseName.includes("service_account")) &&
    baseName.endsWith(".json")
  ) {
    return true;
  }

  if (baseName.includes("secret") && (baseName.endsWith(".json") || baseName.endsWith(".yaml") || baseName.endsWith(".yml") || baseName.endsWith(".txt"))) {
    return true;
  }

  if (normalized.toLowerCase().endsWith("/.git/config") || normalized.toLowerCase() === ".git/config") {
    return true;
  }

  return false;
}
