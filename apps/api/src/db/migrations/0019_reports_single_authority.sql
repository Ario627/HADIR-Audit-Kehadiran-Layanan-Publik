UPDATE reports
SET institution_id = authority_id
WHERE institution_id IS NULL AND authority_id IS NOT NULL;

UPDATE reports
SET authority_id = institution_id
WHERE authority_id IS NULL AND institution_id IS NOT NULL;

ALTER TABLE reports DROP COLUMN authority_id;