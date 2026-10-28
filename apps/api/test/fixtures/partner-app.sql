DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hadir_app') THEN
    CREATE ROLE hadir_app NOLOGIN;
  END IF;
END;
$$;

CREATE TYPE audit_actor_type AS ENUM ('citizen', 'partner', 'system', 'moderator', 'superadmin');
CREATE TYPE partner_role AS ENUM ('viewer', 'responder', 'admin');
CREATE TYPE partner_status AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE otp_purpose AS ENUM ('login', 'recovery');
CREATE TYPE webauthn_purpose AS ENUM ('registration', 'authentication');
CREATE TYPE report_category AS ENUM (
  'service_wait','service_no_show','service_full','stop_facility',
  'stop_cleanliness','stop_safety','route_info','accessibility','other'
);
CREATE TYPE report_status AS ENUM (
  'draft','submitted','triaged','acknowledged','in_progress',
  'claimed_resolved','verified_resolved','disputed','rejected','closed'
);
CREATE TYPE moderation_status AS ENUM ('pending','approved','rejected','quarantined');
CREATE TYPE evidence_level AS ENUM ('none','low','medium','high');
CREATE TYPE report_event_kind AS ENUM (
  'submitted','triaged','acknowledged','info_requested','scheduled','responded',
  'claimed_resolved','verified_resolved','disputed','rejected','closed','corrected'
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  device_hash text NOT NULL UNIQUE,
  first_seen timestamp with time zone NOT NULL DEFAULT now(),
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  trust_score real NOT NULL DEFAULT 0.5,
  flags text[] NOT NULL DEFAULT '{}'::text[],
  revoked_at timestamp with time zone
);

CREATE TABLE institutions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL
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
  evidence_score real NOT NULL DEFAULT 0,
  evidence_level evidence_level NOT NULL DEFAULT 'none',
  corroboration_count integer NOT NULL DEFAULT 0,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
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

CREATE TABLE partner_users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email_hash text NOT NULL UNIQUE,
  email_enc bytea NOT NULL,
  display_name text NOT NULL,
  status partner_status NOT NULL DEFAULT 'active',
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE partner_memberships (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  role partner_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone
);

CREATE UNIQUE INDEX uq_membership_active
  ON partner_memberships (user_id, institution_id)
  WHERE revoked_at IS NULL;

CREATE TABLE partner_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES partner_memberships(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  invite_jti text UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  ip_hash text,
  user_agent_hash text,
  CONSTRAINT ck_session_token_bytes CHECK (octet_length(token_hash) = 32)
);

CREATE TABLE partner_password_credentials (
  user_id uuid PRIMARY KEY REFERENCES partner_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE partner_otp_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  purpose otp_purpose NOT NULL DEFAULT 'login',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamp with time zone
);

CREATE TABLE partner_webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}'::text[],
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  device_label text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone
);

CREATE TABLE partner_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid REFERENCES partner_users(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  purpose webauthn_purpose NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL
);

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT pk_idempotency_keys PRIMARY KEY (scope, key),
  CONSTRAINT ck_idempotency_keys_scope_length CHECK (char_length(scope) BETWEEN 1 AND 160)
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

GRANT USAGE ON SCHEMA public TO hadir_app;
GRANT SELECT ON institutions, stops, partner_users TO hadir_app;
GRANT SELECT ON devices TO hadir_app;
GRANT INSERT (device_hash, trust_score, flags) ON devices TO hadir_app;
GRANT UPDATE (last_seen, trust_score, flags, revoked_at) ON devices TO hadir_app;
GRANT SELECT, INSERT, UPDATE (status, resolved_at) ON reports TO hadir_app;
GRANT SELECT, INSERT ON report_events TO hadir_app;
GRANT SELECT, INSERT ON partner_memberships TO hadir_app;
GRANT UPDATE (revoked_at) ON partner_memberships TO hadir_app;
GRANT SELECT, INSERT ON partner_sessions TO hadir_app;
GRANT UPDATE (last_seen_at, revoked_at) ON partner_sessions TO hadir_app;
GRANT SELECT, INSERT ON partner_password_credentials TO hadir_app;
GRANT UPDATE (password_hash) ON partner_password_credentials TO hadir_app;
GRANT SELECT, INSERT, DELETE ON partner_otp_challenges TO hadir_app;
GRANT UPDATE (attempts, consumed_at) ON partner_otp_challenges TO hadir_app;
GRANT SELECT, INSERT ON partner_webauthn_credentials TO hadir_app;
GRANT UPDATE (counter, last_used_at) ON partner_webauthn_credentials TO hadir_app;
GRANT DELETE ON partner_webauthn_credentials TO hadir_app;
GRANT SELECT, INSERT, DELETE ON partner_webauthn_challenges TO hadir_app;
GRANT SELECT, INSERT, UPDATE (response_status, response_body) ON idempotency_keys TO hadir_app;
GRANT SELECT ON audit_log TO hadir_app;
GRANT INSERT (actor_type, actor_id, action, object_type, object_id, request_id, ip_hash, payload) ON audit_log TO hadir_app;