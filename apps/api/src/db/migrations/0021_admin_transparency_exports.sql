CREATE TYPE platform_admin_role AS ENUM ('moderator', 'superadmin');

ALTER TABLE reports ADD COLUMN follow_up_at timestamp with time zone;

ALTER TABLE reports ADD CONSTRAINT ck_reports_follow_up
  CHECK (follow_up_at IS NULL OR follow_up_at <= created_at + interval '365 days');

CREATE INDEX ix_reports_follow_up ON reports (institution_id, follow_up_at)
  WHERE follow_up_at IS NOT NULL;

GRANT SELECT (follow_up_at) ON reports TO hadir_app;
GRANT UPDATE (follow_up_at) ON reports TO hadir_app;

CREATE TABLE platform_admins (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  role platform_admin_role NOT NULL DEFAULT 'moderator',
  password_hash bytea NOT NULL,
  totp_secret_enc bytea NOT NULL,
  totp_enrolled_at timestamp with time zone NOT NULL DEFAULT now(),
  last_totp_step bigint,
  disabled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_platform_admins_email UNIQUE (email),
  CONSTRAINT ck_platform_admins_email CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT ck_platform_admins_name CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT ck_platform_admins_password CHECK (octet_length(password_hash) BETWEEN 16 AND 256),
  CONSTRAINT ck_platform_admins_totp CHECK (octet_length(totp_secret_enc) BETWEEN 16 AND 512)
);

CREATE INDEX ix_platform_admins_role ON platform_admins (role) WHERE disabled_at IS NULL;

CREATE TABLE platform_admin_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  admin_id uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  ip_hash bytea,
  user_agent_hash bytea,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  idle_expires_at timestamp with time zone NOT NULL,
  absolute_expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  CONSTRAINT uq_platform_admin_sessions_token UNIQUE (token_hash),
  CONSTRAINT ck_platform_admin_sessions_token CHECK (octet_length(token_hash) = 32),
  CONSTRAINT ck_platform_admin_sessions_window CHECK (idle_expires_at <= absolute_expires_at)
);

CREATE INDEX ix_platform_admin_sessions_admin
  ON platform_admin_sessions (admin_id, last_seen_at DESC);

CREATE TABLE anchor_log (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  anchor_date date NOT NULL,
  merkle_root bytea NOT NULL,
  leaf_count integer NOT NULL,
  window_start timestamp with time zone NOT NULL,
  window_end timestamp with time zone NOT NULL,
  tx_ref text,
  proof jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_anchor_log_date UNIQUE (anchor_date),
  CONSTRAINT ck_anchor_log_root CHECK (octet_length(merkle_root) = 32),
  CONSTRAINT ck_anchor_log_count CHECK (leaf_count >= 0),
  CONSTRAINT ck_anchor_log_window CHECK (window_start < window_end),
  CONSTRAINT ck_anchor_log_tx CHECK (tx_ref IS NULL OR char_length(tx_ref) BETWEEN 1 AND 200)
);

CREATE TABLE exports (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES partner_users(id) ON DELETE RESTRICT,
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
  CONSTRAINT ck_exports_status CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  CONSTRAINT ck_exports_rows CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT ck_exports_bytes CHECK (byte_size IS NULL OR byte_size >= 0),
  CONSTRAINT ck_exports_ready CHECK ((status = 'ready') = (object_key IS NOT NULL))
);

CREATE INDEX ix_exports_institution ON exports (institution_id, created_at DESC);
CREATE INDEX ix_exports_expiry ON exports (expires_at) WHERE status = 'ready';

CREATE TABLE feature_flags (
  key text PRIMARY KEY NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_feature_flags_key CHECK (key ~ '^[a-z][a-z0-9_.-]{1,63}$')
);

CREATE TABLE rup_packages (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
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
  CONSTRAINT uq_rup_packages UNIQUE (satker, name, fiscal_year, source_url),
  CONSTRAINT ck_rup_packages_satker CHECK (char_length(satker) BETWEEN 1 AND 160),
  CONSTRAINT ck_rup_packages_name CHECK (char_length(name) BETWEEN 1 AND 300),
  CONSTRAINT ck_rup_packages_year CHECK (fiscal_year BETWEEN 2000 AND 2100),
  CONSTRAINT ck_rup_packages_pagu CHECK (pagu IS NULL OR pagu >= 0),
  CONSTRAINT ck_rup_packages_url CHECK (char_length(source_url) BETWEEN 1 AND 500)
);

CREATE INDEX ix_rup_name_trgm ON rup_packages USING gin (name gin_trgm_ops);
CREATE INDEX ix_rup_year ON rup_packages (fiscal_year, satker);

CREATE TRIGGER trg_platform_admins_updated BEFORE UPDATE ON platform_admins
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

REVOKE ALL ON platform_admins FROM PUBLIC;
REVOKE ALL ON platform_admin_sessions FROM PUBLIC;
REVOKE ALL ON anchor_log FROM PUBLIC;
REVOKE ALL ON exports FROM PUBLIC;
REVOKE ALL ON feature_flags FROM PUBLIC;
REVOKE ALL ON rup_packages FROM PUBLIC;

REVOKE ALL ON platform_admins FROM hadir_app;
REVOKE ALL ON platform_admin_sessions FROM hadir_app;
REVOKE ALL ON anchor_log FROM hadir_app;
REVOKE ALL ON exports FROM hadir_app;
REVOKE ALL ON feature_flags FROM hadir_app;
REVOKE ALL ON rup_packages FROM hadir_app;

GRANT SELECT ON anchor_log TO hadir_app;
GRANT INSERT ON anchor_log TO hadir_app;

GRANT SELECT (
  id, email, display_name, role, password_hash, totp_secret_enc, totp_enrolled_at,
  last_totp_step, disabled_at, created_at
) ON platform_admins TO hadir_app;
GRANT INSERT (email, display_name, role, password_hash, totp_secret_enc) ON platform_admins TO hadir_app;
GRANT UPDATE (password_hash, totp_secret_enc, totp_enrolled_at, last_totp_step, disabled_at)
  ON platform_admins TO hadir_app;

GRANT SELECT ON platform_admin_sessions TO hadir_app;
GRANT INSERT (admin_id, token_hash, ip_hash, user_agent_hash, idle_expires_at, absolute_expires_at)
  ON platform_admin_sessions TO hadir_app;
GRANT UPDATE (last_seen_at, idle_expires_at, revoked_at) ON platform_admin_sessions TO hadir_app;

GRANT SELECT ON exports TO hadir_app;
GRANT INSERT (institution_id, requested_by, format, scope, status, expires_at)
  ON exports TO hadir_app;
GRANT UPDATE (status, object_key, row_count, byte_size, error_code, completed_at, expires_at)
  ON exports TO hadir_app;

GRANT SELECT ON feature_flags TO hadir_app;
GRANT INSERT ON feature_flags TO hadir_app;
GRANT UPDATE (value, description, updated_by, updated_at) ON feature_flags TO hadir_app;

GRANT SELECT ON rup_packages TO hadir_app;
GRANT INSERT (satker, name, location_text, funding_source, pagu, method, fiscal_year, status, source_url, fetched_at, match_keywords)
  ON rup_packages TO hadir_app;
GRANT UPDATE (location_text, funding_source, pagu, method, status, fetched_at, match_keywords)
  ON rup_packages TO hadir_app;
