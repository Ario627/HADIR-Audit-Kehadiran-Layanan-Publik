CREATE OR REPLACE FUNCTION panel_grant_same_city() RETURNS trigger AS $$
DECLARE
  report_city uuid;
BEGIN
  SELECT s.city_id INTO report_city
  FROM reports r
  JOIN stops s ON s.id = r.stop_id
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
