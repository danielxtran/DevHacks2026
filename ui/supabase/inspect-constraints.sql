-- Show the CHECK constraints and column types on the existing `issues` table,
-- so the push script can map target_type (and anything else constrained) to
-- allowed values. Read-only.

select con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public' and rel.relname = 'issues'
order by con.conname;

-- Enum values for the enum-typed columns on issues.
select t.typname as enum_type, e.enumlabel as value
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typname in ('claim_type','verdict_type')
order by t.typname, e.enumsortorder;
