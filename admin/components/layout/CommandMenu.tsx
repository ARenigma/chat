'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun, SignOut } from '@phosphor-icons/react/dist/ssr';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useShell } from '@/components/layout/shell-context';

/** Cmd/Ctrl+K: jump to any page, toggle theme, sign out. */
export function CommandMenu() {
  const { commandOpen, setCommandOpen, nav } = useShell();
  const router = useRouter();
  const { setTheme } = useTheme();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [commandOpen, setCommandOpen]);

  const run = (fn: () => void) => {
    setCommandOpen(false);
    fn();
  };

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
      <CommandInput placeholder="Jump to a page or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {nav.flatMap((g) => g.items).map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} value={`go ${label}`} onSelect={() => run(() => router.push(href))}>
              <Icon aria-hidden="true" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem value="theme dark" onSelect={() => run(() => setTheme('dark'))}>
            <Moon aria-hidden="true" />
            Dark theme
          </CommandItem>
          <CommandItem value="theme light" onSelect={() => run(() => setTheme('light'))}>
            <Sun aria-hidden="true" />
            Light theme
          </CommandItem>
          <CommandItem
            value="sign out"
            onSelect={() => run(() => (document.getElementById('signout-form') as HTMLFormElement | null)?.requestSubmit())}
          >
            <SignOut aria-hidden="true" />
            Sign out
            <CommandShortcut>Account</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
