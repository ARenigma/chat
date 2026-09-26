# Third-party code

Pappal is licensed under the GNU General Public License, version 2 (see
`LICENSE`), because it incorporates code, algorithms and interaction logic
read and adapted from Telegram for Android, copyright the Telegram Messenger
project and its contributors, also licensed under GPL-2.0. Their license text
is unmodified below.

Per GPL-2.0 §1-§2: this NOTICE, and the LICENSE file, must be preserved and
distributed with any copy or derivative of this software.

---

## Telegram for Android

```
                    GNU GENERAL PUBLIC LICENSE
                       Version 2, June 1991

 Copyright (C) 1989, 1991 Free Software Foundation, Inc.,
 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
```

Source: https://github.com/DrKLO/Telegram (the upstream project's own name for
itself; not reproduced elsewhere in this repository's code or comments).

Full license text: see `LICENSE` in this repository, which is byte-identical
to the license Telegram for Android ships under.

---

## Bluesky (social-app)

Portions of the following are adapted from the Bluesky social-app:

- `src/lib/routes/helpers.ts` (upstream `src/lib/routes/helpers.ts`)
- `src/shell/bottom-bar/BottomBar.tsx`, `BottomBarStyles.ts` — the custom tab bar, its
  soft-reset / pop-to-top / navigate press logic and bar geometry (upstream
  `src/view/shell/bottom-bar/*`)
- `src/shell/minimalMode.tsx`, `src/shell/useMinimalShellTransform.ts`,
  `src/shell/shellLayout.tsx`, `src/shell/ShellStateProvider.tsx`,
  `src/shell/useBottomBarOffset.ts` (upstream `src/state/shell/minimal-mode.tsx`,
  `src/lib/hooks/useMinimalShellTransform.ts`, `src/state/shell/shell-layout.tsx`,
  `src/state/shell/index.tsx`, `src/lib/hooks/useBottomBarOffset.ts`)
- `src/components/Layout/*` — `Layout.Screen` (upstream `src/components/Layout/*`)

```
MIT License

Copyright (c) 2023 Bluesky PBC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Source: https://github.com/bluesky-social/social-app  
Commit: `f80c43eabe3dfbe0fa3f111f361f48ebfa0fa8ab`

---

## Phosphor Icons

Every icon in the app is a glyph in `assets/fonts/Phosphor.ttf`, which
`scripts/gen-icons-font.mjs` builds from the SVGs of `@phosphor-icons/core`
(a pinned devDependency; `design/icons.json` lists the glyphs used). The font
is a derivative of those SVGs and ships in the APK, so the notice ships with
it as `assets/fonts/LICENSE-Phosphor.txt`.

Source: https://github.com/phosphor-icons/core

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Unicode Character Database (contact guard tables)

`design/contact-guard.tables.json` is derived from Unicode character data (the
decimal-digit, combining-mark and format-character properties and the
compatibility decompositions) as exposed by Node's ICU, by
`scripts/gen-contact-guard.mjs --tables`. The tables ship in the APK inside
`src/lib/contactGuard.generated.ts` and in migration 156, so the notice
travels with them. Unicode data is distributed under the Unicode License v3,
reproduced unmodified below from https://www.unicode.org/license.txt
(fetched 2026-09-27).

Source: https://www.unicode.org/ucd/

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```
