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


export const CONTACT_GUARD_SPEC = "ac38fff8f98f756c5e2390e3c1a15af11c872acde7eeda491e1e94ff777c7e1f";

export type ContactCategory = "phone" | "payment" | "email" | "link" | "handle";

/** Decodes a run list: base-36 pairs of (gap after the previous run's end, end - start). */
function runs(s: string): Array<readonly [number, number]> {
  const n = s.split(',').map(x => parseInt(x, 36));
  const out: Array<readonly [number, number]> = [];
  let end = -1;
  for (let i = 0; i + 1 < n.length; i += 2) {
    const a = end + 1 + (n[i] as number);
    end = a + (n[i + 1] as number);
    out.push([a, end]);
  }
  return out;
}

function esc(cp: number): string {
  return cp <= 0xffff
    ? `\\u${cp.toString(16).padStart(4, '0')}`
    : `\\u{${cp.toString(16)}}`;
}

/** A character class body from a run list. */
function cls(s: string): string {
  return runs(s)
    .map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`))
    .join('');
}

const F0 = cls("lc,33,7n,6,7b,18,1,0,1,1,1,1,1,0,20,a,1c,k,g,0,2t,6,2,5,2,1,1,3,z,0,u,q,2j,a,1m,8,9,0,o,3,1,8,1,2,1,4,17,2,1n,8,16,n,1,v,1j,0,1,0,4,7,4,0,3,6,a,1,t,0,1m,0,4,3,8,0,k,1,q,0,2,1,1l,0,4,1,4,1,2,2,3,0,u,1,3,0,b,1,1l,0,4,4,1,1,4,0,k,1,m,5,1,0,1m,0,2,0,1,3,8,0,7,1,b,1,u,0,1p,0,c,0,1e,0,3,0,1j,0,1,2,5,2,1,3,7,1,b,1,t,0,1m,0,2,0,6,0,5,1,k,1,s,1,1l,1,4,3,8,0,k,1,t,0,20,0,7,2,1,0,2i,0,2,6,c,7,2q,0,2,8,b,6,21,1,r,0,1,0,1,0,1j,d,1,4,1,1,5,a,1,z,9,0,2u,3,1,5,1,1,2,1,p,1,4,2,g,3,d,0,2,1,6,0,f,0,jj,2,qa,2,t,1,u,1,u,1,1s,1,1,6,8,0,2,a,9,0,19,2,1,0,39,1,y,0,3a,2,4,1,9,0,6,2,63,1,2,0,1m,0,1,6,1,0,1,0,2,7,6,9,2,0,1c,19,2,b,k,3,1c,0,1,4,1,0,5,0,14,8,c,1,w,3,2,1,1,2,1k,0,1,1,3,0,1,2,1m,7,2,1,48,2,1,c,1,6,4,0,6,0,3,1,5i,1r,k0,w,2da,2,3x,0,2o,v,fe,3,2z,1,n9w,3,1,9,w,1,28,1,7k,0,3,0,4,0,p,1,5,0,47,1,q,h,d,0,12,7,p,a,1a,2,1c,0,2,3,2,1,13,0,1v,5,2,1,2,1,c,0,8,0,1b,0,1f,0,1,2,2,1,5,1,1,0,16,1,8,0,6m,0,2,0,4,0,fn4,0,kh,f,g,f,r1,0,6a,0,45,4,1ae,2,1,1,5,3,14,2,4,0,4l,1,fx,3,1t,4,8t,1,25,5,1y,a,1d,3,3f,0,1i,e,15,0,2,1,a,2,1d,3,2,1,7,0,1p,2,10,4,1,7,1q,0,c,1,1g,8,a,3,2,0,2n,2,2,0,1,1,6,0,2,0,4d,0,3,7,l,1,1l,1,3,0,11,6,3,4,1y,5,d,0,1,0,1,0,e,1,2d,7,2,2,1,0,n,0,2c,5,1,0,4,1,1,1,6m,3,6,1,1,1,r,1,2d,7,2,0,1,1,2y,0,1,0,2,5,1,0,2t,0,1,0,2,3,1,4,77,8,1,1,74,1,1,0,4,0,40,3,2,1,4,0,w,9,14,5,2,3,8,0,9,5,2,2,1a,c,1,1,5i,0,1,2,1,0,5l,6,1,5,1,0,2a,l,2,6,1,1,1,1,3e,5,3,0,1,1,1,6,1,0,20,1,3,0,1,0,9n,1,b,1,1g,4,5,0,1,0,n,0,44l,0,6,e,8ug,b,3,2,1xc,4,1n,6,t4,0,1r,3,29,0,f5k,1,3mp,19,2,m,f4,2,h,7,2,6,u,3,44,2,1iz,1i,4,1d,8,0,e,0,m,4,1,e,11s,6,1,g,2,6,1,1,1,4,2s,0,4g,6,af,0,1p,3,e4,3,72,1,6r,0,2,0,7,1,5,0,d6,6,31,6,gzhx,6n");
const F1 = "(?:astrology|services|academy|digital|network|website|online|social|studio|cloud|email|media|space|store|today|world|blog|care|chat|club|guru|help|host|info|life|link|live|love|news|page|shop|site|tech|yoga|app|art|bio|biz|com|dev|fun|gle|ink|net|one|org|pro|top|vip|xyz|ai|am|be|cc|ee|gd|gg|in|io|ly|me|to|tv|uk|us|ws)";
const F2 = "(?:jupiteraxis|barodampay|freecharge|googlemail|okhdfcbank|protonmail|rediffmail|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|hotmail|okicici|outlook|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|icloud|okaxis|proton|ptaxis|pthdfc|rediff|waaxis|axisb|gmail|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|yahoo|ymail|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|live|mahb|tjsb|uboi|utbi|yapl|zoho|aol|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)";
const F3 = "(?:jupiteraxis|barodampay|freecharge|okhdfcbank|timecosmos|wahdfcbank|yesbankltd|amazonpay|idfcfirst|niyoicici|okbizaxis|unionbank|axisbank|hdfcbank|idfcbank|naviaxis|superyes|tapicici|abfspay|allbank|equitas|federal|okicici|phonepe|pingpay|waicici|yesbank|yescred|airtel|aubank|okaxis|ptaxis|pthdfc|waaxis|axisb|icici|ikwik|indus|kotak|oksbi|paytm|ptsbi|ptyes|wasbi|andb|apay|bhim|citi|cnrb|gpay|hsbc|kmbl|mahb|tjsb|uboi|utbi|yapl|apl|axl|boi|dbs|dlb|fbl|ibl|jio|kbl|kvb|pnb|rbl|sbi|sib|slc|upi|ybl)";
const F4 = "(?:\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|clubhouse|instagram|pinterest|sharechat|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|facebook|linkedin|snapchat|tele\\u0067ram|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|arattai|discord|jiochat|threads|twitter|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|reddit|signal|tiktok|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|botim|insta|skype|hike|josh|snap|tele|wtsp|imo|kik|koo|moj|fb|ig|sc|tg|yt)";
const F5 = "(?:googlemail|protonmail|rediffmail|hotmail|outlook|icloud|proton|rediff|gmail|yahoo|ymail|live|zoho|aol)";
const F6 = cls("4t,0,11u,5,m,0,5c,0,1d,0,ao,1,28,0,1oc,1,1bh,0,1ks,4,q,4,1d,4,1,9,1hs,0,1ur,0,14ez,f,6n,0,4g,0,2g,2,3b5,0,f,0,6zm,f,qxs,3,43z,7,h406,0,u,2n");

const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["[" + F6 + "]+", "gu"],
  ["^[" + F0 + "]+", "u"],
  ["([\\u0001-\\u007f])[" + F0 + "]+", "gu"],
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
  ["(?<=[a-z0-9])[ ]+(?:at|@)[ ]+(?=" + F2 + "(?![a-z0-9]))", "gu"],
  ["(?<=[a-z0-9])[ ]*@[ ]*(?=" + F2 + "(?![a-z0-9])|[a-z0-9-]+\\." + F1 + "(?![a-z0-9]))", "gu"],
  ["(?<![a-z0-9])@[ ]+(?=[a-z0-9_])", "gu"],
  ["(?<=[a-z0-9])[ ]*(?<![a-z])(?:underscore|under score)(?![a-z])[ ]*(?=[a-z0-9])", "gu"],
  ["[ ]*(?<![a-z])(?:dot|daat|dott|point)(?![a-z])[ ]*(?=" + F1 + "(?![a-z0-9]))", "gu"],
  ["(?<=[a-z0-9])[ ]+(?:dot|daat)[ ]+(?=[a-z0-9])", "gu"],
  ["(?:(?<=[a-z0-9]{2})|(?<=(?:^|[^a-z0-9])(?:t|wa)))[ ]*\\.[ ]*(?=" + F1 + "(?![a-z0-9]))", "gu"],
  ["(?<=\\." + F1 + ")[ ]*/[ ]*(?=[a-z0-9_+])", "gu"],
  ["(?<=(?:^|[^a-z0-9])[a-z0-9]) (?=[a-z0-9](?:[^a-z0-9]|$))", "gu"],
  ["(?<![a-z0-9])[0-9]{1,2}[ ]*(?:digits|digit|ank)(?![a-z])", "gu"],
  ["(?<![a-z])(?:remaining|continue|vodafone|contact|airtel|bhejta|bhejti|doosra|likhta|likhti|mobile|number|purana|second|teesra|baaki|bacha|dekho|dusra|first|hissa|likho|madam|pehla|pehle|phone|shuru|start|third|aage|abhi|baki|bhai|bhej|bsnl|cont|dekh|didi|haan|hain|half|hoon|idea|karo|last|likh|mera|mere|meri|naya|next|nmbr|note|okay|part|phir|plus|raha|rahi|rest|ruko|save|suno|then|wala|wali|and|aur|bas|end|fir|hai|han|hmm|hun|jio|kar|mam|nbr|new|num|sim|sir|sun|the|yeh|ab|he|hu|is|ji|ka|ki|le|lo|my|no|of|ok|ph|se|vi|ye|h)(?![a-z])", "gu"],
  ["[.!?]+[ ]*$", "gu"],
  ["[^0-9a-z:/%.\\u20b9$-]", "gu"],
  ["[ ][ ]+", "gu"],
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
  ["(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{1,63}@" + F3 + "(?![a-z0-9])", "u"],
  ["(?<![a-z0-9])[a-z]{4}0[a-z0-9]{6}(?![a-z0-9])", "u"],
  ["(?<![a-z])(?:a/c|acct|account|khata|ac)(?:[ .]*(?:no|number|num|nmbr))?[ .:#-]*[0-9](?:[ -]?[0-9]){8,17}(?![0-9])", "u"],
  ["(?<![a-z0-9._-])[a-z0-9][a-z0-9._-]{2,63}@(?!" + F5 + "(?![a-z0-9]))[a-z]{2,20}(?![a-z0-9.@])", "u"],
  ["(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,63}@(?!" + F3 + "(?![a-z0-9]))[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.[a-z]{2,24}(?![a-z0-9])", "u"],
  ["(?<![a-z0-9._-])[a-z0-9][a-z0-9._%+-]{1,63}@" + F5 + "(?![a-z0-9])", "u"],
  ["(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])(?:[ ]+(?:on|pe|par|ka|ki|at|wala|wali|in|hai|is|h))?[ ]+" + F5 + "(?![a-z])", "u"],
  ["(?<![a-z])" + F5 + "(?:[ ,]+[a-z]+){0,4}[ ,]*[:=-]?[ ]*(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z])(?:https?|ftp)[ ]*:[ ]*/[ ]*/|(?<![a-z0-9])www[ ]*\\.[ ]*[a-z0-9]", "u"],
  ["(?<![a-z0-9])(?:chat\\.whatsapp\\.com|api\\.whatsapp\\.com|join\\.skype\\.com|instagram\\.com|sharechat\\.com|facebook\\.com|linkedin\\.com|signal\\.group|snapchat\\.com|tele\\u0067ram\\.dog|tele\\u0067ram\\.org|whatsapp\\.com|discord\\.com|shorturl\\.at|tele\\u0067ram\\.me|threads\\.net|tinyurl\\.com|twitter\\.com|youtube\\.com|discord\\.gg|instagr\\.am|forms\\.gle|linktr\\.ee|signal\\.me|skype\\.com|snap\\.com|youtu\\.be|cutt\\.ly|lnkd\\.in|bit\\.ly|fb\\.com|goo\\.gl|fb\\.me|ig\\.me|is\\.gd|rb\\.gy|wa\\.me|x\\.com|t\\.co|t\\.me)(?![a-z0-9])", "u"],
  ["(?<![a-z0-9@._-])(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{1,62}(?:\\.[a-z0-9-]{2,62})*\\." + F1 + "(?![a-z0-9])", "u"],
  ["(?<![a-z0-9._@])@(?!(?:everyone|panditji|evening|morning|support|bhaiya|guruji|office|pandit|pappal|admin|madam|night|there|baba|bhai|didi|ghar|here|home|maam|noon|team|time|work|all|mam|sir|you|ji|me)(?![a-z0-9._]))(?![0-9]{1,2}(?:[:.][0-9]{2})?(?:am|pm|baje|bje)?(?![a-z0-9_]))(?![0-9]+(?![a-z_]))[a-z0-9_](?:[a-z0-9_]|\\.(?=[a-z0-9_])){2,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])" + F4 + "(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:[ ]*(?:pe|par|on|me|mein|id|handle|username|user|naam|name|hai|h|is|mera|meri|my|search|karo|kar|follow|add|dhundo|dhundho|dhoondo|dhundh|dhoondh|\u0906\u0908\u0921\u0940|:|-)){0,4}[^a-z0-9@]{0,8}@?(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])", "u"],
  ["(?<![a-z])(?<!(?:order|txn|transaction|booking|session|ticket|ref|payment|utr|upi|call|meeting|reference|tracking|customer|employee|roll|student|aadhaar|pan) )(?:" + F4 + "[ ]+)?(?:id|username|user name|userid|user id|handle)[ ]*[:=-][ ]*@?(?:(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])|[a-z]{6,30}(?![a-z0-9_]))", "u"],
  ["(?<![a-z0-9._])(?=[a-z0-9_.]*[a-z])(?=[a-z0-9_.]*[0-9_.])[a-z_][a-z0-9_.]{3,29}(?![a-z0-9_])[ ]+(?:on|pe|par|at)[ ]+(?:instagram|insta|ig|snapchat|snap|tele\\u0067ram|tg|twitter|facebook|fb|discord|skype|threads)(?![a-z])", "u"],
  ["(?<![a-z0-9_.])[a-z0-9_.]{2,32}#[0-9]{4}(?![0-9])", "u"],
  ["(?<![a-z])live[ ]*:[ ]*[a-z][a-z0-9]*[._0-9][a-z0-9._-]*", "u"],
  ["[0-9]|(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:chauhattar|chhihattar|chhiyasath|pachhattar|chauranve|chauvalis|chhiyalis|chhiyanve|paintalis|saintalis|sathattar|sattattar|seventeen|taintalis|athattar|atthavan|bahattar|chauntis|chaurasi|chausath|chawalis|chhabbis|chhappan|chhattis|chhiyasi|eighteen|fourteen|ikhattar|nineteen|ninyanve|pachanve|pachchis|painsath|satattar|sattanve|sattavan|sattawan|thirteen|tihattar|unhattar|adtalis|artalis|athanve|atharah|athawan|atthais|bayalis|chaalis|chabbis|chappan|chattis|chaubis|chaudah|chautis|chauvan|chauwan|enimidi|fifteen|iktalis|ikyanve|ikyavan|ikyawan|moondru|naalugu|ombattu|onbadhu|onbathu|pachaas|pachasi|pachpan|paintis|pandrah|poojyam|sadsath|saintis|sataees|sattais|sattasi|seventy|shoonya|sixteen|taintis|tetalis|tiranve|tirsath|tommidi|untalis|adsath|ainthu|arsath|athais|athara|athasi|baanve|baawan|basath|battis|bayasi|byalis|chalis|chauda|chobis|double|eighty|eleven|fourty|gyarah|ikkees|iksath|ikyasi|irandu|naalku|naangu|nabbey|navasi|nawasi|ninety|paanch|pachas|pachis|pandra|pujyam|satrah|sattar|shunno|shunya|shunyo|thirty|tirasi|tirpan|trepan|triple|twelve|twenty|unchas|unsath|adtis|artis|baees|banve|barah|bavan|chaar|chhah|chhai|chheh|chhoy|eight|eradu|fifty|forty|gyara|ikkis|iktis|moodu|moonu|mooru|naalu|nabbe|okati|ondru|paach|panch|rendu|satra|seven|sifar|sixty|solah|sonne|sunna|sunya|terah|tetis|theen|three|unasi|unees|unnis|untis|\u091c\u093c\u0940\u0930\u094b|\u0936\u0941\u0928\u094d\u092f|\u0936\u0942\u0928\u094d\u092f|\u0938\u093f\u0915\u094d\u0938|\u0938\u0941\u0928\u094d\u092f|\u09b6\u09c2\u09a8\u09cd\u09af|aaru|aath|aidu|anju|assi|atth|bais|bara|bees|chah|char|cheh|chha|chhe|entu|ettu|ezhu|five|four|nine|ondu|onnu|panj|saat|saha|satt|sola|teen|tees|teis|tera|tinn|tran|zero|\u091c\u0940\u0930\u094b|\u0925\u094d\u0930\u0940|\u0928\u093e\u0907\u0928|\u092a\u093e\u0901\u091a|\u092a\u093e\u0902\u091a|\u092b\u093e\u0907\u0935|\u0938\u0947\u0935\u0928|\u09aa\u09be\u0981\u099a|aat|das|don|doo|dui|edu|ekk|elu|ikk|nau|nav|noy|one|six|ten|tin|two|\u091a\u093e\u0930|\u0924\u0940\u0928|\u0926\u094b\u0928|\u092a\u093e\u091a|\u092b\u094b\u0930|\u0938\u0939\u093e|\u0938\u093e\u0924|\u099a\u09be\u09b0|\u099b\u09af\u09bc|\u09a4\u09bf\u09a8|\u09a6\u09c1\u0987|\u09a8\u09af\u09bc|\u09b8\u09be\u09a4|do|ek|\u0906\u0920|\u090f\u0915|\u090f\u091f|\u091b\u0903|\u091b\u0939|\u091b\u0947|\u091f\u0942|\u0926\u094b|\u0928\u090a|\u0928\u094c|\u0935\u0928|\u0986\u099f|\u098f\u0995)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])", "u"],
  ["[@#[({<]|[a-z0-9_][ ]*\\.[ ]*[a-z]|(?<![a-z\\u0900-\\u097f\\u0980-\\u09ff])(?:under score|\u0907\u0902\u0938\u094d\u091f\u093e\u0917\u094d\u0930\u093e\u092e|googlemail|protonmail|rediffmail|underscore|attherate|clubhouse|instagram|pinterest|sharechat|user name|\u091f\u0947\u0932\u0940\u0917\u094d\u0930\u093e\u092e|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u090f\u092a|\u0935\u094d\u0939\u093e\u091f\u094d\u0938\u0910\u092a|facebook|linkedin|snapchat|tele\\u0067ram|username|whatsapp|\u0938\u094d\u0928\u0948\u092a\u091a\u0948\u091f|arattai|discord|hotmail|jiochat|outlook|threads|twitter|watsapp|whatsap|youtube|\u0935\u0949\u091f\u094d\u0938\u0910\u092a|handle|icloud|proton|reddit|rediff|signal|tiktok|userid|watsap|wechat|\u0907\u0902\u0938\u094d\u091f\u093e|\u092b\u0947\u0938\u092c\u0941\u0915|botim|gmail|https|insta|point|skype|yahoo|ymail|daat|dott|hike|http|josh|live|snap|tele|wtsp|zoho|aol|dot|ftp|imo|kik|koo|moj|www|at|fb|id|ig|sc|tg|yt)(?![a-z\\u0900-\\u097f\\u0980-\\u09ff])", "u"],
  ["^[ ]?[0-9]{1,10}(?:[ ][0-9]{1,10})*[ ]?$", "u"],
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

/** The fold table's source characters as runs of code points; FOLD_TO is aligned with them. */
const FOLD_RUNS = "4q,0,7,1,3,0,1,1,5,5,1,8,1,5,2,4,2,5,1,8,1,5,2,4,1,g,2,j,2,9,2,3,1,5,4,5,3,5,2,h,2,n,w,1,d,1,s,f,1,3,4,7,2,0,3,1,2,3,4,r,2,1,6,d,t,0,f,1,6,1,9,0,b,0,e,0,9,0,2,0,2,0,g,0,1,1,3,1,14,2,4t,1,2,2,1,1,1,1,1,0,1,0,2,1,1,0,9,1,2,0,3,1,2,0,1,0,1,0,2,1,1,0,1,0,1n,1,1,0,7,2,2,0,1,0,2,0,1,2,1,3,1,0,6,0,3,2,2,0,1,0,2,0,1,2,1,3,1,0,6,0,4,0,3,3,5e,0,1,0,2n,0,7,0,62,9,1,0,3o,9,5i,9,bg,9,3a,9,3a,9,3a,9,3a,9,3a,9,3a,9,3a,9,3a,9,3a,9,2o,9,3a,9,1y,9,7q,9,1y,9,1fq,9,12,9,8c,9,3k,9,4m,9,6,9,52,9,2e,9,3q,9,6,9,4m,0,3,1,1,0,2,1,1,0,1,0,8,0,2,1,3,2,9,0,1,0,1,1,1,7,1,0,1,5,3,2,3,0,1,1,1,0,3,2,2,0,6,3,1i,0,3,0,q,0,1w,49,1,0,4,2h,7q,5,c,0,1,0,23,1,2,6,4,b,5,3,1,7,2t,0,7,4,1,3,1,0,3,4,6,0,3,0,1,3,1,2,1,1,4,0,b,4,m,0,3,0,4,0,2,4,3,0,4,0,2,3,42,0,gd,8,25,1g,a,8,1,0,hi,8,1,8,1,8,yx,1,p0,0,nbx,9,7b,0,5b,3,63,9,12,9,5i,9,m,9,2e,9,ba,9,fn3,0,kp,0,v,1,o,2,2,0,2,0,9,0,2,1,7,0,47,0,7,0,1,d,5,q,4,0,1,p,6,0,11a,9,l7,0,13e,9,6,9,m4,9,3k,9,1o,9,40,9,7q,9,9i,9,3a,9,ae,9,2u,9,6,j,24,9,bq,9,2u,9,ie,9,2e,9,6u,9,1y,9,1i,9,9y,9,d06,9,1t2,9,2e,9,3q,9,eu,9,iu4,z,1dy,2c,1,1y,1,1,2,0,2,1,2,3,1,b,1,0,1,6,1,1s,1,3,2,7,1,6,1,r,1,3,1,4,1,0,3,6,1,9d,8a,1d,1ts,9,bq,9,dy,9,6v,9,np,9,1jl,1,3,p,23q,9";
const FOLD_TO = "a23.1oaaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzsoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaggiinrybhlhjrwylsxabezhikmnoptyxabeikvoptuxwsija6be3kmhopctyxba6be3kmhopctyxbesiijqwuo0123456789.012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789acdejkmoptuvwzabdeghijklmnoprtuwabdegkmoptuviruvcfzaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwysaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy------..0i456789+n0123456789+aeoxhklmnpstcghhhhiillnpqrrrzzkabceefmoiddeijivxlcdmivxlcdm-123456789abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz01234567890123456789123456789123456789jv.0123456789sscfq012345678901234567890123456789012345678901234567890123456789+:_____.:#+-@#+-./0123456789:@abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz.0123456789q012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefgijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzacdgjknopqstuvwxyzabcdfhijklmnpqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabdefgjklmnopqstuvwxyabcdefghijklmnopqrstuvwxyzabdefgijklmostuvwxyabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789crabcdefghijklmnopqrstuvwxyz0123456789";

let fold: Map<string, string> | undefined;
function foldMap(): Map<string, string> {
  if (fold === undefined) {
    const from: string[] = [];
    for (const [a, b] of runs(FOLD_RUNS)) {
      for (let cp = a; cp <= b; cp += 1) {
        from.push(String.fromCodePoint(cp));
      }
    }
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

let d1: Map<string, string> | undefined;
function dict1(): Map<string, string> {
  if (d1 === undefined) {
    d1 = new Map(Object.entries(DICT0).map(([k, w]) => [k, w + "\u00a7"]));
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
  if (v.includes("&")) { v = v.replace(re(4), " "); }
  if (v.includes("&")) { v = v.replace(re(5), "@"); }
  if (v.includes("&")) { v = v.replace(re(6), "."); }
  if (v.includes("&")) { v = v.replace(re(7), "&"); }
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

type MaybeCopies = { t: string; d: string | null; p: string | null; rp: string | null; pd: string | null; pw: string | null; e: string | null; ec: string | null };

/**
 * The working copies the rules read. With `guarded`, a copy whose guard copy
 * t fails is null, as in the SQL, so none of its rules can fire.
 */
function copiesOf(text: string, guarded: boolean): MaybeCopies {
  const c: MaybeCopies = { t: copy_t(text), d: null, p: null, rp: null, pd: null, pw: null, e: null, ec: null };
  c.d = copy_d(c.t);
  c.p = c.d === null || (guarded && !re(78).test(c.t)) ? null : copy_p(c.d as string);
  c.rp = c.p === null || (guarded && !re(78).test(c.t)) ? null : copy_rp(c.p as string);
  c.pd = c.d === null || (guarded && !re(9).test(c.t)) ? null : copy_pd(c.d as string);
  c.pw = c.d === null || (guarded && !re(78).test(c.t)) ? null : copy_pw(c.d as string);
  c.e = (guarded && !re(79).test(c.t)) ? null : copy_e(c.t);
  c.ec = (guarded && !re(79).test(c.t)) ? null : copy_ec(c.t);
  return c;
}

/** The hard rule ids that fire on these copies, in spec order. */
function rulesOn(c: MaybeCopies): string[] {
  const ids: string[] = [];
  if (!ids.includes("phone_mobile") && (c.p !== null && re(51).test(c.p))) {
    ids.push("phone_mobile");
  }
  if (!ids.includes("phone_run10") && (c.p !== null && re(52).test(c.p))) {
    ids.push("phone_run10");
  }
  if (!ids.includes("phone_intl") && (c.p !== null && re(53).test(c.p))) {
    ids.push("phone_intl");
  }
  if (!ids.includes("phone_landline") && (c.p !== null && re(54).test(c.p))) {
    ids.push("phone_landline");
  }
  if (!ids.includes("phone_digits") && (c.pd !== null && re(55).test(c.pd))) {
    ids.push("phone_digits");
  }
  if (!ids.includes("phone_spread") && (c.pd !== null && re(56).test(c.pd))) {
    ids.push("phone_spread");
  }
  if (!ids.includes("phone_symbols") && (c.pd !== null && re(57).test(c.pd))) {
    ids.push("phone_symbols");
  }
  if (!ids.includes("phone_words") && (c.pw !== null && re(58).test(c.pw))) {
    ids.push("phone_words");
  }
  if (!ids.includes("phone_reversed") && (c.rp !== null && re(59).test(c.rp)) && (c.t !== null && re(60).test(c.t))) {
    ids.push("phone_reversed");
  }
  if (!ids.includes("vpa") && (c.e !== null && re(61).test(c.e))) {
    ids.push("vpa");
  }
  if (!ids.includes("vpa") && (c.ec !== null && re(61).test(c.ec))) {
    ids.push("vpa");
  }
  if (!ids.includes("ifsc") && (c.t !== null && re(62).test(c.t))) {
    ids.push("ifsc");
  }
  if (!ids.includes("bank_account") && (c.p !== null && re(63).test(c.p))) {
    ids.push("bank_account");
  }
  if (!ids.includes("at_id") && (c.e !== null && re(64).test(c.e))) {
    ids.push("at_id");
  }
  if (!ids.includes("email") && (c.e !== null && re(65).test(c.e))) {
    ids.push("email");
  }
  if (!ids.includes("email") && (c.ec !== null && re(65).test(c.ec))) {
    ids.push("email");
  }
  if (!ids.includes("email_no_tld") && (c.e !== null && re(66).test(c.e))) {
    ids.push("email_no_tld");
  }
  if (!ids.includes("mail_local_near") && (c.e !== null && re(67).test(c.e))) {
    ids.push("mail_local_near");
  }
  if (!ids.includes("mail_local_near") && (c.e !== null && re(68).test(c.e))) {
    ids.push("mail_local_near");
  }
  if (!ids.includes("url_scheme") && (c.e !== null && re(69).test(c.e))) {
    ids.push("url_scheme");
  }
  if (!ids.includes("url_known") && (c.e !== null && re(70).test(c.e))) {
    ids.push("url_known");
  }
  if (!ids.includes("url_known") && (c.ec !== null && re(70).test(c.ec))) {
    ids.push("url_known");
  }
  if (!ids.includes("url_tld") && (c.e !== null && re(71).test(c.e))) {
    ids.push("url_tld");
  }
  if (!ids.includes("handle") && (c.e !== null && re(72).test(c.e))) {
    ids.push("handle");
  }
  if (!ids.includes("app_handle") && (c.e !== null && re(73).test(c.e))) {
    ids.push("app_handle");
  }
  if (!ids.includes("id_colon_handle") && (c.e !== null && re(74).test(c.e))) {
    ids.push("id_colon_handle");
  }
  if (!ids.includes("handle_on_app") && (c.e !== null && re(75).test(c.e))) {
    ids.push("handle_on_app");
  }
  if (!ids.includes("discord_tag") && (c.e !== null && re(76).test(c.e))) {
    ids.push("discord_tag");
  }
  if (!ids.includes("skype_live") && (c.e !== null && re(77).test(c.e))) {
    ids.push("skype_live");
  }
  return ids;
}

/** True when any hard rule fires: the server would refuse this in enforce mode. */
export function isContactBlocked(text: string): boolean {
  return contactGuardRules(text).length > 0;
}

/** The hard rule ids that fire, in spec order. */
export function contactGuardRules(text: string): string[] {
  if (!ready() || !re(50).test(copy_t(text))) {
    return [];
  }
  return rulesOn(copiesOf(text, true));
}

/** Whether the fast path's prefilter lets the text through to the rules. */
export function contactGuardPrefilter(text: string): boolean {
  return ready() && re(50).test(copy_t(text));
}

/**
 * Every hard rule, with no prefilter and no copy guards. Tests use it to
 * prove neither ever hides a hit; nothing else should.
 */
export function contactGuardRulesUnfiltered(text: string): string[] {
  return ready() ? rulesOn(copiesOf(text, false)) : [];
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
  v = v.replace(re(49), " ");
  if (!re(80).test(v)) {
    return '';
  }
  v = v.replace(re(83), '');
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
  return re(82).test(v);
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
    if (re(81).test(fwd)) {
      return fwd;
    }
    if (re(81).test(rev)) {
      return rev;
    }
  }
  return null;
}
