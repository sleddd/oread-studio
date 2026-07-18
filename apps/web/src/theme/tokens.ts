/**
 * Design tokens — the single source of styling truth, lifted verbatim from the
 * prototype's Design Tokens. Components import from here rather than hardcoding
 * hexes, so the palette stays consistent and themeable.
 */
export const colors = {
  canvas: '#0d0f0f',
  panel: '#101313',
  surface1: '#141818',
  surface2: '#16191a',
  surface3: '#1a1f1f',
  field1: '#121616',
  field2: '#0f1212',
  borderStructural: '#1c2020',
  borderControl: '#232929',
  borderControl2: '#262b2b',
  borderRule: '#1a1e1e',
  borderRule2: '#16191a',
  textPrimary: '#e9ecea',
  textPrimary2: '#eef0ef',
  textSecondary: '#aeb4b2',
  textSecondary2: '#cfd3d1',
  textMuted: '#8b918f',
  textMuted2: '#7d8382',
  textFaint: '#6d7473',
  textFaint2: '#5f6664',
  textFaint3: '#4f5655',
  onAccent: '#04201f',
} as const;

export const ACCENTS = [
  { name: 'Teal', hex: '#2e9d9d' },
  { name: 'Amber', hex: '#c9922e' },
  { name: 'Violet', hex: '#8a6df0' },
  { name: 'Rose', hex: '#d1617f' },
] as const;

/** rgba tint of the default teal accent used for selected rows/tabs */
export const accentTint = 'rgba(46,157,157,0.14)';

/** Suggestion type → colour coding (tag text / background). */
export const suggestionColors: Record<string, { c: string; b: string }> = {
  rewrite: { c: '#e0b25a', b: 'rgba(224,178,90,0.14)' },
  voice: { c: '#e0b25a', b: 'rgba(224,178,90,0.14)' },
  cut: { c: '#d1617f', b: 'rgba(209,97,127,0.14)' },
  flag: { c: '#d1617f', b: 'rgba(209,97,127,0.14)' },
  continuity: { c: '#d1617f', b: 'rgba(209,97,127,0.14)' },
  'continuity-error': { c: '#d1617f', b: 'rgba(209,97,127,0.14)' },
  expand: { c: '#6fbf73', b: 'rgba(111,191,115,0.14)' },
  argument: { c: '#6fbf73', b: 'rgba(111,191,115,0.14)' },
  pacing: { c: '#8a9bf0', b: 'rgba(138,155,240,0.14)' },
};

export const fonts = {
  ui: '"Manrope", system-ui, sans-serif',
  serif: "'Newsreader', Georgia, serif",
  mono: "'Courier New', monospace",
};

export function applyAccent(hex: string): void {
  document.documentElement.style.setProperty('--accent', hex);
}
