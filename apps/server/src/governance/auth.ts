import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface RunTokenClaims {
  runId: string;
  employeeId: string;
  projectId: string | null;
  exp: number;
}

const ALLOWED_ORIGIN_REGEX = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/i;

/**
 * Manages localhost bearer session authentication, Origin/Host CSRF protection,
 * and HMAC-signed short-lived Run-Scoped Tokens for employee/MCP identity isolation.
 */
export class LocalAuthManager {
  public readonly sessionToken: string;
  private readonly signingKey: Buffer;

  constructor(tokenFilePath: string) {
    fs.mkdirSync(path.dirname(tokenFilePath), { recursive: true });
    if (fs.existsSync(tokenFilePath)) {
      const existing = fs.readFileSync(tokenFilePath, "utf8").trim();
      if (/^[a-f0-9]{64}$/i.test(existing)) {
        this.sessionToken = existing;
      } else {
        this.sessionToken = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(tokenFilePath, this.sessionToken, { encoding: "utf8", mode: 0o600 });
      }
    } else {
      this.sessionToken = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(tokenFilePath, this.sessionToken, { encoding: "utf8", mode: 0o600 });
    }
    this.signingKey = crypto.createHash("sha256").update(this.sessionToken).digest();
  }

  public isAllowedHost(hostHeader: string | undefined): boolean {
    if (!hostHeader) {
      return false;
    }
    const hostWithoutPort = hostHeader.replace(/:\d+$/, "").toLowerCase();
    return hostWithoutPort === "127.0.0.1" || hostWithoutPort === "localhost";
  }

  public isAllowedOrigin(originHeader: string | undefined): boolean {
    if (!originHeader) {
      // Non-browser local CLI/SDK callers do not send Origin
      return true;
    }
    return ALLOWED_ORIGIN_REGEX.test(originHeader);
  }

  public verifyBearerToken(authHeader: string | undefined, queryToken?: string): boolean {
    const candidate =
      authHeader?.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : (queryToken ?? "").trim();

    if (!candidate || candidate.length !== this.sessionToken.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(this.sessionToken));
  }

  public mintRunToken(claims: Omit<RunTokenClaims, "exp">, ttlMs = 3600_000): string {
    const payload: RunTokenClaims = {
      ...claims,
      exp: Date.now() + ttlMs,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", this.signingKey).update(encoded).digest("base64url");
    return `${encoded}.${sig}`;
  }

  public verifyRunToken(token: string): RunTokenClaims | null {
    const parts = token.split(".");
    if (parts.length !== 2) {
      return null;
    }
    const [encoded, sig] = parts;
    if (!encoded || !sig) {
      return null;
    }
    const expectedSig = crypto
      .createHmac("sha256", this.signingKey)
      .update(encoded)
      .digest("base64url");
    if (sig.length !== expectedSig.length) {
      return null;
    }
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }
    try {
      const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RunTokenClaims;
      if (typeof claims.exp !== "number" || Date.now() > claims.exp) {
        return null;
      }
      return claims;
    } catch {
      return null;
    }
  }
}
