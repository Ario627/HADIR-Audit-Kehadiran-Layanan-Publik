CREATE TABLE holiday_calendar (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  city_id uuid REFERENCES cities(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  source_url text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_holiday_scope_date UNIQUE NULLS NOT DISTINCT (city_id, holiday_date),
  CONSTRAINT ck_holiday_name CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT ck_holiday_source CHECK (char_length(source_url) BETWEEN 8 AND 500)
);

CREATE INDEX ix_holiday_date ON holiday_calendar (holiday_date);

ALTER TABLE holiday_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_read ON holiday_calendar
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (true);

CREATE POLICY holiday_write ON holiday_calendar
  AS PERMISSIVE
  FOR ALL
  TO hadir_app
  USING (current_scope() = 'admin')
  WITH CHECK (current_scope() = 'admin');

GRANT SELECT ON holiday_calendar TO hadir_app;
GRANT INSERT, UPDATE, DELETE ON holiday_calendar TO hadir_app;

ALTER TABLE report_appeals
  ADD COLUMN decision_due timestamp with time zone;

UPDATE report_appeals
SET decision_due = created_at + interval '14 days'
WHERE decision_due IS NULL;

ALTER TABLE report_appeals
  ALTER COLUMN decision_due SET NOT NULL,
  ADD CONSTRAINT ck_appeal_decision_due CHECK (decision_due > created_at);

CREATE INDEX ix_appeal_due ON report_appeals (decision_due)
  WHERE status IN ('submitted', 'admitted');

UPDATE report_media SET status = 'approved' WHERE status = 'ready';

CREATE TYPE media_status_v2 AS ENUM (
  'pending',
  'quarantined',
  'approved',
  'rejected',
  'deleted'
);

ALTER TABLE report_media DROP CONSTRAINT IF EXISTS ck_report_media_status;
DROP POLICY IF EXISTS report_media_read ON report_media;
DROP POLICY IF EXISTS report_media_write ON report_media;
DROP POLICY IF EXISTS report_media_insert ON report_media;

ALTER TABLE report_media
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE media_status_v2 USING status::text::media_status_v2,
  ALTER COLUMN status SET DEFAULT 'pending'::media_status_v2;

DROP TYPE media_status;

ALTER TYPE media_status_v2 RENAME TO media_status;

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
          AND (
            r.institution_id = current_institution()
            OR EXISTS (
              SELECT 1 FROM report_panel_grants g
              WHERE g.report_id = r.id
                AND g.institution_id = current_institution()
                AND g.status = 'active'
            )
          )
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

CREATE POLICY report_media_insert ON report_media
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (
    current_scope() = 'admin'
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
  USING (current_scope() = 'admin')
  WITH CHECK (current_scope() = 'admin');
