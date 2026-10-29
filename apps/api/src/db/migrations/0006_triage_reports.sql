CREATE TYPE evidence_level AS ENUM ('none', 'indication', 'strong', 'field_verified');
CREATE TYPE source_tier AS ENUM ('T1', 'T2', 'T3', 'T4');
CREATE TYPE institution_kind AS ENUM ('dinhub', 'dishub', 'pupr', 'diskominfo', 'operator', 'other');
CREATE TYPE notice_kind AS ENUM ('detour', 'repair', 'suspension', 'schedule', 'other');
CREATE TYPE triage_verdict AS ENUM ('join', 'already_planned', 'wrong_authority', 'service_not_running', 'data_supports', 'data_insufficient', 'new_report');
CREATE TYPE experiment_arm AS ENUM ('control', 'triage');
CREATE TYPE report_category AS ENUM ('service_wait', 'service_no_show', 'service_full', 'stop_facility', 'stop_cleanliness', 'stop_safety', 'route_info', 'accessibility', 'other');
CREATE TYPE report_status AS ENUM ('draft', 'submitted', 'triaged', 'acknowledged', 'in_progress', 'claimed_resolved', 'verified_resolved', 'disputed', 'rejected', 'closed');
CREATE TYPE moderation_status AS ENUM ('pending', 'approved', 'rejected', 'quarantined');
CREATE TYPE report_event_kind AS ENUM ('submitted', 'triaged', 'acknowledged', 'info_requested', 'scheduled', 'responded', 'claimed_resolved', 'verified_resolved', 'disputed', 'rejected', 'moderated', 'corrected');
CREATE TYPE closure_answer AS ENUM ('yes', 'no', 'partial');
CREATE TYPE media_status AS ENUM ('pending', 'ready', 'quarantined', 'deleted');

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  city_id uuid REFERENCES cities(id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind institution_kind NOT NULL DEFAULT 'other',
  official_site_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_institutions_name_length CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT ck_institutions_site_length CHECK (official_site_url IS NULL OR char_length(official_site_url) <= 500)
);

CREATE INDEX ix_institutions_city ON institutions (city_id, kind);

CREATE TABLE authority_map (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  asset_kind text NOT NULL,
  asset_ref text NOT NULL,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  source_url text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_authority_map UNIQUE (city_id, asset_kind, asset_ref),
  CONSTRAINT ck_authority_asset_kind CHECK (asset_kind IN ('road', 'stop', 'route', 'terminal', 'sidewalk')),
  CONSTRAINT ck_authority_asset_ref_length CHECK (char_length(asset_ref) BETWEEN 1 AND 80),
  CONSTRAINT ck_authority_source_length CHECK (char_length(source_url) BETWEEN 1 AND 500),
  CONSTRAINT ck_authority_note_length CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX ix_authority_institution ON authority_map (institution_id);

CREATE TABLE notices (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  kind notice_kind NOT NULL,
  city_id uuid REFERENCES cities(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES stops(id) ON DELETE CASCADE,
  route_id uuid REFERENCES routes(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  text text NOT NULL,
  source_url text NOT NULL,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_notices_text_length CHECK (char_length(text) BETWEEN 1 AND 1000),
  CONSTRAINT ck_notices_source_length CHECK (char_length(source_url) BETWEEN 1 AND 500),
  CONSTRAINT ck_notices_window CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at),
  CONSTRAINT ck_notices_target CHECK (city_id IS NOT NULL OR stop_id IS NOT NULL OR route_id IS NOT NULL)
);

CREATE INDEX ix_notices_stop ON notices (stop_id, starts_at DESC);
CREATE INDEX ix_notices_route ON notices (route_id, starts_at DESC);
CREATE INDEX ix_notices_city ON notices (city_id, starts_at DESC);

CREATE TABLE evidence_items (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  claim text NOT NULL,
  tier source_tier NOT NULL,
  source_type text NOT NULL,
  source_url text,
  retrieved_at timestamp with time zone NOT NULL,
  valid_until date,
  confidence real NOT NULL DEFAULT 0.5,
  match_method text,
  match_score real,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_evidence_claim_length CHECK (char_length(claim) BETWEEN 1 AND 400),
  CONSTRAINT ck_evidence_source_type CHECK (char_length(source_type) BETWEEN 1 AND 40),
  CONSTRAINT ck_evidence_confidence CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT ck_evidence_match CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 1),
  CONSTRAINT ck_evidence_url_length CHECK (source_url IS NULL OR char_length(source_url) <= 500)
);

CREATE INDEX ix_evidence_tier ON evidence_items (tier, source_type);
CREATE INDEX ix_evidence_valid ON evidence_items (valid_until);
CREATE INDEX ix_evidence_payload ON evidence_items USING gin (payload);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  public_id text NOT NULL,
  category report_category NOT NULL,
  stop_id uuid REFERENCES stops(id) ON DELETE RESTRICT,
  route_id uuid REFERENCES routes(id) ON DELETE SET NULL,
  device_hash text NOT NULL,
  device_day_hash text NOT NULL,
  client_event_id uuid NOT NULL,
  text text NOT NULL,
  status report_status NOT NULL DEFAULT 'submitted',
  moderation moderation_status NOT NULL DEFAULT 'pending',
  authority_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  institution_id uuid REFERENCES institutions(id) ON DELETE SET NULL,
  evidence_score real NOT NULL DEFAULT 0,
  evidence_level evidence_level NOT NULL DEFAULT 'none',
  contact_email_enc bytea,
  contact_email_hash bytea,
  corroboration_count integer NOT NULL DEFAULT 0,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_reports_public_id UNIQUE (public_id),
  CONSTRAINT ck_reports_text_length CHECK (char_length(text) BETWEEN 20 AND 2000),
  CONSTRAINT ck_reports_public_id_format CHECK (public_id ~ '^LPR-[0-9]{4}-[0-9]{6}$'),
  CONSTRAINT ck_reports_evidence_score CHECK (evidence_score BETWEEN 0 AND 1),
  CONSTRAINT ck_reports_corroboration CHECK (corroboration_count >= 0),
  CONSTRAINT ck_reports_client_event_version CHECK (substring(client_event_id::text, 15, 1) = '7'),
  CONSTRAINT ck_reports_device_hash CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_reports_device_day_hash CHECK (device_day_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX uq_reports_client_event ON reports (device_hash, client_event_id);
CREATE INDEX ix_reports_institution ON reports (institution_id, status, created_at DESC);
CREATE INDEX ix_reports_stop ON reports (stop_id, created_at DESC);
CREATE INDEX ix_reports_public ON reports (public_id);
CREATE INDEX ix_reports_text_trgm ON reports USING gin (text gin_trgm_ops);
CREATE INDEX ix_reports_moderation ON reports (moderation, created_at DESC);

CREATE TABLE report_media (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  mime text NOT NULL,
  width integer,
  height integer,
  sha256 bytea,
  status media_status NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_media_key UNIQUE (object_key),
  CONSTRAINT ck_report_media_mime CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_report_media_dimensions CHECK (
    (width IS NULL AND height IS NULL) OR (width > 0 AND height > 0)
  ),
  CONSTRAINT ck_report_media_sha CHECK (sha256 IS NULL OR length(sha256) = 32)
);

CREATE INDEX ix_report_media_report ON report_media (report_id, created_at DESC);

CREATE TABLE report_events (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind report_event_kind NOT NULL,
  actor_type audit_actor_type NOT NULL,
  actor_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  prev_hash bytea NOT NULL,
  payload_hash bytea NOT NULL,
  chain_hash bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_events_seq UNIQUE (report_id, seq),
  CONSTRAINT ck_report_events_seq CHECK (seq >= 1),
  CONSTRAINT ck_report_events_prev CHECK (length(prev_hash) = 32),
  CONSTRAINT ck_report_events_payload CHECK (length(payload_hash) = 32),
  CONSTRAINT ck_report_events_chain CHECK (length(chain_hash) = 32),
  CONSTRAINT ck_report_events_source_length CHECK (source_url IS NULL OR char_length(source_url) <= 500)
);

CREATE INDEX ix_report_events_report ON report_events (report_id, seq);

CREATE TABLE report_corroborations (
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_report_corroborations PRIMARY KEY (report_id, device_hash),
  CONSTRAINT ck_corroboration_device CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_corroboration_note CHECK (note IS NULL OR char_length(note) <= 280)
);

CREATE TABLE closure_verifications (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  answer closure_answer NOT NULL,
  note text,
  media_id uuid REFERENCES report_media(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_closure_device CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_closure_note CHECK (note IS NULL OR char_length(note) <= 280)
);

CREATE UNIQUE INDEX uq_closure_device ON closure_verifications (report_id, device_hash);
CREATE INDEX ix_closure_report ON closure_verifications (report_id, created_at DESC);

CREATE TABLE triage_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  device_hash text NOT NULL,
  device_day_hash text NOT NULL,
  client_event_id uuid NOT NULL,
  stop_id uuid REFERENCES stops(id) ON DELETE SET NULL,
  route_id uuid REFERENCES routes(id) ON DELETE SET NULL,
  category report_category NOT NULL,
  verdict triage_verdict NOT NULL,
  overridden boolean NOT NULL DEFAULT false,
  evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  arm experiment_arm NOT NULL DEFAULT 'triage',
  rules_ver text NOT NULL,
  latency_ms integer,
  connectors jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_triage_client_event UNIQUE (device_hash, client_event_id),
  CONSTRAINT ck_triage_rules_ver CHECK (char_length(rules_ver) BETWEEN 1 AND 40),
  CONSTRAINT ck_triage_latency CHECK (latency_ms IS NULL OR latency_ms >= 0),
  CONSTRAINT ck_triage_device CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_triage_device_day CHECK (device_day_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_triage_client_event_version CHECK (substring(client_event_id::text, 15, 1) = '7')
);

CREATE INDEX ix_triage_created ON triage_sessions (created_at DESC);
CREATE INDEX ix_triage_verdict ON triage_sessions (verdict, overridden);
CREATE INDEX ix_triage_stop ON triage_sessions (stop_id, created_at DESC);

CREATE TRIGGER trg_institutions_updated BEFORE UPDATE ON institutions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_reports_updated BEFORE UPDATE ON reports
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hadir_app;

GRANT SELECT ON institutions, authority_map, notices, evidence_items TO hadir_app;
GRANT SELECT (
  id, public_id, category, stop_id, route_id, device_hash, device_day_hash,
  client_event_id, text, status, moderation, authority_id, institution_id,
  evidence_score, evidence_level, corroboration_count, resolved_at,
  created_at, updated_at
) ON reports TO hadir_app;
GRANT SELECT (id, report_id, object_key, mime, width, height, status, created_at) ON report_media TO hadir_app;
GRANT SELECT ON report_events TO hadir_app;
GRANT SELECT ON report_corroborations TO hadir_app;
GRANT SELECT ON closure_verifications TO hadir_app;
GRANT SELECT ON triage_sessions TO hadir_app;

GRANT INSERT (
  public_id, category, stop_id, route_id, device_hash, device_day_hash, client_event_id,
  text, status, moderation, authority_id, institution_id, evidence_score, evidence_level
) ON reports TO hadir_app;
GRANT UPDATE (
  status, moderation, authority_id, institution_id, evidence_score, evidence_level,
  corroboration_count, contact_email_enc, contact_email_hash, resolved_at, updated_at
) ON reports TO hadir_app;

GRANT INSERT (
  report_id, object_key, mime, width, height, sha256, status
) ON report_media TO hadir_app;
GRANT UPDATE (status) ON report_media TO hadir_app;

GRANT INSERT (
  report_id, seq, kind, actor_type, actor_id, payload, source_url,
  prev_hash, payload_hash, chain_hash
) ON report_events TO hadir_app;

GRANT INSERT (report_id, device_hash, note) ON report_corroborations TO hadir_app;
GRANT INSERT (report_id, device_hash, answer, note, media_id) ON closure_verifications TO hadir_app;

GRANT INSERT (
  device_hash, device_day_hash, client_event_id, stop_id, route_id, category,
  verdict, overridden, evidence_ids, arm, rules_ver, latency_ms, connectors,
  completed_report_id
) ON triage_sessions TO hadir_app;
GRANT UPDATE (completed_report_id, overridden) ON triage_sessions TO hadir_app;

GRANT EXECUTE ON FUNCTION set_updated_at() TO hadir_app;