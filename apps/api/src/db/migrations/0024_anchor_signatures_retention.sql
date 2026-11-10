ALTER TABLE anchor_log
  ADD COLUMN signature bytea,
  ADD COLUMN signature_algorithm text,
  ADD COLUMN signing_key_id text,
  ADD COLUMN public_key bytea,
  ADD COLUMN signed_at timestamp with time zone;

ALTER TABLE anchor_log
  ADD CONSTRAINT ck_anchor_log_signature_bytes
    CHECK (signature IS NULL OR octet_length(signature) = 64),
  ADD CONSTRAINT ck_anchor_log_public_key_bytes
    CHECK (public_key IS NULL OR octet_length(public_key) = 32),
  ADD CONSTRAINT ck_anchor_log_algorithm
    CHECK (signature_algorithm IS NULL OR signature_algorithm IN ('ed25519')),
  ADD CONSTRAINT ck_anchor_log_key_id
    CHECK (signing_key_id IS NULL OR char_length(signing_key_id) BETWEEN 1 AND 64),
  ADD CONSTRAINT ck_anchor_log_signature_complete
    CHECK (
      (signature IS NULL AND signature_algorithm IS NULL AND signing_key_id IS NULL
        AND public_key IS NULL AND signed_at IS NULL)
      OR (signature IS NOT NULL AND signature_algorithm IS NOT NULL
        AND signing_key_id IS NOT NULL AND public_key IS NOT NULL AND signed_at IS NOT NULL)
    ),
  ADD CONSTRAINT ck_anchor_log_signed_after_window
    CHECK (signed_at IS NULL OR signed_at >= window_end);

CREATE INDEX ix_anchor_log_key ON anchor_log (signing_key_id, anchor_date DESC)
  WHERE signing_key_id IS NOT NULL;

GRANT UPDATE (signature, signature_algorithm, signing_key_id, public_key, signed_at)
  ON anchor_log TO hadir_app;

CREATE TYPE retention_action AS ENUM ('delete', 'anonymize', 'keep');

CREATE TABLE retention_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  rows_removed integer NOT NULL DEFAULT 0,
  datasets jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by text NOT NULL DEFAULT 'worker',
  error_code text,
  CONSTRAINT ck_retention_runs_rows CHECK (rows_removed >= 0),
  CONSTRAINT ck_retention_runs_trigger CHECK (triggered_by IN ('worker', 'manual', 'test')),
  CONSTRAINT ck_retention_runs_error CHECK (error_code IS NULL OR char_length(error_code) <= 80)
);

CREATE INDEX ix_retention_runs_started ON retention_runs (started_at DESC);

CREATE TABLE retention_overrides (
  dataset text PRIMARY KEY NOT NULL,
  retention_days integer NOT NULL,
  reason text NOT NULL,
  updated_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_retention_overrides_dataset CHECK (dataset ~ '^[a-z][a-z0-9_.]{2,63}$'),
  CONSTRAINT ck_retention_overrides_days CHECK (retention_days BETWEEN 1 AND 3650),
  CONSTRAINT ck_retention_overrides_reason CHECK (char_length(reason) BETWEEN 10 AND 400)
);

REVOKE ALL ON retention_runs FROM PUBLIC;
REVOKE ALL ON retention_overrides FROM PUBLIC;
REVOKE ALL ON retention_runs FROM hadir_app;
REVOKE ALL ON retention_overrides FROM hadir_app;

GRANT SELECT, INSERT ON retention_runs TO hadir_app;
GRANT UPDATE (finished_at, rows_removed, datasets, error_code) ON retention_runs TO hadir_app;
GRANT SELECT ON retention_overrides TO hadir_app;
GRANT INSERT ON retention_overrides TO hadir_app;
GRANT UPDATE (retention_days, reason, updated_by, updated_at) ON retention_overrides TO hadir_app;

CREATE OR REPLACE FUNCTION purge_expired_uploads(p_cutoff timestamp with time zone, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'limit di luar rentang: %', p_limit USING ERRCODE = '22023';
  END IF;
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'cutoff wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_cutoff > now() THEN
    RAISE EXCEPTION 'cutoff tidak boleh di masa depan: %', p_cutoff USING ERRCODE = '22023';
  END IF;

  WITH doomed AS (
    SELECT id
    FROM uploads
    WHERE created_at < p_cutoff
      AND status IN ('pending', 'rejected', 'stored', 'attached')
      AND report_id IS NULL
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM uploads u
  USING doomed d
  WHERE u.id = d.id;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_uploads(timestamp with time zone, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_uploads(timestamp with time zone, integer) TO hadir_app;

CREATE OR REPLACE FUNCTION purge_expired_exports(p_cutoff timestamp with time zone, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'limit di luar rentang: %', p_limit USING ERRCODE = '22023';
  END IF;
  IF p_cutoff IS NULL THEN
    RAISE EXCEPTION 'cutoff wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_cutoff > now() THEN
    RAISE EXCEPTION 'cutoff tidak boleh di masa depan: %', p_cutoff USING ERRCODE = '22023';
  END IF;

  WITH doomed AS (
    SELECT id
    FROM exports
    WHERE created_at < p_cutoff
      AND status IN ('queued', 'running', 'ready', 'failed', 'expired')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM exports e
  USING doomed d
  WHERE e.id = d.id;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_exports(timestamp with time zone, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_exports(timestamp with time zone, integer) TO hadir_app;

CREATE OR REPLACE FUNCTION prune_retention_runs(p_keep integer, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_keep IS NULL OR p_keep < 1 OR p_keep > 100000 THEN
    RAISE EXCEPTION 'keep di luar rentang: %', p_keep USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'limit di luar rentang: %', p_limit USING ERRCODE = '22023';
  END IF;

  WITH doomed AS (
    SELECT id FROM retention_runs
    ORDER BY started_at DESC
    OFFSET p_keep
    LIMIT p_limit
  )
  DELETE FROM retention_runs r
  USING doomed d
  WHERE r.id = d.id;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION prune_retention_runs(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_retention_runs(integer, integer) TO hadir_app;
