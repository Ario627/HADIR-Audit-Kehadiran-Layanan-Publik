CREATE TYPE otp_purpose AS ENUM ('login', 'recovery');
CREATE TYPE webauthn_purpose AS ENUM ('registration', 'authentication');

ALTER TABLE partner_sessions ALTER COLUMN invite_jti DROP NOT NULL;

ALTER TABLE partner_users
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamp with time zone;

ALTER TABLE partner_users
  ADD CONSTRAINT ck_partner_failed_count CHECK (failed_login_count >= 0);

CREATE TABLE partner_password_credentials (
  user_id uuid PRIMARY KEY REFERENCES partner_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  algorithm text NOT NULL DEFAULT 'argon2id',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_password_hash_length CHECK (char_length(password_hash) BETWEEN 32 AND 512),
  CONSTRAINT ck_password_algorithm CHECK (algorithm IN ('argon2id'))
);

CREATE TABLE partner_webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  credential_id bytea NOT NULL,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}'::text[],
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  device_label text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone,
  CONSTRAINT ck_webauthn_credential_unique UNIQUE (credential_id),
  CONSTRAINT ck_webauthn_counter CHECK (counter >= 0),
  CONSTRAINT ck_webauthn_public_key CHECK (octet_length(public_key) BETWEEN 1 AND 2048),
  CONSTRAINT ck_webauthn_device_label CHECK (device_label IS NULL OR char_length(device_label) <= 80)
);

CREATE INDEX ix_webauthn_user ON partner_webauthn_credentials (user_id);

CREATE TABLE partner_otp_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  purpose otp_purpose NOT NULL DEFAULT 'login',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamp with time zone,
  CONSTRAINT ck_otp_code_bytes CHECK (octet_length(code_hash) = 32),
  CONSTRAINT ck_otp_attempts CHECK (attempts >= 0),
  CONSTRAINT ck_otp_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_otp_user_open
  ON partner_otp_challenges (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE partner_webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  user_id uuid REFERENCES partner_users(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  purpose webauthn_purpose NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT ck_webauthn_challenge_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_webauthn_challenge_length CHECK (char_length(challenge) BETWEEN 16 AND 256)
);

CREATE INDEX ix_webauthn_challenge_expiry ON partner_webauthn_challenges (expires_at);

CREATE TRIGGER trg_password_credentials_updated_at
  BEFORE UPDATE ON partner_password_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT UPDATE (failed_login_count, locked_until) ON partner_users TO hadir_app;

GRANT SELECT, INSERT ON partner_password_credentials TO hadir_app;
GRANT UPDATE (password_hash) ON partner_password_credentials TO hadir_app;

GRANT SELECT, INSERT ON partner_webauthn_credentials TO hadir_app;
GRANT UPDATE (counter, last_used_at, device_label) ON partner_webauthn_credentials TO hadir_app;
GRANT DELETE ON partner_webauthn_credentials TO hadir_app;

GRANT SELECT, INSERT, DELETE ON partner_otp_challenges TO hadir_app;
GRANT UPDATE (attempts, consumed_at) ON partner_otp_challenges TO hadir_app;

GRANT SELECT, INSERT, DELETE ON partner_webauthn_challenges TO hadir_app;