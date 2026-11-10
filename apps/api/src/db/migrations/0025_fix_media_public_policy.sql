DROP POLICY IF EXISTS report_media_read ON report_media;

CREATE POLICY report_media_read ON report_media
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'public'
      AND status = 'approved'
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
