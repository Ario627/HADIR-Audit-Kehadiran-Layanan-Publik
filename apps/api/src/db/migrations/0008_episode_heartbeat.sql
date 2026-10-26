ALTER TABLE wait_episodes
  ADD COLUMN last_heartbeat_at timestamp with time zone;

GRANT UPDATE (last_heartbeat_at) ON wait_episodes TO hadir_app;