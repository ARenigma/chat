/**
 * GENERATED FILE, DO NOT EDIT.
 *
 * Source: design/contact-guard.spec.mjs and design/contact-guard.tables.json,
 * through scripts/gen-contact-guard.mjs. Regenerate with `npm run
 * contact-guard`; `npm run contact-guard:check` fails on drift.
 *
 * The app's mirror of the contact guard's HARD tier. The server decides
 * (156_contact_guard_detector.sql, schema private); this only predicts, so the
 * composer can explain a block before the send. Signal rules are server only.
 * If this engine rejects any pattern, every function reports "not blocked" and
 * the server's answer is the only one: a broken mirror must never block.
 */


export const CONTACT_GUARD_SPEC = "b0130d3b8b91ef45b5d02df9ec8d7a8c634f8d15b8699ffde9fbb6b534e6f682";

export type ContactCategory = "phone" | "payment" | "email" | "link" | "handle";

const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["[\\u00ad\\u0600-\\u0605\\u061c\\u06dd\\u070f\\u0890-\\u0891\\u08e2\\u115f-\\u1160\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f\\u2800\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb\\u{110bd}\\u{110cd}\\u{13430}-\\u{1343f}\\u{1bca0}-\\u{1bca3}\\u{1d173}-\\u{1d17a}\\u{e0001}\\u{e0020}-\\u{e007f}]+", "gu"],
  ["^[\\u0300-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u05bf\\u05c1-\\u05c2\\u05c4-\\u05c5\\u05c7\\u0610-\\u061a\\u064b-\\u065f\\u0670\\u06d6-\\u06dc\\u06df-\\u06e4\\u06e7-\\u06e8\\u06ea-\\u06ed\\u0711\\u0730-\\u074a\\u07a6-\\u07b0\\u07eb-\\u07f3\\u07fd\\u0816-\\u0819\\u081b-\\u0823\\u0825-\\u0827\\u0829-\\u082d\\u0859-\\u085b\\u0897-\\u089f\\u08ca-\\u08e1\\u08e3-\\u0902\\u093a\\u093c\\u0941-\\u0948\\u094d\\u0951-\\u0957\\u0962-\\u0963\\u0981\\u09bc\\u09c1-\\u09c4\\u09cd\\u09e2-\\u09e3\\u09fe\\u0a01-\\u0a02\\u0a3c\\u0a41-\\u0a42\\u0a47-\\u0a48\\u0a4b-\\u0a4d\\u0a51\\u0a70-\\u0a71\\u0a75\\u0a81-\\u0a82\\u0abc\\u0ac1-\\u0ac5\\u0ac7-\\u0ac8\\u0acd\\u0ae2-\\u0ae3\\u0afa-\\u0aff\\u0b01\\u0b3c\\u0b3f\\u0b41-\\u0b44\\u0b4d\\u0b55-\\u0b56\\u0b62-\\u0b63\\u0b82\\u0bc0\\u0bcd\\u0c00\\u0c04\\u0c3c\\u0c3e-\\u0c40\\u0c46-\\u0c48\\u0c4a-\\u0c4d\\u0c55-\\u0c56\\u0c62-\\u0c63\\u0c81\\u0cbc\\u0cbf\\u0cc6\\u0ccc-\\u0ccd\\u0ce2-\\u0ce3\\u0d00-\\u0d01\\u0d3b-\\u0d3c\\u0d41-\\u0d44\\u0d4d\\u0d62-\\u0d63\\u0d81\\u0dca\\u0dd2-\\u0dd4\\u0dd6\\u0e31\\u0e34-\\u0e3a\\u0e47-\\u0e4e\\u0eb1\\u0eb4-\\u0ebc\\u0ec8-\\u0ece\\u0f18-\\u0f19\\u0f35\\u0f37\\u0f39\\u0f71-\\u0f7e\\u0f80-\\u0f84\\u0f86-\\u0f87\\u0f8d-\\u0f97\\u0f99-\\u0fbc\\u0fc6\\u102d-\\u1030\\u1032-\\u1037\\u1039-\\u103a\\u103d-\\u103e\\u1058-\\u1059\\u105e-\\u1060\\u1071-\\u1074\\u1082\\u1085-\\u1086\\u108d\\u109d\\u135d-\\u135f\\u1712-\\u1714\\u1732-\\u1733\\u1752-\\u1753\\u1772-\\u1773\\u17b4-\\u17b5\\u17b7-\\u17bd\\u17c6\\u17c9-\\u17d3\\u17dd\\u180b-\\u180d\\u180f\\u1885-\\u1886\\u18a9\\u1920-\\u1922\\u1927-\\u1928\\u1932\\u1939-\\u193b\\u1a17-\\u1a18\\u1a1b\\u1a56\\u1a58-\\u1a5e\\u1a60\\u1a62\\u1a65-\\u1a6c\\u1a73-\\u1a7c\\u1a7f\\u1ab0-\\u1add\\u1ae0-\\u1aeb\\u1b00-\\u1b03\\u1b34\\u1b36-\\u1b3a\\u1b3c\\u1b42\\u1b6b-\\u1b73\\u1b80-\\u1b81\\u1ba2-\\u1ba5\\u1ba8-\\u1ba9\\u1bab-\\u1bad\\u1be6\\u1be8-\\u1be9\\u1bed\\u1bef-\\u1bf1\\u1c2c-\\u1c33\\u1c36-\\u1c37\\u1cd0-\\u1cd2\\u1cd4-\\u1ce0\\u1ce2-\\u1ce8\\u1ced\\u1cf4\\u1cf8-\\u1cf9\\u1dc0-\\u1dff\\u20d0-\\u20f0\\u2cef-\\u2cf1\\u2d7f\\u2de0-\\u2dff\\u302a-\\u302d\\u3099-\\u309a\\ua66f-\\ua672\\ua674-\\ua67d\\ua69e-\\ua69f\\ua6f0-\\ua6f1\\ua802\\ua806\\ua80b\\ua825-\\ua826\\ua82c\\ua8c4-\\ua8c5\\ua8e0-\\ua8f1\\ua8ff\\ua926-\\ua92d\\ua947-\\ua951\\ua980-\\ua982\\ua9b3\\ua9b6-\\ua9b9\\ua9bc-\\ua9bd\\ua9e5\\uaa29-\\uaa2e\\uaa31-\\uaa32\\uaa35-\\uaa36\\uaa43\\uaa4c\\uaa7c\\uaab0\\uaab2-\\uaab4\\uaab7-\\uaab8\\uaabe-\\uaabf\\uaac1\\uaaec-\\uaaed\\uaaf6\\uabe5\\uabe8\\uabed\\ufb1e\\ufe00-\\ufe0f\\ufe20-\\ufe2f\\u{101fd}\\u{102e0}\\u{10376}-\\u{1037a}\\u{10a01}-\\u{10a03}\\u{10a05}-\\u{10a06}\\u{10a0c}-\\u{10a0f}\\u{10a38}-\\u{10a3a}\\u{10a3f}\\u{10ae5}-\\u{10ae6}\\u{10d24}-\\u{10d27}\\u{10d69}-\\u{10d6d}\\u{10eab}-\\u{10eac}\\u{10efa}-\\u{10eff}\\u{10f46}-\\u{10f50}\\u{10f82}-\\u{10f85}\\u{11001}\\u{11038}-\\u{11046}\\u{11070}\\u{11073}-\\u{11074}\\u{1107f}-\\u{11081}\\u{110b3}-\\u{110b6}\\u{110b9}-\\u{110ba}\\u{110c2}\\u{11100}-\\u{11102}\\u{11127}-\\u{1112b}\\u{1112d}-\\u{11134}\\u{11173}\\u{11180}-\\u{11181}\\u{111b6}-\\u{111be}\\u{111c9}-\\u{111cc}\\u{111cf}\\u{1122f}-\\u{11231}\\u{11234}\\u{11236}-\\u{11237}\\u{1123e}\\u{11241}\\u{112df}\\u{112e3}-\\u{112ea}\\u{11300}-\\u{11301}\\u{1133b}-\\u{1133c}\\u{11340}\\u{11366}-\\u{1136c}\\u{11370}-\\u{11374}\\u{113bb}-\\u{113c0}\\u{113ce}\\u{113d0}\\u{113d2}\\u{113e1}-\\u{113e2}\\u{11438}-\\u{1143f}\\u{11442}-\\u{11444}\\u{11446}\\u{1145e}\\u{114b3}-\\u{114b8}\\u{114ba}\\u{114bf}-\\u{114c0}\\u{114c2}-\\u{114c3}\\u{115b2}-\\u{115b5}\\u{115bc}-\\u{115bd}\\u{115bf}-\\u{115c0}\\u{115dc}-\\u{115dd}\\u{11633}-\\u{1163a}\\u{1163d}\\u{1163f}-\\u{11640}\\u{116ab}\\u{116ad}\\u{116b0}-\\u{116b5}\\u{116b7}\\u{1171d}\\u{1171f}\\u{11722}-\\u{11725}\\u{11727}-\\u{1172b}\\u{1182f}-\\u{11837}\\u{11839}-\\u{1183a}\\u{1193b}-\\u{1193c}\\u{1193e}\\u{11943}\\u{119d4}-\\u{119d7}\\u{119da}-\\u{119db}\\u{119e0}\\u{11a01}-\\u{11a0a}\\u{11a33}-\\u{11a38}\\u{11a3b}-\\u{11a3e}\\u{11a47}\\u{11a51}-\\u{11a56}\\u{11a59}-\\u{11a5b}\\u{11a8a}-\\u{11a96}\\u{11a98}-\\u{11a99}\\u{11b60}\\u{11b62}-\\u{11b64}\\u{11b66}\\u{11c30}-\\u{11c36}\\u{11c38}-\\u{11c3d}\\u{11c3f}\\u{11c92}-\\u{11ca7}\\u{11caa}-\\u{11cb0}\\u{11cb2}-\\u{11cb3}\\u{11cb5}-\\u{11cb6}\\u{11d31}-\\u{11d36}\\u{11d3a}\\u{11d3c}-\\u{11d3d}\\u{11d3f}-\\u{11d45}\\u{11d47}\\u{11d90}-\\u{11d91}\\u{11d95}\\u{11d97}\\u{11ef3}-\\u{11ef4}\\u{11f00}-\\u{11f01}\\u{11f36}-\\u{11f3a}\\u{11f40}\\u{11f42}\\u{11f5a}\\u{13440}\\u{13447}-\\u{13455}\\u{1611e}-\\u{16129}\\u{1612d}-\\u{1612f}\\u{16af0}-\\u{16af4}\\u{16b30}-\\u{16b36}\\u{16f4f}\\u{16f8f}-\\u{16f92}\\u{16fe4}\\u{1bc9d}-\\u{1bc9e}\\u{1cf00}-\\u{1cf2d}\\u{1cf30}-\\u{1cf46}\\u{1d167}-\\u{1d169}\\u{1d17b}-\\u{1d182}\\u{1d185}-\\u{1d18b}\\u{1d1aa}-\\u{1d1ad}\\u{1d242}-\\u{1d244}\\u{1da00}-\\u{1da36}\\u{1da3b}-\\u{1da6c}\\u{1da75}\\u{1da84}\\u{1da9b}-\\u{1da9f}\\u{1daa1}-\\u{1daaf}\\u{1e000}-\\u{1e006}\\u{1e008}-\\u{1e018}\\u{1e01b}-\\u{1e021}\\u{1e023}-\\u{1e024}\\u{1e026}-\\u{1e02a}\\u{1e08f}\\u{1e130}-\\u{1e136}\\u{1e2ae}\\u{1e2ec}-\\u{1e2ef}\\u{1e4ec}-\\u{1e4ef}\\u{1e5ee}-\\u{1e5ef}\\u{1e6e3}\\u{1e6e6}\\u{1e6ee}-\\u{1e6ef}\\u{1e6f5}\\u{1e8d0}-\\u{1e8d6}\\u{1e944}-\\u{1e94a}\\u{e0100}-\\u{e01ef}]+", "u"],
  ["([\\u0001-\\u007f])[\\u0300-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u05bf\\u05c1-\\u05c2\\u05c4-\\u05c5\\u05c7\\u0610-\\u061a\\u064b-\\u065f\\u0670\\u06d6-\\u06dc\\u06df-\\u06e4\\u06e7-\\u06e8\\u06ea-\\u06ed\\u0711\\u0730-\\u074a\\u07a6-\\u07b0\\u07eb-\\u07f3\\u07fd\\u0816-\\u0819\\u081b-\\u0823\\u0825-\\u0827\\u0829-\\u082d\\u0859-\\u085b\\u0897-\\u089f\\u08ca-\\u08e1\\u08e3-\\u0902\\u093a\\u093c\\u0941-\\u0948\\u094d\\u0951-\\u0957\\u0962-\\u0963\\u0981\\u09bc\\u09c1-\\u09c4\\u09cd\\u09e2-\\u09e3\\u09fe\\u0a01-\\u0a02\\u0a3c\\u0a41-\\u0a42\\u0a47-\\u0a48\\u0a4b-\\u0a4d\\u0a51\\u0a70-\\u0a71\\u0a75\\u0a81-\\u0a82\\u0abc\\u0ac1-\\u0ac5\\u0ac7-\\u0ac8\\u0acd\\u0ae2-\\u0ae3\\u0afa-\\u0aff\\u0b01\\u0b3c\\u0b3f\\u0b41-\\u0b44\\u0b4d\\u0b55-\\u0b56\\u0b62-\\u0b63\\u0b82\\u0bc0\\u0bcd\\u0c00\\u0c04\\u0c3c\\u0c3e-\\u0c40\\u0c46-\\u0c48\\u0c4a-\\u0c4d\\u0c55-\\u0c56\\u0c62-\\u0c63\\u0c81\\u0cbc\\u0cbf\\u0cc6\\u0ccc-\\u0ccd\\u0ce2-\\u0ce3\\u0d00-\\u0d01\\u0d3b-\\u0d3c\\u0d41-\\u0d44\\u0d4d\\u0d62-\\u0d63\\u0d81\\u0dca\\u0dd2-\\u0dd4\\u0dd6\\u0e31\\u0e34-\\u0e3a\\u0e47-\\u0e4e\\u0eb1\\u0eb4-\\u0ebc\\u0ec8-\\u0ece\\u0f18-\\u0f19\\u0f35\\u0f37\\u0f39\\u0f71-\\u0f7e\\u0f80-\\u0f84\\u0f86-\\u0f87\\u0f8d-\\u0f97\\u0f99-\\u0fbc\\u0fc6\\u102d-\\u1030\\u1032-\\u1037\\u1039-\\u103a\\u103d-\\u103e\\u1058-\\u1059\\u105e-\\u1060\\u1071-\\u1074\\u1082\\u1085-\\u1086\\u108d\\u109d\\u135d-\\u135f\\u1712-\\u1714\\u1732-\\u1733\\u1752-\\u1753\\u1772-\\u1773\\u17b4-\\u17b5\\u17b7-\\u17bd\\u17c6\\u17c9-\\u17d3\\u17dd\\u180b-\\u180d\\u180f\\u1885-\\u1886\\u18a9\\u1920-\\u1922\\u1927-\\u1928\\u1932\\u1939-\\u193b\\u1a17-\\u1a18\\u1a1b\\u1a56\\u1a58-\\u1a5e\\u1a60\\u1a62\\u1a65-\\u1a6c\\u1a73-\\u1a7c\\u1a7f\\u1ab0-\\u1add\\u1ae0-\\u1aeb\\u1b00-\\u1b03\\u1b34\\u1b36-\\u1b3a\\u1b3c\\u1b42\\u1b6b-\\u1b73\\u1b80-\\u1b81\\u1ba2-\\u1ba5\\u1ba8-\\u1ba9\\u1bab-\\u1bad\\u1be6\\u1be8-\\u1be9\\u1bed\\u1bef-\\u1bf1\\u1c2c-\\u1c33\\u1c36-\\u1c37\\u1cd0-\\u1cd2\\u1cd4-\\u1ce0\\u1ce2-\\u1ce8\\u1ced\\u1cf4\\u1cf8-\\u1cf9\\u1dc0-\\u1dff\\u20d0-\\u20f0\\u2cef-\\u2cf1\\u2d7f\\u2de0-\\u2dff\\u302a-\\u302d\\u3099-\\u309a\\ua66f-\\ua672\\ua674-\\ua67d\\ua69e-\\ua69f\\ua6f0-\\ua6f1\\ua802\\ua806\\ua80b\\ua825-\\ua826\\ua82c\\ua8c4-\\ua8c5\\ua8e0-\\ua8f1\\ua8ff\\ua926-\\ua92d\\ua947-\\ua951\\ua980-\\ua982\\ua9b3\\ua9b6-\\ua9b9\\ua9bc-\\ua9bd\\ua9e5\\uaa29-\\uaa2e\\uaa31-\\uaa32\\uaa35-\\uaa36\\uaa43\\uaa4c\\uaa7c\\uaab0\\uaab2-\\uaab4\\uaab7-\\uaab8\\uaabe-\\uaabf\\uaac1\\uaaec-\\uaaed\\uaaf6\\uabe5\\uabe8\\uabed\\ufb1e\\ufe00-\\ufe0f\\ufe20-\\ufe2f\\u{101fd}\\u{102e0}\\u{10376}-\\u{1037a}\\u{10a01}-\\u{10a03}\\u{10a05}-\\u{10a06}\\u{10a0c}-\\u{10a0f}\\u{10a38}-\\u{10a3a}\\u{10a3f}\\u{10ae5}-\\u{10ae6}\\u{10d24}-\\u{10d27}\\u{10d69}-\\u{10d6d}\\u{10eab}-\\u{10eac}\\u{10efa}-\\u{10eff}\\u{10f46}-\\u{10f50}\\u{10f82}-\\u{10f85}\\u{11001}\\u{11038}-\\u{11046}\\u{11070}\\u{11073}-\\u{11074}\\u{1107f}-\\u{11081}\\u{110b3}-\\u{110b6}\\u{110b9}-\\u{110ba}\\u{110c2}\\u{11100}-\\u{11102}\\u{11127}-\\u{1112b}\\u{1112d}-\\u{11134}\\u{11173}\\u{11180}-\\u{11181}\\u{111b6}-\\u{111be}\\u{111c9}-\\u{111cc}\\u{111cf}\\u{1122f}-\\u{11231}\\u{11234}\\u{11236}-\\u{11237}\\u{1123e}\\u{11241}\\u{112df}\\u{112e3}-\\u{112ea}\\u{11300}-\\u{11301}\\u{1133b}-\\u{1133c}\\u{11340}\\u{11366}-\\u{1136c}\\u{11370}-\\u{11374}\\u{113bb}-\\u{113c0}\\u{113ce}\\u{113d0}\\u{113d2}\\u{113e1}-\\u{113e2}\\u{11438}-\\u{1143f}\\u{11442}-\\u{11444}\\u{11446}\\u{1145e}\\u{114b3}-\\u{114b8}\\u{114ba}\\u{114bf}-\\u{114c0}\\u{114c2}-\\u{114c3}\\u{115b2}-\\u{115b5}\\u{115bc}-\\u{115bd}\\u{115bf}-\\u{115c0}\\u{115dc}-\\u{115dd}\\u{11633}-\\u{1163a}\\u{1163d}\\u{1163f}-\\u{11640}\\u{116ab}\\u{116ad}\\u{116b0}-\\u{116b5}\\u{116b7}\\u{1171d}\\u{1171f}\\u{11722}-\\u{11725}\\u{11727}-\\u{1172b}\\u{1182f}-\\u{11837}\\u{11839}-\\u{1183a}\\u{1193b}-\\u{1193c}\\u{1193e}\\u{11943}\\u{119d4}-\\u{119d7}\\u{119da}-\\u{119db}\\u{119e0}\\u{11a01}-\\u{11a0a}\\u{11a33}-\\u{11a38}\\u{11a3b}-\\u{11a3e}\\u{11a47}\\u{11a51}-\\u{11a56}\\u{11a59}-\\u{11a5b}\\u{11a8a}-\\u{11a96}\\u{11a98}-\\u{11a99}\\u{11b60}\\u{11b62}-\\u{11b64}\\u{11b66}\\u{11c30}-\\u{11c36}\\u{11c38}-\\u{11c3d}\\u{11c3f}\\u{11c92}-\\u{11ca7}\\u{11caa}-\\u{11cb0}\\u{11cb2}-\\u{11cb3}\\u{11cb5}-\\u{11cb6}\\u{11d31}-\\u{11d36}\\u{11d3a}\\u{11d3c}-\\u{11d3d}\\u{11d3f}-\\u{11d45}\\u{11d47}\\u{11d90}-\\u{11d91}\\u{11d95}\\u{11d97}\\u{11ef3}-\\u{11ef4}\\u{11f00}-\\u{11f01}\\u{11f36}-\\u{11f3a}\\u{11f40}\\u{11f42}\\u{11f5a}\\u{13440}\\u{13447}-\\u{13455}\\u{1611e}-\\u{16129}\\u{1612d}-\\u{1612f}\\u{16af0}-\\u{16af4}\\u{16b30}-\\u{16b36}\\u{16f4f}\\u{16f8f}-\\u{16f92}\\u{16fe4}\\u{1bc9d}-\\u{1bc9e}\\u{1cf00}-\\u{1cf2d}\\u{1cf30}-\\u{1cf46}\\u{1d167}-\\u{1d169}\\u{1d17b}-\\u{1d182}\\u{1d185}-\\u{1d18b}\\u{1d1aa}-\\u{1d1ad}\\u{1d242}-\\u{1d244}\\u{1da00}-\\u{1da36}\\u{1da3b}-\\u{1da6c}\\u{1da75}\\u{1da84}\\u{1da9b}-\\u{1da9f}\\u{1daa1}-\\u{1daaf}\\u{1e000}-\\u{1e006}\\u{1e008}-\\u{1e018}\\u{1e01b}-\\u{1e021}\\u{1e023}-\\u{1e024}\\u{1e026}-\\u{1e02a}\\u{1e08f}\\u{1e130}-\\u{1e136}\\u{1e2ae}\\u{1e2ec}-\\u{1e2ef}\\u{1e4ec}-\\u{1e4ef}\\u{1e5ee}-\\u{1e5ef}\\u{1e6e3}\\u{1e6e6}\\u{1e6ee}-\\u{1e6ef}\\u{1e6f5}\\u{1e8d0}-\\u{1e8d6}\\u{1e944}-\\u{1e94a}\\u{e0100}-\\u{e01ef}]+", "gu"],
  ["[\\u0009-\\u000d\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]", "gu"],
  ["&(?:nbsp|#160|#xa0);", "gu"],
  ["&(?:commat|#64|#x40);", "gu"],
  ["&(?:period|#46|#x2e);", "gu"],
  ["&amp;", "gu"],
  ["^(?=[0-9oilszbgq]{6,}$)(?=(?:[a-z]*[0-9]){4})[0-9oilszbgq]+$", "u"],
  ["[0-9]", "u"],
  ["[a-z0-9]+", "gu"],
  ["^(?=[0-9oil]*[0-9])(?=[0-9oil]*[oil])[0-9oil]{2,5}$", "u"],
  ["[a-z\\u0900-\\u097f\\u0980-\\u09ff]+", "gu"],
  ["~[ -]*([1-9])(?![0-9])", "gu"],
  ["~", "gu"],
  ["(?<![a-z])double[ -]*([0-9])", "gu"],
  ["(?<![a-z])triple[ -]*([0-9])", "gu"],
  ["(?<![a-z])plus[ ]*(?=91)", "gu"],
  ["(?<![0-9])(?:0?[1-9]|[12][0-9]|3[01])[ ]?[ ./-][ ]?(?:0?[1-9]|1[0-2])[ ]?[ ./-][ ]?(?:19|20)[0-9]{2}(?![0-9])|(?<![0-9])(?:19|20)[0-9]{2}[ ]?[./-][ ]?(?:0?[1-9]|1[0-2])[ ]?[./-][ ]?(?:0?[1-9]|[12][0-9]|3[01])(?![0-9])", "gu"],
  ["(?<![0-9])[0-9]{1,4}[ ]*[/.-][ ]*[0-9]{1,2}[ ]*[/.-][ ]*[0-9]{1,4}(?![0-9])", "gu"],
  ["(?<=[0-9])[ ]*:[ ]*(?=[0-9])", "gu"],
  ["[/%\\u00b0'\\u20b9$\\u20ac\\u00a3]", "gu"],
  ["(?<![a-z])(?:rupees|rupaye|rupiya|rupay|rupee|inr|rs)(?![a-z])", "gu"],
  ["[ ]*[,;][ ,;]*", "gu"],
  ["[^0-9#w,]+", "gu"],
  ["[ ]*#[ ]*", "gu"],
  ["^[ ]+|[ ]+$", "gu"],
  ["~\u00a7[ -]*([1-9])\u00a7", "gu"],
  ["~\u00a7", "gu"],
  ["(?<![a-z])double[ -]*([0-9])\u00a7", "gu"],
  ["(?<![a-z])triple[ -]*([0-9])\u00a7", "gu"],
  ["\u00a7[ ,.;:/|+&-]*(?=[0-9])", "gu"],
  ["\u00a7", "gu"],
  ["[ ]*[[({<][ ]*(?:at|@)[ ]*[\\])}>][ ]*", "gu"],
  ["[ ]*[[({<][ ]*(?:dot|\\.)[ ]*[\\])}>][ ]*", "gu"],
  ["[ ]*(?<![a-z])(?:at the rate of|at the rate|attherate|at-the-rate|at sign)(?![a-z])[ ]*", "gu"],
  ["(?<=[a-z0-9])[ ]+(?:at|@)[ ]+(?=(?:jupiteraxis|barodampay|freecharge|googlemail|okhdfcbank|protonmail|rediffmail|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|hotmail|okicici|outlook|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|icloud|okaxis|proton|ptaxis|pthdfc|rediff|waaxis|axisb|gmail|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|yahoo|ymail|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|live|mahb|tjsb|uboi|utbi|yapl|zoho|aol|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))", "gu"],
  ["(?<=[a-z0-9])[ ]*@[ ]*(?=(?:jupiteraxis|barodampay|freecharge|googlemail|okhdfcbank|protonmail|rediffmail|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|hotmail|okicici|outlook|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|icloud|okaxis|proton|ptaxis|pthdfc|rediff|waaxis|axisb|gmail|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|yahoo|ymail|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|live|mahb|tjsb|uboi|utbi|yapl|zoho|aol|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9])|[a-z0-9-]+\\.(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)(?![a-z0-9]))", "gu"],
  ["(?<![a-z0-9])@[ ]+(?=[a-z0-9_])", "gu"],
  ["(?<=[a-z0-9])[ ]*(?<![a-z])(?:underscore|under score)(?![a-z])[ ]*(?=[a-z0-9])", "gu"],
  ["[ ]*(?<![a-z])(?:dot|daat|dott|point)(?![a-z])[ ]*(?=(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)(?![a-z0-9]))", "gu"],
  ["(?<=[a-z0-9])[ ]+(?:dot|daat)[ ]+(?=[a-z0-9])", "gu"],
  ["(?:(?<=[a-z0-9]{2})|(?<=(?:^|[^a-z0-9])(?:t|wa)))[ ]*\\.[ ]*(?=(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)(?![a-z0-9]))", "gu"],
  ["(?<=\\.(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws))[ ]*/[ ]*(?=[a-z0-9_+])", "gu"],
  ["(?<=(?:^|[^a-z0-9])[a-z0-9]) (?=[a-z0-9](?:[^a-z0-9]|$))", "gu"],
  ["(?<![a-z0-9])[0-9]{1,2}[ ]*(?:digits|digit|ank)(?![a-z])", "gu"],
  ["(?<![a-z])(?:remaining|continue|vodafone|contact|airtel|bhejta|bhejti|doosra|likhta|likhti|mobile|number|purana|second|teesra|baaki|bacha|dekho|dusra|first|hissa|likho|madam|pehla|pehle|phone|shuru|start|third|aage|abhi|baki|bhai|bhej|bsnl|cont|dekh|didi|haan|hain|half|hoon|idea|karo|last|likh|mera|mere|meri|naya|next|nmbr|note|okay|part|phir|plus|raha|rahi|rest|ruko|save|suno|then|wala|wali|and|aur|bas|end|fir|hai|han|hmm|hun|jio|kar|mam|nbr|new|num|sim|sir|sun|the|yeh|ab|he|hu|is|ji|ka|ki|le|lo|my|no|of|ok|ph|se|vi|ye|h)(?![a-z])", "gu"],
  ["[.!?]+[ ]*$", "gu"],
  ["[^0-9a-z:/%.\\u20b9$-]", "gu"],
  ["(?:(?<![a-z0-9])[a-z]{4}0[a-z0-9]{6}(?![a-z0-9]))", "u"],
  ["(?:(?<![0-9])(?:(?:\\+|00)[ ]*91[ .-]*|91[ .-]+|0[ .-]*)?[6-9](?:[ .()/\\u20b9$\\u20ac\\u00a3-]{0,3}[0-9]){9}(?![0-9]))|(?:[0-9]{10})|(?:(?:\\+|(?<![0-9])00)[ ]*[1-9](?:[ .()-]{0,2}[0-9]){7,13}(?![0-9]))|(?:(?<![0-9])0[1-9][0-9]{1,3}[ -]?[2-9][0-9]{2,3}[ -]?[0-9]{3,4}(?![0-9]))|(?:(?<![a-z])(?:a/c|acct|account|khata|ac)(?:[ .]*(?:no|number|num|nmbr))?[ .:#-]*[0-9](?:[ -]?[0-9]){8,17}(?![0-9]))", "u"],
  ["(?:(?:^|#)[ w,]*(?=[0-9]+(?:[ w,]+[0-9]+){0,3}[ w,]*(?:#|$))(?:9[ w,]*1[ w,]*|0[ w,]*)?(?!9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$))[6-9](?:[ w,]*[0-9]){9}[ w,]*(?:#|$))|(?:(?:^|#)[ w,]*(?!9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$))[6-9](?:[ ,][0-9]){9}[ w,]*(?:#|$))|(?:(?:^|#)[ w,]*(?=[0-9]+(?:[ ][0-9]+){0,4}[ w,]*(?:#|$))(?:9[ ]?1[ ]?|0[ ]?)?(?!9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$))[6-9](?:[ ]?[0-9]){9}[ w,]*(?:#|$))", "u"],
  ["(?:(?<![0-9])(?:91|0)?[6-9][0-9]{9}(?![0-9]))", "u"],
  ["(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))|(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{2,63}@(?!(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z0-9]))[a-z]{2,20}(?![a-z0-9.@]))|(?:(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,24}(?![a-z0-9]))|(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._%+-]{1,63}@(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z0-9]))|(?:(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])(?:[ ]+(?:on|pe|par|ka|ki|at|wala|wali|in|hai|is|h))?[ ]+(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z]))|(?:(?<![a-z])(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?:[ ,]+[a-z]+){0,4}[ ,]*[:=-]?[ ]*(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_]))|(?:(?<![a-z])(?:https?|ftp)[ ]*:[ ]*/[ ]*/|(?<![a-z0-9])www[ ]*\\.[ ]*[a-z0-9])|(?:(?<![a-z0-9])(?:chat\\.whatsapp\\.com|api\\.whatsapp\\.com|join\\.skype\\.com|instagram\\.com|sharechat\\.com|facebook\\.com|linkedin\\.com|signal\\.group|snapchat\\.com|tele\\u0067ram\\.dog|tele\\u0067ram\\.org|whatsapp\\.com|discord\\.com|shorturl\\.at|tele\\u0067ram\\.me|threads\\.net|tinyurl\\.com|twitter\\.com|youtube\\.com|discord\\.gg|instagr\\.am|forms\\.gle|linktr\\.ee|signal\\.me|skype\\.com|snap\\.com|youtu\\.be|cutt\\.ly|lnkd\\.in|bit\\.ly|fb\\.com|goo\\.gl|fb\\.me|ig\\.me|is\\.gd|rb\\.gy|wa\\.me|x\\.com|t\\.co|t\\.me)(?![a-z0-9]))|(?:(?<![a-z0-9@._-])(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{1,62}(?:\\.[a-z0-9-]{2,62})*\\.(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)(?![a-z0-9]))|(?:(?<![a-z0-9._@])@(?!(?:everyone|panditji|evening|morning|support|bhaiya|guruji|office|pandit|pappal|admin|madam|night|there|baba|bhai|didi|ghar|here|home|maam|noon|team|time|work|all|mam|sir|you|ji|me)(?![a-z0-9._]))(?![0-9]{1,2}(?:[:.][0-9]{2})?(?:am|pm|baje|bje)?(?![a-z0-9_]))(?![0-9]+(?![a-z_]))[a-z0-9_](?:[a-z0-9_]|\\.(?=[a-z0-9_])){2,29}(?![a-z0-9_]))|(?:(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|clubhouse|instagram|pinterest|sharechat|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|reddit|signal|tiktok|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:[ ]*(?:pe|par|on|me|mein|id|handle|username|user|naam|name|hai|h|is|mera|meri|my|search|karo|kar|follow|add|dhundo|dhundho|dhoondo|dhundh|dhoondh|\u0906\u0908\u0921\u0940|:|-)){0,4}[^a-z0-9@]{0,8}@?(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_]))|(?:(?<![a-z])(?<!(?:order|txn|transaction|booking|session|ticket|ref|payment|utr|upi|call|meeting|reference|tracking|customer|employee|roll|student|aadhaar|pan) )(?:(?:\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|clubhouse|instagram|pinterest|sharechat|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|reddit|signal|tiktok|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)[ ]+)?(?:id|username|user name|userid|user id|handle)[ ]*[:=-][ ]*@?(?:(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])|[a-z]{6,30}(?![a-z0-9_])))|(?:(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])[ ]+(?:on|pe|par|at)[ ]+(?:instagram|insta|ig|snapchat|snap|tele\\u0067ram|tg|twitter|facebook|fb|discord|skype|threads)(?![a-z]))|(?:(?<![a-z0-9_.])[a-z0-9_.]{2,32}#[0-9]{4}(?![0-9]))|(?:(?<![a-z])live[ ]*:[ ]*[a-z][a-z0-9]*[._0-9][a-z0-9._-]*)", "u"],
  ["(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))|(?:(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,24}(?![a-z0-9]))|(?:(?<![a-z0-9])(?:chat\\.whatsapp\\.com|api\\.whatsapp\\.com|join\\.skype\\.com|instagram\\.com|sharechat\\.com|facebook\\.com|linkedin\\.com|signal\\.group|snapchat\\.com|tele\\u0067ram\\.dog|tele\\u0067ram\\.org|whatsapp\\.com|discord\\.com|shorturl\\.at|tele\\u0067ram\\.me|threads\\.net|tinyurl\\.com|twitter\\.com|youtube\\.com|discord\\.gg|instagr\\.am|forms\\.gle|linktr\\.ee|signal\\.me|skype\\.com|snap\\.com|youtu\\.be|cutt\\.ly|lnkd\\.in|bit\\.ly|fb\\.com|goo\\.gl|fb\\.me|ig\\.me|is\\.gd|rb\\.gy|wa\\.me|x\\.com|t\\.co|t\\.me)(?![a-z0-9]))", "u"],
  ["[0-9@.:#/=-]|(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:at the rate|under score|\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|chauhattar|chhihattar|chhiyasath|googlemail|pachhattar|protonmail|rediffmail|underscore|attherate|chauranve|chauvalis|chhiyalis|chhiyanve|clubhouse|instagram|paintalis|pinterest|saintalis|sathattar|sattattar|seventeen|sharechat|taintalis|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|athattar|atthavan|bahattar|chauntis|chaurasi|chausath|chawalis|chhabbis|chhappan|chhattis|chhiyasi|eighteen|facebook|fourteen|ikhattar|linkedin|nineteen|ninyanve|pachanve|pachchis|painsath|satattar|sattanve|sattavan|sattawan|snapchat|tele\\u0067ram|thirteen|tihattar|unhattar|username|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|adtalis|arattai|artalis|at sign|athanve|atharah|athawan|atthais|bayalis|chaalis|chabbis|chappan|chattis|chaubis|chaudah|chautis|chauvan|chauwan|discord|enimidi|fifteen|hotmail|iktalis|ikyanve|ikyavan|ikyawan|jiochat|moondru|naalugu|ombattu|onbadhu|onbathu|outlook|pachaas|pachasi|pachpan|paintis|pandrah|poojyam|sadsath|saintis|sataees|sattais|sattasi|seventy|shoonya|sixteen|taintis|tetalis|threads|tiranve|tirsath|tommidi|twitter|untalis|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|adsath|ainthu|arsath|athais|athara|athasi|baanve|baawan|basath|battis|bayasi|byalis|chalis|chauda|chobis|double|eighty|eleven|fourty|gyarah|handle|icloud|ikkees|iksath|ikyasi|irandu|naalku|naangu|nabbey|navasi|nawasi|ninety|paanch|pachas|pachis|pandra|proton|pujyam|reddit|rediff|satrah|sattar|shunno|shunya|shunyo|signal|thirty|tiktok|tirasi|tirpan|trepan|triple|twelve|twenty|unchas|unsath|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|adtis|artis|baees|banve|barah|bavan|botim|chaar|chhah|chhai|chheh|chhoy|eight|eradu|fifty|forty|gmail|gyara|ikkis|iktis|insta|moodu|moonu|mooru|naalu|nabbe|okati|ondru|paach|panch|point|rendu|satra|seven|sifar|sixty|skype|solah|sonne|sunna|sunya|terah|tetis|theen|three|unasi|unees|unnis|untis|yahoo|ymail|\u091c\u093c\u0940\u0930\u094b|\u0936\u0941\u0928\u094d\u092f|\u0936\u0942\u0928\u094d\u092f|\u0938\u093f\u0915\u094d\u0938|\u0938\u0941\u0928\u094d\u092f|\u09b6\u09c2\u09a8\u09cd\u09af|aaru|aath|aidu|anju|assi|atth|bais|bara|bees|chah|char|cheh|chha|chhe|daat|dott|entu|ettu|ezhu|five|four|hike|http|josh|live|nine|ondu|onnu|panj|saat|saha|satt|snap|sola|teen|tees|teis|tele|tera|tinn|tran|wtsp|zero|zoho|\u091c\u0940\u0930\u094b|\u0925\u094d\u0930\u0940|\u0928\u093e\u0907\u0928|\u092a\u093e\u0901\u091a|\u092a\u093e\u0902\u091a|\u092b\u093e\u0907\u0935|\u0938\u0947\u0935\u0928|\u09aa\u09be\u0981\u099a|aat|aol|das|don|doo|dot|dui|edu|ekk|elu|ikk|imo|kik|koo|moj|nau|nav|noy|one|six|ten|tin|two|www|\u091a\u093e\u0930|\u0924\u0940\u0928|\u0926\u094b\u0928|\u092a\u093e\u091a|\u092b\u094b\u0930|\u0938\u0939\u093e|\u0938\u093e\u0924|\u099a\u09be\u09b0|\u099b\u09af\u09bc|\u09a4\u09bf\u09a8|\u09a6\u09c1\u0987|\u09a8\u09af\u09bc|\u09b8\u09be\u09a4|do|ek|fb|id|ig|sc|tg|yt|\u0906\u0920|\u090f\u0915|\u090f\u091f|\u091b\u0903|\u091b\u0939|\u091b\u0947|\u091f\u0942|\u0926\u094b|\u0928\u090a|\u0928\u094c|\u0935\u0928|\u0986\u099f|\u098f\u0995)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])|[[({<]", "u"],
  ["(?<![0-9])(?:(?:\\+|00)[ ]*91[ .-]*|91[ .-]+|0[ .-]*)?[6-9](?:[ .()/\\u20b9$\\u20ac\\u00a3-]{0,3}[0-9]){9}(?![0-9])", "u"],
  ["[0-9]{10}", "u"],
  ["(?:\\+|(?<![0-9])00)[ ]*[1-9](?:[ .()-]{0,2}[0-9]){7,13}(?![0-9])", "u"],
  ["(?<![0-9])0[1-9][0-9]{1,3}[ -]?[2-9][0-9]{2,3}[ -]?[0-9]{3,4}(?![0-9])", "u"],
  ["(?:^|#)[ w,]*(?=[0-9]+(?:[ w,]+[0-9]+){0,3}[ w,]*(?:#|$))(?:9[ w,]*1[ w,]*|0[ w,]*)?(?!9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$))[6-9](?:[ w,]*[0-9]){9}[ w,]*(?:#|$)", "u"],
  ["(?:^|#)[ w,]*(?!9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$))[6-9](?:[ ,][0-9]){9}[ w,]*(?:#|$)", "u"],
  ["(?:^|#)[ w,]*(?=[0-9]+(?:[ ][0-9]+){0,4}[ w,]*(?:#|$))(?:9[ ]?1[ ]?|0[ ]?)?(?!9[ w]*8[ w]*7[ w]*6[ w]*5[ w]*4[ w]*3[ w]*2[ w]*1[ w]*0[ w]*(?:#|$))[6-9](?:[ ]?[0-9]){9}[ w,]*(?:#|$)", "u"],
  ["(?<![0-9])(?:91|0)?[6-9][0-9]{9}(?![0-9])", "u"],
  ["(?<![0-9])[6-9](?:[ .()/\\u20b9$\\u20ac\\u00a3-]{0,3}[0-9]){9}(?![0-9])", "u"],
  ["(?<![a-z])(?:ulta|ultaa|ulte|ulti|reverse|reversed|backwards|backward|peeche se|piche se|pichhe se|right to left)(?![a-z])", "u"],
  ["(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9])", "u"],
  ["(?<![a-z0-9])[a-z]{4}0[a-z0-9]{6}(?![a-z0-9])", "u"],
  ["(?<![a-z])(?:a/c|acct|account|khata|ac)(?:[ .]*(?:no|number|num|nmbr))?[ .:#-]*[0-9](?:[ -]?[0-9]){8,17}(?![0-9])", "u"],
  ["(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{2,63}@(?!(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z0-9]))[a-z]{2,20}(?![a-z0-9.@])", "u"],
  ["(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,24}(?![a-z0-9])", "u"],
  ["(?<![a-z0-9._-])[a-z0-9][a-z0-9._%+-]{1,63}@(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z0-9])", "u"],
  ["(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])(?:[ ]+(?:on|pe|par|ka|ki|at|wala|wali|in|hai|is|h))?[ ]+(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z])", "u"],
  ["(?<![a-z])(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?:[ ,]+[a-z]+){0,4}[ ,]*[:=-]?[ ]*(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z])(?:https?|ftp)[ ]*:[ ]*/[ ]*/|(?<![a-z0-9])www[ ]*\\.[ ]*[a-z0-9]", "u"],
  ["(?<![a-z0-9])(?:chat\\.whatsapp\\.com|api\\.whatsapp\\.com|join\\.skype\\.com|instagram\\.com|sharechat\\.com|facebook\\.com|linkedin\\.com|signal\\.group|snapchat\\.com|tele\\u0067ram\\.dog|tele\\u0067ram\\.org|whatsapp\\.com|discord\\.com|shorturl\\.at|tele\\u0067ram\\.me|threads\\.net|tinyurl\\.com|twitter\\.com|youtube\\.com|discord\\.gg|instagr\\.am|forms\\.gle|linktr\\.ee|signal\\.me|skype\\.com|snap\\.com|youtu\\.be|cutt\\.ly|lnkd\\.in|bit\\.ly|fb\\.com|goo\\.gl|fb\\.me|ig\\.me|is\\.gd|rb\\.gy|wa\\.me|x\\.com|t\\.co|t\\.me)(?![a-z0-9])", "u"],
  ["(?<![a-z0-9@._-])(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{1,62}(?:\\.[a-z0-9-]{2,62})*\\.(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)(?![a-z0-9])", "u"],
  ["(?<![a-z0-9._@])@(?!(?:everyone|panditji|evening|morning|support|bhaiya|guruji|office|pandit|pappal|admin|madam|night|there|baba|bhai|didi|ghar|here|home|maam|noon|team|time|work|all|mam|sir|you|ji|me)(?![a-z0-9._]))(?![0-9]{1,2}(?:[:.][0-9]{2})?(?:am|pm|baje|bje)?(?![a-z0-9_]))(?![0-9]+(?![a-z_]))[a-z0-9_](?:[a-z0-9_]|\\.(?=[a-z0-9_])){2,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|clubhouse|instagram|pinterest|sharechat|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|reddit|signal|tiktok|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:[ ]*(?:pe|par|on|me|mein|id|handle|username|user|naam|name|hai|h|is|mera|meri|my|search|karo|kar|follow|add|dhundo|dhundho|dhoondo|dhundh|dhoondh|\u0906\u0908\u0921\u0940|:|-)){0,4}[^a-z0-9@]{0,8}@?(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z])(?<!(?:order|txn|transaction|booking|session|ticket|ref|payment|utr|upi|call|meeting|reference|tracking|customer|employee|roll|student|aadhaar|pan) )(?:(?:\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|clubhouse|instagram|pinterest|sharechat|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|reddit|signal|tiktok|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)[ ]+)?(?:id|username|user name|userid|user id|handle)[ ]*[:=-][ ]*@?(?:(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])|[a-z]{6,30}(?![a-z0-9_]))", "u"],
  ["(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])[ ]+(?:on|pe|par|at)[ ]+(?:instagram|insta|ig|snapchat|snap|tele\\u0067ram|tg|twitter|facebook|fb|discord|skype|threads)(?![a-z])", "u"],
  ["(?<![a-z0-9_.])[a-z0-9_.]{2,32}#[0-9]{4}(?![0-9])", "u"],
  ["(?<![a-z])live[ ]*:[ ]*[a-z][a-z0-9]*[._0-9][a-z0-9._-]*", "u"],
  ["^[ ]*[0-9]{1,10}(?:[ ]+[0-9]{1,10})*[ ]*$", "u"],
  ["^(?:91|0)?[6-9][0-9]{9}$", "u"],
  ["^[^0-9]*(?:[0-9][^0-9]+)*[0-9]?[^0-9]*$", "u"],
  ["[^0-9]", "gu"],
];

/** Whether any code unit is outside ASCII; the SQL asks v ~ '[^\u0001-\u007f]'. */
function hasNonAscii(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    if (v.charCodeAt(i) > 0x7f) {
      return true;
    }
  }
  return false;
}

let compiled: RegExp[] | null | undefined;

/** Compiles every pattern once. Null when this engine rejects one. */
function regexes(): RegExp[] | null {
  if (compiled === undefined) {
    try {
      compiled = SOURCES.map(([source, flags]) => new RegExp(source, flags));
    } catch {
      compiled = null;
    }
  }
  return compiled;
}

let R: RegExp[] = [];

/** The compiled pattern at `i`. Only reached after ready() succeeded. */
function re(i: number): RegExp {
  return R[i] as RegExp;
}

const FOLD_FROM = "\u00aa\u00b2\u00b3\u00b7\u00b9\u00ba\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d9\u00da\u00db\u00dc\u00dd\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f9\u00fa\u00fb\u00fc\u00fd\u00ff\u0100\u0101\u0102\u0103\u0104\u0105\u0106\u0107\u0108\u0109\u010a\u010b\u010c\u010d\u010e\u010f\u0112\u0113\u0114\u0115\u0116\u0117\u0118\u0119\u011a\u011b\u011c\u011d\u011e\u011f\u0120\u0121\u0122\u0123\u0124\u0125\u0128\u0129\u012a\u012b\u012c\u012d\u012e\u012f\u0130\u0131\u0134\u0135\u0136\u0137\u0139\u013a\u013b\u013c\u013d\u013e\u0143\u0144\u0145\u0146\u0147\u0148\u014c\u014d\u014e\u014f\u0150\u0151\u0154\u0155\u0156\u0157\u0158\u0159\u015a\u015b\u015c\u015d\u015e\u015f\u0160\u0161\u0162\u0163\u0164\u0165\u0168\u0169\u016a\u016b\u016c\u016d\u016e\u016f\u0170\u0171\u0172\u0173\u0174\u0175\u0176\u0177\u0178\u0179\u017a\u017b\u017c\u017d\u017e\u017f\u01a0\u01a1\u01af\u01b0\u01cd\u01ce\u01cf\u01d0\u01d1\u01d2\u01d3\u01d4\u01d5\u01d6\u01d7\u01d8\u01d9\u01da\u01db\u01dc\u01de\u01df\u01e0\u01e1\u01e6\u01e7\u01e8\u01e9\u01ea\u01eb\u01ec\u01ed\u01f0\u01f4\u01f5\u01f8\u01f9\u01fa\u01fb\u0200\u0201\u0202\u0203\u0204\u0205\u0206\u0207\u0208\u0209\u020a\u020b\u020c\u020d\u020e\u020f\u0210\u0211\u0212\u0213\u0214\u0215\u0216\u0217\u0218\u0219\u021a\u021b\u021e\u021f\u0226\u0227\u0228\u0229\u022a\u022b\u022c\u022d\u022e\u022f\u0230\u0231\u0232\u0233\u0251\u0261\u0262\u0269\u026a\u0274\u0280\u028f\u0299\u029c\u029f\u02b0\u02b2\u02b3\u02b7\u02b8\u02e1\u02e2\u02e3\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7\u03b1\u03b2\u03b5\u03b9\u03ba\u03bd\u03bf\u03c1\u03c4\u03c5\u03c7\u03c9\u0405\u0406\u0408\u0410\u0411\u0412\u0415\u0417\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0423\u0425\u042c\u0430\u0431\u0432\u0435\u0437\u043a\u043c\u043d\u043e\u0440\u0441\u0442\u0443\u0445\u044c\u0451\u0455\u0456\u0457\u0458\u051b\u051d\u057d\u0585\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u066b\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9\u07c0\u07c1\u07c2\u07c3\u07c4\u07c5\u07c6\u07c7\u07c8\u07c9\u0966\u0967\u0968\u0969\u096a\u096b\u096c\u096d\u096e\u096f\u09e6\u09e7\u09e8\u09e9\u09ea\u09eb\u09ec\u09ed\u09ee\u09ef\u0a66\u0a67\u0a68\u0a69\u0a6a\u0a6b\u0a6c\u0a6d\u0a6e\u0a6f\u0ae6\u0ae7\u0ae8\u0ae9\u0aea\u0aeb\u0aec\u0aed\u0aee\u0aef\u0b66\u0b67\u0b68\u0b69\u0b6a\u0b6b\u0b6c\u0b6d\u0b6e\u0b6f\u0be6\u0be7\u0be8\u0be9\u0bea\u0beb\u0bec\u0bed\u0bee\u0bef\u0c66\u0c67\u0c68\u0c69\u0c6a\u0c6b\u0c6c\u0c6d\u0c6e\u0c6f\u0ce6\u0ce7\u0ce8\u0ce9\u0cea\u0ceb\u0cec\u0ced\u0cee\u0cef\u0d66\u0d67\u0d68\u0d69\u0d6a\u0d6b\u0d6c\u0d6d\u0d6e\u0d6f\u0de6\u0de7\u0de8\u0de9\u0dea\u0deb\u0dec\u0ded\u0dee\u0def\u0e50\u0e51\u0e52\u0e53\u0e54\u0e55\u0e56\u0e57\u0e58\u0e59\u0ed0\u0ed1\u0ed2\u0ed3\u0ed4\u0ed5\u0ed6\u0ed7\u0ed8\u0ed9\u0f20\u0f21\u0f22\u0f23\u0f24\u0f25\u0f26\u0f27\u0f28\u0f29\u1040\u1041\u1042\u1043\u1044\u1045\u1046\u1047\u1048\u1049\u1090\u1091\u1092\u1093\u1094\u1095\u1096\u1097\u1098\u1099\u17e0\u17e1\u17e2\u17e3\u17e4\u17e5\u17e6\u17e7\u17e8\u17e9\u1810\u1811\u1812\u1813\u1814\u1815\u1816\u1817\u1818\u1819\u1946\u1947\u1948\u1949\u194a\u194b\u194c\u194d\u194e\u194f\u19d0\u19d1\u19d2\u19d3\u19d4\u19d5\u19d6\u19d7\u19d8\u19d9\u1a80\u1a81\u1a82\u1a83\u1a84\u1a85\u1a86\u1a87\u1a88\u1a89\u1a90\u1a91\u1a92\u1a93\u1a94\u1a95\u1a96\u1a97\u1a98\u1a99\u1b50\u1b51\u1b52\u1b53\u1b54\u1b55\u1b56\u1b57\u1b58\u1b59\u1bb0\u1bb1\u1bb2\u1bb3\u1bb4\u1bb5\u1bb6\u1bb7\u1bb8\u1bb9\u1c40\u1c41\u1c42\u1c43\u1c44\u1c45\u1c46\u1c47\u1c48\u1c49\u1c50\u1c51\u1c52\u1c53\u1c54\u1c55\u1c56\u1c57\u1c58\u1c59\u1d00\u1d04\u1d05\u1d07\u1d0a\u1d0b\u1d0d\u1d0f\u1d18\u1d1b\u1d1c\u1d20\u1d21\u1d22\u1d2c\u1d2e\u1d30\u1d31\u1d33\u1d34\u1d35\u1d36\u1d37\u1d38\u1d39\u1d3a\u1d3c\u1d3e\u1d3f\u1d40\u1d41\u1d42\u1d43\u1d47\u1d48\u1d49\u1d4d\u1d4f\u1d50\u1d52\u1d56\u1d57\u1d58\u1d5b\u1d62\u1d63\u1d64\u1d65\u1d9c\u1da0\u1dbb\u1e00\u1e01\u1e02\u1e03\u1e04\u1e05\u1e06\u1e07\u1e08\u1e09\u1e0a\u1e0b\u1e0c\u1e0d\u1e0e\u1e0f\u1e10\u1e11\u1e12\u1e13\u1e14\u1e15\u1e16\u1e17\u1e18\u1e19\u1e1a\u1e1b\u1e1c\u1e1d\u1e1e\u1e1f\u1e20\u1e21\u1e22\u1e23\u1e24\u1e25\u1e26\u1e27\u1e28\u1e29\u1e2a\u1e2b\u1e2c\u1e2d\u1e2e\u1e2f\u1e30\u1e31\u1e32\u1e33\u1e34\u1e35\u1e36\u1e37\u1e38\u1e39\u1e3a\u1e3b\u1e3c\u1e3d\u1e3e\u1e3f\u1e40\u1e41\u1e42\u1e43\u1e44\u1e45\u1e46\u1e47\u1e48\u1e49\u1e4a\u1e4b\u1e4c\u1e4d\u1e4e\u1e4f\u1e50\u1e51\u1e52\u1e53\u1e54\u1e55\u1e56\u1e57\u1e58\u1e59\u1e5a\u1e5b\u1e5c\u1e5d\u1e5e\u1e5f\u1e60\u1e61\u1e62\u1e63\u1e64\u1e65\u1e66\u1e67\u1e68\u1e69\u1e6a\u1e6b\u1e6c\u1e6d\u1e6e\u1e6f\u1e70\u1e71\u1e72\u1e73\u1e74\u1e75\u1e76\u1e77\u1e78\u1e79\u1e7a\u1e7b\u1e7c\u1e7d\u1e7e\u1e7f\u1e80\u1e81\u1e82\u1e83\u1e84\u1e85\u1e86\u1e87\u1e88\u1e89\u1e8a\u1e8b\u1e8c\u1e8d\u1e8e\u1e8f\u1e90\u1e91\u1e92\u1e93\u1e94\u1e95\u1e96\u1e97\u1e98\u1e99\u1e9b\u1ea0\u1ea1\u1ea2\u1ea3\u1ea4\u1ea5\u1ea6\u1ea7\u1ea8\u1ea9\u1eaa\u1eab\u1eac\u1ead\u1eae\u1eaf\u1eb0\u1eb1\u1eb2\u1eb3\u1eb4\u1eb5\u1eb6\u1eb7\u1eb8\u1eb9\u1eba\u1ebb\u1ebc\u1ebd\u1ebe\u1ebf\u1ec0\u1ec1\u1ec2\u1ec3\u1ec4\u1ec5\u1ec6\u1ec7\u1ec8\u1ec9\u1eca\u1ecb\u1ecc\u1ecd\u1ece\u1ecf\u1ed0\u1ed1\u1ed2\u1ed3\u1ed4\u1ed5\u1ed6\u1ed7\u1ed8\u1ed9\u1eda\u1edb\u1edc\u1edd\u1ede\u1edf\u1ee0\u1ee1\u1ee2\u1ee3\u1ee4\u1ee5\u1ee6\u1ee7\u1ee8\u1ee9\u1eea\u1eeb\u1eec\u1eed\u1eee\u1eef\u1ef0\u1ef1\u1ef2\u1ef3\u1ef4\u1ef5\u1ef6\u1ef7\u1ef8\u1ef9\u2010\u2011\u2012\u2013\u2014\u2015\u2022\u2024\u2070\u2071\u2074\u2075\u2076\u2077\u2078\u2079\u207a\u207f\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089\u208a\u2090\u2091\u2092\u2093\u2095\u2096\u2097\u2098\u2099\u209a\u209b\u209c\u2102\u210a\u210b\u210c\u210d\u210e\u2110\u2111\u2112\u2113\u2115\u2119\u211a\u211b\u211c\u211d\u2124\u2128\u212a\u212b\u212c\u212d\u212f\u2130\u2131\u2133\u2134\u2139\u2145\u2146\u2147\u2148\u2149\u2160\u2164\u2169\u216c\u216d\u216e\u216f\u2170\u2174\u2179\u217c\u217d\u217e\u217f\u2212\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u24b6\u24b7\u24b8\u24b9\u24ba\u24bb\u24bc\u24bd\u24be\u24bf\u24c0\u24c1\u24c2\u24c3\u24c4\u24c5\u24c6\u24c7\u24c8\u24c9\u24ca\u24cb\u24cc\u24cd\u24ce\u24cf\u24d0\u24d1\u24d2\u24d3\u24d4\u24d5\u24d6\u24d7\u24d8\u24d9\u24da\u24db\u24dc\u24dd\u24de\u24df\u24e0\u24e1\u24e2\u24e3\u24e4\u24e5\u24e6\u24e7\u24e8\u24e9\u24ea\u24f5\u24f6\u24f7\u24f8\u24f9\u24fa\u24fb\u24fc\u24fd\u24ff\u2776\u2777\u2778\u2779\u277a\u277b\u277c\u277d\u277e\u2780\u2781\u2782\u2783\u2784\u2785\u2786\u2787\u2788\u278a\u278b\u278c\u278d\u278e\u278f\u2790\u2791\u2792\u2c7c\u2c7d\u3002\ua620\ua621\ua622\ua623\ua624\ua625\ua626\ua627\ua628\ua629\ua731\ua7f1\ua7f2\ua7f3\ua7f4\ua8d0\ua8d1\ua8d2\ua8d3\ua8d4\ua8d5\ua8d6\ua8d7\ua8d8\ua8d9\ua900\ua901\ua902\ua903\ua904\ua905\ua906\ua907\ua908\ua909\ua9d0\ua9d1\ua9d2\ua9d3\ua9d4\ua9d5\ua9d6\ua9d7\ua9d8\ua9d9\ua9f0\ua9f1\ua9f2\ua9f3\ua9f4\ua9f5\ua9f6\ua9f7\ua9f8\ua9f9\uaa50\uaa51\uaa52\uaa53\uaa54\uaa55\uaa56\uaa57\uaa58\uaa59\uabf0\uabf1\uabf2\uabf3\uabf4\uabf5\uabf6\uabf7\uabf8\uabf9\ufb29\ufe13\ufe33\ufe34\ufe4d\ufe4e\ufe4f\ufe52\ufe55\ufe5f\ufe62\ufe63\ufe6b\uff03\uff0b\uff0d\uff0e\uff0f\uff10\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff1a\uff20\uff21\uff22\uff23\uff24\uff25\uff26\uff27\uff28\uff29\uff2a\uff2b\uff2c\uff2d\uff2e\uff2f\uff30\uff31\uff32\uff33\uff34\uff35\uff36\uff37\uff38\uff39\uff3a\uff3f\uff41\uff42\uff43\uff44\uff45\uff46\uff47\uff48\uff49\uff4a\uff4b\uff4c\uff4d\uff4e\uff4f\uff50\uff51\uff52\uff53\uff54\uff55\uff56\uff57\uff58\uff59\uff5a\uff61\ud801\udca0\ud801\udca1\ud801\udca2\ud801\udca3\ud801\udca4\ud801\udca5\ud801\udca6\ud801\udca7\ud801\udca8\ud801\udca9\ud801\udfa5\ud803\udd30\ud803\udd31\ud803\udd32\ud803\udd33\ud803\udd34\ud803\udd35\ud803\udd36\ud803\udd37\ud803\udd38\ud803\udd39\ud803\udd40\ud803\udd41\ud803\udd42\ud803\udd43\ud803\udd44\ud803\udd45\ud803\udd46\ud803\udd47\ud803\udd48\ud803\udd49\ud804\udc66\ud804\udc67\ud804\udc68\ud804\udc69\ud804\udc6a\ud804\udc6b\ud804\udc6c\ud804\udc6d\ud804\udc6e\ud804\udc6f\ud804\udcf0\ud804\udcf1\ud804\udcf2\ud804\udcf3\ud804\udcf4\ud804\udcf5\ud804\udcf6\ud804\udcf7\ud804\udcf8\ud804\udcf9\ud804\udd36\ud804\udd37\ud804\udd38\ud804\udd39\ud804\udd3a\ud804\udd3b\ud804\udd3c\ud804\udd3d\ud804\udd3e\ud804\udd3f\ud804\uddd0\ud804\uddd1\ud804\uddd2\ud804\uddd3\ud804\uddd4\ud804\uddd5\ud804\uddd6\ud804\uddd7\ud804\uddd8\ud804\uddd9\ud804\udef0\ud804\udef1\ud804\udef2\ud804\udef3\ud804\udef4\ud804\udef5\ud804\udef6\ud804\udef7\ud804\udef8\ud804\udef9\ud805\udc50\ud805\udc51\ud805\udc52\ud805\udc53\ud805\udc54\ud805\udc55\ud805\udc56\ud805\udc57\ud805\udc58\ud805\udc59\ud805\udcd0\ud805\udcd1\ud805\udcd2\ud805\udcd3\ud805\udcd4\ud805\udcd5\ud805\udcd6\ud805\udcd7\ud805\udcd8\ud805\udcd9\ud805\ude50\ud805\ude51\ud805\ude52\ud805\ude53\ud805\ude54\ud805\ude55\ud805\ude56\ud805\ude57\ud805\ude58\ud805\ude59\ud805\udec0\ud805\udec1\ud805\udec2\ud805\udec3\ud805\udec4\ud805\udec5\ud805\udec6\ud805\udec7\ud805\udec8\ud805\udec9\ud805\uded0\ud805\uded1\ud805\uded2\ud805\uded3\ud805\uded4\ud805\uded5\ud805\uded6\ud805\uded7\ud805\uded8\ud805\uded9\ud805\udeda\ud805\udedb\ud805\udedc\ud805\udedd\ud805\udede\ud805\udedf\ud805\udee0\ud805\udee1\ud805\udee2\ud805\udee3\ud805\udf30\ud805\udf31\ud805\udf32\ud805\udf33\ud805\udf34\ud805\udf35\ud805\udf36\ud805\udf37\ud805\udf38\ud805\udf39\ud806\udce0\ud806\udce1\ud806\udce2\ud806\udce3\ud806\udce4\ud806\udce5\ud806\udce6\ud806\udce7\ud806\udce8\ud806\udce9\ud806\udd50\ud806\udd51\ud806\udd52\ud806\udd53\ud806\udd54\ud806\udd55\ud806\udd56\ud806\udd57\ud806\udd58\ud806\udd59\ud806\udff0\ud806\udff1\ud806\udff2\ud806\udff3\ud806\udff4\ud806\udff5\ud806\udff6\ud806\udff7\ud806\udff8\ud806\udff9\ud807\udc50\ud807\udc51\ud807\udc52\ud807\udc53\ud807\udc54\ud807\udc55\ud807\udc56\ud807\udc57\ud807\udc58\ud807\udc59\ud807\udd50\ud807\udd51\ud807\udd52\ud807\udd53\ud807\udd54\ud807\udd55\ud807\udd56\ud807\udd57\ud807\udd58\ud807\udd59\ud807\udda0\ud807\udda1\ud807\udda2\ud807\udda3\ud807\udda4\ud807\udda5\ud807\udda6\ud807\udda7\ud807\udda8\ud807\udda9\ud807\udde0\ud807\udde1\ud807\udde2\ud807\udde3\ud807\udde4\ud807\udde5\ud807\udde6\ud807\udde7\ud807\udde8\ud807\udde9\ud807\udf50\ud807\udf51\ud807\udf52\ud807\udf53\ud807\udf54\ud807\udf55\ud807\udf56\ud807\udf57\ud807\udf58\ud807\udf59\ud818\udd30\ud818\udd31\ud818\udd32\ud818\udd33\ud818\udd34\ud818\udd35\ud818\udd36\ud818\udd37\ud818\udd38\ud818\udd39\ud81a\ude60\ud81a\ude61\ud81a\ude62\ud81a\ude63\ud81a\ude64\ud81a\ude65\ud81a\ude66\ud81a\ude67\ud81a\ude68\ud81a\ude69\ud81a\udec0\ud81a\udec1\ud81a\udec2\ud81a\udec3\ud81a\udec4\ud81a\udec5\ud81a\udec6\ud81a\udec7\ud81a\udec8\ud81a\udec9\ud81a\udf50\ud81a\udf51\ud81a\udf52\ud81a\udf53\ud81a\udf54\ud81a\udf55\ud81a\udf56\ud81a\udf57\ud81a\udf58\ud81a\udf59\ud81b\udd70\ud81b\udd71\ud81b\udd72\ud81b\udd73\ud81b\udd74\ud81b\udd75\ud81b\udd76\ud81b\udd77\ud81b\udd78\ud81b\udd79\ud833\udcd6\ud833\udcd7\ud833\udcd8\ud833\udcd9\ud833\udcda\ud833\udcdb\ud833\udcdc\ud833\udcdd\ud833\udcde\ud833\udcdf\ud833\udce0\ud833\udce1\ud833\udce2\ud833\udce3\ud833\udce4\ud833\udce5\ud833\udce6\ud833\udce7\ud833\udce8\ud833\udce9\ud833\udcea\ud833\udceb\ud833\udcec\ud833\udced\ud833\udcee\ud833\udcef\ud833\udcf0\ud833\udcf1\ud833\udcf2\ud833\udcf3\ud833\udcf4\ud833\udcf5\ud833\udcf6\ud833\udcf7\ud833\udcf8\ud833\udcf9\ud835\udc00\ud835\udc01\ud835\udc02\ud835\udc03\ud835\udc04\ud835\udc05\ud835\udc06\ud835\udc07\ud835\udc08\ud835\udc09\ud835\udc0a\ud835\udc0b\ud835\udc0c\ud835\udc0d\ud835\udc0e\ud835\udc0f\ud835\udc10\ud835\udc11\ud835\udc12\ud835\udc13\ud835\udc14\ud835\udc15\ud835\udc16\ud835\udc17\ud835\udc18\ud835\udc19\ud835\udc1a\ud835\udc1b\ud835\udc1c\ud835\udc1d\ud835\udc1e\ud835\udc1f\ud835\udc20\ud835\udc21\ud835\udc22\ud835\udc23\ud835\udc24\ud835\udc25\ud835\udc26\ud835\udc27\ud835\udc28\ud835\udc29\ud835\udc2a\ud835\udc2b\ud835\udc2c\ud835\udc2d\ud835\udc2e\ud835\udc2f\ud835\udc30\ud835\udc31\ud835\udc32\ud835\udc33\ud835\udc34\ud835\udc35\ud835\udc36\ud835\udc37\ud835\udc38\ud835\udc39\ud835\udc3a\ud835\udc3b\ud835\udc3c\ud835\udc3d\ud835\udc3e\ud835\udc3f\ud835\udc40\ud835\udc41\ud835\udc42\ud835\udc43\ud835\udc44\ud835\udc45\ud835\udc46\ud835\udc47\ud835\udc48\ud835\udc49\ud835\udc4a\ud835\udc4b\ud835\udc4c\ud835\udc4d\ud835\udc4e\ud835\udc4f\ud835\udc50\ud835\udc51\ud835\udc52\ud835\udc53\ud835\udc54\ud835\udc56\ud835\udc57\ud835\udc58\ud835\udc59\ud835\udc5a\ud835\udc5b\ud835\udc5c\ud835\udc5d\ud835\udc5e\ud835\udc5f\ud835\udc60\ud835\udc61\ud835\udc62\ud835\udc63\ud835\udc64\ud835\udc65\ud835\udc66\ud835\udc67\ud835\udc68\ud835\udc69\ud835\udc6a\ud835\udc6b\ud835\udc6c\ud835\udc6d\ud835\udc6e\ud835\udc6f\ud835\udc70\ud835\udc71\ud835\udc72\ud835\udc73\ud835\udc74\ud835\udc75\ud835\udc76\ud835\udc77\ud835\udc78\ud835\udc79\ud835\udc7a\ud835\udc7b\ud835\udc7c\ud835\udc7d\ud835\udc7e\ud835\udc7f\ud835\udc80\ud835\udc81\ud835\udc82\ud835\udc83\ud835\udc84\ud835\udc85\ud835\udc86\ud835\udc87\ud835\udc88\ud835\udc89\ud835\udc8a\ud835\udc8b\ud835\udc8c\ud835\udc8d\ud835\udc8e\ud835\udc8f\ud835\udc90\ud835\udc91\ud835\udc92\ud835\udc93\ud835\udc94\ud835\udc95\ud835\udc96\ud835\udc97\ud835\udc98\ud835\udc99\ud835\udc9a\ud835\udc9b\ud835\udc9c\ud835\udc9e\ud835\udc9f\ud835\udca2\ud835\udca5\ud835\udca6\ud835\udca9\ud835\udcaa\ud835\udcab\ud835\udcac\ud835\udcae\ud835\udcaf\ud835\udcb0\ud835\udcb1\ud835\udcb2\ud835\udcb3\ud835\udcb4\ud835\udcb5\ud835\udcb6\ud835\udcb7\ud835\udcb8\ud835\udcb9\ud835\udcbb\ud835\udcbd\ud835\udcbe\ud835\udcbf\ud835\udcc0\ud835\udcc1\ud835\udcc2\ud835\udcc3\ud835\udcc5\ud835\udcc6\ud835\udcc7\ud835\udcc8\ud835\udcc9\ud835\udcca\ud835\udccb\ud835\udccc\ud835\udccd\ud835\udcce\ud835\udccf\ud835\udcd0\ud835\udcd1\ud835\udcd2\ud835\udcd3\ud835\udcd4\ud835\udcd5\ud835\udcd6\ud835\udcd7\ud835\udcd8\ud835\udcd9\ud835\udcda\ud835\udcdb\ud835\udcdc\ud835\udcdd\ud835\udcde\ud835\udcdf\ud835\udce0\ud835\udce1\ud835\udce2\ud835\udce3\ud835\udce4\ud835\udce5\ud835\udce6\ud835\udce7\ud835\udce8\ud835\udce9\ud835\udcea\ud835\udceb\ud835\udcec\ud835\udced\ud835\udcee\ud835\udcef\ud835\udcf0\ud835\udcf1\ud835\udcf2\ud835\udcf3\ud835\udcf4\ud835\udcf5\ud835\udcf6\ud835\udcf7\ud835\udcf8\ud835\udcf9\ud835\udcfa\ud835\udcfb\ud835\udcfc\ud835\udcfd\ud835\udcfe\ud835\udcff\ud835\udd00\ud835\udd01\ud835\udd02\ud835\udd03\ud835\udd04\ud835\udd05\ud835\udd07\ud835\udd08\ud835\udd09\ud835\udd0a\ud835\udd0d\ud835\udd0e\ud835\udd0f\ud835\udd10\ud835\udd11\ud835\udd12\ud835\udd13\ud835\udd14\ud835\udd16\ud835\udd17\ud835\udd18\ud835\udd19\ud835\udd1a\ud835\udd1b\ud835\udd1c\ud835\udd1e\ud835\udd1f\ud835\udd20\ud835\udd21\ud835\udd22\ud835\udd23\ud835\udd24\ud835\udd25\ud835\udd26\ud835\udd27\ud835\udd28\ud835\udd29\ud835\udd2a\ud835\udd2b\ud835\udd2c\ud835\udd2d\ud835\udd2e\ud835\udd2f\ud835\udd30\ud835\udd31\ud835\udd32\ud835\udd33\ud835\udd34\ud835\udd35\ud835\udd36\ud835\udd37\ud835\udd38\ud835\udd39\ud835\udd3b\ud835\udd3c\ud835\udd3d\ud835\udd3e\ud835\udd40\ud835\udd41\ud835\udd42\ud835\udd43\ud835\udd44\ud835\udd46\ud835\udd4a\ud835\udd4b\ud835\udd4c\ud835\udd4d\ud835\udd4e\ud835\udd4f\ud835\udd50\ud835\udd52\ud835\udd53\ud835\udd54\ud835\udd55\ud835\udd56\ud835\udd57\ud835\udd58\ud835\udd59\ud835\udd5a\ud835\udd5b\ud835\udd5c\ud835\udd5d\ud835\udd5e\ud835\udd5f\ud835\udd60\ud835\udd61\ud835\udd62\ud835\udd63\ud835\udd64\ud835\udd65\ud835\udd66\ud835\udd67\ud835\udd68\ud835\udd69\ud835\udd6a\ud835\udd6b\ud835\udd6c\ud835\udd6d\ud835\udd6e\ud835\udd6f\ud835\udd70\ud835\udd71\ud835\udd72\ud835\udd73\ud835\udd74\ud835\udd75\ud835\udd76\ud835\udd77\ud835\udd78\ud835\udd79\ud835\udd7a\ud835\udd7b\ud835\udd7c\ud835\udd7d\ud835\udd7e\ud835\udd7f\ud835\udd80\ud835\udd81\ud835\udd82\ud835\udd83\ud835\udd84\ud835\udd85\ud835\udd86\ud835\udd87\ud835\udd88\ud835\udd89\ud835\udd8a\ud835\udd8b\ud835\udd8c\ud835\udd8d\ud835\udd8e\ud835\udd8f\ud835\udd90\ud835\udd91\ud835\udd92\ud835\udd93\ud835\udd94\ud835\udd95\ud835\udd96\ud835\udd97\ud835\udd98\ud835\udd99\ud835\udd9a\ud835\udd9b\ud835\udd9c\ud835\udd9d\ud835\udd9e\ud835\udd9f\ud835\udda0\ud835\udda1\ud835\udda2\ud835\udda3\ud835\udda4\ud835\udda5\ud835\udda6\ud835\udda7\ud835\udda8\ud835\udda9\ud835\uddaa\ud835\uddab\ud835\uddac\ud835\uddad\ud835\uddae\ud835\uddaf\ud835\uddb0\ud835\uddb1\ud835\uddb2\ud835\uddb3\ud835\uddb4\ud835\uddb5\ud835\uddb6\ud835\uddb7\ud835\uddb8\ud835\uddb9\ud835\uddba\ud835\uddbb\ud835\uddbc\ud835\uddbd\ud835\uddbe\ud835\uddbf\ud835\uddc0\ud835\uddc1\ud835\uddc2\ud835\uddc3\ud835\uddc4\ud835\uddc5\ud835\uddc6\ud835\uddc7\ud835\uddc8\ud835\uddc9\ud835\uddca\ud835\uddcb\ud835\uddcc\ud835\uddcd\ud835\uddce\ud835\uddcf\ud835\uddd0\ud835\uddd1\ud835\uddd2\ud835\uddd3\ud835\uddd4\ud835\uddd5\ud835\uddd6\ud835\uddd7\ud835\uddd8\ud835\uddd9\ud835\uddda\ud835\udddb\ud835\udddc\ud835\udddd\ud835\uddde\ud835\udddf\ud835\udde0\ud835\udde1\ud835\udde2\ud835\udde3\ud835\udde4\ud835\udde5\ud835\udde6\ud835\udde7\ud835\udde8\ud835\udde9\ud835\uddea\ud835\uddeb\ud835\uddec\ud835\udded\ud835\uddee\ud835\uddef\ud835\uddf0\ud835\uddf1\ud835\uddf2\ud835\uddf3\ud835\uddf4\ud835\uddf5\ud835\uddf6\ud835\uddf7\ud835\uddf8\ud835\uddf9\ud835\uddfa\ud835\uddfb\ud835\uddfc\ud835\uddfd\ud835\uddfe\ud835\uddff\ud835\ude00\ud835\ude01\ud835\ude02\ud835\ude03\ud835\ude04\ud835\ude05\ud835\ude06\ud835\ude07\ud835\ude08\ud835\ude09\ud835\ude0a\ud835\ude0b\ud835\ude0c\ud835\ude0d\ud835\ude0e\ud835\ude0f\ud835\ude10\ud835\ude11\ud835\ude12\ud835\ude13\ud835\ude14\ud835\ude15\ud835\ude16\ud835\ude17\ud835\ude18\ud835\ude19\ud835\ude1a\ud835\ude1b\ud835\ude1c\ud835\ude1d\ud835\ude1e\ud835\ude1f\ud835\ude20\ud835\ude21\ud835\ude22\ud835\ude23\ud835\ude24\ud835\ude25\ud835\ude26\ud835\ude27\ud835\ude28\ud835\ude29\ud835\ude2a\ud835\ude2b\ud835\ude2c\ud835\ude2d\ud835\ude2e\ud835\ude2f\ud835\ude30\ud835\ude31\ud835\ude32\ud835\ude33\ud835\ude34\ud835\ude35\ud835\ude36\ud835\ude37\ud835\ude38\ud835\ude39\ud835\ude3a\ud835\ude3b\ud835\ude3c\ud835\ude3d\ud835\ude3e\ud835\ude3f\ud835\ude40\ud835\ude41\ud835\ude42\ud835\ude43\ud835\ude44\ud835\ude45\ud835\ude46\ud835\ude47\ud835\ude48\ud835\ude49\ud835\ude4a\ud835\ude4b\ud835\ude4c\ud835\ude4d\ud835\ude4e\ud835\ude4f\ud835\ude50\ud835\ude51\ud835\ude52\ud835\ude53\ud835\ude54\ud835\ude55\ud835\ude56\ud835\ude57\ud835\ude58\ud835\ude59\ud835\ude5a\ud835\ude5b\ud835\ude5c\ud835\ude5d\ud835\ude5e\ud835\ude5f\ud835\ude60\ud835\ude61\ud835\ude62\ud835\ude63\ud835\ude64\ud835\ude65\ud835\ude66\ud835\ude67\ud835\ude68\ud835\ude69\ud835\ude6a\ud835\ude6b\ud835\ude6c\ud835\ude6d\ud835\ude6e\ud835\ude6f\ud835\ude70\ud835\ude71\ud835\ude72\ud835\ude73\ud835\ude74\ud835\ude75\ud835\ude76\ud835\ude77\ud835\ude78\ud835\ude79\ud835\ude7a\ud835\ude7b\ud835\ude7c\ud835\ude7d\ud835\ude7e\ud835\ude7f\ud835\ude80\ud835\ude81\ud835\ude82\ud835\ude83\ud835\ude84\ud835\ude85\ud835\ude86\ud835\ude87\ud835\ude88\ud835\ude89\ud835\ude8a\ud835\ude8b\ud835\ude8c\ud835\ude8d\ud835\ude8e\ud835\ude8f\ud835\ude90\ud835\ude91\ud835\ude92\ud835\ude93\ud835\ude94\ud835\ude95\ud835\ude96\ud835\ude97\ud835\ude98\ud835\ude99\ud835\ude9a\ud835\ude9b\ud835\ude9c\ud835\ude9d\ud835\ude9e\ud835\ude9f\ud835\udea0\ud835\udea1\ud835\udea2\ud835\udea3\ud835\udfce\ud835\udfcf\ud835\udfd0\ud835\udfd1\ud835\udfd2\ud835\udfd3\ud835\udfd4\ud835\udfd5\ud835\udfd6\ud835\udfd7\ud835\udfd8\ud835\udfd9\ud835\udfda\ud835\udfdb\ud835\udfdc\ud835\udfdd\ud835\udfde\ud835\udfdf\ud835\udfe0\ud835\udfe1\ud835\udfe2\ud835\udfe3\ud835\udfe4\ud835\udfe5\ud835\udfe6\ud835\udfe7\ud835\udfe8\ud835\udfe9\ud835\udfea\ud835\udfeb\ud835\udfec\ud835\udfed\ud835\udfee\ud835\udfef\ud835\udff0\ud835\udff1\ud835\udff2\ud835\udff3\ud835\udff4\ud835\udff5\ud835\udff6\ud835\udff7\ud835\udff8\ud835\udff9\ud835\udffa\ud835\udffb\ud835\udffc\ud835\udffd\ud835\udffe\ud835\udfff\ud838\udd40\ud838\udd41\ud838\udd42\ud838\udd43\ud838\udd44\ud838\udd45\ud838\udd46\ud838\udd47\ud838\udd48\ud838\udd49\ud838\udef0\ud838\udef1\ud838\udef2\ud838\udef3\ud838\udef4\ud838\udef5\ud838\udef6\ud838\udef7\ud838\udef8\ud838\udef9\ud839\udcf0\ud839\udcf1\ud839\udcf2\ud839\udcf3\ud839\udcf4\ud839\udcf5\ud839\udcf6\ud839\udcf7\ud839\udcf8\ud839\udcf9\ud839\uddf1\ud839\uddf2\ud839\uddf3\ud839\uddf4\ud839\uddf5\ud839\uddf6\ud839\uddf7\ud839\uddf8\ud839\uddf9\ud839\uddfa\ud83a\udd50\ud83a\udd51\ud83a\udd52\ud83a\udd53\ud83a\udd54\ud83a\udd55\ud83a\udd56\ud83a\udd57\ud83a\udd58\ud83a\udd59\ud83c\udd2b\ud83c\udd2c\ud83c\udd30\ud83c\udd31\ud83c\udd32\ud83c\udd33\ud83c\udd34\ud83c\udd35\ud83c\udd36\ud83c\udd37\ud83c\udd38\ud83c\udd39\ud83c\udd3a\ud83c\udd3b\ud83c\udd3c\ud83c\udd3d\ud83c\udd3e\ud83c\udd3f\ud83c\udd40\ud83c\udd41\ud83c\udd42\ud83c\udd43\ud83c\udd44\ud83c\udd45\ud83c\udd46\ud83c\udd47\ud83c\udd48\ud83c\udd49\ud83e\udff0\ud83e\udff1\ud83e\udff2\ud83e\udff3\ud83e\udff4\ud83e\udff5\ud83e\udff6\ud83e\udff7\ud83e\udff8\ud83e\udff9";
const FOLD_TO = "a23.1oaaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzsoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaggiinrybhlhjrwylsxabezhikmnoptyxabeikvoptuxwsija6be3kmhopctyxba6be3kmhopctyxbesiijqwuo0123456789.012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789acdejkmoptuvwzabdeghijklmnoprtuwabdegkmoptuviruvcfzaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwysaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy------..0i456789+n0123456789+aeoxhklmnpstcghhhhiillnpqrrrzzkabceefmoiddeijivxlcdmivxlcdm-123456789abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz01234567890123456789123456789123456789jv.0123456789sscfq012345678901234567890123456789012345678901234567890123456789+:_____.:#+-@#+-./0123456789:@abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz.0123456789q012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefgijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzacdgjknopqstuvwxyzabcdfhijklmnpqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabdefgjklmnopqstuvwxyabcdefghijklmnopqrstuvwxyzabdefgijklmostuvwxyabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789crabcdefghijklmnopqrstuvwxyz0123456789";

let fold: Map<string, string> | undefined;
function foldMap(): Map<string, string> {
  if (fold === undefined) {
    const from = Array.from(FOLD_FROM);
    const to = Array.from(FOLD_TO);
    fold = new Map(from.map((ch, i) => [ch, to[i] ?? ch]));
  }
  return fold;
}

let tm0: Map<string, string> | undefined;
function tmap0(): Map<string, string> {
  if (tm0 === undefined) {
    const from = Array.from("oilszbgq");
    const to = Array.from("01152899");
    tm0 = new Map(from.map((ch, i2) => [ch, to[i2] ?? ch]));
  }
  return tm0;
}

let tm1: Map<string, string> | undefined;
function tmap1(): Map<string, string> {
  if (tm1 === undefined) {
    const from = Array.from("oil");
    const to = Array.from("011");
    tm1 = new Map(from.map((ch, i2) => [ch, to[i2] ?? ch]));
  }
  return tm1;
}

const DICT0: Record<string, string> = {"zero":"0","shunya":"0","shoonya":"0","sunya":"0","shunyo":"0","shunno":"0","sunna":"0","sonne":"0","sifar":"0","poojyam":"0","pujyam":"0","\u0936\u0942\u0928\u094d\u092f":"0","\u0938\u0941\u0928\u094d\u092f":"0","\u091c\u0940\u0930\u094b":"0","\u091c\u093c\u0940\u0930\u094b":"0","\u0936\u0941\u0928\u094d\u092f":"0","\u09b6\u09c2\u09a8\u09cd\u09af":"0","one":"1","ek":"1","ekk":"1","ikk":"1","okati":"1","ondu":"1","onnu":"1","ondru":"1","\u090f\u0915":"1","\u0935\u0928":"1","\u098f\u0995":"1","two":"2","do":"2","doo":"2","don":"2","dui":"2","rendu":"2","irandu":"2","eradu":"2","\u0926\u094b":"2","\u0926\u094b\u0928":"2","\u091f\u0942":"2","\u09a6\u09c1\u0987":"2","three":"3","teen":"3","tin":"3","tinn":"3","theen":"3","tran":"3","moodu":"3","mooru":"3","moonu":"3","moondru":"3","\u0924\u0940\u0928":"3","\u0925\u094d\u0930\u0940":"3","\u09a4\u09bf\u09a8":"3","four":"4","char":"4","chaar":"4","naalugu":"4","naalku":"4","naangu":"4","naalu":"4","\u091a\u093e\u0930":"4","\u092b\u094b\u0930":"4","\u099a\u09be\u09b0":"4","five":"5","paanch":"5","panch":"5","paach":"5","panj":"5","aidu":"5","ainthu":"5","anju":"5","\u092a\u093e\u0902\u091a":"5","\u092a\u093e\u0901\u091a":"5","\u092a\u093e\u091a":"5","\u092b\u093e\u0907\u0935":"5","\u09aa\u09be\u0981\u099a":"5","six":"6","chhe":"6","chhah":"6","chah":"6","chheh":"6","cheh":"6","chhai":"6","chhoy":"6","chha":"6","saha":"6","aaru":"6","\u091b\u0939":"6","\u091b\u0903":"6","\u091b\u0947":"6","\u0938\u0939\u093e":"6","\u0938\u093f\u0915\u094d\u0938":"6","\u099b\u09af\u09bc":"6","seven":"7","saat":"7","satt":"7","edu":"7","ezhu":"7","elu":"7","\u0938\u093e\u0924":"7","\u0938\u0947\u0935\u0928":"7","\u09b8\u09be\u09a4":"7","eight":"8","aath":"8","aat":"8","atth":"8","enimidi":"8","ettu":"8","entu":"8","\u0906\u0920":"8","\u090f\u091f":"8","\u0986\u099f":"8","nine":"9","nau":"9","nav":"9","noy":"9","tommidi":"9","onbathu":"9","onbadhu":"9","ombattu":"9","\u0928\u094c":"9","\u0928\u090a":"9","\u0928\u093e\u0907\u0928":"9","\u09a8\u09af\u09bc":"9","ten":"10","eleven":"11","twelve":"12","thirteen":"13","fourteen":"14","fifteen":"15","sixteen":"16","seventeen":"17","eighteen":"18","nineteen":"19","twenty":"2~","thirty":"3~","forty":"4~","fourty":"4~","fifty":"5~","sixty":"6~","seventy":"7~","eighty":"8~","ninety":"9~","das":"10","gyarah":"11","gyara":"11","barah":"12","bara":"12","terah":"13","tera":"13","chaudah":"14","chauda":"14","pandrah":"15","pandra":"15","solah":"16","sola":"16","satrah":"17","satra":"17","atharah":"18","athara":"18","unnis":"19","unees":"19","bees":"20","ikkis":"21","ikkees":"21","bais":"22","baees":"22","teis":"23","tees":"30","chaubis":"24","chobis":"24","pachchis":"25","pachis":"25","chhabbis":"26","chabbis":"26","sattais":"27","sataees":"27","atthais":"28","athais":"28","untis":"29","iktis":"31","battis":"32","taintis":"33","tetis":"33","chauntis":"34","chautis":"34","paintis":"35","chhattis":"36","chattis":"36","saintis":"37","adtis":"38","artis":"38","untalis":"39","chalis":"40","chaalis":"40","iktalis":"41","bayalis":"42","byalis":"42","taintalis":"43","tetalis":"43","chauvalis":"44","chawalis":"44","paintalis":"45","chhiyalis":"46","saintalis":"47","adtalis":"48","artalis":"48","unchas":"49","pachas":"50","pachaas":"50","ikyavan":"51","ikyawan":"51","bavan":"52","baawan":"52","tirpan":"53","trepan":"53","chauvan":"54","chauwan":"54","pachpan":"55","chhappan":"56","chappan":"56","sattavan":"57","sattawan":"57","atthavan":"58","athawan":"58","unsath":"59","iksath":"61","basath":"62","tirsath":"63","chausath":"64","painsath":"65","chhiyasath":"66","sadsath":"67","adsath":"68","arsath":"68","unhattar":"69","sattar":"70","ikhattar":"71","bahattar":"72","tihattar":"73","chauhattar":"74","pachhattar":"75","chhihattar":"76","sathattar":"77","satattar":"77","sattattar":"77","athattar":"78","unasi":"79","assi":"80","ikyasi":"81","bayasi":"82","tirasi":"83","chaurasi":"84","pachasi":"85","chhiyasi":"86","sattasi":"87","athasi":"88","nawasi":"89","navasi":"89","nabbe":"90","nabbey":"90","ikyanve":"91","banve":"92","baanve":"92","tiranve":"93","chauranve":"94","pachanve":"95","chhiyanve":"96","sattanve":"97","athanve":"98","ninyanve":"99"};
let d0: Map<string, string> | undefined;
function dict0(): Map<string, string> {
  if (d0 === undefined) {
    d0 = new Map(Object.entries(DICT0));
  }
  return d0;
}

const DICT1: Record<string, string> = {"zero":"0\u00a7","shunya":"0\u00a7","shoonya":"0\u00a7","sunya":"0\u00a7","shunyo":"0\u00a7","shunno":"0\u00a7","sunna":"0\u00a7","sonne":"0\u00a7","sifar":"0\u00a7","poojyam":"0\u00a7","pujyam":"0\u00a7","\u0936\u0942\u0928\u094d\u092f":"0\u00a7","\u0938\u0941\u0928\u094d\u092f":"0\u00a7","\u091c\u0940\u0930\u094b":"0\u00a7","\u091c\u093c\u0940\u0930\u094b":"0\u00a7","\u0936\u0941\u0928\u094d\u092f":"0\u00a7","\u09b6\u09c2\u09a8\u09cd\u09af":"0\u00a7","one":"1\u00a7","ek":"1\u00a7","ekk":"1\u00a7","ikk":"1\u00a7","okati":"1\u00a7","ondu":"1\u00a7","onnu":"1\u00a7","ondru":"1\u00a7","\u090f\u0915":"1\u00a7","\u0935\u0928":"1\u00a7","\u098f\u0995":"1\u00a7","two":"2\u00a7","do":"2\u00a7","doo":"2\u00a7","don":"2\u00a7","dui":"2\u00a7","rendu":"2\u00a7","irandu":"2\u00a7","eradu":"2\u00a7","\u0926\u094b":"2\u00a7","\u0926\u094b\u0928":"2\u00a7","\u091f\u0942":"2\u00a7","\u09a6\u09c1\u0987":"2\u00a7","three":"3\u00a7","teen":"3\u00a7","tin":"3\u00a7","tinn":"3\u00a7","theen":"3\u00a7","tran":"3\u00a7","moodu":"3\u00a7","mooru":"3\u00a7","moonu":"3\u00a7","moondru":"3\u00a7","\u0924\u0940\u0928":"3\u00a7","\u0925\u094d\u0930\u0940":"3\u00a7","\u09a4\u09bf\u09a8":"3\u00a7","four":"4\u00a7","char":"4\u00a7","chaar":"4\u00a7","naalugu":"4\u00a7","naalku":"4\u00a7","naangu":"4\u00a7","naalu":"4\u00a7","\u091a\u093e\u0930":"4\u00a7","\u092b\u094b\u0930":"4\u00a7","\u099a\u09be\u09b0":"4\u00a7","five":"5\u00a7","paanch":"5\u00a7","panch":"5\u00a7","paach":"5\u00a7","panj":"5\u00a7","aidu":"5\u00a7","ainthu":"5\u00a7","anju":"5\u00a7","\u092a\u093e\u0902\u091a":"5\u00a7","\u092a\u093e\u0901\u091a":"5\u00a7","\u092a\u093e\u091a":"5\u00a7","\u092b\u093e\u0907\u0935":"5\u00a7","\u09aa\u09be\u0981\u099a":"5\u00a7","six":"6\u00a7","chhe":"6\u00a7","chhah":"6\u00a7","chah":"6\u00a7","chheh":"6\u00a7","cheh":"6\u00a7","chhai":"6\u00a7","chhoy":"6\u00a7","chha":"6\u00a7","saha":"6\u00a7","aaru":"6\u00a7","\u091b\u0939":"6\u00a7","\u091b\u0903":"6\u00a7","\u091b\u0947":"6\u00a7","\u0938\u0939\u093e":"6\u00a7","\u0938\u093f\u0915\u094d\u0938":"6\u00a7","\u099b\u09af\u09bc":"6\u00a7","seven":"7\u00a7","saat":"7\u00a7","satt":"7\u00a7","edu":"7\u00a7","ezhu":"7\u00a7","elu":"7\u00a7","\u0938\u093e\u0924":"7\u00a7","\u0938\u0947\u0935\u0928":"7\u00a7","\u09b8\u09be\u09a4":"7\u00a7","eight":"8\u00a7","aath":"8\u00a7","aat":"8\u00a7","atth":"8\u00a7","enimidi":"8\u00a7","ettu":"8\u00a7","entu":"8\u00a7","\u0906\u0920":"8\u00a7","\u090f\u091f":"8\u00a7","\u0986\u099f":"8\u00a7","nine":"9\u00a7","nau":"9\u00a7","nav":"9\u00a7","noy":"9\u00a7","tommidi":"9\u00a7","onbathu":"9\u00a7","onbadhu":"9\u00a7","ombattu":"9\u00a7","\u0928\u094c":"9\u00a7","\u0928\u090a":"9\u00a7","\u0928\u093e\u0907\u0928":"9\u00a7","\u09a8\u09af\u09bc":"9\u00a7","ten":"10\u00a7","eleven":"11\u00a7","twelve":"12\u00a7","thirteen":"13\u00a7","fourteen":"14\u00a7","fifteen":"15\u00a7","sixteen":"16\u00a7","seventeen":"17\u00a7","eighteen":"18\u00a7","nineteen":"19\u00a7","twenty":"2~\u00a7","thirty":"3~\u00a7","forty":"4~\u00a7","fourty":"4~\u00a7","fifty":"5~\u00a7","sixty":"6~\u00a7","seventy":"7~\u00a7","eighty":"8~\u00a7","ninety":"9~\u00a7","das":"10\u00a7","gyarah":"11\u00a7","gyara":"11\u00a7","barah":"12\u00a7","bara":"12\u00a7","terah":"13\u00a7","tera":"13\u00a7","chaudah":"14\u00a7","chauda":"14\u00a7","pandrah":"15\u00a7","pandra":"15\u00a7","solah":"16\u00a7","sola":"16\u00a7","satrah":"17\u00a7","satra":"17\u00a7","atharah":"18\u00a7","athara":"18\u00a7","unnis":"19\u00a7","unees":"19\u00a7","bees":"20\u00a7","ikkis":"21\u00a7","ikkees":"21\u00a7","bais":"22\u00a7","baees":"22\u00a7","teis":"23\u00a7","tees":"30\u00a7","chaubis":"24\u00a7","chobis":"24\u00a7","pachchis":"25\u00a7","pachis":"25\u00a7","chhabbis":"26\u00a7","chabbis":"26\u00a7","sattais":"27\u00a7","sataees":"27\u00a7","atthais":"28\u00a7","athais":"28\u00a7","untis":"29\u00a7","iktis":"31\u00a7","battis":"32\u00a7","taintis":"33\u00a7","tetis":"33\u00a7","chauntis":"34\u00a7","chautis":"34\u00a7","paintis":"35\u00a7","chhattis":"36\u00a7","chattis":"36\u00a7","saintis":"37\u00a7","adtis":"38\u00a7","artis":"38\u00a7","untalis":"39\u00a7","chalis":"40\u00a7","chaalis":"40\u00a7","iktalis":"41\u00a7","bayalis":"42\u00a7","byalis":"42\u00a7","taintalis":"43\u00a7","tetalis":"43\u00a7","chauvalis":"44\u00a7","chawalis":"44\u00a7","paintalis":"45\u00a7","chhiyalis":"46\u00a7","saintalis":"47\u00a7","adtalis":"48\u00a7","artalis":"48\u00a7","unchas":"49\u00a7","pachas":"50\u00a7","pachaas":"50\u00a7","ikyavan":"51\u00a7","ikyawan":"51\u00a7","bavan":"52\u00a7","baawan":"52\u00a7","tirpan":"53\u00a7","trepan":"53\u00a7","chauvan":"54\u00a7","chauwan":"54\u00a7","pachpan":"55\u00a7","chhappan":"56\u00a7","chappan":"56\u00a7","sattavan":"57\u00a7","sattawan":"57\u00a7","atthavan":"58\u00a7","athawan":"58\u00a7","unsath":"59\u00a7","iksath":"61\u00a7","basath":"62\u00a7","tirsath":"63\u00a7","chausath":"64\u00a7","painsath":"65\u00a7","chhiyasath":"66\u00a7","sadsath":"67\u00a7","adsath":"68\u00a7","arsath":"68\u00a7","unhattar":"69\u00a7","sattar":"70\u00a7","ikhattar":"71\u00a7","bahattar":"72\u00a7","tihattar":"73\u00a7","chauhattar":"74\u00a7","pachhattar":"75\u00a7","chhihattar":"76\u00a7","sathattar":"77\u00a7","satattar":"77\u00a7","sattattar":"77\u00a7","athattar":"78\u00a7","unasi":"79\u00a7","assi":"80\u00a7","ikyasi":"81\u00a7","bayasi":"82\u00a7","tirasi":"83\u00a7","chaurasi":"84\u00a7","pachasi":"85\u00a7","chhiyasi":"86\u00a7","sattasi":"87\u00a7","athasi":"88\u00a7","nawasi":"89\u00a7","navasi":"89\u00a7","nabbe":"90\u00a7","nabbey":"90\u00a7","ikyanve":"91\u00a7","banve":"92\u00a7","baanve":"92\u00a7","tiranve":"93\u00a7","chauranve":"94\u00a7","pachanve":"95\u00a7","chhiyanve":"96\u00a7","sattanve":"97\u00a7","athanve":"98\u00a7","ninyanve":"99\u00a7"};
let d1: Map<string, string> | undefined;
function dict1(): Map<string, string> {
  if (d1 === undefined) {
    d1 = new Map(Object.entries(DICT1));
  }
  return d1;
}

/** Postgres translate(): each character of `map`'s keys becomes its value. */
function translate(v: string, map: Map<string, string>): string {
  let out = '';
  for (const ch of v) {
    out += map.get(ch) ?? ch;
  }
  return out;
}

function copy_t(p: string): string {
  let v = p;
  v = hasNonAscii(v) ? v.replace(re(0), '') : v;
  v = hasNonAscii(v) ? translate(v, foldMap()) : v;
  v = v.replace(/[A-Z]/g, c => c.toLowerCase());
  v = hasNonAscii(v) ? v.replace(re(1), '').replace(re(2), '$1') : v;
  v = v.replace(re(3), ' ');
  v = v.replace(re(4), " ");
  v = v.replace(re(5), "@");
  v = v.replace(re(6), ".");
  v = v.replace(re(7), "&");
  return v;
}

function copy_d(p: string): string {
  let v = p;
  v = re(9).test(v) ? v.replace(re(10), tok => (re(8).test(tok) ? translate(tok, tmap0()) : tok)) : v;
  v = re(9).test(v) ? v.replace(re(10), tok => (re(11).test(tok) ? translate(tok, tmap1()) : tok)) : v;
  return v;
}

function copy_p(p: string): string {
  let v = p;
  v = v.replace(re(12), tok => (dict0().get(tok) ?? tok));
  v = v.replace(re(13), "$1");
  v = v.replace(re(14), "0");
  v = v.replace(re(15), "$1$1");
  v = v.replace(re(16), "$1$1$1");
  v = v.replace(re(17), "+");
  v = v.replace(re(18), "#");
  return v;
}

function copy_rp(p: string): string {
  let v = p;
  v = Array.from(v).reverse().join('');
  return v;
}

function copy_pd(p: string): string {
  let v = p;
  v = v.replace(re(18), "#");
  v = v.replace(re(19), "#");
  v = v.replace(re(20), "#");
  v = v.replace(re(21), "#");
  v = v.replace(re(22), "#");
  v = v.replace(re(12), "w");
  v = v.replace(re(23), ",");
  v = v.replace(re(24), " ");
  v = v.replace(re(25), "#");
  v = v.replace(re(26), "");
  return v;
}

function copy_pw(p: string): string {
  let v = p;
  v = v.replace(re(12), tok => (dict1().get(tok) ?? tok));
  v = v.replace(re(27), "$1§");
  v = v.replace(re(28), "0§");
  v = v.replace(re(29), "$1$1§");
  v = v.replace(re(30), "$1$1$1§");
  v = v.replace(re(31), "");
  v = v.replace(re(32), "");
  return v;
}

function copy_e(p: string): string {
  let v = p;
  v = v.replace(re(33), "@");
  v = v.replace(re(34), ".");
  v = v.replace(re(35), "@");
  v = v.replace(re(36), "@");
  v = v.replace(re(37), "@");
  v = v.replace(re(38), "@");
  v = v.replace(re(39), "_");
  v = v.replace(re(40), ".");
  v = v.replace(re(41), ".");
  v = v.replace(re(42), ".");
  v = v.replace(re(43), "/");
  return v;
}

function copy_ec(p: string): string {
  let v = p;
  v = v.replace(re(44), "");
  v = v.replace(re(33), "@");
  v = v.replace(re(34), ".");
  v = v.replace(re(35), "@");
  v = v.replace(re(36), "@");
  v = v.replace(re(37), "@");
  v = v.replace(re(38), "@");
  v = v.replace(re(39), "_");
  v = v.replace(re(40), ".");
  v = v.replace(re(41), ".");
  v = v.replace(re(42), ".");
  v = v.replace(re(43), "/");
  return v;
}

type Copies = { t: string; d: string; p: string; rp: string; pd: string; pw: string; e: string; ec: string };

function ready(): boolean {
  const all = regexes();
  if (all === null) {
    return false;
  }
  R = all;
  return true;
}

/** Every working copy of the text, for tests and debugging. */
export function contactGuardCopies(text: string): Copies | null {
  if (!ready()) {
    return null;
  }
  const t = copy_t(text);
  const d = copy_d(t);
  const p = copy_p(d);
  const rp = copy_rp(p);
  const pd = copy_pd(d);
  const pw = copy_pw(d);
  const e = copy_e(t);
  const ec = copy_ec(t);
  return { t, d, p, rp, pd, pw, e, ec };
}

/** True when any hard rule fires: the server would refuse this in enforce mode. */
export function isContactBlocked(text: string): boolean {
  if (!ready()) {
    return false;
  }
  const t = copy_t(text);
  if (!re(55).test(t)) {
    return false;
  }
  const c: Partial<Copies> = { t };
  c.d = copy_d(c.t as string);
  c.p = copy_p(c.d as string);
  c.rp = copy_rp(c.p as string);
  c.pd = copy_pd(c.d as string);
  c.pw = copy_pw(c.d as string);
  c.e = copy_e(c.t as string);
  c.ec = copy_ec(c.t as string);
  if (re(49).test(c.t as string)) {
    return true;
  }
  if (re(50).test(c.p as string)) {
    return true;
  }
  if (re(51).test(c.pd as string)) {
    return true;
  }
  if (re(52).test(c.pw as string)) {
    return true;
  }
  if (re(53).test(c.e as string)) {
    return true;
  }
  if (re(54).test(c.ec as string)) {
    return true;
  }
  if (re(64).test(c.rp as string) && re(65).test(c.t as string)) {
    return true;
  }
  return false;
}

/** The hard rule ids that fire, in spec order. */
export function contactGuardRules(text: string): string[] {
  if (!ready() || !re(55).test(copy_t(text))) {
    return [];
  }
  return contactGuardRulesUnfiltered(text);
}

/** Whether the fast path's prefilter lets the text through to the rules. */
export function contactGuardPrefilter(text: string): boolean {
  return ready() && re(55).test(copy_t(text));
}

/**
 * Every hard rule, without the prefilter. Tests use it to prove the
 * prefilter never hides a hit; nothing else should.
 */
export function contactGuardRulesUnfiltered(text: string): string[] {
  const ids: string[] = [];
  if (!ready()) {
    return ids;
  }
  const c = contactGuardCopies(text) as Copies;
  if (!ids.includes("phone_mobile") && re(56).test(c.p)) {
    ids.push("phone_mobile");
  }
  if (!ids.includes("phone_run10") && re(57).test(c.p)) {
    ids.push("phone_run10");
  }
  if (!ids.includes("phone_intl") && re(58).test(c.p)) {
    ids.push("phone_intl");
  }
  if (!ids.includes("phone_landline") && re(59).test(c.p)) {
    ids.push("phone_landline");
  }
  if (!ids.includes("phone_digits") && re(60).test(c.pd)) {
    ids.push("phone_digits");
  }
  if (!ids.includes("phone_spread") && re(61).test(c.pd)) {
    ids.push("phone_spread");
  }
  if (!ids.includes("phone_symbols") && re(62).test(c.pd)) {
    ids.push("phone_symbols");
  }
  if (!ids.includes("phone_words") && re(63).test(c.pw)) {
    ids.push("phone_words");
  }
  if (!ids.includes("phone_reversed") && re(64).test(c.rp) && re(65).test(c.t)) {
    ids.push("phone_reversed");
  }
  if (!ids.includes("vpa") && re(66).test(c.e)) {
    ids.push("vpa");
  }
  if (!ids.includes("vpa") && re(66).test(c.ec)) {
    ids.push("vpa");
  }
  if (!ids.includes("ifsc") && re(67).test(c.t)) {
    ids.push("ifsc");
  }
  if (!ids.includes("bank_account") && re(68).test(c.p)) {
    ids.push("bank_account");
  }
  if (!ids.includes("at_id") && re(69).test(c.e)) {
    ids.push("at_id");
  }
  if (!ids.includes("email") && re(70).test(c.e)) {
    ids.push("email");
  }
  if (!ids.includes("email") && re(70).test(c.ec)) {
    ids.push("email");
  }
  if (!ids.includes("email_no_tld") && re(71).test(c.e)) {
    ids.push("email_no_tld");
  }
  if (!ids.includes("mail_local_near") && re(72).test(c.e)) {
    ids.push("mail_local_near");
  }
  if (!ids.includes("mail_local_near") && re(73).test(c.e)) {
    ids.push("mail_local_near");
  }
  if (!ids.includes("url_scheme") && re(74).test(c.e)) {
    ids.push("url_scheme");
  }
  if (!ids.includes("url_known") && re(75).test(c.e)) {
    ids.push("url_known");
  }
  if (!ids.includes("url_known") && re(75).test(c.ec)) {
    ids.push("url_known");
  }
  if (!ids.includes("url_tld") && re(76).test(c.e)) {
    ids.push("url_tld");
  }
  if (!ids.includes("handle") && re(77).test(c.e)) {
    ids.push("handle");
  }
  if (!ids.includes("app_handle") && re(78).test(c.e)) {
    ids.push("app_handle");
  }
  if (!ids.includes("id_colon_handle") && re(79).test(c.e)) {
    ids.push("id_colon_handle");
  }
  if (!ids.includes("handle_on_app") && re(80).test(c.e)) {
    ids.push("handle_on_app");
  }
  if (!ids.includes("discord_tag") && re(81).test(c.e)) {
    ids.push("discord_tag");
  }
  if (!ids.includes("skype_live") && re(82).test(c.e)) {
    ids.push("skype_live");
  }
  return ids;
}

const CATEGORY_OF: Record<string, ContactCategory> = {"phone_mobile":"phone","phone_run10":"phone","phone_intl":"phone","phone_landline":"phone","phone_digits":"phone","phone_spread":"phone","phone_symbols":"phone","phone_words":"phone","phone_reversed":"phone","vpa":"payment","ifsc":"payment","bank_account":"payment","at_id":"payment","email":"email","email_no_tld":"email","mail_local_near":"email","url_scheme":"link","url_known":"link","url_tld":"link","handle":"handle","app_handle":"handle","id_colon_handle":"handle","handle_on_app":"handle","discord_tag":"handle","skype_live":"handle"};
const CATEGORY_ORDER: ContactCategory[] = ["phone","payment","email","link","handle"];
const PHONE_IDS = ["phone_mobile","phone_run10","phone_intl","phone_landline","phone_digits","phone_spread","phone_symbols","phone_words","phone_reversed"];

/** The category the UI names, by priority; null when nothing fired. */
export function contactCategory(rules: readonly string[]): ContactCategory | null {
  for (const category of CATEGORY_ORDER) {
    if (rules.some(id => CATEGORY_OF[id] === category)) {
      return category;
    }
  }
  return null;
}

/** 'reference' for a bare 10+ digit run alone, 'date_like' for the joined-digits reading alone. */
export function contactReason(rules: readonly string[]): 'reference' | 'date_like' | null {
  if (contactCategory(rules) !== 'phone') {
    return null;
  }
  const phone = rules.filter(id => PHONE_IDS.includes(id));
  if (phone.length === 1 && phone[0] === 'phone_run10') {
    return 'reference';
  }
  if (phone.length === 1 && phone[0] === 'phone_digits') {
    return 'date_like';
  }
  return null;
}

/** A message that is only digit groups returns its digits; any other returns ''. */
export function contactFragment(text: string): string {
  if (!ready()) {
    return '';
  }
  let v = text;
  v = copy_t(text);
  v = copy_d(v);
  v = copy_p(v);
  v = v.replace(re(45), " ");
  v = v.replace(re(46), " ");
  v = v.replace(re(47), "");
  v = v.replace(re(48), " ");
  if (!re(83).test(v)) {
    return '';
  }
  v = v.replace(re(86), '');
  return v.length < 2 ? '' : v;
}

/** A message with no run of two or more digits: the window steps over it. */
export function contactChatter(text: string): boolean {
  if (!ready()) {
    return false;
  }
  let v = text;
  v = copy_t(text);
  v = copy_d(v);
  v = copy_p(v);
  return re(85).test(v);
}

/**
 * The sender's recent messages oldest first, the new one last. Returns the
 * mobile a run of fragments ending at the new message joins into (in sending
 * order or reversed), or null.
 */
export function contactWindow(texts: readonly string[]): string | null {
  const n = texts.length;
  if (n < 2) {
    return null;
  }
  let fwd = contactFragment(texts[n - 1] ?? '');
  if (fwd === '') {
    return null;
  }
  let rev = fwd;
  for (let i = n - 2; i >= 0; i -= 1) {
    const pay = contactFragment(texts[i] ?? '');
    if (pay === '') {
      if (!contactChatter(texts[i] ?? '')) {
        break;
      }
      continue;
    }
    fwd = pay + fwd;
    rev = rev + pay;
    if (fwd.length > 13) {
      break;
    }
    if (re(84).test(fwd)) {
      return fwd;
    }
    if (re(84).test(rev)) {
      return rev;
    }
  }
  return null;
}
