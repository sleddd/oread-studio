/**
 * Chat distillation. On save, a cheap model reads the transcript and extracts
 * memory events, which are appended to world.memory.events. Restartable: only
 * chats with distilled=false are processed, and the flag flips only after the
 * world write succeeds.
 *
 * Falls back to a heuristic extractor when no credential is configured, so
 * distillation still produces something offline.
 */
import type {
  WorldDocument,
  MemoryEvent,
  ChatMessage,
  PersistedChatMode,
} from '@oread/shared';
import type { StoreCtx } from '../storage/types.js';
import { resolveAuth } from '../credentials/store.js';
import { getAdapter } from './adapters/index.js';
import { env } from '../env.js';
import { randomUUID } from 'node:crypto';

function transcriptText(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const who = m.role === 'user' ? 'Author' : m.char ? `AI(${m.char})` : 'AI';
      const text = m.text ?? (m.sug ? `[suggestion] ${m.sug.rationale}` : '');
      return `${who}: ${text}`;
    })
    .join('\n');
}

const DISTILL_SYSTEM =
  'You extract durable memory events from a writing-session transcript. ' +
  'Return a JSON array of events, each: ' +
  '{ "type": "plot|character-development|worldbuilding|decision|research-finding", ' +
  '"summary": "one line", "detail": "1-2 sentences", "importance": 1-5 }. ' +
  'Only include things worth remembering across sessions. Output ONLY the JSON array.';

function toEvents(
  raw: Array<Partial<MemoryEvent>>,
  chapterContext: string,
): MemoryEvent[] {
  const now = new Date().toISOString();
  return raw
    .filter((e) => e.summary)
    .map((e) => ({
      id: `mem_${randomUUID().slice(0, 8)}`,
      timestamp: now,
      type: (e.type as MemoryEvent['type']) ?? 'plot',
      summary: e.summary!,
      detail: e.detail ?? '',
      entities: e.entities ?? [],
      chapterContext,
      importance: Math.min(5, Math.max(1, Number(e.importance ?? 3))),
    }));
}

/** Heuristic fallback: one low-importance event summarizing the session. */
function heuristicEvents(messages: ChatMessage[], chapterContext: string): MemoryEvent[] {
  const userMsgs = messages.filter((m) => m.role === 'user' && m.text);
  if (userMsgs.length === 0) return [];
  const first = userMsgs[0]!.text!.slice(0, 100);
  return toEvents(
    [
      {
        type: 'decision',
        summary: `Session discussed: ${first}`,
        detail: `A saved chat covered ${userMsgs.length} author prompt(s).`,
        importance: 2,
      },
    ],
    chapterContext,
  );
}

export interface DistillInput {
  ctx: StoreCtx;
  world: WorldDocument;
  mode: PersistedChatMode;
  messages: ChatMessage[];
  chapterContext: string;
}

/** Returns the new events (already appended to the passed world doc in memory). */
export async function distillChat(input: DistillInput): Promise<MemoryEvent[]> {
  const transcript = transcriptText(input.messages);
  if (!transcript.trim()) return [];

  // Resolve the distill credential from the world's model setting (cheap model).
  const credId = input.world.world.session.model?.credentialId ?? null;
  const resolved = credId ? await resolveAuth(input.ctx, credId) : null;

  let events: MemoryEvent[] = [];
  if (resolved) {
    try {
      const adapter = getAdapter(resolved.provider);
      const result = await adapter.generate(
        {
          model: env.distillModel,
          system: DISTILL_SYSTEM,
          messages: [{ role: 'user', content: transcript }],
          temperature: 0.3,
          maxTokens: 1024,
        },
        resolved.auth,
      );
      const match = result.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Array<Partial<MemoryEvent>>;
        events = toEvents(parsed, input.chapterContext);
      }
    } catch {
      events = heuristicEvents(input.messages, input.chapterContext);
    }
  } else {
    events = heuristicEvents(input.messages, input.chapterContext);
  }

  input.world.world.memory.events.push(...events);
  input.world.world.identity.lastModified = new Date().toISOString();
  return events;
}
