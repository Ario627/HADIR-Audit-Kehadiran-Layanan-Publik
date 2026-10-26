CREATE TYPE runway_status AS ENUM ('funded', 'pending', 'stopped', 'unknown');
CREATE TYPE runway_event_kind AS ENUM (
  'announced', 'budget_decided', 'funded', 'suspended', 'resumed', 'stopped', 'corrected'
);

CREATE TABLE service_runway (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  status runway_status NOT NULL DEFAULT 'unknown',
  funded_until date,
  source_url text,
  decision_doc text,
  decision_date date,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_runway_route UNIQUE (route_id),
  CONSTRAINT ck_runway_source CHECK (source_url IS NULL OR char_length(source_url) BETWEEN 1 AND 500),
  CONSTRAINT ck_runway_doc CHECK (decision_doc IS NULL OR char_length(decision_doc) <= 500),
  CONSTRAINT ck_runway_note CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE TABLE runway_events (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  runway_id uuid NOT NULL REFERENCES service_runway(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind runway_event_kind NOT NULL,
  note text NOT NULL,
  source_url text NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  prev_hash bytea NOT NULL,
  payload_hash bytea NOT NULL,
  chain_hash bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_runway_events_seq UNIQUE (runway_id, seq),
  CONSTRAINT ck_runway_events_seq CHECK (seq >= 1),
  CONSTRAINT ck_runway_events_note CHECK (char_length(note) BETWEEN 1 AND 500),
  CONSTRAINT ck_runway_events_source CHECK (char_length(source_url) BETWEEN 1 AND 500),
  CONSTRAINT ck_runway_events_prev CHECK (length(prev_hash) = 32),
  CONSTRAINT ck_runway_events_payload CHECK (length(payload_hash) = 32),
  CONSTRAINT ck_runway_events_chain CHECK (length(chain_hash) = 32)
);

CREATE INDEX ix_runway_status ON service_runway (status, funded_until);
CREATE INDEX ix_runway_events_runway ON runway_events (runway_id, seq);

CREATE TRIGGER trg_runway_updated BEFORE UPDATE ON service_runway
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

REVOKE ALL ON service_runway, runway_events FROM hadir_app;
GRANT SELECT ON service_runway, runway_events TO hadir_app;
GRANT INSERT (route_id, status, funded_until, source_url, decision_doc, decision_date, note)
  ON service_runway TO hadir_app;
GRANT UPDATE (status, funded_until, source_url, decision_doc, decision_date, note, updated_at)
  ON service_runway TO hadir_app;
GRANT INSERT (runway_id, seq, kind, note, source_url, occurred_at, prev_hash, payload_hash, chain_hash)
  ON runway_events TO hadir_app;