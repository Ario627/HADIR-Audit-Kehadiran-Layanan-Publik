CREATE OR REPLACE FUNCTION current_scope()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.scope', true), 'system');
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

CREATE OR REPLACE FUNCTION is_partner_scope()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_scope() = 'partner';
$$;

REVOKE ALL ON FUNCTION current_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_institution() FROM PUBLIC;
REVOKE ALL ON FUNCTION is_partner_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_scope() TO hadir_app;
GRANT EXECUTE ON FUNCTION current_institution() TO hadir_app;
GRANT EXECUTE ON FUNCTION is_partner_scope() TO hadir_app;

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_read ON reports
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    NOT is_partner_scope()
    OR (current_institution() IS NOT NULL AND institution_id = current_institution())
  );

CREATE POLICY reports_write ON reports
  AS PERMISSIVE
  FOR UPDATE
  TO hadir_app
  USING (
    NOT is_partner_scope()
    OR (current_institution() IS NOT NULL AND institution_id = current_institution())
  )
  WITH CHECK (
    NOT is_partner_scope()
    OR (current_institution() IS NOT NULL AND institution_id = current_institution())
  );

CREATE POLICY reports_insert ON reports
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (true);
