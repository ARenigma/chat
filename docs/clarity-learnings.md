# What Clarity taught us, and where each lesson landed

Research pass on **Clarity / WeHeal** (`com.weheal.weheal`) — 10M+ installs, 4.3★
from ~92K reviews, listed under **Lifestyle**, rated 12+. The closest live
analogue to this product: paid conversation with real people, positioned around
loneliness rather than treatment.

The listing was useful. The **reviews were far more useful**, because they show
what breaks at scale rather than what the marketing claims.

Every row below is a decision that shipped, with the migration or file it lives
in. Nothing here is aspirational.

---

## 1. Category and positioning

| Observed                                                                                                             | What we did                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listed under **Lifestyle**, not Health/Medical. Rated 12+.                                                           | Strong precedent that this category ships without entering Health. Recorded in [ADR-0001](adr/0001-human-to-human-not-ai-chat.md); our Play listing targets the same category.    |
| Store copy: _"So many contacts on your phone, still no one to talk to!"_ — loneliness framing, zero clinical claims. | Confirms the positioning we had already chosen. Our subtitle is _"Real people, ready to talk. Not therapy — just company."_ The disclaimer is explicit rather than merely absent. |
| Their screenshots do say _"Video Call for **better care**"_ — care-adjacent language while sitting in Lifestyle.     | Noted, not copied. "Care" is a word a reviewer can read as a health claim. We stay on "listen" and "company".                                                                     |
| Tagline pattern: "Paid Calls & Chats / Real People / Safe & Private".                                                | We say "Real people" plainly too. Being unambiguous that these are humans is now a _safety_ asset, not just marketing — see ADR-0001.                                             |

**Their surface is bigger than ours**: chat, voice _and_ video. We ship text
only. That is a smaller product and a much smaller trust-and-safety problem;
video with strangers on a paid intimacy-adjacent app is a different risk class
entirely. Not a gap to close casually.

---

## 2. Billing — their weakness, our opening

| Observed                                                                                                                                                                                                                                            | What we did                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-minute billing** with a visible call timer.                                                                                                                                                                                                   | We bill **per message**. There is no meter, so there is nothing to run down while nobody speaks.                                                                                                                                                                                                                                                                                                     |
| Their most-upvoted negative review (83 found it helpful): _"the so-called listeners don't even reply. They just wait around so that more money can flow in as more time tocks out… even if you cancel in 15 seconds you're charged for 3 minutes."_ | This is the single most valuable thing in the research. Per-message billing avoids the meter, but a member could still pay for messages nobody answered — the same grievance in a different shape. So `refund_unanswered_messages()` in **migration 006** credits back any member message the provider has not replied to within 24h. `messages.refunded_at` makes it idempotent, asserted in pgTAP. |
| _"70% OFF on the First Session"_ promotion on the listing.                                                                                                                                                                                          | Not copied. Discounting the first session optimises for trial at the cost of making the price feel arbitrary. Our equivalent is the 50 free starting tokens, which is the same idea without a fake anchor price.                                                                                                                                                                                     |
| Per-provider pricing (₹/min varies by listener).                                                                                                                                                                                                    | **Deliberately rejected.** One token per message for everyone is an invariant with a SQL/TypeScript parity test behind it (`ledger_cases.json`). Variable pricing would break that and turn the directory into a price-comparison surface, which changes what members optimise for.                                                                                                                  |

---

## 3. The directory row

Their row carries: photo, name, **gender · age**, **★ rating · review count**, a
one-line bio, a price, and a TALK NOW button. Ours carried a name and
"Available now" — a member choosing between two names was choosing at random.

Rebuilt in **migration 006** + [`ProviderRow.tsx`](../src/components/ProviderRow.tsx):

| Field                       | Note                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name + avatar initial       | No photos yet. Photo upload means a media permission and a moderation queue for images; not now.                                                                                                                                                                                                                         |
| **Gender · age**            | `age` is computed in the `provider_directory` view. `date_of_birth` is stored but **never exposed** — a birth date is a re-identification key, an age is a fact.                                                                                                                                                         |
| **★ rating · review count** | New `reviews` table, one review per conversation, member-only. `rating_avg`/`rating_count` are denormalised onto `profiles` by trigger because the directory is the hottest read in the app. Count is always shown next to the average — "5.0" from two reviews is noise dressed as signal.                              |
| **Headline**                | One line, 140 chars. Their bio line does real work; ours had nothing.                                                                                                                                                                                                                                                    |
| **Languages**               | Not on their row, but obviously load-bearing in the launch market.                                                                                                                                                                                                                                                       |
| **`replies in ~Nm`**        | _Our addition, and the direct answer to their worst review._ `median_reply_seconds`, refreshed by `refresh_reply_latencies()`. Median, not mean, so one abandoned thread does not define an otherwise responsive provider. Publishing it makes responsiveness the provider's problem rather than the member's discovery. |
| ~~Price~~                   | Omitted — see above.                                                                                                                                                                                                                                                                                                     |

Reputation columns are **not client-writable**: the guard trigger rejects a
provider writing their own `rating_avg`, `rating_count` or
`median_reply_seconds`. Reputation is derived or it is worthless.

---

## 4. Supply onboarding — the most instructive review of all

| Observed                                                                                                                                                                                                                                                                                                                                                 | What we did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **listener** wrote: _"I registered as a Listener after being shortlisted and selected… my account has remained unverified for over 2 weeks. I have contacted User Support several times. My profile still shows 'Unverified Listener', 'Profile Under Review', 'Something Missing'. I'm eager to start working. Please let me know what is required."_ | This is supply churning **in public, under the listing demand also reads**. The fix is not faster review — it is telling people the truth continuously. Migration 006 gives applications a real status enum (`draft / submitted / under_review / needs_info / approved / rejected`) and a **structured `missing_fields` array**. [`ProviderStatusScreen`](../src/screens/ProviderStatusScreen.tsx) renders every state with what it means and what happens next; **no state is a dead end**. `needs_info` names the exact fields and the applicant resubmits alone, without contacting support. |
| The developer's reply: _"We accept 2% of the total applications that we receive."_                                                                                                                                                                                                                                                                       | Heavy curation is the model, and it is defensible — but 98% of applicants get an outcome, and that outcome should be legible. `reject_provider_application()` records a reviewer note the applicant can read.                                                                                                                                                                                                                                                                                                                                                                                   |
| Completeness checking appears to happen after submission, out of band.                                                                                                                                                                                                                                                                                   | `submit_provider_application()` computes what is missing **server-side, at submission**, and returns the list so the form marks the inputs immediately. An incomplete application stays a `draft` rather than silently entering a queue.                                                                                                                                                                                                                                                                                                                                                        |
| Listeners hold multiple roles: _"listener, counsellor and numerologist"_.                                                                                                                                                                                                                                                                                | **Not copied.** "Counsellor" and "numerologist" are exactly the claims that would move us from Lifestyle toward Health, or toward a consumer-protection problem. One role: someone who listens.                                                                                                                                                                                                                                                                                                                                                                                                 |
| Their positive reviews are almost entirely about money: _"this app has not only helped me improve my finances…"_                                                                                                                                                                                                                                         | Supply stays for earnings, so earnings must be visible. `provider_earnings` view + [`ProviderHomeScreen`](../src/screens/ProviderHomeScreen.tsx) shows messages, people served, rating and waiting threads. Counted in **tokens, not currency** — showing a rupee figure we cannot yet pay out would be a lie. Stripe Connect is unbuilt.                                                                                                                                                                                                                                                       |
| No visible availability control in the listing.                                                                                                                                                                                                                                                                                                          | Availability is the first control on the provider home screen, because it is the only one with an immediate effect on whether anyone can reach them.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The provider home screen also surfaces refunded messages back to the provider:
_"N messages went unanswered and were refunded. Replying, even briefly, is what
earns."_ The incentive is stated rather than implied.

---

## 5. Age and identity

Nothing in Clarity's listing shows an age gate. We treat it as non-negotiable:

- `date_of_birth` on `profiles`, **write-once** — the guard trigger refuses to
  change it after it is set, so an applicant cannot pass review and then edit it.
- A **CHECK constraint** (`provider_is_adult`) makes an underage provider
  unrepresentable. Not a form field, not a function check: there is no route to
  one, including a manual `UPDATE` by an operator in a hurry. pgTAP asserts that
  even `service_role` cannot promote a minor.
- The client checks too, so a 17-year-old is told at the date field rather than
  after filling in six others. Client-side is a courtesy; the constraint is the
  rule.

Still missing: **real KYC**. `identity_verified_at` is set by the approval
function, not by a vendor. A document check (Persona, Veriff, Stripe Identity) is
a launch requirement.

---

## 6. Data safety

Their Play declaration reads oddly — "may share Financial info with third
parties" alongside "No data collected". Ours is narrower and we intend to keep it
that way: `INTERNET` and `VIBRATE`, no advertising ID, no analytics SDK, and
telemetry in a first-party table that a trigger prevents from carrying message
content.

---

## 7. What we are deliberately not taking

- **Voice and video.** Bigger surface, far bigger safety problem.
- **Per-minute billing.** It is the mechanism behind their worst reviews.
- **"Counsellor" / "numerologist" role labels.** Category risk for no product gain.
- **First-session discount.** Trial optimisation that makes the price look invented.
- **Per-provider pricing.** Breaks a tested invariant; changes what members optimise for.

---

## Open questions this research did not answer

1. **Play Billing.** Clarity charges for a service delivered by a person. Whether
   that is exempt from Play Billing's cut, or not, decides the unit economics. It
   cannot be inferred from the listing and should be answered by policy.
2. **How they handle minor safety.** Nothing observable. Ours is a first-class
   report reason that sorts ahead of everything else in the queue.
3. **Retention.** 10M installs and 92K reviews says acquisition works; nothing in
   the listing says whether conversations continue past the first session. Our
   inbox and reply-latency work both bet that they should.

---

## 8. How they take money — and why they are not a safe precedent

Checked empirically on 2026-08-20 against their live Play listing:

| Signal                   | Clarity                                                               | Spotify (control) |
| ------------------------ | --------------------------------------------------------------------- | ----------------- |
| `In-app purchases` label | **absent**                                                            | present           |
| `Contains ads` label     | absent                                                                | present           |
| Data safety              | _"may share these data types with third parties: **Financial info**"_ | —                 |

The control matters: the same detector finds the label on an app that certainly
uses Play Billing, so Clarity's absence is a real negative rather than a scraping
artefact. Google adds that label automatically when an app has IAP products
configured.

**Conclusion: they are almost certainly charging outside Google Play Billing**, via
an Indian payment gateway — which is what "shares Financial info with third
parties" implies. Their coins are bought with a card or UPI, not through Play.

**Do not treat this as a compliance precedent.** Under
[Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818),
in-app "virtual currencies" and "app functionality or content" are explicitly in
the categories that _must_ use Play Billing. The real-world exemption covers
transportation, airfare, gym memberships, food delivery — physical services, not
a conversation delivered inside the app. India does allow an **alternative
billing system**, but _alongside_ Play's, with the service fee reduced by 4% —
and an app doing that would still show the IAP label.

So one of these is true, and none of them helps us:

1. They are non-compliant and have not been enforced against yet. 10M installs
   makes them a large target, not a safe one.
2. They have an arrangement or argument we cannot see, in which case it is not
   transferable.
3. The listing signal is misleading in a way the control does not suggest.

### The tension worth naming

Play's payments policy carves out **"transactions involving regulated clinical
services."** Our positioning is deliberately _non_-clinical — that is what keeps
us out of the Health category and away from medical claims (§1 above, and
ADR-0001).

That same choice keeps us **inside** Play Billing. The positioning that protects
the listing costs us the exemption. Both cannot be optimised at once, and
pretending to be a clinical service to dodge a 20% fee would be a far worse trade
than paying it — it invites a regulator instead of a platform fee.

### What this means for us

Assume **Play Billing applies** and model the economics on it. As of the
[March 2026 changes](https://android-developers.googleblog.com/2026/03/a-new-era-for-choice-and-openness.html),
the service fee and billing fee are separated: service fee starts at **10% on the
first $1M** of annual earnings, billing fee **5%** in US/EEA/UK, with other
regions — India included — **not yet published**. India's existing program still
gives a **4% reduction** when a user picks alternative billing.

The unit economics question is therefore: ~15% platform cost (optimistically, at
the new lower rates) plus payment-gateway fees plus the provider split plus TDS
and GST. Run that before building the money layer, and get Play policy support to
confirm in writing.
