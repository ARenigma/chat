-- pgTAP: every literal a function writes is one its CHECK constraint permits.
--
-- ===========================================================================
-- WHY THIS FILE IS GENERIC AND THE OTHERS ARE NOT
-- ===========================================================================
-- Two outages in one day, 2026-09-08, and one shape:
--
--   089  assign_call_media_backend wrote calls.media_assignment_kind :=
--        'default' while the live constraint still permitted only
--        sticky|harness. Every outgoing call raised 23514.
--   091  start_call writes paid_sessions.end_reason = 'upgraded_to_call',
--        which the constraint has never permitted. Every chat->call and
--        audio->video upgrade raised 23514, from 073 onward.
--
-- 390 and 410 each pin ONE of those pairs. That is the right test to write
-- after an outage and the wrong test to rely on before one: 091's value was
-- introduced by 073 and carried forward by 074, 076 and 079 — four migrations,
-- each written, reviewed and merged with the whole suite green, because no test
-- compared what a function writes against what its column allows.
--
-- So this file asserts the RELATIONSHIP rather than any instance of it. It
-- reads the allowed set out of `pg_get_constraintdef` and the written literals
-- out of `pg_proc.prosrc`, and fails if the second is not a subset of the
-- first. New columns and new writers are covered the day they are added,
-- without anybody remembering to come back here.
--
-- ---------------------------------------------------------------------------
-- WHAT IT UNDERSTANDS, AND WHAT IT DOES NOT
-- ---------------------------------------------------------------------------
-- Two write shapes, chosen because they are the two that broke:
--
--   UPDATE   `update public.<table> ... <col> = '<literal>'`, scoped to the
--            statement (up to the next semicolon) so that a function updating
--            two tables is not credited with the wrong one. This matters here:
--            `calls.end_reason` and `paid_sessions.end_reason` are DIFFERENT
--            columns with DIFFERENT allowed sets, and a name-only scan would
--            report every call hang-up as a paid-session violation.
--
--   TRIGGER  `new.<col> := '<literal>'`, attributed to the table the trigger
--            is actually attached to. This is 089's exact shape.
--
-- Not understood, and deliberately: INSERT column/value lists (positional, so
-- matching a literal to a column needs a parser, not a regex), values built by
-- concatenation or `case` into a variable, and anything passed in as a
-- parameter. A miss here is a false NEGATIVE — this file can fail to notice a
-- violation, and cannot invent one. That asymmetry is the point: a generic
-- check that cried wolf would be switched off within a week, and 030's own
-- history says an ignored check is worse than no check.
--
-- It also only looks at constraints written as `= ANY (ARRAY[...])`, which is
-- how Postgres renders `col in ('a','b')`. Range and boolean checks have no
-- literal set to compare against.
-- ===========================================================================

begin;
select plan(2);

create temporary view constraint_allowed as
select
  cls.relname::text                            as tbl,
  att.attname::text                            as col,
  lit[1]                                       as allowed
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_attribute att
  on att.attrelid = con.conrelid
 and att.attnum   = con.conkey[1]
cross join lateral regexp_matches(
  pg_get_constraintdef(con.oid), '''([^'']+)''', 'g'
) as lit
where con.contype = 'c'
  and con.connamespace = 'public'::regnamespace
  and array_length(con.conkey, 1) = 1
  and pg_get_constraintdef(con.oid) like '%ANY (ARRAY[%';

-- The (table, column) pairs that have a literal allow-list at all.
create temporary view constrained_column as
select distinct tbl, col from constraint_allowed;

-- ---------------------------------------------------------------------------
-- Writers, shape 1: UPDATE ... SET col = 'literal', scoped per statement.
-- ---------------------------------------------------------------------------
create temporary view written_by_update as
select
  cc.tbl,
  cc.col,
  pro.proname::text as writer,
  lit[1]            as written
from constrained_column cc
join pg_proc pro on pro.pronamespace = 'public'::regnamespace
cross join lateral regexp_matches(
  pro.prosrc,
  'update\s+(?:public\.)?' || cc.tbl || '\M[^;]*?\m' || cc.col || '\s*=\s*''([^'']+)''',
  'gi'
) as lit;

-- ---------------------------------------------------------------------------
-- Writers, shape 2: a BEFORE trigger assigning new.col := 'literal'. The table
-- comes from the trigger, not from the text, which is what makes it reliable.
-- ---------------------------------------------------------------------------
create temporary view written_by_trigger as
select
  cc.tbl,
  cc.col,
  pro.proname::text as writer,
  lit[1]            as written
from constrained_column cc
join pg_class cls on cls.relname = cc.tbl
join pg_trigger trg on trg.tgrelid = cls.oid and not trg.tgisinternal
join pg_proc pro on pro.oid = trg.tgfoid
cross join lateral regexp_matches(
  pro.prosrc, '\mnew\.' || cc.col || '\s*:=\s*''([^'']+)''', 'gi'
) as lit;

create temporary view violation as
select w.tbl, w.col, w.writer, w.written
from (
  select * from written_by_update
  union
  select * from written_by_trigger
) w
where not exists (
  select 1 from constraint_allowed a
  where a.tbl = w.tbl and a.col = w.col and a.allowed = w.written
);

-- ---------------------------------------------------------------------------
-- 1. THE ASSERTION. Any row here is a function that will raise 23514 the
--    moment its branch is reached.
-- ---------------------------------------------------------------------------
select is_empty(
  $$select tbl || '.' || col || ' <- ' || writer || '() writes ' || quote_literal(written)
      from violation order by 1$$,
  'every literal written into a CHECK-constrained column is permitted by it'
);

-- ---------------------------------------------------------------------------
-- 2. The check is not vacuous. If the extraction ever stops finding writers —
--    a regex that no longer matches, a renamed catalog column — assertion 1
--    passes by knowing nothing, which is the failure mode of every generic
--    test. So: prove it still sees the two writers the outages came from.
--
--    `assign_call_media_backend` writing 'default' (089's trigger) and
--    `start_call` writing 'upgraded_to_call' (091's update) are both found by
--    the machinery above, and both are now legal. If either disappears from
--    this count, the extraction is broken and assertion 1 means nothing.
-- ---------------------------------------------------------------------------
select is(
  (
    select count(*)::int from (
      select * from written_by_update
      union
      select * from written_by_trigger
    ) w
    where (w.writer = 'assign_call_media_backend' and w.written = 'default')
       or (w.writer = 'start_call' and w.written = 'upgraded_to_call')
  ),
  2,
  'the extraction still finds both writers the 2026-09-08 outages came from'
);

select * from finish();
rollback;
