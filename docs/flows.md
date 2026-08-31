# Top app flows — conversation list, back stack, first Home

Five shipped messengers, then what we took. Mobbin / Figma / M3, not invention.

## Sources

1. **WhatsApp** — Long-press a chat → pin, mute, archive, delete. Pins sit at the top of the inbox. Opening a chat from the inbox, back returns to the inbox, not a different tab.
2. **Telegram** — Long-press opens a vertical context menu (pin, mute, delete) next to the row. Folder / “hide from chats” is a layout choice, not a server wipe.
3. **Signal** — Archive is a separate list. A thread opened from Archive pops back to Archive; a second back leaves that list. Swipe exists; Android long-press still offers the same verbs.
4. **iMessage** — The conversation list is the parent of a thread. Back from a thread is always the list. Destructive delete is a confirm, not an immediate swipe-commit on first use.
5. **Instagram DMs** — Inbox stays on the stack. Back from a thread returns to the inbox, not the feed that launched Notes / the camera. Long-press offers pin and delete.

M3 Menus: press-and-hold opens a **menu**, not a sheet, when the set is three short actions. Compact width may use a sheet for longer lists; three rows is a menu.

https://m3.material.io/components/menus/guidelines

## What Pappal does

| Flow                     | Behaviour                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Long-press rail face     | Paper vertical menu: Pin, Remove from Home, Delete                                                   |
| Long-press list row      | Paper vertical menu: Pin, Delete (no Remove — already on the list)                                   |
| Remove                   | Hide from Home rail only. Still in Chats.                                                            |
| Delete                   | Confirm, then hide from both lists on this device. Peer unchanged.                                   |
| See all → Chats          | Full-screen overlay (modal). Nav hidden.                                                             |
| Open chat from Chats     | Chat pushes on top of Chats. Back → Chats. Second back → Home.                                       |
| Open chat from Home rail | Back → Home.                                                                                         |
| Open chat from a profile | Back → that profile.                                                                                 |
| First Home               | Spotlight + Paper tooltip: wallet → chats → explore → Favourites tab → Home tab. Once. Skip anytime. |

## Heart (locked pair)

- **Nav tab:** fill + colour only. No scale. Active tab uses the M3 tonal indicator (`accentTint` pill).
- **Profile heart:** glyph springs 1 → 1.18 → 1 inside a fixed 40dp slot. Reduce Motion → colour / fill only.
