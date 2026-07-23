alter table renewal_jobs
  add column if not exists reminder_1_sent_at timestamptz,
  add column if not exists reminder_2_sent_at timestamptz,
  add column if not exists reminder_3_sent_at timestamptz,
  add column if not exists reminder_skip_reason text;
