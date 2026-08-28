-- ===========================================================================
-- 025  Validate voice_peaks element values, not just array length
-- ===========================================================================
-- 023 bounded voice_peaks by LENGTH (1..64) but not by VALUE. `real[]` accepts
-- NaN, ±Infinity, and any magnitude, and voice_peaks is CLIENT-SUPPLIED
-- (p_voice_peaks on send_message). A modified client could store malformed
-- peaks that the recipient's Waveform then renders. The honest recorder already
-- clamps every sample to [0..1] (src/lib/voice.ts normaliseDb → Math.min(1,
-- Math.max(0, …))), so this constraint rejects nothing a real recording
-- produces — it only closes the door on hand-crafted values.
--
-- (Defense-in-depth: Waveform.tsx also clamps at render, so a pre-025 row can't
-- deform the UI either.)

-- An amplitude array is valid when it is null, or has 1..64 elements each of
-- which is finite and within [0, 1]. `x <> x` is the NaN test (NaN is the only
-- value not equal to itself); the range test catches ±Infinity as well as plain
-- out-of-bounds. IMMUTABLE so a CHECK constraint may call it.
create or replace function public.voice_peaks_ok(p real[])
returns boolean
language sql
immutable
as $$
  select p is null
    or (
      array_length(p, 1) between 1 and 64
      and not exists (
        select 1 from unnest(p) as x
        where x is null or x <> x or x < 0 or x > 1
      )
    )
$$;

-- Restated whole, as 023/014 did, so the full invariant reads in one place. The
-- only change from 023 is the voice branch: the inline length check becomes
-- `voice_peaks_ok(voice_peaks)`, which folds in the value validation.
alter table public.messages
  drop constraint if exists message_carries_one_payload;

alter table public.messages
  add constraint message_carries_one_payload check (
    (
      body is not null
      and length(btrim(body)) > 0
      and length(body) <= 4000
      and voice_path is null
      and voice_duration_ms is null
      and attachment_path is null
      and voice_peaks is null
    )
    or (
      body is null
      and voice_path is not null
      and voice_duration_ms between 1000 and 180000
      and attachment_path is null
      and public.voice_peaks_ok(voice_peaks)
    )
    or (
      body is null
      and voice_path is null
      and voice_duration_ms is null
      and attachment_path is not null
      and attachment_type = 'image'
      and attachment_width > 0
      and attachment_height > 0
      and voice_peaks is null
    )
  );
