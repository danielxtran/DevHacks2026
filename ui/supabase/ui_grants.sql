-- Grant table privileges on the new ui_* tables to the Supabase API roles.
-- This project does not auto-grant to the API roles on newly created tables,
-- so the REST API (anon / service_role) gets "permission denied" without this.
--
-- RLS still governs row visibility; these GRANTs are the table-level gate that
-- must also be open. Safe to re-run.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.ui_issue_meta,
  public.ui_source_status,
  public.ui_ingest
to anon, authenticated, service_role;

-- ui_ingest uses an integer PK (no sequence), and ui_* PKs are supplied by the
-- client, so no sequence grants are required. If that changes, also:
--   grant usage, select on all sequences in schema public to anon, authenticated, service_role;
