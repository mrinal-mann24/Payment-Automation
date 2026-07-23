alter table renewal_jobs
  add column if not exists periskope_skip_reason text;
