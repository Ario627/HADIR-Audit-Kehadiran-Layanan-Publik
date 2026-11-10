CREATE TYPE response_kind AS ENUM ('initial', 'follow_up', 'closure_claim', 'correction');
CREATE TYPE verifier_kind AS ENUM ('citizen', 'independent_institution', 'platform', 'automatic');
CREATE TYPE resolution_method AS ENUM (
  'citizen_confirmation',
  'field_inspection',
  'observation_data',
  'panel_review'
);
CREATE TYPE resolution_verdict AS ENUM ('confirmed', 'refuted', 'inconclusive');

CREATE TABLE report_responses (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  author_user_id uuid REFERENCES partner_users(id) ON DELETE SET NULL,
  kind response_kind NOT NULL DEFAULT 'initial',
  body text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  corrects_response_id uuid REFERENCES report_responses(id) ON DELETE SET NULL,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_response_body CHECK (char_length(body) BETWEEN 20 AND 4000),
  CONSTRAINT ck_response_evidence_count CHECK (cardinality(evidence_urls) <= 5),
  CONSTRAINT ck_response_correction_target CHECK (
    kind <> 'correction' OR corrects_response_id IS NOT NULL
  ),
  CONSTRAINT ck_response_correction_self CHECK (
    corrects_response_id IS NULL OR corrects_response_id <> id
  )
);

CREATE INDEX ix_responses_report ON report_responses (report_id, published_at);
CREATE INDEX ix_responses_institution ON report_responses (institution_id, published_at DESC);

CREATE OR REPLACE FUNCTION check_response_urls() RETURNS trigger AS $$
DECLARE
  entry text;
BEGIN
  FOREACH entry IN ARRAY NEW.evidence_urls LOOP
    IF char_length(entry) < 8 OR char_length(entry) > 500 OR entry !~ '^https://' THEN
      RAISE EXCEPTION 'evidence_url pada tanggapan instansi tidak valid';
    END IF;
    IF position(' ' in entry) > 0 OR position(E'\t' in entry) > 0 THEN
      RAISE EXCEPTION 'evidence_url tidak boleh memuat spasi';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_response_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'report_responses bersifat append-only; buat tanggapan koreksi baru';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_report_responses_urls BEFORE INSERT ON report_responses
FOR EACH ROW EXECUTE FUNCTION check_response_urls();

CREATE TRIGGER trg_report_responses_immutable BEFORE UPDATE OR DELETE ON report_responses
FOR EACH ROW EXECUTE FUNCTION reject_response_mutation();

ALTER TABLE report_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY report_responses_read ON report_responses
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'public'
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_responses.report_id
          AND r.moderation = 'approved'
          AND r.status NOT IN ('draft', 'rejected', 'closed')
      )
    )
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_responses.report_id
          AND r.institution_id = current_institution()
      )
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_responses.report_id
          AND r.device_hash = current_device_hash()
      )
    )
  );

CREATE POLICY report_responses_insert ON report_responses
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (
    (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND institution_id = current_institution()
    )
    OR current_scope() = 'admin'
  );

CREATE TABLE resolution_verifications (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  method resolution_method NOT NULL,
  verdict resolution_verdict NOT NULL,
  verifier_kind verifier_kind NOT NULL,
  verifier_institution_id uuid REFERENCES institutions(id) ON DELETE RESTRICT,
  verifier_user_id uuid REFERENCES partner_users(id) ON DELETE SET NULL,
  claimant_institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  note text,
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  verified_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_resolution_independence CHECK (
    verifier_institution_id IS NULL
    OR verifier_institution_id <> claimant_institution_id
  ),
  CONSTRAINT ck_resolution_institution_identity CHECK (
    verifier_kind <> 'independent_institution' OR verifier_institution_id IS NOT NULL
  ),
  CONSTRAINT ck_resolution_citizen_identity CHECK (
    verifier_kind <> 'citizen' OR verifier_user_id IS NOT NULL
  ),
  CONSTRAINT ck_resolution_note CHECK (note IS NULL OR char_length(note) <= 400),
  CONSTRAINT ck_resolution_evidence_count CHECK (cardinality(evidence_urls) <= 5)
);

CREATE UNIQUE INDEX uq_resolution_verifier ON resolution_verifications (
  report_id,
  verifier_kind,
  COALESCE(verifier_institution_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(verifier_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

CREATE INDEX ix_resolution_report ON resolution_verifications (report_id, verified_at);

CREATE OR REPLACE FUNCTION reject_resolution_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'resolution_verifications bersifat append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_resolution_immutable BEFORE UPDATE OR DELETE ON resolution_verifications
FOR EACH ROW EXECUTE FUNCTION reject_resolution_mutation();

ALTER TABLE resolution_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY resolution_read ON resolution_verifications
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'public'
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = resolution_verifications.report_id
          AND r.moderation = 'approved'
      )
    )
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = resolution_verifications.report_id
          AND r.institution_id = current_institution()
      )
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = resolution_verifications.report_id
          AND r.device_hash = current_device_hash()
      )
    )
  );

CREATE POLICY resolution_insert ON resolution_verifications
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (
    current_scope() IN ('partner', 'admin', 'citizen')
  );

CREATE TABLE report_sla (
  report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  priority text NOT NULL,
  acknowledge_hours numeric(6, 2) NOT NULL,
  respond_hours numeric(6, 2) NOT NULL,
  resolve_hours numeric(6, 2) NOT NULL,
  acknowledge_due timestamp with time zone NOT NULL,
  respond_due timestamp with time zone NOT NULL,
  resolve_due timestamp with time zone NOT NULL,
  frozen_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_report_sla_priority CHECK (
    priority IN ('low', 'normal', 'high', 'critical')
  ),
  CONSTRAINT ck_report_sla_version CHECK (char_length(policy_version) BETWEEN 1 AND 40),
  CONSTRAINT ck_report_sla_order CHECK (
    acknowledge_due <= respond_due AND respond_due <= resolve_due
  ),
  CONSTRAINT ck_report_sla_positive CHECK (
    acknowledge_hours > 0 AND respond_hours > 0 AND resolve_hours > 0
  )
);

CREATE INDEX ix_report_sla_resolve_due ON report_sla (resolve_due);

CREATE TABLE partner_invites (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  email_hash text NOT NULL,
  email_enc bytea NOT NULL,
  role partner_role NOT NULL DEFAULT 'responder',
  token_hash bytea NOT NULL,
  invited_by uuid REFERENCES partner_users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT uq_partner_invites_token UNIQUE (token_hash),
  CONSTRAINT ck_invite_token_bytes CHECK (octet_length(token_hash) = 32),
  CONSTRAINT ck_invite_email_hash CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_invite_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT ck_invite_consumed_order CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE UNIQUE INDEX uq_invite_pending
  ON partner_invites (institution_id, email_hash)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX ix_invite_expiry ON partner_invites (expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

REVOKE ALL ON report_responses FROM PUBLIC;
REVOKE ALL ON resolution_verifications FROM PUBLIC;
REVOKE ALL ON report_sla FROM PUBLIC;
REVOKE ALL ON partner_invites FROM PUBLIC;
REVOKE ALL ON report_responses FROM hadir_app;
REVOKE ALL ON resolution_verifications FROM hadir_app;
REVOKE ALL ON report_sla FROM hadir_app;
REVOKE ALL ON partner_invites FROM hadir_app;

GRANT SELECT, INSERT ON report_responses TO hadir_app;
GRANT SELECT, INSERT ON resolution_verifications TO hadir_app;
GRANT SELECT, INSERT ON report_sla TO hadir_app;
GRANT SELECT, INSERT ON partner_invites TO hadir_app;
GRANT UPDATE (consumed_at, revoked_at) ON partner_invites TO hadir_app;

REVOKE ALL ON FUNCTION check_response_urls() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_response_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_resolution_mutation() FROM PUBLIC;
