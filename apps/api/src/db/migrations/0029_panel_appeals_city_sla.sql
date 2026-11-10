CREATE TYPE panel_role AS ENUM ('observer', 'verifier');
CREATE TYPE panel_status AS ENUM ('invited', 'active', 'declined', 'revoked');
CREATE TYPE appeal_grounds AS ENUM ('rejection', 'resolution', 'moderation', 'service');
CREATE TYPE appeal_status AS ENUM ('submitted', 'inadmissible', 'admitted', 'upheld', 'overturned');

CREATE TABLE city_sla_overrides (
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  priority text NOT NULL,
  acknowledge_hours numeric(6, 2) NOT NULL,
  respond_hours numeric(6, 2) NOT NULL,
  resolve_hours numeric(6, 2) NOT NULL,
  source_url text NOT NULL,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_city_sla_overrides PRIMARY KEY (city_id, priority),
  CONSTRAINT ck_city_sla_priority CHECK (
    priority IN ('low', 'normal', 'high', 'critical')
  ),
  CONSTRAINT ck_city_sla_positive CHECK (
    acknowledge_hours > 0 AND respond_hours > 0 AND resolve_hours > 0
  ),
  CONSTRAINT ck_city_sla_order CHECK (
    acknowledge_hours <= respond_hours AND respond_hours <= resolve_hours
  ),
  CONSTRAINT ck_city_sla_source CHECK (char_length(source_url) BETWEEN 8 AND 500),
  CONSTRAINT ck_city_sla_note CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE TRIGGER trg_city_sla_overrides_updated BEFORE UPDATE ON city_sla_overrides
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE report_panel_grants (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  claimant_institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  role panel_role NOT NULL DEFAULT 'verifier',
  status panel_status NOT NULL DEFAULT 'invited',
  invited_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  decided_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_panel_grant UNIQUE (report_id, institution_id),
  CONSTRAINT ck_panel_independence CHECK (institution_id <> claimant_institution_id),
  CONSTRAINT ck_panel_decided CHECK (
    status IN ('invited', 'declined') OR decided_at IS NOT NULL
  ),
  CONSTRAINT ck_panel_revoked CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT ck_panel_revoked_order CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX ix_panel_institution ON report_panel_grants (institution_id, status)
  WHERE status = 'active';
CREATE INDEX ix_panel_report ON report_panel_grants (report_id, status);

CREATE OR REPLACE FUNCTION panel_grant_same_city() RETURNS trigger AS $$
DECLARE
  report_city uuid;
BEGIN
  SELECT r.city_id INTO report_city
  FROM stops s
  JOIN reports r ON r.stop_id = s.id
  WHERE r.id = NEW.report_id;

  IF report_city IS NULL THEN
    RAISE EXCEPTION 'panel hanya berlaku untuk laporan yang punya kota';
  END IF;
  IF report_city <> NEW.city_id THEN
    RAISE EXCEPTION 'kota panel harus sama dengan kota laporan';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_panel_same_city BEFORE INSERT OR UPDATE ON report_panel_grants
FOR EACH ROW EXECUTE FUNCTION panel_grant_same_city();

CREATE TABLE report_appeals (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  device_hash text NOT NULL,
  grounds appeal_grounds NOT NULL,
  status appeal_status NOT NULL DEFAULT 'submitted',
  statement text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  decided_by uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  decided_at timestamp with time zone,
  decision_note text,
  outcome_transition text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_appeal_device CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_appeal_statement CHECK (char_length(statement) BETWEEN 20 AND 2000),
  CONSTRAINT ck_appeal_evidence CHECK (cardinality(evidence_urls) <= 5),
  CONSTRAINT ck_appeal_decision CHECK (
    status IN ('submitted', 'admitted') OR decided_at IS NOT NULL
  ),
  CONSTRAINT ck_appeal_note CHECK (
    decision_note IS NULL OR char_length(decision_note) BETWEEN 10 AND 1000
  ),
  CONSTRAINT ck_appeal_outcome CHECK (
    status IN ('submitted', 'admitted', 'inadmissible') OR outcome_transition IS NOT NULL
  ),
  CONSTRAINT ck_appeal_decided_order CHECK (
    decided_at IS NULL OR decided_at >= created_at
  )
);

CREATE UNIQUE INDEX uq_appeal_ground ON report_appeals (report_id, grounds)
  WHERE status <> 'inadmissible';
CREATE INDEX ix_appeal_report ON report_appeals (report_id, created_at);
CREATE INDEX ix_appeal_pending ON report_appeals (created_at)
  WHERE status = 'submitted';
CREATE INDEX ix_appeal_device ON report_appeals (device_hash, created_at DESC);

CREATE OR REPLACE FUNCTION reject_appeal_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'report_appeals bersifat append-only';
  END IF;
  IF OLD.statement <> NEW.statement
     OR OLD.grounds <> NEW.grounds
     OR OLD.device_hash <> NEW.device_hash
     OR OLD.report_id <> NEW.report_id THEN
    RAISE EXCEPTION 'isi banding tidak boleh diubah setelah dikirim';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appeal_immutable BEFORE UPDATE OR DELETE ON report_appeals
FOR EACH ROW EXECUTE FUNCTION reject_appeal_mutation();

CREATE OR REPLACE FUNCTION appeal_device_matches() RETURNS trigger AS $$
DECLARE
  owner text;
BEGIN
  SELECT device_hash INTO owner FROM reports WHERE id = NEW.report_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'laporan banding tidak ditemukan';
  END IF;
  IF owner <> NEW.device_hash THEN
    RAISE EXCEPTION 'banding hanya boleh diajukan perangkat pelapor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appeal_device BEFORE INSERT ON report_appeals
FOR EACH ROW EXECUTE FUNCTION appeal_device_matches();

ALTER TABLE report_panel_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_sla_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY panel_grants_read ON report_panel_grants
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND (
        institution_id = current_institution()
        OR claimant_institution_id = current_institution()
      )
    )
    OR (
      current_scope() = 'public'
      AND status = 'active'
    )
  );

CREATE POLICY panel_grants_write ON report_panel_grants
  AS PERMISSIVE
  FOR ALL
  TO hadir_app
  USING (current_scope() = 'admin')
  WITH CHECK (current_scope() = 'admin');

CREATE POLICY appeals_read ON report_appeals
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND device_hash = current_device_hash()
    )
    OR (
      current_scope() = 'public'
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_appeals.report_id
          AND r.moderation = 'approved'
      )
    )
  );

CREATE POLICY appeals_insert ON report_appeals
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (
    current_scope() = 'admin'
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND device_hash = current_device_hash()
    )
  );

CREATE POLICY appeals_update ON report_appeals
  AS PERMISSIVE
  FOR UPDATE
  TO hadir_app
  USING (current_scope() = 'admin')
  WITH CHECK (current_scope() = 'admin');

CREATE POLICY city_sla_read ON city_sla_overrides
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (true);

CREATE POLICY city_sla_write ON city_sla_overrides
  AS PERMISSIVE
  FOR ALL
  TO hadir_app
  USING (current_scope() = 'admin')
  WITH CHECK (current_scope() = 'admin');

DROP POLICY IF EXISTS reports_read ON reports;

CREATE POLICY reports_read ON reports
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'public'
      AND moderation = 'approved'
      AND status NOT IN ('draft', 'rejected', 'closed')
    )
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND (
        institution_id = current_institution()
        OR EXISTS (
          SELECT 1 FROM report_panel_grants g
          WHERE g.report_id = reports.id
            AND g.institution_id = current_institution()
            AND g.status = 'active'
        )
      )
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND device_hash = current_device_hash()
    )
  );

DROP POLICY IF EXISTS report_media_read ON report_media;

CREATE POLICY report_media_read ON report_media
  AS PERMISSIVE
  FOR SELECT
  TO hadir_app
  USING (
    current_scope() = 'admin'
    OR (
      current_scope() = 'public'
      AND status = 'approved'
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.moderation = 'approved'
          AND r.status NOT IN ('draft', 'rejected', 'closed')
      )
    )
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND (
            r.institution_id = current_institution()
            OR EXISTS (
              SELECT 1 FROM report_panel_grants g
              WHERE g.report_id = r.id
                AND g.institution_id = current_institution()
                AND g.status = 'active'
            )
          )
      )
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM reports r
        WHERE r.id = report_media.report_id
          AND r.device_hash = current_device_hash()
      )
    )
  );

DROP POLICY IF EXISTS report_responses_read ON report_responses;

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
          AND (
            r.institution_id = current_institution()
            OR EXISTS (
              SELECT 1 FROM report_panel_grants g
              WHERE g.report_id = r.id
                AND g.institution_id = current_institution()
                AND g.status = 'active'
            )
          )
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

REVOKE ALL ON city_sla_overrides FROM PUBLIC;
REVOKE ALL ON city_sla_overrides FROM hadir_app;
REVOKE ALL ON report_panel_grants FROM PUBLIC;
REVOKE ALL ON report_panel_grants FROM hadir_app;
REVOKE ALL ON report_appeals FROM PUBLIC;
REVOKE ALL ON report_appeals FROM hadir_app;

GRANT SELECT, INSERT, UPDATE ON city_sla_overrides TO hadir_app;
GRANT SELECT, INSERT, UPDATE ON report_panel_grants TO hadir_app;
GRANT SELECT, INSERT ON report_appeals TO hadir_app;
GRANT UPDATE (status, decided_by, decided_at, decision_note, outcome_transition)
  ON report_appeals TO hadir_app;

REVOKE ALL ON FUNCTION panel_grant_same_city() FROM PUBLIC;
REVOKE ALL ON FUNCTION reject_appeal_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION appeal_device_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION panel_grant_same_city() TO hadir_app;
GRANT EXECUTE ON FUNCTION reject_appeal_mutation() TO hadir_app;
GRANT EXECUTE ON FUNCTION appeal_device_matches() TO hadir_app;

CREATE OR REPLACE FUNCTION current_panel_role(p_report_id uuid) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT g.role::text
  FROM report_panel_grants g
  WHERE g.report_id = p_report_id
    AND g.institution_id = current_institution()
    AND g.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION current_panel_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_panel_role(uuid) TO hadir_app;

CREATE OR REPLACE FUNCTION panel_apply_verdict(
  p_report_id uuid,
  p_status report_status
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_current report_status;
BEGIN
  IF current_scope() <> 'partner' THEN
    RAISE EXCEPTION 'hanya panel mitra yang dapat menerapkan vonis';
  END IF;
  IF p_status NOT IN ('verified_resolved', 'disputed') THEN
    RAISE EXCEPTION 'status vonis panel tidak sah';
  END IF;
  v_role := current_panel_role(p_report_id);
  IF v_role IS NULL OR v_role <> 'verifier' THEN
    RAISE EXCEPTION 'institusi ini bukan verifier panel untuk laporan tersebut';
  END IF;

  SELECT status INTO v_current FROM reports WHERE id = p_report_id FOR UPDATE;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'laporan tidak ditemukan';
  END IF;
  IF v_current NOT IN ('claimed_resolved', 'disputed') THEN
    RAISE EXCEPTION 'vonis panel hanya berlaku untuk claimed_resolved atau disputed';
  END IF;

  UPDATE reports
  SET status = p_status,
      resolved_at = CASE WHEN p_status = 'verified_resolved' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_report_id;

  RETURN p_status::text;
END;
$$;

REVOKE ALL ON FUNCTION panel_apply_verdict(uuid, report_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION panel_apply_verdict(uuid, report_status) TO hadir_app;

DROP POLICY IF EXISTS resolution_read ON resolution_verifications;

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
      AND (
        verifier_institution_id = current_institution()
        OR EXISTS (
          SELECT 1 FROM reports r
          WHERE r.id = resolution_verifications.report_id
            AND r.institution_id = current_institution()
        )
        OR current_panel_role(resolution_verifications.report_id) IS NOT NULL
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

DROP POLICY IF EXISTS resolution_insert ON resolution_verifications;

CREATE POLICY resolution_insert ON resolution_verifications
  AS PERMISSIVE
  FOR INSERT
  TO hadir_app
  WITH CHECK (
    current_scope() = 'admin'
    OR (
      current_scope() = 'partner'
      AND current_institution() IS NOT NULL
      AND verifier_institution_id = current_institution()
      AND current_panel_role(report_id) = 'verifier'
    )
    OR (
      current_scope() = 'citizen'
      AND current_device_hash() IS NOT NULL
    )
  );
