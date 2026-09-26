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
  ["~§[ -]*([1-9])§", "gu"],
  ["~§", "gu"],
  ["(?<![a-z])double[ -]*([0-9])§", "gu"],
  ["(?<![a-z])triple[ -]*([0-9])§", "gu"],
  ["§[ ,.;:/|+&-]*(?=[0-9])", "gu"],
  ["§", "gu"],
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
  ["(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))|(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{2,63}@(?!(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z0-9]))[a-z]{2,20}(?![a-z0-9.@]))|(?:(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,24}(?![a-z0-9]))|(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._%+-]{1,63}@(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z0-9]))|(?:(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])(?:[ ]+(?:on|pe|par|ka|ki|at|wala|wali|in|hai|is|h))?[ ]+(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?![a-z]))|(?:(?<![a-z])(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)(?:[ ,]+[a-z]+){0,4}[ ,]*[:=-]?[ ]*(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_]))|(?:(?<![a-z])(?:https?|ftp)[ ]*:[ ]*/[ ]*/|(?<![a-z0-9])www[ ]*\\.[ ]*[a-z0-9])|(?:(?<![a-z0-9])(?:chat\\.whatsapp\\.com|api\\.whatsapp\\.com|join\\.skype\\.com|instagram\\.com|sharechat\\.com|facebook\\.com|linkedin\\.com|signal\\.group|snapchat\\.com|tele\\u0067ram\\.dog|tele\\u0067ram\\.org|whatsapp\\.com|discord\\.com|shorturl\\.at|tele\\u0067ram\\.me|threads\\.net|tinyurl\\.com|twitter\\.com|youtube\\.com|discord\\.gg|instagr\\.am|forms\\.gle|linktr\\.ee|signal\\.me|skype\\.com|snap\\.com|youtu\\.be|cutt\\.ly|lnkd\\.in|bit\\.ly|fb\\.com|goo\\.gl|fb\\.me|ig\\.me|is\\.gd|rb\\.gy|wa\\.me|x\\.com|t\\.co|t\\.me)(?![a-z0-9]))|(?:(?<![a-z0-9@._-])(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{1,62}(?:\\.[a-z0-9-]{2,62})*\\.(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)(?![a-z0-9]))|(?:(?<![a-z0-9._@])@(?!(?:everyone|panditji|evening|morning|support|bhaiya|guruji|office|pandit|pappal|admin|madam|night|there|baba|bhai|didi|ghar|here|home|maam|noon|team|time|work|all|mam|sir|you|ji|me)(?![a-z0-9._]))(?![0-9]{1,2}(?:[:.][0-9]{2})?(?:am|pm|baje|bje)?(?![a-z0-9_]))(?![0-9]+(?![a-z_]))[a-z0-9_](?:[a-z0-9_]|\\.(?=[a-z0-9_])){2,29}(?![a-z0-9_]))|(?:(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:इंस्टाग्राम|clubhouse|instagram|pinterest|sharechat|टेलीग्राम|व्हाट्सएप|व्हाट्सऐप|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|स्नैपचैट|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|वॉट्सऐप|reddit|signal|tiktok|watsap|wechat|इंस्टा|फेसबुक|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:[ ]*(?:pe|par|on|me|mein|id|handle|username|user|naam|name|hai|h|is|mera|meri|my|search|karo|kar|follow|add|dhundo|dhundho|dhoondo|dhundh|dhoondh|आईडी|:|-)){0,4}[^a-z0-9@]{0,8}@?(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_]))|(?:(?<![a-z])(?<!(?:order|txn|transaction|booking|session|ticket|ref|payment|utr|upi|call|meeting|reference|tracking|customer|employee|roll|student|aadhaar|pan) )(?:(?:इंस्टाग्राम|clubhouse|instagram|pinterest|sharechat|टेलीग्राम|व्हाट्सएप|व्हाट्सऐप|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|स्नैपचैट|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|वॉट्सऐप|reddit|signal|tiktok|watsap|wechat|इंस्टा|फेसबुक|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)[ ]+)?(?:id|username|user name|userid|user id|handle)[ ]*[:=-][ ]*@?(?:(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])|[a-z]{6,30}(?![a-z0-9_])))|(?:(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])[ ]+(?:on|pe|par|at)[ ]+(?:instagram|insta|ig|snapchat|snap|tele\\u0067ram|tg|twitter|facebook|fb|discord|skype|threads)(?![a-z]))|(?:(?<![a-z0-9_.])[a-z0-9_.]{2,32}#[0-9]{4}(?![0-9]))|(?:(?<![a-z])live[ ]*:[ ]*[a-z][a-z0-9]*[._0-9][a-z0-9._-]*)", "u"],
  ["(?:(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))|(?:(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,24}(?![a-z0-9]))|(?:(?<![a-z0-9])(?:chat\\.whatsapp\\.com|api\\.whatsapp\\.com|join\\.skype\\.com|instagram\\.com|sharechat\\.com|facebook\\.com|linkedin\\.com|signal\\.group|snapchat\\.com|tele\\u0067ram\\.dog|tele\\u0067ram\\.org|whatsapp\\.com|discord\\.com|shorturl\\.at|tele\\u0067ram\\.me|threads\\.net|tinyurl\\.com|twitter\\.com|youtube\\.com|discord\\.gg|instagr\\.am|forms\\.gle|linktr\\.ee|signal\\.me|skype\\.com|snap\\.com|youtu\\.be|cutt\\.ly|lnkd\\.in|bit\\.ly|fb\\.com|goo\\.gl|fb\\.me|ig\\.me|is\\.gd|rb\\.gy|wa\\.me|x\\.com|t\\.co|t\\.me)(?![a-z0-9]))", "u"],
  ["[0-9@.:#/=-]|(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:at the rate|under score|इंस्टाग्राम|chauhattar|chhihattar|chhiyasath|googlemail|pachhattar|protonmail|rediffmail|underscore|attherate|chauranve|chauvalis|chhiyalis|chhiyanve|clubhouse|instagram|paintalis|pinterest|saintalis|sathattar|sattattar|seventeen|sharechat|taintalis|टेलीग्राम|व्हाट्सएप|व्हाट्सऐप|athattar|atthavan|bahattar|chauntis|chaurasi|chausath|chawalis|chhabbis|chhappan|chhattis|chhiyasi|eighteen|facebook|fourteen|ikhattar|linkedin|nineteen|ninyanve|pachanve|pachchis|painsath|satattar|sattanve|sattavan|sattawan|snapchat|tele\\u0067ram|thirteen|tihattar|unhattar|username|whatsapp|स्नैपचैट|adtalis|arattai|artalis|at sign|athanve|atharah|athawan|atthais|bayalis|chaalis|chabbis|chappan|chattis|chaubis|chaudah|chautis|chauvan|chauwan|discord|enimidi|fifteen|hotmail|iktalis|ikyanve|ikyavan|ikyawan|jiochat|moondru|naalugu|ombattu|onbadhu|onbathu|outlook|pachaas|pachasi|pachpan|paintis|pandrah|poojyam|sadsath|saintis|sataees|sattais|sattasi|seventy|shoonya|sixteen|taintis|tetalis|threads|tiranve|tirsath|tommidi|twitter|untalis|watsapp|whatsap|youtube|वॉट्सऐप|adsath|ainthu|arsath|athais|athara|athasi|baanve|baawan|basath|battis|bayasi|byalis|chalis|chauda|chobis|double|eighty|eleven|fourty|gyarah|handle|icloud|ikkees|iksath|ikyasi|irandu|naalku|naangu|nabbey|navasi|nawasi|ninety|paanch|pachas|pachis|pandra|proton|pujyam|reddit|rediff|satrah|sattar|shunno|shunya|shunyo|signal|thirty|tiktok|tirasi|tirpan|trepan|triple|twelve|twenty|unchas|unsath|watsap|wechat|इंस्टा|फेसबुक|adtis|artis|baees|banve|barah|bavan|botim|chaar|chhah|chhai|chheh|chhoy|eight|eradu|fifty|forty|gmail|gyara|ikkis|iktis|insta|moodu|moonu|mooru|naalu|nabbe|okati|ondru|paach|panch|point|rendu|satra|seven|sifar|sixty|skype|solah|sonne|sunna|sunya|terah|tetis|theen|three|unasi|unees|unnis|untis|yahoo|ymail|ज़ीरो|शुन्य|शून्य|सिक्स|सुन्य|শূন্য|aaru|aath|aidu|anju|assi|atth|bais|bara|bees|chah|char|cheh|chha|chhe|daat|dott|entu|ettu|ezhu|five|four|hike|http|josh|live|nine|ondu|onnu|panj|saat|saha|satt|snap|sola|teen|tees|teis|tele|tera|tinn|tran|wtsp|zero|zoho|जीरो|थ्री|नाइन|पाँच|पांच|फाइव|सेवन|পাঁচ|aat|aol|das|don|doo|dot|dui|edu|ekk|elu|ikk|imo|kik|koo|moj|nau|nav|noy|one|six|ten|tin|two|www|चार|तीन|दोन|पाच|फोर|सहा|सात|চার|ছয়|তিন|দুই|নয়|সাত|do|ek|fb|id|ig|sc|tg|yt|आठ|एक|एट|छः|छह|छे|टू|दो|नऊ|नौ|वन|আট|এক)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])|[[({<]", "u"],
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
  ["(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:इंस्टाग्राम|clubhouse|instagram|pinterest|sharechat|टेलीग्राम|व्हाट्सएप|व्हाट्सऐप|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|स्नैपचैट|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|वॉट्सऐप|reddit|signal|tiktok|watsap|wechat|इंस्टा|फेसबुक|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:[ ]*(?:pe|par|on|me|mein|id|handle|username|user|naam|name|hai|h|is|mera|meri|my|search|karo|kar|follow|add|dhundo|dhundho|dhoondo|dhundh|dhoondh|आईडी|:|-)){0,4}[^a-z0-9@]{0,8}@?(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z])(?<!(?:order|txn|transaction|booking|session|ticket|ref|payment|utr|upi|call|meeting|reference|tracking|customer|employee|roll|student|aadhaar|pan) )(?:(?:इंस्टाग्राम|clubhouse|instagram|pinterest|sharechat|टेलीग्राम|व्हाट्सएप|व्हाट्सऐप|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|स्नैपचैट|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|वॉट्सऐप|reddit|signal|tiktok|watsap|wechat|इंस्टा|फेसबुक|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)[ ]+)?(?:id|username|user name|userid|user id|handle)[ ]*[:=-][ ]*@?(?:(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])|[a-z]{6,30}(?![a-z0-9_]))", "u"],
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

const FOLD_FROM = "ª²³·¹ºÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİıĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳɑɡɢɩɪɴʀʏʙʜʟʰʲʳʷʸˡˢˣΑΒΕΖΗΙΚΜΝΟΡΤΥΧαβεικνορτυχωЅІЈАБВЕЗКМНОРСТУХЬабвезкмнорстухьёѕіїјԛԝսօ٠١٢٣٤٥٦٧٨٩٫۰۱۲۳۴۵۶۷۸۹߀߁߂߃߄߅߆߇߈߉०१२३४५६७८९০১২৩৪৫৬৭৮৯੦੧੨੩੪੫੬੭੮੯૦૧૨૩૪૫૬૭૮૯୦୧୨୩୪୫୬୭୮୯௦௧௨௩௪௫௬௭௮௯౦౧౨౩౪౫౬౭౮౯೦೧೨೩೪೫೬೭೮೯൦൧൨൩൪൫൬൭൮൯෦෧෨෩෪෫෬෭෮෯๐๑๒๓๔๕๖๗๘๙໐໑໒໓໔໕໖໗໘໙༠༡༢༣༤༥༦༧༨༩၀၁၂၃၄၅၆၇၈၉႐႑႒႓႔႕႖႗႘႙០១២៣៤៥៦៧៨៩᠐᠑᠒᠓᠔᠕᠖᠗᠘᠙᥆᥇᥈᥉᥊᥋᥌᥍᥎᥏᧐᧑᧒᧓᧔᧕᧖᧗᧘᧙᪀᪁᪂᪃᪄᪅᪆᪇᪈᪉᪐᪑᪒᪓᪔᪕᪖᪗᪘᪙᭐᭑᭒᭓᭔᭕᭖᭗᭘᭙᮰᮱᮲᮳᮴᮵᮶᮷᮸᮹᱀᱁᱂᱃᱄᱅᱆᱇᱈᱉᱐᱑᱒᱓᱔᱕᱖᱗᱘᱙ᴀᴄᴅᴇᴊᴋᴍᴏᴘᴛᴜᴠᴡᴢᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁᵂᵃᵇᵈᵉᵍᵏᵐᵒᵖᵗᵘᵛᵢᵣᵤᵥᶜᶠᶻḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ‐‑‒–—―•․⁰ⁱ⁴⁵⁶⁷⁸⁹⁺ⁿ₀₁₂₃₄₅₆₇₈₉₊ₐₑₒₓₕₖₗₘₙₚₛₜℂℊℋℌℍℎℐℑℒℓℕℙℚℛℜℝℤℨKÅℬℭℯℰℱℳℴℹⅅⅆⅇⅈⅉⅠⅤⅩⅬⅭⅮⅯⅰⅴⅹⅼⅽⅾⅿ−①②③④⑤⑥⑦⑧⑨ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ⓪⓵⓶⓷⓸⓹⓺⓻⓼⓽⓿❶❷❸❹❺❻❼❽❾➀➁➂➃➄➅➆➇➈➊➋➌➍➎➏➐➑➒ⱼⱽ。꘠꘡꘢꘣꘤꘥꘦꘧꘨꘩ꜱ꟱ꟲꟳꟴ꣐꣑꣒꣓꣔꣕꣖꣗꣘꣙꤀꤁꤂꤃꤄꤅꤆꤇꤈꤉꧐꧑꧒꧓꧔꧕꧖꧗꧘꧙꧰꧱꧲꧳꧴꧵꧶꧷꧸꧹꩐꩑꩒꩓꩔꩕꩖꩗꩘꩙꯰꯱꯲꯳꯴꯵꯶꯷꯸꯹﬩︓︳︴﹍﹎﹏﹒﹕﹟﹢﹣﹫＃＋－．／０１２３４５６７８９：＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ＿ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｡𐒠𐒡𐒢𐒣𐒤𐒥𐒦𐒧𐒨𐒩𐞥𐴰𐴱𐴲𐴳𐴴𐴵𐴶𐴷𐴸𐴹𐵀𐵁𐵂𐵃𐵄𐵅𐵆𐵇𐵈𐵉𑁦𑁧𑁨𑁩𑁪𑁫𑁬𑁭𑁮𑁯𑃰𑃱𑃲𑃳𑃴𑃵𑃶𑃷𑃸𑃹𑄶𑄷𑄸𑄹𑄺𑄻𑄼𑄽𑄾𑄿𑇐𑇑𑇒𑇓𑇔𑇕𑇖𑇗𑇘𑇙𑋰𑋱𑋲𑋳𑋴𑋵𑋶𑋷𑋸𑋹𑑐𑑑𑑒𑑓𑑔𑑕𑑖𑑗𑑘𑑙𑓐𑓑𑓒𑓓𑓔𑓕𑓖𑓗𑓘𑓙𑙐𑙑𑙒𑙓𑙔𑙕𑙖𑙗𑙘𑙙𑛀𑛁𑛂𑛃𑛄𑛅𑛆𑛇𑛈𑛉𑛐𑛑𑛒𑛓𑛔𑛕𑛖𑛗𑛘𑛙𑛚𑛛𑛜𑛝𑛞𑛟𑛠𑛡𑛢𑛣𑜰𑜱𑜲𑜳𑜴𑜵𑜶𑜷𑜸𑜹𑣠𑣡𑣢𑣣𑣤𑣥𑣦𑣧𑣨𑣩𑥐𑥑𑥒𑥓𑥔𑥕𑥖𑥗𑥘𑥙𑯰𑯱𑯲𑯳𑯴𑯵𑯶𑯷𑯸𑯹𑱐𑱑𑱒𑱓𑱔𑱕𑱖𑱗𑱘𑱙𑵐𑵑𑵒𑵓𑵔𑵕𑵖𑵗𑵘𑵙𑶠𑶡𑶢𑶣𑶤𑶥𑶦𑶧𑶨𑶩𑷠𑷡𑷢𑷣𑷤𑷥𑷦𑷧𑷨𑷩𑽐𑽑𑽒𑽓𑽔𑽕𑽖𑽗𑽘𑽙𖄰𖄱𖄲𖄳𖄴𖄵𖄶𖄷𖄸𖄹𖩠𖩡𖩢𖩣𖩤𖩥𖩦𖩧𖩨𖩩𖫀𖫁𖫂𖫃𖫄𖫅𖫆𖫇𖫈𖫉𖭐𖭑𖭒𖭓𖭔𖭕𖭖𖭗𖭘𖭙𖵰𖵱𖵲𖵳𖵴𖵵𖵶𖵷𖵸𖵹𜳖𜳗𜳘𜳙𜳚𜳛𜳜𜳝𜳞𜳟𜳠𜳡𜳢𜳣𜳤𜳥𜳦𜳧𜳨𜳩𜳪𜳫𜳬𜳭𜳮𜳯𜳰𜳱𜳲𜳳𜳴𜳵𜳶𜳷𜳸𜳹𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍𝑎𝑏𝑐𝑑𝑒𝑓𝑔𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧𝑨𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛𝒜𝒞𝒟𝒢𝒥𝒦𝒩𝒪𝒫𝒬𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵𝒶𝒷𝒸𝒹𝒻𝒽𝒾𝒿𝓀𝓁𝓂𝓃𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏𝓐𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃𝔄𝔅𝔇𝔈𝔉𝔊𝔍𝔎𝔏𝔐𝔑𝔒𝔓𝔔𝔖𝔗𝔘𝔙𝔚𝔛𝔜𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷𝔸𝔹𝔻𝔼𝔽𝔾𝕀𝕁𝕂𝕃𝕄𝕆𝕊𝕋𝕌𝕍𝕎𝕏𝕐𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫𝕬𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟𝖠𝖡𝖢𝖣𝖤𝖥𝖦𝖧𝖨𝖩𝖪𝖫𝖬𝖭𝖮𝖯𝖰𝖱𝖲𝖳𝖴𝖵𝖶𝖷𝖸𝖹𝖺𝖻𝖼𝖽𝖾𝖿𝗀𝗁𝗂𝗃𝗄𝗅𝗆𝗇𝗈𝗉𝗊𝗋𝗌𝗍𝗎𝗏𝗐𝗑𝗒𝗓𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝘈𝘉𝘊𝘋𝘌𝘍𝘎𝘏𝘐𝘑𝘒𝘓𝘔𝘕𝘖𝘗𝘘𝘙𝘚𝘛𝘜𝘝𝘞𝘟𝘠𝘡𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻𝘼𝘽𝘾𝘿𝙀𝙁𝙂𝙃𝙄𝙅𝙆𝙇𝙈𝙉𝙊𝙋𝙌𝙍𝙎𝙏𝙐𝙑𝙒𝙓𝙔𝙕𝙖𝙗𝙘𝙙𝙚𝙛𝙜𝙝𝙞𝙟𝙠𝙡𝙢𝙣𝙤𝙥𝙦𝙧𝙨𝙩𝙪𝙫𝙬𝙭𝙮𝙯𝙰𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡𝟢𝟣𝟤𝟥𝟦𝟧𝟨𝟩𝟪𝟫𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿𞅀𞅁𞅂𞅃𞅄𞅅𞅆𞅇𞅈𞅉𞋰𞋱𞋲𞋳𞋴𞋵𞋶𞋷𞋸𞋹𞓰𞓱𞓲𞓳𞓴𞓵𞓶𞓷𞓸𞓹𞗱𞗲𞗳𞗴𞗵𞗶𞗷𞗸𞗹𞗺𞥐𞥑𞥒𞥓𞥔𞥕𞥖𞥗𞥘𞥙🄫🄬🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉🯰🯱🯲🯳🯴🯵🯶🯷🯸🯹";
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

const DICT0: Record<string, string> = {"zero":"0","shunya":"0","shoonya":"0","sunya":"0","shunyo":"0","shunno":"0","sunna":"0","sonne":"0","sifar":"0","poojyam":"0","pujyam":"0","शून्य":"0","सुन्य":"0","जीरो":"0","ज़ीरो":"0","शुन्य":"0","শূন্য":"0","one":"1","ek":"1","ekk":"1","ikk":"1","okati":"1","ondu":"1","onnu":"1","ondru":"1","एक":"1","वन":"1","এক":"1","two":"2","do":"2","doo":"2","don":"2","dui":"2","rendu":"2","irandu":"2","eradu":"2","दो":"2","दोन":"2","टू":"2","দুই":"2","three":"3","teen":"3","tin":"3","tinn":"3","theen":"3","tran":"3","moodu":"3","mooru":"3","moonu":"3","moondru":"3","तीन":"3","थ्री":"3","তিন":"3","four":"4","char":"4","chaar":"4","naalugu":"4","naalku":"4","naangu":"4","naalu":"4","चार":"4","फोर":"4","চার":"4","five":"5","paanch":"5","panch":"5","paach":"5","panj":"5","aidu":"5","ainthu":"5","anju":"5","पांच":"5","पाँच":"5","पाच":"5","फाइव":"5","পাঁচ":"5","six":"6","chhe":"6","chhah":"6","chah":"6","chheh":"6","cheh":"6","chhai":"6","chhoy":"6","chha":"6","saha":"6","aaru":"6","छह":"6","छः":"6","छे":"6","सहा":"6","सिक्स":"6","ছয়":"6","seven":"7","saat":"7","satt":"7","edu":"7","ezhu":"7","elu":"7","सात":"7","सेवन":"7","সাত":"7","eight":"8","aath":"8","aat":"8","atth":"8","enimidi":"8","ettu":"8","entu":"8","आठ":"8","एट":"8","আট":"8","nine":"9","nau":"9","nav":"9","noy":"9","tommidi":"9","onbathu":"9","onbadhu":"9","ombattu":"9","नौ":"9","नऊ":"9","नाइन":"9","নয়":"9","ten":"10","eleven":"11","twelve":"12","thirteen":"13","fourteen":"14","fifteen":"15","sixteen":"16","seventeen":"17","eighteen":"18","nineteen":"19","twenty":"2~","thirty":"3~","forty":"4~","fourty":"4~","fifty":"5~","sixty":"6~","seventy":"7~","eighty":"8~","ninety":"9~","das":"10","gyarah":"11","gyara":"11","barah":"12","bara":"12","terah":"13","tera":"13","chaudah":"14","chauda":"14","pandrah":"15","pandra":"15","solah":"16","sola":"16","satrah":"17","satra":"17","atharah":"18","athara":"18","unnis":"19","unees":"19","bees":"20","ikkis":"21","ikkees":"21","bais":"22","baees":"22","teis":"23","tees":"30","chaubis":"24","chobis":"24","pachchis":"25","pachis":"25","chhabbis":"26","chabbis":"26","sattais":"27","sataees":"27","atthais":"28","athais":"28","untis":"29","iktis":"31","battis":"32","taintis":"33","tetis":"33","chauntis":"34","chautis":"34","paintis":"35","chhattis":"36","chattis":"36","saintis":"37","adtis":"38","artis":"38","untalis":"39","chalis":"40","chaalis":"40","iktalis":"41","bayalis":"42","byalis":"42","taintalis":"43","tetalis":"43","chauvalis":"44","chawalis":"44","paintalis":"45","chhiyalis":"46","saintalis":"47","adtalis":"48","artalis":"48","unchas":"49","pachas":"50","pachaas":"50","ikyavan":"51","ikyawan":"51","bavan":"52","baawan":"52","tirpan":"53","trepan":"53","chauvan":"54","chauwan":"54","pachpan":"55","chhappan":"56","chappan":"56","sattavan":"57","sattawan":"57","atthavan":"58","athawan":"58","unsath":"59","iksath":"61","basath":"62","tirsath":"63","chausath":"64","painsath":"65","chhiyasath":"66","sadsath":"67","adsath":"68","arsath":"68","unhattar":"69","sattar":"70","ikhattar":"71","bahattar":"72","tihattar":"73","chauhattar":"74","pachhattar":"75","chhihattar":"76","sathattar":"77","satattar":"77","sattattar":"77","athattar":"78","unasi":"79","assi":"80","ikyasi":"81","bayasi":"82","tirasi":"83","chaurasi":"84","pachasi":"85","chhiyasi":"86","sattasi":"87","athasi":"88","nawasi":"89","navasi":"89","nabbe":"90","nabbey":"90","ikyanve":"91","banve":"92","baanve":"92","tiranve":"93","chauranve":"94","pachanve":"95","chhiyanve":"96","sattanve":"97","athanve":"98","ninyanve":"99"};
let d0: Map<string, string> | undefined;
function dict0(): Map<string, string> {
  if (d0 === undefined) {
    d0 = new Map(Object.entries(DICT0));
  }
  return d0;
}

const DICT1: Record<string, string> = {"zero":"0§","shunya":"0§","shoonya":"0§","sunya":"0§","shunyo":"0§","shunno":"0§","sunna":"0§","sonne":"0§","sifar":"0§","poojyam":"0§","pujyam":"0§","शून्य":"0§","सुन्य":"0§","जीरो":"0§","ज़ीरो":"0§","शुन्य":"0§","শূন্য":"0§","one":"1§","ek":"1§","ekk":"1§","ikk":"1§","okati":"1§","ondu":"1§","onnu":"1§","ondru":"1§","एक":"1§","वन":"1§","এক":"1§","two":"2§","do":"2§","doo":"2§","don":"2§","dui":"2§","rendu":"2§","irandu":"2§","eradu":"2§","दो":"2§","दोन":"2§","टू":"2§","দুই":"2§","three":"3§","teen":"3§","tin":"3§","tinn":"3§","theen":"3§","tran":"3§","moodu":"3§","mooru":"3§","moonu":"3§","moondru":"3§","तीन":"3§","थ्री":"3§","তিন":"3§","four":"4§","char":"4§","chaar":"4§","naalugu":"4§","naalku":"4§","naangu":"4§","naalu":"4§","चार":"4§","फोर":"4§","চার":"4§","five":"5§","paanch":"5§","panch":"5§","paach":"5§","panj":"5§","aidu":"5§","ainthu":"5§","anju":"5§","पांच":"5§","पाँच":"5§","पाच":"5§","फाइव":"5§","পাঁচ":"5§","six":"6§","chhe":"6§","chhah":"6§","chah":"6§","chheh":"6§","cheh":"6§","chhai":"6§","chhoy":"6§","chha":"6§","saha":"6§","aaru":"6§","छह":"6§","छः":"6§","छे":"6§","सहा":"6§","सिक्स":"6§","ছয়":"6§","seven":"7§","saat":"7§","satt":"7§","edu":"7§","ezhu":"7§","elu":"7§","सात":"7§","सेवन":"7§","সাত":"7§","eight":"8§","aath":"8§","aat":"8§","atth":"8§","enimidi":"8§","ettu":"8§","entu":"8§","आठ":"8§","एट":"8§","আট":"8§","nine":"9§","nau":"9§","nav":"9§","noy":"9§","tommidi":"9§","onbathu":"9§","onbadhu":"9§","ombattu":"9§","नौ":"9§","नऊ":"9§","नाइन":"9§","নয়":"9§","ten":"10§","eleven":"11§","twelve":"12§","thirteen":"13§","fourteen":"14§","fifteen":"15§","sixteen":"16§","seventeen":"17§","eighteen":"18§","nineteen":"19§","twenty":"2~§","thirty":"3~§","forty":"4~§","fourty":"4~§","fifty":"5~§","sixty":"6~§","seventy":"7~§","eighty":"8~§","ninety":"9~§","das":"10§","gyarah":"11§","gyara":"11§","barah":"12§","bara":"12§","terah":"13§","tera":"13§","chaudah":"14§","chauda":"14§","pandrah":"15§","pandra":"15§","solah":"16§","sola":"16§","satrah":"17§","satra":"17§","atharah":"18§","athara":"18§","unnis":"19§","unees":"19§","bees":"20§","ikkis":"21§","ikkees":"21§","bais":"22§","baees":"22§","teis":"23§","tees":"30§","chaubis":"24§","chobis":"24§","pachchis":"25§","pachis":"25§","chhabbis":"26§","chabbis":"26§","sattais":"27§","sataees":"27§","atthais":"28§","athais":"28§","untis":"29§","iktis":"31§","battis":"32§","taintis":"33§","tetis":"33§","chauntis":"34§","chautis":"34§","paintis":"35§","chhattis":"36§","chattis":"36§","saintis":"37§","adtis":"38§","artis":"38§","untalis":"39§","chalis":"40§","chaalis":"40§","iktalis":"41§","bayalis":"42§","byalis":"42§","taintalis":"43§","tetalis":"43§","chauvalis":"44§","chawalis":"44§","paintalis":"45§","chhiyalis":"46§","saintalis":"47§","adtalis":"48§","artalis":"48§","unchas":"49§","pachas":"50§","pachaas":"50§","ikyavan":"51§","ikyawan":"51§","bavan":"52§","baawan":"52§","tirpan":"53§","trepan":"53§","chauvan":"54§","chauwan":"54§","pachpan":"55§","chhappan":"56§","chappan":"56§","sattavan":"57§","sattawan":"57§","atthavan":"58§","athawan":"58§","unsath":"59§","iksath":"61§","basath":"62§","tirsath":"63§","chausath":"64§","painsath":"65§","chhiyasath":"66§","sadsath":"67§","adsath":"68§","arsath":"68§","unhattar":"69§","sattar":"70§","ikhattar":"71§","bahattar":"72§","tihattar":"73§","chauhattar":"74§","pachhattar":"75§","chhihattar":"76§","sathattar":"77§","satattar":"77§","sattattar":"77§","athattar":"78§","unasi":"79§","assi":"80§","ikyasi":"81§","bayasi":"82§","tirasi":"83§","chaurasi":"84§","pachasi":"85§","chhiyasi":"86§","sattasi":"87§","athasi":"88§","nawasi":"89§","navasi":"89§","nabbe":"90§","nabbey":"90§","ikyanve":"91§","banve":"92§","baanve":"92§","tiranve":"93§","chauranve":"94§","pachanve":"95§","chhiyanve":"96§","sattanve":"97§","athanve":"98§","ninyanve":"99§"};
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
