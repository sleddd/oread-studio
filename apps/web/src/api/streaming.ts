/**
 * AI generate streaming client. Consumes the server's SSE stream, invoking
 * onDelta for each token and resolving with the final structured result.
 */
import type { PersistedChatMode, Suggestion, WebCitation } from '@oread/shared';

export interface GenerateRequest {
  worldId: string;
  mode: PersistedChatMode;
  characterId: string | null;
  messages: { role: 'user' | 'assistant'; content: string }[];
  targetChapterId: string;
  /** research the web this turn (server gates it by mode) */
  allowWebSearch?: boolean;
}

export interface GenerateDone {
  kind: 'text' | 'prose' | 'suggestion';
  text?: string;
  suggestion?: Suggestion;
  citations?: WebCitation[];
  usedMock: boolean;
  includedContext: string[];
  droppedContext: string[];
}

export async function streamGenerate(
  req: GenerateRequest,
  onDelta: (t: string) => void,
): Promise<GenerateDone> {
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'same-origin',
  });
  if (!res.ok || !res.body) {
    throw new Error(`generate failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: GenerateDone | null = null;
  let error: string | null = null;

  for (;;) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const evt = parseBlock(block);
      if (!evt) continue;
      if (evt.event === 'delta') {
        try {
          onDelta(JSON.parse(evt.data).text ?? '');
        } catch {
          /* ignore */
        }
      } else if (evt.event === 'done') {
        done = JSON.parse(evt.data) as GenerateDone;
      } else if (evt.event === 'error') {
        error = JSON.parse(evt.data).error ?? 'generation error';
      }
    }
  }

  if (error) throw new Error(error);
  if (!done) throw new Error('stream ended without a result');
  return done;
}

function parseBlock(block: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return null;
  return { event, data: data.join('\n') };
}
