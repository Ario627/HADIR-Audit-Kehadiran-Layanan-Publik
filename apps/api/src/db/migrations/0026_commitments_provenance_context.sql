CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE commitment_kind AS ENUM ('headway', 'span', 'reliability', 'other');
CREATE TYPE commitment_status AS ENUM ('draft', 'verified', 'superseded', 'revoked');
CREATE TYPE commitment_day_scope AS ENUM ('all', 'weekday', 'weekend', 'holiday');
CREATE TYPE incident_impact AS ENUM ('none', 'minor', 'major', 'service_stopped');

CREATE TABLE service_commitments (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  route_id uuid REFERENCES routes(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES stops(id) ON DELETE CASCADE,
  kind commitment_kind NOT NULL DEFAULT 'headway',
  day_scope commitment_day_scope NOT NULL DEFAULT 'all',
  headway_min numeric(6, 2),
  span_start time without time zone,
  span_end time without time zone,
  source_document_url text NOT NULL,
  source_document_title text,
  source_document_version text,
  valid_from date NOT NULL,
  valid_until date,
  status commitment_status NOT NULL DEFAULT 'draft',
  verified_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  verified_at timestamp with time zone,
  superseded_by uuid REFERENCES service_commitments(id) ON DELETE SET NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_commitment_scope CHECK (route_id IS NOT NULL OR stop_id IS NOT NULL),
  CONSTRAINT ck_commitment_window CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CONSTRAINT ck_commitment_headway CHECK (
    kind <> 'headway' OR (headway_min IS NOT NULL AND headway_min > 0 AND headway_min <= 240)
  ),
  CONSTRAINT ck_commitment_span CHECK (
    kind <> 'span' OR (span_start IS NOT NULL AND span_end IS NOT NULL AND span_start < span_end)
  ),
  CONSTRAINT ck_commitment_url CHECK (char_length(source_document_url) BETWEEN 8 AND 500),
  CONSTRAINT ck_commitment_version CHECK (
    source_document_version IS NULL OR char_length(source_document_version) BETWEEN 1 AND 80
  ),
  CONSTRAINT ck_commitment_title CHECK (
    source_document_title IS NULL OR char_length(source_document_title) BETWEEN 1 AND 200
  ),
  CONSTRAINT ck_commitment_notes CHECK (notes IS NULL OR char_length(notes) <= 1000),
  CONSTRAINT ck_commitment_verified CHECK (
    status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT ck_commitment_revoked CHECK (status <> 'revoked' OR notes IS NOT NULL)
);

ALTER TABLE service_commitments
  ADD CONSTRAINT ex_commitment_overlap
  EXCLUDE USING gist (
    COALESCE(route_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    COALESCE(stop_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
    kind WITH =,
    day_scope WITH =,
    daterange(valid_from, valid_until, '[]') WITH &&
  )
  WHERE (status = 'verified');

CREATE INDEX ix_commitment_route ON service_commitments (route_id, valid_from DESC)
  WHERE status = 'verified';
CREATE INDEX ix_commitment_stop ON service_commitments (stop_id, valid_from DESC)
  WHERE status = 'verified';
CREATE INDEX ix_commitment_institution ON service_commitments (institution_id, status);
CREATE INDEX ix_commitment_validity ON service_commitments (valid_from, valid_until)
  WHERE status = 'verified';

CREATE TRIGGER trg_service_commitments_updated BEFORE UPDATE ON service_commitments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE VIEW service_commitments_public AS
SELECT
  c.id,
  c.route_id,
  c.stop_id,
  c.kind,
  c.day_scope,
  c.headway_min,
  c.span_start,
  c.span_end,
  c.source_document_url,
  c.source_document_title,
  c.source_document_version,
  c.valid_from,
  c.valid_until,
  c.status,
  c.verified_at,
  c.superseded_by,
  c.created_at,
  c.updated_at,
  i.name AS institution_name
FROM service_commitments c
JOIN institutions i ON i.id = c.institution_id
WHERE c.status = 'verified';

CREATE TABLE analysis_snapshots (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  subject_kind text NOT NULL,
  subject_ref text NOT NULL,
  method_version text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  dataset_digest bytea NOT NULL,
  output_digest bytea NOT NULL,
  input_rows integer NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone NOT NULL,
  evidence_level text NOT NULL,
  direction text NOT NULL,
  warnings text[] NOT NULL DEFAULT '{}'::text[],
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_analysis_snapshot UNIQUE (subject_kind, subject_ref, method_version, dataset_digest),
  CONSTRAINT ck_analysis_subject_kind CHECK (subject_kind IN ('stop_estimate', 'route_coverage')),
  CONSTRAINT ck_analysis_subject_ref CHECK (char_length(subject_ref) BETWEEN 1 AND 80),
  CONSTRAINT ck_analysis_method CHECK (char_length(method_version) BETWEEN 1 AND 40),
  CONSTRAINT ck_analysis_digest CHECK (octet_length(dataset_digest) = 32 AND octet_length(output_digest) = 32),
  CONSTRAINT ck_analysis_rows CHECK (input_rows >= 0),
  CONSTRAINT ck_analysis_window CHECK (window_start < window_end),
  CONSTRAINT ck_analysis_evidence CHECK (evidence_level IN ('none', 'indication', 'strong', 'field_verified')),
  CONSTRAINT ck_analysis_direction CHECK (direction IN ('excess', 'no_excess', 'inconclusive'))
);

CREATE INDEX ix_analysis_subject ON analysis_snapshots (subject_kind, subject_ref, computed_at DESC);
CREATE INDEX ix_analysis_computed ON analysis_snapshots (computed_at DESC);

ALTER TABLE notices
  ADD COLUMN impact incident_impact NOT NULL DEFAULT 'minor',
  ADD COLUMN public_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN acknowledged_at timestamp with time zone,
  ADD COLUMN acknowledged_by uuid REFERENCES institutions(id) ON DELETE SET NULL;

ALTER TABLE notices
  ADD CONSTRAINT ck_notices_ack CHECK (
    (acknowledged_at IS NULL AND acknowledged_by IS NULL)
    OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)
  );

CREATE INDEX ix_notices_public ON notices (starts_at DESC, ends_at DESC)
  WHERE public_visible;

CREATE VIEW notices_public AS
SELECT
  n.id,
  n.kind,
  n.city_id,
  n.stop_id,
  n.route_id,
  n.text,
  n.source_url,
  n.starts_at,
  n.ends_at,
  n.impact,
  n.acknowledged_at,
  n.created_at,
  i.name AS institution_name
FROM notices n
LEFT JOIN institutions i ON i.id = n.institution_id
WHERE n.public_visible;

REVOKE ALL ON service_commitments FROM PUBLIC;
REVOKE ALL ON service_commitments FROM hadir_app;
REVOKE ALL ON service_commitments_public FROM PUBLIC;
REVOKE ALL ON analysis_snapshots FROM PUBLIC;
REVOKE ALL ON analysis_snapshots FROM hadir_app;
REVOKE ALL ON notices_public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON service_commitments TO hadir_app;
GRANT SELECT ON service_commitments_public TO hadir_app;
GRANT SELECT, INSERT ON analysis_snapshots TO hadir_app;
GRANT SELECT ON notices_public TO hadir_app;
GRANT UPDATE (impact, public_visible, acknowledged_at, acknowledged_by) ON notices TO hadir_app;
