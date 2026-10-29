DROP POLICY IF EXISTS reports_read ON reports;
DROP POLICY IF EXISTS reports_write ON reports;
DROP POLICY IF EXISTS reports_insert ON reports;

CREATE POLICY reports_read ON reports
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
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
    current_scope() = 'admin'
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
  )
  WITH CHECK (
    current_scope() = 'admin'
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

CREATE POLICY reports_insert ON reports
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (current_scope() = 'citizen');

ALTER TABLE report_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_media_read ON report_media;
DROP POLICY IF EXISTS report_media_write ON report_media;
DROP POLICY IF EXISTS report_media_insert ON report_media;

CREATE POLICY report_media_read ON report_media
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'public'
      AND status = 'ready'
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.moderation = 'approved'
          AND r.status NOT IN ('draft', 'rejected', 'closed')
      )
    )
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.institution_id = current_institution()
      )
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.device_hash = current_device_hash()
      )
    )
  );

CREATE POLICY report_media_write ON report_media
  AS PERMISSIVE
  FOR UPDATE
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.institution_id = current_institution()
      )
    )
  )
  WITH CHECK (
    current_scope() = 'admin'
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.institution_id = current_institution()
      )
    )
  );

CREATE POLICY report_media_insert ON report_media
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (
    current_scope() IN ('citizen', 'admin')
  );

GRANT UPDATE (status, width, height) ON report_media TO hadir_app;
