CREATE INDEX ix_reports_institution_cursor
  ON reports (institution_id, created_at DESC, id DESC)
  WHERE institution_id IS NOT NULL;
