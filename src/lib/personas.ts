/** App-facing re-export; the registry itself is shared with the Edge Function. */
export { PERSONAS, getPersona, isPersonaId } from '../../supabase/functions/_shared/personas';
export type { Persona, PersonaId } from '../../supabase/functions/_shared/personas';
