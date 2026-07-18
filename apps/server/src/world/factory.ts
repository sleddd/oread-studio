/**
 * World factories. `emptyWorld` seeds a fresh "Untitled World" (the prototype's
 * detail:false case). `sampleWorld` builds the fully-authored Sweet Nothings
 * world used to seed a new account with real content.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONTEXT_RECIPES,
  DEFAULT_MEMORY_WRITEBACK,
} from '@oread/shared';
import type {
  WorldDocument,
  WorldSession,
  ModeConfigs,
} from '@oread/shared';

function defaultModeConfigs(): ModeConfigs {
  const base = { credentialId: null, provider: null, model: null, temperature: 0.85 } as const;
  return {
    cowrite: {
      ...base,
      turnScope: 'paragraph',
      userRole: 'author',
      handoffRule: 'hand back after one turn',
      canAdvancePlot: true,
      maxTurnLength: 220,
    },
    draft: {
      ...base,
      target: '',
      fromMaterial: 'outline',
      lengthTarget: '~800',
      canInventDetails: true,
      canAlterCanon: false,
    },
    edit: {
      ...base,
      target: '',
      editLevel: 'line',
      constraints: [],
      outputFormat: 'redline',
    },
    critique: {
      ...base,
      target: '',
      lenses: ['pacing'],
      depth: 'margin-notes',
      suggestRewrites: true,
    },
    discuss: { ...base, focus: 'character', mayProposeCanon: false },
  };
}

export function defaultSession(): WorldSession {
  return {
    defaultMode: 'cowrite',
    modeConfigs: defaultModeConfigs(),
    memoryWriteback: DEFAULT_MEMORY_WRITEBACK,
    contextRecipes: DEFAULT_CONTEXT_RECIPES,
    narratorVoice: 'third_limited',
    hardRules: ['Never speak for the author.', 'Never contradict canon.'],
    styleNotes: 'Warm register, short sentences under pressure, no purple prose.',
    linguisticFilters: { bannedWords: [], bannedPhrases: [] },
  };
}

export function emptyWorld(name = 'Untitled World'): WorldDocument {
  const now = new Date().toISOString();
  return {
    world: {
      identity: {
        id: randomUUID(),
        name,
        version: '1',
        mode: 'fiction',
        created: now,
        lastModified: now,
      },
      premise: { logline: '', synopsis: '', themes: [], genre: [], tone: '' },
      setting: { lore: '', timePeriod: '', locations: [], rules: [] },
      entities: {
        characters: [],
        relationships: [],
        factions: [],
        concepts: [],
        sources: [],
      },
      structure: { chapters: [], scenes: [], timeline: [] },
      memory: { events: [], canon: [], openThreads: [], decisions: [] },
      suggestions: [],
      session: defaultSession(),
    },
  };
}
