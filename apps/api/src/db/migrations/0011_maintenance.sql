CREATE OR REPLACE FUNCTION prune_idempotency_keys(p_grace_seconds integer, p_limit integer)
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
  IF p_grace_seconds IS NULL OR p_grace_seconds < 0 THEN
    RAISE EXCEPTION 'grace di luar rentang: %', p_grace_seconds USING ERRCODE = '22023';
  END IF;

  WITH doomed AS (
    SELECT scope, key
    FROM idempotency_keys
    WHERE expires_at < now() - make_interval(secs => p_grace_seconds)
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM idempotency_keys k
  USING doomed d
  WHERE k.scope = d.scope AND k.key = d.key;

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION prune_idempotency_keys(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_idempotency_keys(integer, integer) TO hadir_app;