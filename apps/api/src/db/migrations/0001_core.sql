CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hadir_app') THEN
    CREATE ROLE hadir_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE hadir_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE hadir_app SET statement_timeout = '10s';
ALTER ROLE hadir_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE hadir_app SET lock_timeout = '5s';
ALTER ROLE hadir_app SET search_path = public;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO hadir_app;

CREATE TYPE route_mode AS ENUM ('brt', 'non_brt', 'feeder', 'other');
CREATE TYPE service_status AS ENUM ('active', 'suspended', 'stopped', 'planned');
CREATE TYPE stop_status AS ENUM ('active', 'inactive', 'moved', 'planned');
CREATE TYPE day_type AS ENUM ('weekday', 'saturday', 'sunday', 'holiday');
CREATE TYPE episode_start_mode AS ENUM ('qr', 'gps_nearby', 'manual', 'resume', 'import');
CREATE TYPE episode_outcome AS ENUM ('boarded', 'abandoned', 'passed_full', 'cancelled', 'timeout');
CREATE TYPE episode_presence AS ENUM ('unverified', 'qr_only', 'qr_geo', 'gps_verified', 'field_verified');
CREATE TYPE episode_time_source AS ENUM ('server', 'client');
CREATE TYPE distance_bucket AS ENUM ('0-50', '50-100', '100-150', '150-300', '>300');
CREATE TYPE accuracy_bucket AS ENUM ('<=20', '21-50', '51-80', '81-150', '>150');
CREATE TYPE audit_actor_type AS ENUM ('citizen', 'partner', 'system', 'moderator', 'superadmin');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;

CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_cities_code UNIQUE (code),
  CONSTRAINT ck_cities_code_format CHECK (code ~ '^[A-Z]{2,8}$'),
  CONSTRAINT ck_cities_name_length CHECK (char_length(name) BETWEEN 1 AND 120)
);

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  mode route_mode NOT NULL DEFAULT 'feeder',
  promised_headway_peak_min integer,
  promised_headway_off_min integer,
  headway_source_url text,
  headway_valid_from date,
  headway_valid_to date,
  status service_status NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_routes_city_code UNIQUE (city_id, code),
  CONSTRAINT ck_routes_code_format CHECK (code ~ '^[A-Z0-9]{1,12}$'),
  CONSTRAINT ck_routes_name_length CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT ck_routes_headway_peak CHECK (promised_headway_peak_min IS NULL OR promised_headway_peak_min > 0),
  CONSTRAINT ck_routes_headway_off CHECK (promised_headway_off_min IS NULL OR promised_headway_off_min > 0),
  CONSTRAINT ck_routes_headway_period CHECK (headway_valid_from IS NULL OR headway_valid_to IS NULL OR headway_valid_from <= headway_valid_to)
);

CREATE TABLE stops (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  geom geography NOT NULL,
  geofence_radius_m integer NOT NULL DEFAULT 150,
  status stop_status NOT NULL DEFAULT 'active',
  qr_asset_url text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_stops_city_code UNIQUE (city_id, code),
  CONSTRAINT ck_stops_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,11}$'),
  CONSTRAINT ck_stops_name_length CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT ck_stops_geofence_radius CHECK (geofence_radius_m BETWEEN 50 AND 500),
  CONSTRAINT ck_stops_description_length CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT ck_stops_qr_asset_url_length CHECK (qr_asset_url IS NULL OR char_length(qr_asset_url) <= 500),
  CONSTRAINT ck_stops_geom_point CHECK (ST_SRID(geom::geometry) = 4326 AND ST_GeometryType(geom::geometry) = 'ST_Point')
);

CREATE INDEX ix_stops_geom ON stops USING gist (geom);
CREATE INDEX ix_stops_name_trgm ON stops USING gin (name gin_trgm_ops);

CREATE TABLE route_stops (
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id uuid NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  direction smallint NOT NULL DEFAULT 0,
  seq integer NOT NULL,
  CONSTRAINT pk_route_stops PRIMARY KEY (route_id, direction, seq),
  CONSTRAINT uq_route_stops_stop UNIQUE (route_id, direction, stop_id),
  CONSTRAINT ck_route_stops_direction CHECK (direction IN (0, 1)),
  CONSTRAINT ck_route_stops_seq CHECK (seq >= 0)
);

CREATE INDEX ix_route_stops_stop ON route_stops (stop_id);

CREATE TABLE route_service_windows (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  day_type day_type NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  headway_min integer NOT NULL,
  source_url text,
  CONSTRAINT ck_route_windows_order CHECK (end_time > start_time),
  CONSTRAINT ck_route_windows_headway CHECK (headway_min > 0)
);

CREATE INDEX ix_route_windows_route ON route_service_windows (route_id, day_type);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  device_hash text NOT NULL,
  first_seen timestamp with time zone NOT NULL DEFAULT now(),
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  trust_score real NOT NULL DEFAULT 0.5,
  flags text[] NOT NULL DEFAULT '{}'::text[],
  revoked_at timestamp with time zone,
  CONSTRAINT uq_devices_hash UNIQUE (device_hash),
  CONSTRAINT ck_devices_trust CHECK (trust_score BETWEEN 0 AND 1)
);

CREATE INDEX ix_devices_last_seen ON devices (last_seen);

CREATE TABLE wait_episodes (
  id uuid NOT NULL DEFAULT uuidv7(),
  stop_id uuid NOT NULL REFERENCES stops(id) ON DELETE RESTRICT,
  route_id uuid REFERENCES routes(id) ON DELETE SET NULL,
  start_mode episode_start_mode NOT NULL,
  presence episode_presence NOT NULL DEFAULT 'unverified',
  outcome episode_outcome,
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,
  duration_s integer GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NULL THEN NULL
         ELSE GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::integer)
    END
  ) STORED,
  client_started_at timestamp with time zone,
  client_ended_at timestamp with time zone,
  clock_skew_ms integer,
  time_source episode_time_source NOT NULL DEFAULT 'server',
  device_hash text NOT NULL,
  device_day_hash text NOT NULL,
  client_event_id uuid NOT NULL,
  qr_epoch text,
  qr_key_id text,
  distance_bucket distance_bucket,
  accuracy_bucket accuracy_bucket,
  geo_ok boolean NOT NULL DEFAULT false,
  trust_weight real NOT NULL DEFAULT 0.6,
  quality_flags text[] NOT NULL DEFAULT '{}'::text[],
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_wait_episodes PRIMARY KEY (id, started_at),
  CONSTRAINT ck_wait_episodes_time_order CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT ck_wait_episodes_trust CHECK (trust_weight BETWEEN 0 AND 1),
  CONSTRAINT ck_wait_episodes_note_length CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT ck_wait_episodes_client_event_version CHECK (substring(client_event_id::text, 15, 1) = '7')
) PARTITION BY RANGE (started_at);

CREATE TABLE wait_episodes_2026_10 PARTITION OF wait_episodes
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
CREATE TABLE wait_episodes_2026_11 PARTITION OF wait_episodes
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE wait_episodes_2026_12 PARTITION OF wait_episodes
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE wait_episodes_2027_01 PARTITION OF wait_episodes
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
CREATE TABLE wait_episodes_2027_02 PARTITION OF wait_episodes
  FOR VALUES FROM ('2027-02-01 00:00:00+00') TO ('2027-03-01 00:00:00+00');
CREATE TABLE wait_episodes_2027_03 PARTITION OF wait_episodes
  FOR VALUES FROM ('2027-03-01 00:00:00+00') TO ('2027-04-01 00:00:00+00');

CREATE INDEX ix_wait_episodes_stop_started ON wait_episodes (stop_id, route_id, started_at DESC);
CREATE INDEX ix_wait_episodes_device_started ON wait_episodes (device_hash, started_at DESC);
CREATE INDEX ix_wait_episodes_day_hash_started ON wait_episodes (device_day_hash, started_at DESC);
CREATE INDEX ix_wait_episodes_client_event ON wait_episodes (client_event_id);

CREATE TABLE wait_episode_events (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  episode_id uuid NOT NULL,
  episode_started_at timestamp with time zone NOT NULL,
  seq integer NOT NULL,
  kind text NOT NULL,
  actor_type audit_actor_type NOT NULL,
  actor_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash bytea NOT NULL,
  payload_hash bytea NOT NULL,
  chain_hash bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_wait_episode_events_seq UNIQUE (episode_id, seq),
  CONSTRAINT ck_wait_episode_events_seq CHECK (seq >= 1),
  CONSTRAINT ck_wait_episode_events_kind_length CHECK (char_length(kind) BETWEEN 1 AND 40),
  CONSTRAINT fk_wait_episode_events_episode FOREIGN KEY (episode_id, episode_started_at)
    REFERENCES wait_episodes(id, started_at) ON DELETE CASCADE
);

CREATE INDEX ix_wait_episode_events_episode ON wait_episode_events (episode_id, seq);

CREATE TABLE idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash bytea NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT pk_idempotency_keys PRIMARY KEY (scope, key),
  CONSTRAINT ck_idempotency_keys_scope_length CHECK (char_length(scope) BETWEEN 1 AND 80),
  CONSTRAINT ck_idempotency_keys_key_length CHECK (char_length(key) BETWEEN 8 AND 128),
  CONSTRAINT ck_idempotency_keys_status CHECK (response_status BETWEEN 100 AND 599)
);

CREATE INDEX ix_idempotency_keys_expires ON idempotency_keys (expires_at);

CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  attempts integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_outbox_attempts CHECK (attempts >= 0),
  CONSTRAINT ck_outbox_topic_length CHECK (char_length(topic) BETWEEN 1 AND 80)
);

CREATE INDEX ix_outbox_unprocessed ON outbox (created_at) WHERE processed_at IS NULL;

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  actor_type audit_actor_type NOT NULL,
  actor_id text,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text,
  request_id text,
  ip_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ck_audit_action_length CHECK (char_length(action) BETWEEN 1 AND 80),
  CONSTRAINT ck_audit_object_type_length CHECK (char_length(object_type) BETWEEN 1 AND 80)
);

CREATE INDEX ix_audit_created_brin ON audit_log USING brin (created_at);
CREATE INDEX ix_audit_object ON audit_log (object_type, object_id, created_at DESC);

CREATE TRIGGER trg_routes_updated BEFORE UPDATE ON routes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_stops_updated BEFORE UPDATE ON stops
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_wait_episodes_updated BEFORE UPDATE ON wait_episodes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hadir_app;

GRANT SELECT ON cities, routes, stops, route_stops, route_service_windows TO hadir_app;
GRANT SELECT ON devices TO hadir_app;
GRANT INSERT (device_hash, trust_score, flags) ON devices TO hadir_app;
GRANT UPDATE (last_seen, trust_score, flags, revoked_at) ON devices TO hadir_app;
GRANT SELECT ON wait_episodes TO hadir_app;
GRANT INSERT (
  stop_id, route_id, start_mode, presence, outcome, started_at, ended_at,
  client_started_at, client_ended_at, clock_skew_ms, time_source, device_hash,
  device_day_hash, client_event_id, qr_epoch, qr_key_id, distance_bucket,
  accuracy_bucket, geo_ok, trust_weight, quality_flags, note
) ON wait_episodes TO hadir_app;
GRANT UPDATE (outcome, ended_at, client_ended_at, note, quality_flags, updated_at)
  ON wait_episodes TO hadir_app;
GRANT SELECT ON wait_episode_events TO hadir_app;
GRANT INSERT (
  episode_id, episode_started_at, seq, kind, actor_type, actor_id, payload,
  prev_hash, payload_hash, chain_hash
) ON wait_episode_events TO hadir_app;
GRANT SELECT ON idempotency_keys TO hadir_app;
GRANT INSERT (scope, key, request_hash, response_status, response_body, expires_at)
  ON idempotency_keys TO hadir_app;
GRANT UPDATE (response_status, response_body) ON idempotency_keys TO hadir_app;
GRANT SELECT ON outbox TO hadir_app;
GRANT INSERT (topic, payload) ON outbox TO hadir_app;
GRANT UPDATE (processed_at, attempts) ON outbox TO hadir_app;
GRANT SELECT ON audit_log TO hadir_app;
GRANT INSERT (actor_type, actor_id, action, object_type, object_id, request_id, ip_hash, payload)
  ON audit_log TO hadir_app;
GRANT EXECUTE ON FUNCTION set_updated_at() TO hadir_app;