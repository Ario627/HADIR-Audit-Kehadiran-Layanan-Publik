ALTER TABLE report_responses
  ADD COLUMN body_digest bytea,
  ADD COLUMN signature bytea,
  ADD COLUMN signature_algorithm text,
  ADD COLUMN signing_key_id text,
  ADD COLUMN public_key bytea,
  ADD COLUMN signed_at timestamp with time zone;

ALTER TABLE report_responses
  ADD CONSTRAINT ck_response_body_digest CHECK (
    body_digest IS NULL OR octet_length(body_digest) = 32
  ),
  ADD CONSTRAINT ck_response_signature_bytes CHECK (
    signature IS NULL OR octet_length(signature) = 64
  ),
  ADD CONSTRAINT ck_response_public_key_bytes CHECK (
    public_key IS NULL OR octet_length(public_key) = 32
  ),
  ADD CONSTRAINT ck_response_algorithm CHECK (
    signature_algorithm IS NULL OR signature_algorithm IN ('ed25519')
  ),
  ADD CONSTRAINT ck_response_key_id CHECK (
    signing_key_id IS NULL OR char_length(signing_key_id) BETWEEN 1 AND 64
  ),
  ADD CONSTRAINT ck_response_signature_complete CHECK (
    (signature IS NULL AND signature_algorithm IS NULL
      AND signing_key_id IS NULL AND public_key IS NULL AND signed_at IS NULL)
    OR
    (signature IS NOT NULL AND signature_algorithm IS NOT NULL
      AND signing_key_id IS NOT NULL AND public_key IS NOT NULL
      AND signed_at IS NOT NULL AND body_digest IS NOT NULL)
  ),
  ADD CONSTRAINT ck_response_signed_order CHECK (
    signed_at IS NULL OR signed_at <= created_at + interval '1 minute'
  );

CREATE INDEX ix_responses_signed ON report_responses (report_id)
  WHERE signature IS NOT NULL;

CREATE OR REPLACE FUNCTION panel_apply_verdict(
  p_report_id uuid,
  p_status report_status,
  p_method resolution_method DEFAULT 'panel_review',
  p_verdict resolution_verdict DEFAULT 'confirmed',
  p_note text DEFAULT NULL,
  p_evidence_urls text[] DEFAULT '{}'::text[]
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_current report_status;
  v_claimant uuid;
  v_institution uuid;
BEGIN
  IF current_scope() <> 'partner' THEN
    RAISE EXCEPTION 'hanya panel mitra yang dapat menerapkan vonis';
  END IF;
  IF p_status NOT IN ('verified_resolved', 'disputed') THEN
    RAISE EXCEPTION 'status vonis panel tidak sah';
  END IF;
  IF p_method NOT IN ('field_inspection', 'panel_review') THEN
    RAISE EXCEPTION 'metode vonis panel tidak sah';
  END IF;
  IF cardinality(p_evidence_urls) > 5 THEN
    RAISE EXCEPTION 'bukti vonis panel maksimal 5 tautan';
  END IF;

  v_institution := current_institution();
  IF v_institution IS NULL THEN
    RAISE EXCEPTION 'institusi panel tidak dikenal';
  END IF;
  v_role := current_panel_role(p_report_id);
  IF v_role IS NULL OR v_role <> 'verifier' THEN
    RAISE EXCEPTION 'institusi ini bukan verifier panel untuk laporan tersebut';
  END IF;

  SELECT status, institution_id INTO v_current, v_claimant
  FROM reports WHERE id = p_report_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'laporan tidak ditemukan';
  END IF;
  IF v_current NOT IN ('claimed_resolved', 'disputed') THEN
    RAISE EXCEPTION 'vonis panel hanya berlaku untuk claimed_resolved atau disputed';
  END IF;
  IF v_claimant IS NULL THEN
    RAISE EXCEPTION 'laporan tanpa institusi tidak dapat divonis panel';
  END IF;
  IF v_claimant = v_institution THEN
    RAISE EXCEPTION 'institusi pengklaim tidak boleh memvonis klaimnya sendiri';
  END IF;

  INSERT INTO resolution_verifications (
    report_id, method, verdict, verifier_kind, verifier_institution_id,
    verifier_user_id, claimant_institution_id, note, evidence_urls
  ) VALUES (
    p_report_id, p_method, p_verdict, 'independent_institution', v_institution,
    NULL, v_claimant, p_note, p_evidence_urls
  );

  UPDATE reports
  SET status = p_status,
      resolved_at = CASE WHEN p_status = 'verified_resolved' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_report_id;

  RETURN p_status::text;
END;
$$;

REVOKE ALL ON FUNCTION panel_apply_verdict(uuid, report_status, resolution_method, resolution_verdict, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION panel_apply_verdict(uuid, report_status, resolution_method, resolution_verdict, text, text[]) TO hadir_app;

DROP FUNCTION IF EXISTS panel_apply_verdict(uuid, report_status);

CREATE VIEW response_attestations AS
SELECT
  rp.id AS response_id,
  rp.report_id,
  r.public_id AS report_public_id,
  rp.institution_id,
  rp.kind,
  encode(rp.body_digest, 'hex') AS body_digest_hex,
  rp.evidence_urls,
  rp.corrects_response_id,
  rp.published_at,
  encode(rp.signature, 'base64') AS signature_base64,
  rp.signature_algorithm,
  rp.signing_key_id,
  encode(rp.public_key, 'base64') AS public_key_base64,
  rp.signed_at,
  (rp.signature IS NOT NULL) AS signed
FROM report_responses rp
JOIN reports r ON r.id = rp.report_id;

REVOKE ALL ON response_attestations FROM PUBLIC;
GRANT SELECT ON response_attestations TO hadir_app;

REVOKE UPDATE (body_digest, signature, signature_algorithm, signing_key_id, public_key, signed_at)
  ON report_responses FROM hadir_app;
