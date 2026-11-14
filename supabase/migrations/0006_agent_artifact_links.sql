alter table public.artifacts add column logical_path text;

alter table public.specs
  add constraint specs_design_artifact_fk foreign key (design_artifact_id) references public.artifacts (id) on delete set null;

alter table public.playtest_reports
  add constraint playtest_reports_trace_artifact_fk foreign key (trace_artifact_id) references public.artifacts (id) on delete set null;
