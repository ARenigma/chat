/**
 * The companion registry — the one place a companion is named.
 *
 * Dependency-free plain TypeScript so both runtimes can import it: Metro (React
 * Native client) and Deno (Edge Function).
 *
 * System prompts live in `prompts.ts`, which only the Edge Function imports.
 * Keeping them out of this file keeps them out of the shipped JS bundle: prompt
 * wording is a server-side product decision, changeable without an app release,
 * and there is nothing a client can do with it.
 */

export type PersonaId = 'mia' | 'aria' | 'nina' | 'zoe';

export interface Persona {
  readonly id: PersonaId;
  readonly name: string;
  readonly tagline: string;
  /** Single character shown in the Avatar until real portraits exist. */
  readonly initial: string;
  /** Drives the presence dot. Static for now; a real signal would come from the server. */
  readonly online: boolean;
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'mia',
    name: 'Mia',
    tagline: 'Playful, teasing, always curious about you',
    initial: 'M',
    online: true,
  },
  {
    id: 'aria',
    name: 'Aria',
    tagline: 'Soft-spoken. Listens more than she talks',
    initial: 'A',
    online: true,
  },
  {
    id: 'nina',
    name: 'Nina',
    tagline: 'Bold and direct. Says exactly what she wants',
    initial: 'N',
    online: false,
  },
  {
    id: 'zoe',
    name: 'Zoe',
    tagline: 'Bright, silly, easy to be around',
    initial: 'Z',
    online: true,
  },
] as const;

const BY_ID: ReadonlyMap<string, Persona> = new Map(PERSONAS.map(p => [p.id, p]));

export function getPersona(id: string): Persona | undefined {
  return BY_ID.get(id);
}

export function isPersonaId(id: unknown): id is PersonaId {
  return typeof id === 'string' && BY_ID.has(id);
}
