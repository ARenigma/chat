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

Portions of `src/lib/routes/helpers.ts` are adapted from the Bluesky social-app:

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
