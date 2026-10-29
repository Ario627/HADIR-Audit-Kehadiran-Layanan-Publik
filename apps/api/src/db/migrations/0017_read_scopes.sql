DROP POLICY IF EXISTS reports_read ON reports;
DROP POLICY IF EXISTS reports_write ON reports;
DROP POLICY IF EXISTS reports_insert ON reports;
DROP POLICY IF EXISTS reports_partner_scoped ON reports;
DROP POLICY IF EXISTS reports_partner_writes ON reports;
DROP POLICY IF EXISTS reports_citizen_read ON reports;
DROP POLICY IF EXISTS reports_citizen_write ON reports;
DROP POLICY IF EXISTS reports_insert_open ON reports;

CREATE OR REPLACE FUNCTION current_scope()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.scope', true), 'none');
$$;

CREATE OR REPLACE FUNCTION current_institution()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.institution_id', true), '') = '' THEN NULL
    ELSE current_setting('app.institution_id', true)::uuid
  END;
$$;

CREATE OR REPLACE FUNCTION current_device_hash()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.device_hash', true), '') = '' THEN NULL
    ELSE current_setting('app.device_hash', true)
  END;
$$;

REVOKE ALL ON FUNCTION current_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_institution() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_device_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_scope() TO hadir_app;
GRANT EXECUTE ON FUNCTION current_institution() TO hadir_app;
GRANT EXECUTE ON FUNCTION current_device_hash() TO hadir_app;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_read ON reports
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    (
      current_scope() = 'public'
      AND moderation = 'approved'
      AND status NOT IN ('draft', 'rejected', 'closed')
    )
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND institution_id = current_institution()
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND device_hash = current_device_hash()
    )
  );

CREATE POLICY reports_write ON reports
  AS PERMISSIVE
  FOR UPDATE
  TO hadir_app
  USING (
    (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND institution_id = current_institution()
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND device_hash = current_device_hash()
    )
  )
  WITH CHECK (
    (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND institution_id = current_institution()
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND device_hash = current_device_hash()
    )
  );

CREATE POLICY reports_insert ON reports
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (current_scope() = 'citizen');