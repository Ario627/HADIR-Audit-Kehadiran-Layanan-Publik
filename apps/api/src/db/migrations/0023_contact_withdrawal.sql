CREATE OR REPLACE FUNCTION withdraw_report_contact(p_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE reports
  SET contact_email_enc = NULL,
      contact_email_hash = NULL,
      updated_at = now()
  WHERE id = p_report_id
    AND current_scope() = 'citizen'
    AND current_device_hash() IS NOT NULL
    AND device_hash = current_device_hash()
    AND (contact_email_enc IS NOT NULL OR contact_email_hash IS NOT NULL);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION withdraw_report_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_report_contact(uuid) TO hadir_app;

CREATE OR REPLACE FUNCTION report_contact_ciphertext(p_report_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  payload bytea;
BEGIN
  SELECT contact_email_enc INTO payload
  FROM reports
  WHERE id = p_report_id
    AND contact_email_enc IS NOT NULL
    AND (
      current_scope() = 'admin'
      OR (
        current_scope() = 'partner'
        AND current_institution() IS NOT NULL
        AND institution_id = current_institution()
      )
    );

  IF payload IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(payload, 'base64');
END;
$$;

REVOKE ALL ON FUNCTION report_contact_ciphertext(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_contact_ciphertext(uuid) TO hadir_app;

