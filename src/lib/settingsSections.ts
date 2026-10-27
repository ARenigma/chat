/**
 * The settings list's information architecture: which rows exist and in which
 * order. Data, not JSX, so the order is tested without rendering and both
 * trees read one list.
 *
 * adapted from bluesky-social/social-app src/screens/Settings/Settings.tsx
 * and components/SettingsList.tsx (MIT), see THIRD_PARTY_LICENSES.md
 */

export type SettingsRowId =
  | 'edit-profile'
  | 'photos'
  | 'get-paid'
  | 'become-provider'
  | 'usage'
  | 'transactions'
  | 'invoices'
  | 'notifications'
  | 'theme'
  | 'blocked'
  | 'share'
  | 'about';

type SettingsSectionId = 'main';

export interface SettingsSectionModel {
  id: SettingsSectionId;
  title: string;
  rows: readonly SettingsRowId[];
}

/*
 * ONE list, no sections (Amit, 2026-10-03: "bluesky doesnt have sections.. i
 * told you to import it verbatim"). Bluesky's root Settings is a single run of
 * rows with About last, then a divider and the destructive rows
 * (social-app Settings.tsx). The legal rows moved into About, as Bluesky's
 * Terms and Privacy live in AboutSettings. Kept as a one-entry list so both
 * trees and the tests still read one model.
 */
export const SETTINGS_SECTIONS: readonly SettingsSectionModel[] = [
  {
    id: 'main',
    title: 'Settings',
    rows: [
      'edit-profile',
      'photos',
      // Amit 2026-09-29: usage first (what each session cost/earned), then the
      // money-in history, then the billing documents, then the payout row.
      'usage',
      'transactions',
      'invoices',
      'get-paid',
      // Member tree only: the way back into the provider application for a
      // member who backed out of it (sweep B3, 2026-10-09).
      'become-provider',
      'notifications',
      'theme',
      'blocked',
      'share',
      'about',
    ],
  },
];

/**
 * The rows to draw, holding only the rows this tree offers (and a search
 * matches). An empty list draws nothing.
 */
export function visibleSections(offered: (row: SettingsRowId) => boolean): SettingsSectionModel[] {
  return SETTINGS_SECTIONS.map(s => ({ ...s, rows: s.rows.filter(offered) })).filter(
    s => s.rows.length > 0,
  );
}
