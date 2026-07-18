/**
 * Deterministic mock replies — the FALLBACK used only when no credential is
 * configured for the active mode, so the app runs end-to-end before keys are
 * added. Mirrors the prototype's replyFor() canned copy. Real providers are the
 * default path once a credential exists.
 */
import type { PersistedChatMode } from '@oread/shared';
import { baseMode } from './permissions.js';
import type { Suggestion } from '@oread/shared';

export interface MockResult {
  kind: 'text' | 'prose';
  text: string;
}

const PROSE: Record<string, string[]> = {
  cowrite: [
    '"Oh — oh no, I\'m so sorry—" Jamie freezes, boxes swaying, and gives you a lopsided, apologetic grin. "You have very good reflexes. Can I pay you in croissant? I have, um. A lot of croissant."',
    'Jamie sets the last box down like it\'s made of glass, then finally looks at you properly. "That was going to be a very bad morning," he says. "You just made it a normal one."',
  ],
  draft: [
    'Jamie set the boxes down with the exaggerated care of a man defusing a bomb, wiped his palms on his apron, and finally, properly, looked at you.\n\n"I\'d have lost all of them," he said. "Every last one."',
  ],
  discuss: [
    "Honestly? Jamie would be mortified and cover it with jokes. If you want him vulnerable, put flour on his hands first — he's braver when he's busy.",
    "The risk with Sam is making him a diary. Let one thing he can't stay detached about slip through, early.",
  ],
};

const SUGGESTIONS: Omit<Suggestion, 'id' | 'target' | 'anchor' | 'status' | 'createdIn'>[] = [
  {
    type: 'rewrite',
    original:
      'The tower sways precariously as he fumbles for the door handle, causing a few nearby patrons to wince.',
    proposed:
      'The tower swayed. Jamie lunged for the handle, missed, and a week of work leaned out over the tile — until your hand caught the top box first.',
    rationale: 'Cut the adverbs; let the verbs carry the danger. Present tense → past to match the chapter.',
  },
  {
    type: 'flag',
    original: '',
    proposed: null,
    rationale:
      'Ch 1 says 4:52pm for Sam\'s arrival, but this scene reads as morning. Confirm which is canon before drafting Ch 2.',
  },
];

let counter = 0;

export function mockReply(mode: PersistedChatMode): MockResult {
  const base = baseMode(mode);
  const bank = PROSE[base] ?? PROSE.discuss!;
  const text = bank[counter++ % bank.length]!;
  const kind = base === 'discuss' ? 'text' : 'prose';
  return { kind, text };
}

export function mockSuggestion(target: string): Suggestion {
  const s = SUGGESTIONS[counter++ % SUGGESTIONS.length]!;
  return {
    id: `sug_${Date.now()}_${counter}`,
    target,
    anchor: { start: 0, end: 0 },
    type: s.type,
    original: s.original,
    proposed: s.proposed,
    rationale: s.rationale,
    status: 'pending',
    createdIn: mode2label('edit'),
  };
}

function mode2label(m: string): string {
  return m;
}
