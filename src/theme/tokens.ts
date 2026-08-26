/**
 * The app's theme entry point.
 *
 * Deliberately a thin re-export: the values themselves are generated from Figma
 * (`design/tokens.json` -> `tokens.generated.ts`), so nothing here is editable by
 * hand. Import from this path rather than the generated file, it keeps every
 * call site stable if the generator's output shape ever changes.
 */
export { LIGHT, DARK, TOKENS } from './tokens.generated';
export type { Theme } from './tokens.generated';
