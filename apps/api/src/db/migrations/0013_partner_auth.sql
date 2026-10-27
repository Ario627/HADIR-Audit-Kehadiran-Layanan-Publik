CREATE TYPE partner_role AS ENUM ('viewer', 'responder', 'admin');
CREATE TYPE partner_status AS ENUM ('active', 'suspended', 'revoked');

CREATE TABLE partner_users (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  email_hash text NOT NULL,
  email_enc bytea NOT NULL,
  display_name text NOT NULL,
  status partner_status NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_partner_users_email UNIQUE (email_hash),
  CONSTRAINT ck_partner_email_hash CHECK (email_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_partner_display_name CHECK (char_length(display_name) BETWEEN 1 AND 120)
);

CREATE TABLE partner_memberships (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  role partner_role NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  CONSTRAINT ck_membership_revoked_order CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX uq_membership_active
  ON partner_memberships (user_id, institution_id)
  WHERE revoked_at IS NULL;
CREATE INDEX ix_membership_institution
  ON partner_memberships (institution_id, role)
  WHERE revoked_at IS NULL;

CREATE TABLE partner_sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES partner_memberships(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  invite_jti text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  ip_hash text,
  user_agent_hash text,
  CONSTRAINT uq_partner_sessions_token UNIQUE (token_hash),
  CONSTRAINT uq_partner_sessions_invite UNIQUE (invite_jti),
  CONSTRAINT ck_session_token_bytes CHECK (octet_length(token_hash) = 32),
  CONSTRAINT ck_session_ip_hash CHECK (ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_session_ua_hash CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_session_expiry_order CHECK (expires_at > created_at)
);

CREATE INDEX ix_partner_sessions_user
  ON partner_sessions (user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX ix_partner_sessions_expiry
  ON partner_sessions (expires_at);

CREATE TRIGGER trg_partner_users_updated_at
  BEFORE UPDATE ON partner_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT ON institutions, partner_users TO hadir_app;
GRANT INSERT (email_hash, email_enc, display_name) ON partner_users TO hadir_app;
GRANT UPDATE (display_name, status) ON partner_users TO hadir_app;
GRANT SELECT, INSERT ON partner_memberships TO hadir_app;
GRANT UPDATE (revoked_at) ON partner_memberships TO hadir_app;
GRANT SELECT, INSERT ON partner_sessions TO hadir_app;
GRANT UPDATE (last_seen_at, revoked_at) ON partner_sessions TO hadir_app;