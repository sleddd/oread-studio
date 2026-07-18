/**
 * Store factory. Default backend is Postgres; the file backend is used only
 * when OREAD_STORAGE=local. A single shared instance is returned.
 */
import { env } from '../env.js';
import type { WorldStore, StoreCtx } from './types.js';
import { PostgresStore } from './postgres-store.js';
import { FileStore } from './file-store.js';

let store: WorldStore | null = null;

export function getStore(): WorldStore {
  if (store) return store;
  store = env.storageBackend === 'local' ? new FileStore() : new PostgresStore();
  return store;
}

/** For tests: inject a specific store. */
export function setStore(s: WorldStore | null): void {
  store = s;
}

export type { WorldStore, StoreCtx };
export * from './types.js';
