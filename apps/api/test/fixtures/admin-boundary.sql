DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hadir_app') THEN
    CREATE ROLE hadir_app NOLOGIN;
  END IF;
END;
$$;

CREATE TYPE audit_actor_type AS ENUM ('citizen', 'partner', 'system', 'moderator', 'superadmin');
CREATE TYPE report_category AS ENUM (
  'service_wait','service_no_show','service_full','stop_facility',
  'stop_cleanliness','stop_safety','route_info','accessibility','other'
);
CREATE TYPE report_status AS ENUM (
  'draft','submitted','triaged','acknowledged','in_progress',
  'claimed_resolved','verified_resolved','disputed','rejected','closed'
);
CREATE TYPE moderation_status AS ENUM ('pending','approved','rejected','quarantined');
CREATE TYPE evidence_level AS ENUM ('none','indication','strong','field_verified');
CREATE TYPE report_event_kind AS ENUM (
  'submitted','triaged','acknowledged','info_requested','scheduled','responded',
  'claimed_resolved','verified_resolved','disputed','rejected','moderated','corrected'
);
CREATE TYPE platform_admin_role AS ENUM ('moderator', 'superadmin');
CREATE TYPE partner_status AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE notice_kind AS ENUM ('detour', 'repair', 'suspension', 'schedule', 'other');

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL
);

CREATE TABLE partner_users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email_hash text NOT NULL UNIQUE,
  email_enc bytea NOT NULL,
  display_name text NOT NULL,
  status partner_status NOT NULL DEFAULT 'active'
);

CREATE TABLE stops (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  public_id text NOT NULL UNIQUE,
  category report_category NOT NULL,
  stop_id uuid REFERENCES stops(id),
  device_hash text NOT NULL,
  device_day_hash text NOT NULL,
  text text NOT NULL,
  status report_status NOT NULL DEFAULT 'submitted',
  moderation moderation_status NOT NULL DEFAULT 'pending',
  institution_id uuid REFERENCES institutions(id),
  evidence_score double precision NOT NULL DEFAULT 0,
  evidence_level evidence_level NOT NULL DEFAULT 'none',
  corroboration_count integer NOT NULL DEFAULT 0,
  contact_email_enc bytea,
  contact_email_hash bytea,
  resolved_at timestamp with time zone,
  follow_up_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE report_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
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
  CONSTRAINT uq_report_events_seq UNIQUE (report_id, seq)
);

CREATE TABLE report_media (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  mime text NOT NULL,
  width integer,
  height integer,
  sha256 bytea,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE platform_admins (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role platform_admin_role NOT NULL DEFAULT 'moderator',
  password_hash bytea NOT NULL,
  totp_secret_enc bytea NOT NULL,
  totp_enrolled_at timestamp with time zone NOT NULL DEFAULT now(),
  last_totp_step bigint,
  disabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE platform_admin_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  admin_id uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  ip_hash bytea,
  user_agent_hash bytea,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  idle_expires_at timestamp with time zone NOT NULL,
  absolute_expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone
);

CREATE TABLE anchor_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  anchor_date date NOT NULL UNIQUE,
  merkle_root bytea NOT NULL,
  leaf_count integer NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone NOT NULL,
  tx_ref text,
  proof jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_anchor_log_root CHECK (octet_length(merkle_root) = 32),
  CONSTRAINT ck_anchor_log_count CHECK (leaf_count >= 0),
  CONSTRAINT ck_anchor_log_window CHECK (window_start < window_end)
);

CREATE TABLE exports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  institution_id uuid NOT NULL REFERENCES institutions(id),
  requested_by uuid NOT NULL REFERENCES partner_users(id),
  format text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  object_key text,
  row_count integer,
  byte_size integer,
  error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  expires_at timestamp with time zone,
  CONSTRAINT ck_exports_format CHECK (format IN ('csv', 'open311')),
  CONSTRAINT ck_exports_status CHECK (status IN ('queued','running','ready','failed','expired')),
  CONSTRAINT ck_exports_ready CHECK ((status = 'ready') = (object_key IS NOT NULL))
);

CREATE TABLE feature_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_feature_flags_key CHECK (key ~ '^[a-z][a-z0-9_.-]{1,63}$')
);

CREATE TABLE rup_packages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  satker text NOT NULL,
  name text NOT NULL,
  location_text text,
  funding_source text,
  pagu numeric(18, 2),
  method text,
  fiscal_year integer NOT NULL,
  status text,
  source_url text NOT NULL,
  fetched_at timestamp with time zone NOT NULL,
  match_keywords text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_rup_packages UNIQUE (satker, name, fiscal_year, source_url)
);

CREATE TABLE notices (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind notice_kind NOT NULL,
  city_id uuid,
  stop_id uuid REFERENCES stops(id),
  route_id uuid,
  institution_id uuid REFERENCES institutions(id),
  text text NOT NULL,
  source_url text NOT NULL,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_type audit_actor_type NOT NULL,
  actor_id text,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text,
  request_id text,
  ip_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

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

GRANT EXECUTE ON FUNCTION current_scope() TO hadir_app;
GRANT EXECUTE ON FUNCTION current_institution() TO hadir_app;
GRANT EXECUTE ON FUNCTION current_device_hash() TO hadir_app;

GRANT SELECT, INSERT, UPDATE ON reports TO hadir_app;
GRANT SELECT, INSERT ON report_events TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON report_media TO hadir_app;
GRANT SELECT, INSERT ON notices TO hadir_app;
GRANT SELECT, INSERT ON audit_log TO hadir_app;
GRANT SELECT ON institutions TO hadir_app;
GRANT SELECT ON stops TO hadir_app;
GRANT SELECT ON anchor_log TO hadir_app;
GRANT INSERT ON anchor_log TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON exports TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON feature_flags TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON rup_packages TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON platform_admins TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON platform_admin_sessions TO hadir_app;
