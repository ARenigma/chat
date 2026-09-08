-- The schema, as a stable sorted text rendering.
--
-- Catalog queries rather than pg_dump: pg_dump's output carries version banners,
-- SET statements and ordering that shift between server builds, so a snapshot of
-- it produces diffs that are about the dumper rather than about the schema.
-- These queries name exactly the facts a migration can change.
\pset tuples_only on
\pset format unaligned
\pset fieldsep ' | '

select 'COLUMN ' || table_name || '.' || column_name || ' ' || data_type
       || case when character_maximum_length is not null
               then '(' || character_maximum_length || ')' else '' end
       || ' null=' || is_nullable
       || ' default=' || coalesce(column_default, '-')
from information_schema.columns
where table_schema = 'public'
order by table_name, column_name;

select 'INDEX ' || indexname || ' ' || regexp_replace(indexdef, '\s+', ' ', 'g')
from pg_indexes where schemaname = 'public'
order by indexname;

select 'CONSTRAINT ' || conrelid::regclass::text || '.' || conname || ' '
       || regexp_replace(pg_get_constraintdef(oid), '\s+', ' ', 'g')
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

select 'FUNCTION ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       || ' returns ' || pg_get_function_result(p.oid)
       || ' security=' || case when p.prosecdef then 'definer' else 'invoker' end
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname, pg_get_function_identity_arguments(p.oid);

select 'POLICY ' || schemaname || '.' || tablename || '.' || policyname
       || ' cmd=' || cmd || ' roles=' || array_to_string(roles, ',')
from pg_policies where schemaname = 'public'
order by tablename, policyname;

select 'RLS ' || relname || ' enabled=' || relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

select 'TRIGGER ' || c.relname || '.' || t.tgname
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
order by c.relname, t.tgname;

select 'ENUM ' || t.typname || ' = ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
group by t.typname
order by t.typname;
