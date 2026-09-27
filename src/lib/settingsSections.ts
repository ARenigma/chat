/**
 * The settings list's information architecture: which sections exist, in
 * which order, and which rows each one holds. Data, not JSX, so the order is
 * tested without rendering and both trees read one list.
 *
 * Grouped the way Bluesky's Settings and the industry apps group theirs
 * (owner decision, 2026-09-25, "Option A approved"): who you are, your money,
 * how the app behaves, and the legal fine print. Sign out and Delete account
 * stay below Legal in their own spaced group, as they already sat, so the
 * destructive row is never flush against a benign one.
 *
 * adapted from bluesky-social/social-app src/screens/Settings/Settings.tsx
 * and components/SettingsList.tsx (MIT), see THIRD_PARTY_LICENSES.md
 */

export type SettingsRowId =
  | 'edit-profile'
  | 'photos'
  | 'get-paid'
  | 'usage'
  | 'transactions'
  | 'invoices'
  | 'notifications'
  | 'theme'
  | 'blocked'
  | 'terms'
  | 'privacy'
  | 'refund';

export type SettingsSectionId = 'profile' | 'money' | 'app' | 'legal';

export interface SettingsSectionModel {
  id: SettingsSectionId;
  title: string;
  rows: readonly SettingsRowId[];
}

export const SETTINGS_SECTIONS: readonly SettingsSectionModel[] = [
  { id: 'profile', title: 'Your profile', rows: ['edit-profile', 'photos'] },
  { id: 'money', title: 'Money', rows: ['get-paid', 'usage', 'transactions', 'invoices'] },
  { id: 'app', title: 'App', rows: ['notifications', 'theme', 'blocked'] },
  { id: 'legal', title: 'Legal', rows: ['terms', 'privacy', 'refund'] },
];

/**
 * The sections to draw, holding only the rows this tree offers (and a search
 * matches). A section with no row left is dropped, label and all, so a member
 * never sees an empty "Your profile" heading.
 */
export function visibleSections(offered: (row: SettingsRowId) => boolean): SettingsSectionModel[] {
  return SETTINGS_SECTIONS.map(s => ({ ...s, rows: s.rows.filter(offered) })).filter(
    s => s.rows.length > 0,
  );
}
