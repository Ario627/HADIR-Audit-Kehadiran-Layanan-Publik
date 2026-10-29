CREATE TYPE upload_purpose AS ENUM ('report_photo', 'closure_evidence');
CREATE TYPE upload_status AS ENUM ('pending', 'stored', 'rejected', 'attached');

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  device_hash text NOT NULL,
  token_hash bytea NOT NULL,
  purpose upload_purpose NOT NULL,
  declared_mime text NOT NULL,
  declared_size integer NOT NULL,
  actual_mime text,
  actual_size integer,
  width integer,
  height integer,
  sha256 bytea,
  object_key text,
  status upload_status NOT NULL DEFAULT 'pending',
  has_exif boolean NOT NULL DEFAULT false,
  rejection_code text,
  report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  stored_at timestamp with time zone,
  CONSTRAINT uq_uploads_token UNIQUE (token_hash),
  CONSTRAINT uq_uploads_object UNIQUE (object_key),
  CONSTRAINT ck_uploads_token_bytes CHECK (octet_length(token_hash) = 32),
  CONSTRAINT ck_uploads_device CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_uploads_declared_size CHECK (declared_size BETWEEN 1 AND 5242880),
  CONSTRAINT ck_uploads_actual_size CHECK (actual_size IS NULL OR actual_size BETWEEN 1 AND 5242880),
  CONSTRAINT ck_uploads_declared_mime CHECK (declared_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_uploads_actual_mime CHECK (actual_mime IS NULL OR actual_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_uploads_dimensions CHECK ((width IS NULL AND height IS NULL) OR (width > 0 AND height > 0)),
  CONSTRAINT ck_uploads_sha CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
  CONSTRAINT ck_uploads_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_uploads_stored CHECK ((status = 'stored' OR status = 'attached') = (object_key IS NOT NULL)),
  CONSTRAINT ck_uploads_rejection CHECK ((rejection_code IS NULL) OR (status = 'rejected'))
);

CREATE INDEX ix_uploads_device ON uploads (device_hash, created_at DESC);
CREATE INDEX ix_uploads_pending ON uploads (expires_at) WHERE status = 'pending';

GRANT SELECT, INSERT ON uploads TO hadir_app;
GRANT UPDATE (actual_mime, actual_size, width, height, sha256, object_key, status, has_exif, rejection_code, report_id, stored_at) ON uploads TO hadir_app;
GRANT UPDATE (status) ON report_media TO hadir_app;
GRANT INSERT (report_id, object_key, mime, width, height, sha256, status) ON report_media TO hadir_app;
