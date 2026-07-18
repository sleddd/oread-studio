/**
 * World document validation. Runs on load AND save. Fails loudly on malformed
 * documents (per SPEC). The schema lives in world.schema.json (the file, so it
 * is the source of truth) and additionally enforces cross-field invariants the
 * pure JSON Schema can't express (credentialId-not-a-raw-key, etc.).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import type { WorldDocument } from '@oread/shared';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, 'world.schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema: ValidateFunction = ajv.compile(schema);

export class WorldValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`World document is invalid:\n - ${errors.join('\n - ')}`);
    this.name = 'WorldValidationError';
    this.errors = errors;
  }
}

/** Extra invariants beyond the JSON Schema. */
function crossFieldErrors(doc: WorldDocument): string[] {
  const errs: string[] = [];
  const configs = doc.world.session?.modeConfigs;
  const scopes: Array<[string, Record<string, unknown> | undefined]> = [
    ['session.model', doc.world.session?.model as unknown as Record<string, unknown> | undefined],
  ];
  if (configs) {
    for (const [mode, cfg] of Object.entries(configs)) {
      scopes.push([`session.modeConfigs.${mode}`, cfg as unknown as Record<string, unknown>]);
    }
  }
  for (const [where, c] of scopes) {
    if (!c) continue;
    // NEVER a raw key in the world document — only a credentialId pointer.
    for (const suspect of ['apiKey', 'key', 'secret', 'token']) {
      if (typeof c[suspect] === 'string' && (c[suspect] as string).length > 0) {
        errs.push(`${where}.${suspect} must not contain raw key material — use credentialId`);
      }
    }
  }
  // draft may never alter canon
  const draft = configs?.draft as unknown as Record<string, unknown> | undefined;
  if (draft && draft.canAlterCanon === true) {
    errs.push('session.modeConfigs.draft.canAlterCanon must be false');
  }
  return errs;
}

export function validateWorld(doc: unknown): asserts doc is WorldDocument {
  const ok = validateSchema(doc);
  const errors: string[] = [];
  if (!ok && validateSchema.errors) {
    for (const e of validateSchema.errors) {
      errors.push(`${e.instancePath || '(root)'} ${e.message ?? ''}`.trim());
    }
  }
  if (ok) {
    errors.push(...crossFieldErrors(doc as WorldDocument));
  }
  if (errors.length > 0) throw new WorldValidationError(errors);
}

/** Non-throwing variant for callers that want a boolean + errors. */
export function checkWorld(doc: unknown): { valid: boolean; errors: string[] } {
  try {
    validateWorld(doc);
    return { valid: true, errors: [] };
  } catch (e) {
    if (e instanceof WorldValidationError) return { valid: false, errors: e.errors };
    throw e;
  }
}
