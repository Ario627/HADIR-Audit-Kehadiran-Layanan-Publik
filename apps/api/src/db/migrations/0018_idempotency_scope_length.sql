ALTER TABLE idempotency_keys
  DROP CONSTRAINT ck_idempotency_keys_scope_length;

ALTER TABLE idempotency_keys
  ADD CONSTRAINT ck_idempotency_keys_scope_length
  CHECK (char_length(scope) BETWEEN 1 AND 160);