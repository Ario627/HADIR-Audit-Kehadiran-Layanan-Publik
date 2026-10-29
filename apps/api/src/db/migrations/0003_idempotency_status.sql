ALTER TABLE idempotency_keys DROP CONSTRAINT ck_idempotency_keys_status;
ALTER TABLE idempotency_keys ADD CONSTRAINT ck_idempotency_keys_status CHECK (response_status BETWEEN 0 AND 599);