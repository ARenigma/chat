import React, { type ReactNode } from 'react';
import { PaperProvider } from 'react-native-paper';
import { Icon, type IconName } from '../components/Icon';
import { useThemeMode } from './ThemeProvider';
import { PAPER_DARK, PAPER_LIGHT } from './paperTheme';

/**
 * Paper requests icons by Material Community name; we ship our own Material
 * Symbols font. This maps the handful of names Paper's own components ask for
 * (Appbar back, dialog close, list chevrons, search) onto our glyphs, so Paper
 * never pulls in react-native-vector-icons and every icon in the app stays one
 * family at one weight. An unmapped name falls back to a dot rather than a
 * red-box crash, so a new Paper component surfaces a visible gap, not an error.
 */
const MAP: Record<string, IconName> = {
  'chevron-right': 'chevronRight',
  'chevron-left': 'chevronLeft',
  'arrow-left': 'back',
  'arrow-right': 'forward',
  'arrow-back': 'back',
  close: 'close',
  magnify: 'search',
  check: 'check',
  'dots-horizontal': 'more',
  'dots-vertical': 'more',
  menu: 'more',
  send: 'send',
  image: 'image',
  microphone: 'mic',
  phone: 'call',
  video: 'video',
  cog: 'settings',
  account: 'person',
  'account-group': 'people',
  heart: 'heart',
  star: 'star',
  block: 'block',
  flag: 'report',
};

function PaperIcon({
  name,
  color,
  size,
}: {
  name: string;
  color?: string;
  size: number;
  direction?: 'rtl' | 'ltr';
  allowFontScaling?: boolean;
}) {
  return <Icon name={MAP[name] ?? 'dot'} size={size} color={color} />;
}

const SETTINGS = { icon: PaperIcon };

/**
 * PaperProvider, themed from our tokens and following light/dark. Sits inside
 * ThemeProvider so it can read the mode, and wraps the whole signed-in/out tree
 * so any screen can use Material 3 components.
 */
export function PaperHost({ children }: { children: ReactNode }) {
  const { isDark } = useThemeMode();
  return (
    <PaperProvider theme={isDark ? PAPER_DARK : PAPER_LIGHT} settings={SETTINGS}>
      {children}
    </PaperProvider>
  );
}
