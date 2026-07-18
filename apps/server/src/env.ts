/**
 * Centralized environment access. Import `env` — do not read process.env
 * elsewhere. Fails loudly for required-but-missing values when they're used.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal .env loader (avoid a dependency; only runs once at startup).
function loadDotEnv(): void {
  for (const file of ['.env', '../../.env']) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const line of text.split('\n')) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        if (process.env[key] !== undefined) continue;
        let val = m[2]!.trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
      break;
    } catch {
      // no .env at this path; try the next
    }
  }
}
loadDotEnv();

export type StorageBackend = 'postgres' | 'local';

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  return v === 'true' || v === '1' || v === 'yes';
}

export const env = {
  get databaseUrl(): string | undefined {
    return process.env.DATABASE_URL;
  },
  get pgSslMode(): string | undefined {
    return process.env.PGSSLMODE;
  },
  /** Default is postgres; file backend only when explicitly local. */
  get storageBackend(): StorageBackend {
    return process.env.OREAD_STORAGE === 'local' ? 'local' : 'postgres';
  },
  get localWorldsDir(): string {
    return process.env.OREAD_WORLDS_DIR ?? resolve(process.cwd(), 'data/worlds');
  },
  get masterKeyActiveVer(): number {
    return Number(process.env.MASTER_KEY_ACTIVE_VER ?? '1');
  },
  masterKey(ver: number): string | undefined {
    return process.env[`MASTER_KEY_V${ver}`];
  },
  get sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s) throw new Error('SESSION_SECRET is required');
    return s;
  },
  get sessionTtlDays(): number {
    return Number(process.env.SESSION_TTL_DAYS ?? '30');
  },
  get cookieSecure(): boolean {
    return bool(process.env.COOKIE_SECURE, false);
  },
  get port(): number {
    return Number(process.env.PORT ?? '8080');
  },
  get webOrigin(): string[] {
    return (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get distillModel(): string {
    return process.env.DISTILL_MODEL ?? 'claude-haiku-4-5-20251001';
  },
  provider: {
    get anthropicKey() {
      return process.env.ANTHROPIC_API_KEY;
    },
    get openaiKey() {
      return process.env.OPENAI_API_KEY;
    },
    get cloudflareAccountId() {
      return process.env.CLOUDFLARE_ACCOUNT_ID;
    },
    get cloudflareToken() {
      return process.env.CLOUDFLARE_API_TOKEN;
    },
    get awsRegion() {
      return process.env.AWS_REGION ?? 'us-east-1';
    },
    get ollamaBaseUrl() {
      return process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    },
  },
};
