CREATE OR REPLACE FUNCTION assert_commitment_city() RETURNS trigger AS $$
DECLARE
  institution_city uuid;
  target_city uuid;
BEGIN
  SELECT city_id INTO institution_city FROM institutions WHERE id = NEW.institution_id;
  IF NEW.stop_id IS NOT NULL THEN
    SELECT city_id INTO target_city FROM stops WHERE id = NEW.stop_id;
  ELSE
    SELECT city_id INTO target_city FROM routes WHERE id = NEW.route_id;
  END IF;
  IF institution_city IS NOT NULL AND target_city IS NOT NULL
     AND institution_city <> target_city THEN
    RAISE EXCEPTION 'Janji layanan harus berada di kota instansi yang sama.'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'ck_commitment_city';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_commitment_city
BEFORE INSERT OR UPDATE OF institution_id, route_id, stop_id ON service_commitments
FOR EACH ROW EXECUTE FUNCTION assert_commitment_city();
