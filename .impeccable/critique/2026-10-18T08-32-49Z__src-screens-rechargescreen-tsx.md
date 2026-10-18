---
target: recharge sheet
total_score: 22
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 2
timestamp: 2026-10-18T08-32-49Z
slug: src-screens-rechargescreen-tsx
---

Method: dual-agent (A: design review · B: detector)

Heuristics: 1 Status 3 · 2 Real world 2 · 3 Control 3 · 4 Consistency 2 · 5 Error prevention 3 · 6 Recognition 4 · 7 Flexibility n/a · 8 Minimalist 2 · 9 Error recovery 1 · 10 Help 2 → 22/36.

Specificity: generic — any top-up grid; only the coral is Pappal. Dead because it is all extremes: one glaring white slab (13.7:1), one coral block, cards at 1.09:1 to the sheet.

Detector: 0 findings (regex rules target web CSS; weak signal for RN).

P1 Balance slab bg/inverse #E9E9E9 dominates; balance has 3 colours across app. Fix: bg/raised + text/available green + wallet glyph.
P1 Cancelled payment shows "Payment failed … (action_cancelled)" in danger with callEnd icon, then "No refunds". Fix: map cancel codes to "Payment not completed. No money was taken." neutral info; danger only for real declines; title "Pay ₹354".
P2 GST lines text/tertiary 3.31:1 on card. Fix: text/secondary or one "+18% GST" footnote.
P2 Coral overloaded (selected card, Best value ribbon, Pay, Back link). Fix: selected = accentTint + 2dp accent border; solid coral only for Pay; drop "Back" link.
P2 "Best value" on ₹5,000 is unearned (flat 18%, no bonus; hard-coded last pack); "Popular" hard-coded. Fix: remove or back with a real bonus.
P3 Unselected card outline 1.40:1. Fix: fill-only cards on bg/selected.
Motion: no state transition on selection; success is quiet (burst now added); no minutes shown.

Personas: first-time UPI payer panics at "failed + No refunds"; cost-conscious user distrusts "Best value"; low-vision user loses GST lines and gets glare.
