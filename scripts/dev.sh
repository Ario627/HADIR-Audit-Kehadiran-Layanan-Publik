#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
COMPOSE_FILE="$ROOT_DIR/infra/compose/docker-compose.dev.yml"
ENV_FILE="$API_DIR/.env"
ENV_EXAMPLE="$API_DIR/.env.example"

API_PORT="${HADIR_API_PORT:-3000}"
WEB_PORT="${HADIR_WEB_PORT:-5173}"
DEFAULT_DB_URL="postgres://hadir:hadir@localhost:5432/hadir"
DEFAULT_REDIS_URL="redis://localhost:6379"
DB_WAIT_SECONDS="${HADIR_DB_WAIT_SECONDS:-60}"

MODE_CHECK=0
USE_DOCKER="auto"
FORCE_SEED=0
ENV_CREATED=0
DOCKER_STARTED=0
SERVER_STARTED=0

say() { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok() { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'TXT'
HADIR — satu perintah untuk menyalakan seluruh lingkungan pengembangan.

Pakai:
  bash scripts/dev.sh              Deteksi otomatis: Docker bila bisa, kalau tidak pakai layanan lokal.
  bash scripts/dev.sh --check      Hanya preflight: versi, database, migrasi. Tidak menyalakan server.
  bash scripts/dev.sh --no-docker  Paksa memakai PostgreSQL dan Redis lokal.
  bash scripts/dev.sh --docker     Paksa memakai Docker (gagal keras bila Docker tidak bisa dipakai).
  bash scripts/dev.sh --seed       Isi ulang data demo walau database sudah berisi.
  bash scripts/dev.sh --help       Tampilkan bantuan ini.

Variabel lingkungan:
  HADIR_API_PORT          Port API (bawaan 3000)
  HADIR_WEB_PORT          Port web (bawaan 5173)
  HADIR_DB_WAIT_SECONDS   Batas tunggu database siap (bawaan 60)
  DATABASE_URL            Menimpa URL database
  REDIS_URL               Menimpa URL Redis
TXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE_CHECK=1 ;;
    --no-docker) USE_DOCKER=0 ;;
    --docker) USE_DOCKER=1 ;;
    --seed) FORCE_SEED=1 ;;
    --help | -h) usage; exit 0 ;;
    *) die "Argumen tidak dikenal: $1 (pakai --help)" ;;
  esac
  shift
done

need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 tidak ditemukan di PATH."
}

version_ok() {
  local have major
  have="$("$1" --version 2>/dev/null | head -1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  [ -n "$have" ] || return 1
  major="${have%%.*}"
  [ "$major" -ge "$2" ]
}

read_env_value() {
  [ -f "$ENV_FILE" ] || return 0
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | head -1 || true)"
  [ -n "$line" ] || return 0
  printf '%s' "${line#*=}" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

write_env_value() {
  local key="$1" value="$2"
  if grep -qE "^$key=" "$ENV_FILE"; then
    sed -i -E "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

port_busy() {
  ss -ltn 2>/dev/null | grep -q ":$1 "
}

db_reachable() {
  ( cd "$API_DIR" && DATABASE_URL="$1" node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2500 });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  ' >/dev/null 2>&1 )
}

db_scalar() {
  ( cd "$API_DIR" && DATABASE_URL="$1" node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2500 });
    try {
      await client.connect();
      const result = await client.query(process.argv[1]);
      await client.end();
      const row = result.rows[0];
      const value = row === undefined ? "" : Object.values(row)[0];
      process.stdout.write(value === null || value === undefined ? "" : String(value));
    } catch {
      process.stdout.write("");
    }
  ' "$2" 2>/dev/null )
}

docker_usable() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  docker compose version >/dev/null 2>&1 || return 1
  return 0
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

start_docker_infra() {
  say "Menyalakan PostgreSQL + Redis lewat Docker"
  compose up -d postgres redis >/dev/null 2>&1 || return 1
  local waited=0
  local pg_state redis_state
  while [ "$waited" -lt "$DB_WAIT_SECONDS" ]; do
    pg_state="$(docker inspect --format '{{.State.Health.Status}}' hadir-postgres 2>/dev/null || echo missing)"
    redis_state="$(docker inspect --format '{{.State.Health.Status}}' hadir-redis 2>/dev/null || echo missing)"
    if [ "$pg_state" = "healthy" ] && [ "$redis_state" = "healthy" ]; then
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

stop_docker_infra() {
  docker_usable || return 0
  compose stop postgres redis >/dev/null 2>&1 || true
}

discard_docker_infra() {
  docker_usable || return 0
  compose down --remove-orphans >/dev/null 2>&1 || true
}

preflight() {
  say "Memeriksa prasyarat"
  need node
  need pnpm
  version_ok node 24 || die "Butuh Node >= 24. Versi sekarang: $(node --version)."
  version_ok pnpm 12 || die "Butuh pnpm >= 12. Versi sekarang: $(pnpm --version)."
  ok "Node $(node --version), pnpm $(pnpm --version)"

  [ -d "$ROOT_DIR/node_modules" ] || die "Dependensi belum dipasang. Jalankan: pnpm install"
  ok "node_modules tersedia"
}

prepare_env() {
  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ENV_EXAMPLE" ] || die "Tidak menemukan $ENV_EXAMPLE"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ENV_CREATED=1
    say "Membuat $ENV_FILE dari contoh"
  fi
  local secret
  secret="$(read_env_value SESSION_SECRET)"
  if [ -z "$secret" ] || [ "$secret" = "dev-only-change-me-0000000000000000" ] || [ "${#secret}" -lt 32 ]; then
    write_env_value SESSION_SECRET "$(openssl rand -base64 32 | tr -d '\n')"
    say "Membuat SESSION_SECRET acak untuk pengembangan"
  fi
  write_env_value PORT "$API_PORT"
  write_env_value WEB_ORIGIN "http://localhost:$WEB_PORT"
  ok "Konfigurasi API siap di apps/api/.env"
}

persist_urls() {
  if [ "$INFRA" != "docker" ]; then
    return 0
  fi
  write_env_value DATABASE_URL "$DB_URL"
  write_env_value REDIS_URL "$REDIS_RESOLVED"
  ok "URL database dan Redis ditulis ke apps/api/.env"
}

resolve_infra() {
  local from_env from_process
  from_process="${DATABASE_URL:-}"
  from_env="$(read_env_value DATABASE_URL)"

  if [ -n "$from_process" ]; then
    DB_URL="$from_process"
    REDIS_RESOLVED="${REDIS_URL:-$(read_env_value REDIS_URL)}"
    REDIS_RESOLVED="${REDIS_RESOLVED:-$DEFAULT_REDIS_URL}"
    ok "Memakai DATABASE_URL dari lingkungan"
    INFRA="external"
    return 0
  fi

  if [ "$USE_DOCKER" = "0" ]; then
    DB_URL="${from_env:-$DEFAULT_DB_URL}"
    REDIS_RESOLVED="${REDIS_URL:-$(read_env_value REDIS_URL)}"
    REDIS_RESOLVED="${REDIS_RESOLVED:-$DEFAULT_REDIS_URL}"
    INFRA="local"
    say "Docker dilewati, memakai layanan lokal"
    return 0
  fi

  if [ "$ENV_CREATED" = "0" ] && [ -n "$from_env" ] && db_reachable "$from_env"; then
    DB_URL="$from_env"
    REDIS_RESOLVED="${REDIS_URL:-$(read_env_value REDIS_URL)}"
    REDIS_RESOLVED="${REDIS_RESOLVED:-$DEFAULT_REDIS_URL}"
    INFRA="external"
    ok "Memakai database dari apps/api/.env"
    return 0
  fi

  if docker_usable; then
    if start_docker_infra; then
      DB_URL="$DEFAULT_DB_URL"
      REDIS_RESOLVED="$DEFAULT_REDIS_URL"
      INFRA="docker"
      DOCKER_STARTED=1
      ok "PostgreSQL dan Redis siap lewat Docker"
      return 0
    fi
    warn "Docker terpasang tetapi kontainer gagal sehat. Membersihkan percobaan."
    discard_docker_infra
    if [ "$USE_DOCKER" = "1" ]; then
      die "Docker dipaksa tetapi tidak bisa dipakai. Periksa 'docker compose -f $COMPOSE_FILE logs'."
    fi
  else
    if [ "$USE_DOCKER" = "1" ]; then
      die "Docker tidak bisa dipakai di mesin ini."
    fi
    warn "Docker tidak tersedia, mencoba layanan lokal"
  fi

  DB_URL="${from_env:-$DEFAULT_DB_URL}"
  REDIS_RESOLVED="${REDIS_URL:-$(read_env_value REDIS_URL)}"
  REDIS_RESOLVED="${REDIS_RESOLVED:-$DEFAULT_REDIS_URL}"
  INFRA="local"
}

wait_for_db() {
  say "Menunggu database menerima koneksi"
  local waited=0
  while [ "$waited" -lt "$DB_WAIT_SECONDS" ]; do
    if db_reachable "$DB_URL"; then
      ok "Database menerima koneksi"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  die "Database tidak bisa dihubungi dalam $DB_WAIT_SECONDS detik.
  URL     : $DB_URL
  Docker  : bash scripts/dev.sh --docker
  Lokal   : pastikan PostgreSQL hidup, lalu buat role dan database bernama hadir:
            sudo -u postgres psql -c \"CREATE ROLE hadir LOGIN PASSWORD 'hadir' SUPERUSER\"
            sudo -u postgres createdb -O hadir hadir
            sudo -u postgres psql -d hadir -c 'CREATE EXTENSION IF NOT EXISTS postgis'"
}

check_postgis() {
  local flag
  flag="$(db_scalar "$DB_URL" "select extname from pg_extension where extname = 'postgis'")"
  if [ "$flag" = "postgis" ]; then
    ok "Ekstensi PostGIS aktif"
    return 0
  fi
  local available
  available="$(db_scalar "$DB_URL" "select name from pg_available_extensions where name = 'postgis'")"
  if [ "$available" = "postgis" ]; then
    warn "PostGIS tersedia tetapi belum aktif. Migrasi akan mengaktifkannya."
    return 0
  fi
  die "PostGIS tidak terpasang di server database.
  Debian/Ubuntu : sudo apt install postgresql-18-postgis-3
  Arch          : sudo pacman -S postgis
  Docker        : bash scripts/dev.sh --docker"
}

run_migrations() {
  say "Menjalankan migrasi"
  ( cd "$ROOT_DIR" && DATABASE_URL="$DB_URL" pnpm --filter @hadir/api db:migrate ) || die "Migrasi gagal."
  ok "Skema database mutakhir"
}

seed_if_needed() {
  local stops
  stops="$(db_scalar "$DB_URL" "select count(*) from stops")"
  if [ "$FORCE_SEED" = "0" ] && [ -n "$stops" ] && [ "$stops" != "0" ]; then
    ok "Data demo sudah ada ($stops halte), seed dilewati"
    return 0
  fi
  say "Mengisi data demo"
  ( cd "$ROOT_DIR" && DATABASE_URL="$DB_URL" pnpm --filter @hadir/api db:seed ) || die "Seed gagal."
  ok "Data demo siap"
}

check_ports() {
  if port_busy "$API_PORT"; then
    die "Port $API_PORT sudah dipakai. Hentikan prosesnya atau jalankan HADIR_API_PORT=3100 bash scripts/dev.sh"
  fi
  if port_busy "$WEB_PORT"; then
    die "Port $WEB_PORT sudah dipakai. Hentikan prosesnya atau jalankan HADIR_WEB_PORT=5273 bash scripts/dev.sh"
  fi
  ok "Port $API_PORT dan $WEB_PORT bebas"
}

shutdown() {
  local code=$?
  trap - EXIT INT TERM
  if [ "${SERVER_STARTED:-0}" = "1" ]; then
    say "Menghentikan server"
    kill 0 2>/dev/null || true
    wait 2>/dev/null || true
  fi
  if [ "${DOCKER_STARTED:-0}" = "1" ] && [ "${HADIR_KEEP_INFRA:-0}" != "1" ]; then
    say "Menghentikan kontainer infrastruktur"
    stop_docker_infra
  elif [ "${DOCKER_STARTED:-0}" = "1" ]; then
    say "Kontainer dibiarkan hidup (HADIR_KEEP_INFRA=1)"
  fi
  exit "$code"
}

trap shutdown EXIT INT TERM

preflight
prepare_env
resolve_infra
persist_urls
wait_for_db
check_postgis
run_migrations
seed_if_needed

if [ "$MODE_CHECK" = "1" ]; then
  ok "Preflight selesai. Infrastruktur: $INFRA"
  exit 0
fi

check_ports
say "Menyalakan API dan web"
SERVER_STARTED=1
printf '\n  Web  http://localhost:%s\n  API  http://localhost:%s/healthz\n\n' "$WEB_PORT" "$API_PORT"
printf 'Tekan Ctrl+C untuk berhenti.\n\n'
( cd "$ROOT_DIR" && HADIR_API_PORT="$API_PORT" HADIR_WEB_PORT="$WEB_PORT" pnpm dev )
