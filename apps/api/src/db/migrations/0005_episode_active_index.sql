CREATE INDEX IF NOT EXISTS ix_wait_episodes_active_device
  ON wait_episodes (device_hash, started_at DESC)
  WHERE outcome IS NULL;