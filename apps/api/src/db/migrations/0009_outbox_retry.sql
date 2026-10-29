ALTER TABLE outbox
  ADD COLUMN available_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN last_error text;

CREATE INDEX ix_outbox_ready
  ON outbox (available_at, created_at)
  WHERE processed_at IS NULL;

GRANT UPDATE (available_at, last_error) ON outbox TO hadir_app;