# HADIR

Instrumen audit warga untuk layanan bus bersubsidi.

Warga mencatat berapa lama mereka menunggu lewat QR di halte. Sistem mengubah catatan itu menjadi
bukti yang bisa dibandingkan dengan janji layanan — dan menolak menyimpulkan sebelum buktinya cukup.

Dokumentasi produk, arsitektur, dan keputusan desain ada di [`../docs/00-INDEX.md`](../docs/00-INDEX.md).
Berkas ini hanya menjelaskan cara menjalankan dan memakainya.

---

## Daftar isi

- [Apa yang dilakukan sistem ini](#apa-yang-dilakukan-sistem-ini)
- [Menjalankan dalam satu perintah](#menjalankan-dalam-satu-perintah)
- [Menjalankan manual](#menjalankan-manual)
- [Memakai aplikasinya](#memakai-aplikasinya)
- [Docker](#docker)
- [Arsitektur](#arsitektur)
- [Perintah](#perintah)
- [Konfigurasi](#konfigurasi)
- [Data demo](#data-demo)
- [Pengujian](#pengujian)
- [Keamanan](#keamanan)
- [Pemecahan masalah](#pemecahan-masalah)
- [Batasan yang perlu diketahui](#batasan-yang-perlu-diketahui)

---

## Apa yang dilakukan sistem ini

Masalahnya sederhana dan sulit dibuktikan: bus bersubsidi punya janji headway, warga merasakan
tunggu yang jauh lebih lama, tetapi tidak ada angka yang bisa dipakai untuk membantah atau membenarkan.

HADIR mengumpulkan tiga hal yang biasanya hilang:

1. **Waktu tunggu yang benar-benar terjadi** — dicatat warga sendiri, bukan diambil dari jadwal.
2. **Kekuatan bukti** — berapa episode, lintas berapa hari, dari berapa perangkat berbeda.
3. **Jejak yang tidak bisa diubah diam-diam** — setiap laporan masuk rantai hash; akar harian
   diterbitkan sebagai anchor.

Yang sengaja **tidak** dilakukan sistem ini:

- Tidak menuduh operator sebelum bukti mencapai ambang.
- Tidak memakai koordinat presisi. Mode QR tidak memakai lokasi sama sekali; mode GPS hanya mengirim
  kategori jarak dan akurasi.
- Tidak meminta akun. Perangkat dikenali lewat cookie bertanda tangan yang di-hash.
- Tidak mengisi sel kosong dengan nol. Halte tanpa data dibiarkan kosong.

### Untuk siapa

| Peran | Yang didapat |
|---|---|
| Warga / penumpang | Mencatat tunggu dalam 3 ketukan, tanpa aplikasi dan tanpa akun |
| Mitra instansi (Dinas Perhubungan) | Inbox laporan, agregat, paket bukti ekspor |
| Publik | Papan bukti, peta sebaran, metode perhitungan, anchor transparansi |

---

## Menjalankan dalam satu perintah

```bash
pnpm install
pnpm start
```

`pnpm start` menjalankan `scripts/dev.sh`, yang melakukan berurutan:

1. Memeriksa Node, pnpm, dan `node_modules`.
2. Menyiapkan `apps/api/.env` bila belum ada, termasuk membuat `SESSION_SECRET` acak.
3. Menentukan sumber database: **Docker bila bisa dipakai, kalau tidak layanan lokal**.
4. Menunggu database benar-benar menerima koneksi.
5. Memastikan PostGIS tersedia.
6. Menjalankan seluruh migrasi.
7. Mengisi data demo bila tabel `stops` masih kosong.
8. Memastikan port API dan web bebas.
9. Menyalakan API dan web bersamaan; `Ctrl+C` mematikan keduanya.

Setelah selesai:

| Alamat | Isi |
|---|---|
| <http://localhost:5173> | Aplikasi web |
| <http://localhost:3000/healthz> | Kesehatan API |
| <http://localhost:3000/readyz> | Kesiapan API (database + Redis) |
| <http://localhost:3000/v1/meta> | Versi dan konfigurasi publik |

### Pilihan lain

| Perintah | Kapan dipakai |
|---|---|
| `pnpm start` | Deteksi otomatis. Ini yang biasanya dipakai. |
| `pnpm start:check` | Hanya memeriksa prasyarat, database, dan migrasi. Tidak menyalakan server. |
| `pnpm start:docker` | Memaksa Docker. Gagal keras bila Docker tidak bisa dipakai. |
| `pnpm start:local` | Memaksa PostgreSQL dan Redis lokal, melewati Docker. |

Port bisa diganti tanpa menyunting file:

```bash
HADIR_API_PORT=3100 HADIR_WEB_PORT=5273 pnpm start
```

Vite memakai port itu sekaligus mengarahkan proxy `/v1` ke port API yang sama.

---

## Menjalankan manual

Kalau lebih suka mengendalikan tiap langkah:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env

pnpm db:up                                  # PostgreSQL + Redis lewat Docker
pnpm --filter @hadir/api db:migrate
pnpm --filter @hadir/api db:seed
pnpm dev                                    # API dan web bersamaan
```

Atau dua terminal terpisah:

```bash
pnpm dev:api     # http://localhost:3000
pnpm dev:web     # http://localhost:5173
```

`pnpm dev` memakai Turbo, yang otomatis membangun `packages/contracts` dan `packages/domain`
lebih dulu. Langkah itu wajib: API meng-`import` paket tersebut dari `dist/`, bukan dari `src/`.

### PostgreSQL lokal tanpa Docker

Butuh PostgreSQL 18 dengan PostGIS. Perintah pembuatan yang setara dengan isi compose:

```bash
sudo -u postgres psql -c "CREATE ROLE hadir LOGIN PASSWORD 'hadir' SUPERUSER"
sudo -u postgres createdb -O hadir hadir
sudo -u postgres psql -d hadir -c 'CREATE EXTENSION IF NOT EXISTS postgis'
```

Peran `hadir` perlu `SUPERUSER` hanya karena migrasi pertama membuat ekstensi PostGIS. Setelah
itu hak istimewa bisa dicabut.

---

## Memakai aplikasinya

### Alur warga — target di bawah 10 detik

1. Buka `/`. Pilih **Pindai stiker halte** (kamera) atau **Pakai lokasi**.
2. Scanner membaca QR di halte. Tautan QR memuat stempel waktu dan tanda tangan, jadi bisa dipakai
   tanpa izin lokasi.
3. Tiket tunggu terbuka di `/wait/<id>` dan terus menghitung.
4. Saat bus datang, tekan salah satu tombol hasil: **naik**, **batal**, atau **penuh**.
5. Ringkasan muncul, dengan tawaran melaporkan kendala kalau memang ada.

Bila sinyal putus di tengah jalan, catatan masuk antrean perangkat dan dikirim ulang otomatis dengan
kunci idempotensi, jadi tidak menjadi ganda.

### Melaporkan kendala

`/lapor` memilih halte dan kategori lebih dulu, lalu **triase** menilai apakah laporan itu sudah
punya dasar. Baru setelah itu formulir panjang dibuka di `/lapor/<draftId>`.

Draf disimpan otomatis setiap 2 detik. Menutup tab tidak menghilangkan tulisan. Draf kedaluwarsa
setelah 48 jam; unggahan foto 12 menit.

### Untuk mitra instansi

Masuk di `/masuk` dengan kata sandi atau passkey. Sesi berupa cookie `HttpOnly` yang tidak bisa
dibaca JavaScript.

| Halaman | Isi |
|---|---|
| `/partner` | Ringkasan beban laporan |
| `/partner/laporan` | Daftar laporan masuk, dengan saringan |
| `/partner/laporan/<id>` | Detail dan aksi tindak lanjut |
| `/partner/analitik` | Agregat per jendela waktu |
| `/partner/ekspor` | Paket bukti CSV / Open311 |
| `/partner/pengaturan` | Profil, kata sandi, passkey, sesi aktif |

Akun mitra dibuat lewat undangan admin, bukan pendaftaran mandiri:

```bash
pnpm --filter @hadir/api db:bootstrap-admin
```

### Halaman publik

| Halaman | Isi |
|---|---|
| `/` | Papan bukti, peta sebaran, kabar transportasi |
| `/peta` | Skema posisi halte dengan alternatif daftar |
| `/s/<kode>` | Halaman halte: janji headway, estimasi, mulai menunggu |
| `/metodologi` | Cara angka dihitung, batasnya, sumbernya |
| `/transparansi` | Anchor harian dan riwayat perubahan |
| `/privasi` | Data apa yang disimpan di perangkat, dan tombol hapus |

Pintasan keyboard: `?` membuka daftar, `g` lalu `b/p/s/l/m/r` berpindah halaman.
Mode Malam mengikuti sistem secara bawaan dan bisa dipaksa lewat pemilih tema di header.

---

## Docker

Compose hanya menjalankan **infrastruktur** — PostgreSQL/PostGIS dan Redis. API dan web berjalan di
host dengan hot reload. Alasannya: membangun ulang image setiap perubahan kode memperlambat
pekerjaan tanpa memberi keuntungan apa pun saat pengembangan.

```bash
pnpm db:up            # PostgreSQL 18-3.6 + Redis 8.10
pnpm db:up:storage    # tambah MinIO (profil opsional)
pnpm db:logs          # ikuti log
pnpm db:psql          # shell psql di dalam kontainer
pnpm db:reset         # hapus volume lalu buat ulang
pnpm db:down          # hentikan
```

Yang membuat konfigurasinya stabil:

| Aspek | Penanganan |
|---|---|
| Versi image | Dipatok (`postgis/postgis:18-3.6`, `redis:8.10`, MinIO rilis tertanggal) |
| Kesiapan | `healthcheck` dengan `start_period` 30 detik untuk PostgreSQL |
| Sinyal | `init: true` dan `stop_grace_period` agar tidak ada koneksi terpotong |
| Log | Rotasi `json-file` 10 MB × 3 berkas, tidak memenuhi disk |
| Data | Volume bernama `hadir_pg`, `hadir_redis`, `hadir_minio` |
| Redis | `appendonly yes`, `maxmemory-policy noeviction` — eviksi akan merusak penghitung rate limit |
| PostgreSQL | `--data-checksums` untuk mendeteksi korupsi halaman |
| MinIO | Profil `storage`, jadi tidak ikut menyala bila tidak dipakai |
| Port | Bisa diubah lewat `HADIR_PG_PORT`, `HADIR_REDIS_PORT`, `HADIR_MINIO_PORT` |

> Docker memerlukan kernel yang mendukung pasangan antarmuka `veth`. Pada sebagian lingkungan
> (kernel dibatasi, WSL1, sebagian container CI) pembuatan jaringan bridge gagal dengan
> `failed to add the host ... pair interfaces: operation not supported`. Dalam kondisi itu
> `pnpm start` otomatis jatuh ke PostgreSQL/Redis lokal, dan `pnpm start:docker` akan gagal dengan
> pesan jelas. Ini yang terjadi pada mesin pengembangan tempat README ini disusun.

---

## Arsitektur

```text
apps/
  api/                NestJS 12 + Express 5 — HTTP, cookie perangkat, estimasi, triase, mitra
  web/                Vite 8 + React 19 + TanStack Router/Query, PWA
packages/
  contracts/          Skema Zod + tipe DTO (CommonJS)
  domain/             Logika murni: level bukti, kepercayaan presence, statistik tunggu
  config/             Preset tsconfig dan oxlint
infra/compose/        PostgreSQL/PostGIS, Redis, MinIO
scripts/dev.sh        Satu perintah menyalakan seluruh lingkungan
docs/                 Produk, arsitektur, keamanan, desain, roadmap
```

| Bagian | Isi |
|---|---|
| 15 modul API | `admin`, `devices`, `episodes`, `estimates`, `internal`, `meta`, `news`, `partner`, `qr-landing`, `reports`, `runway`, `stops`, `transparency`, `triage`, `uploads` |
| 82 endpoint | Semua di bawah `/v1`, dibungkus envelope `{ data, meta }` |
| 24 halaman web | 20 sesuai IA dokumentasi, sisanya halaman tambahan |
| 23 migrasi | `0001` sampai `0023`, dijalankan berurutan dan dicatat di `schema_migrations` |
| 55 komponen | Dikelompokkan per fitur, bukan per jenis |

### Aturan yang menentukan bentuk kode

- **`packages/contracts` dikompilasi ke CommonJS.** Di `apps/web` impor hanya boleh `import type`,
  ditambah guard tulisan tangan di `lib/guards.ts`, `lib/news.ts`, `lib/partner-guards.ts`. Kalau
  ada nilai yang ikut terimpor, Zod masuk ke bundle dan anggaran JS jebol.
- **CSP berlaku ketat saat build.** `style-src 'self'` berarti tidak boleh ada atribut `style`.
  `lib/csp.test.ts` menolak `style={{` dan `dangerouslySetInnerHTML` di seluruh `src`.
  Gambar dari luar harus lewat proksi.
- **Angka tunggu harus tabular.** `font-variant-numeric: tabular-nums slashed-zero` supaya digit
  tidak menari saat penghitung berdetak.
- **Level bukti punya ambang keras** di `packages/domain`: `n >= 15` dan `clusters >= 3` untuk
  keluar dari `none`; `n >= 30`, `days >= 3`, `devices >= 10`, `clusters >= 10`, dan `ciLow > threshold`
  untuk `strong`.

---

## Perintah

### Lingkungan

| Perintah | Fungsi |
|---|---|
| `pnpm start` | Satu perintah: infrastruktur, migrasi, seed, API, web |
| `pnpm start:check` | Preflight saja |
| `pnpm start:docker` | Paksa Docker |
| `pnpm start:local` | Paksa layanan lokal |
| `pnpm dev` | API dan web lewat Turbo |
| `pnpm dev:api` | API saja |
| `pnpm dev:web` | Web saja |

### Database

| Perintah | Fungsi |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Nyalakan / hentikan PostgreSQL dan Redis |
| `pnpm db:reset` | Hapus volume lalu buat ulang |
| `pnpm db:psql` | Shell `psql` di kontainer |
| `pnpm --filter @hadir/api db:migrate` | Jalankan migrasi |
| `pnpm --filter @hadir/api db:seed` | Isi data demo |
| `pnpm --filter @hadir/api db:studio` | Drizzle Studio |
| `pnpm --filter @hadir/api db:bootstrap-admin` | Buat admin platform |

### Mutu

| Perintah | Fungsi |
|---|---|
| `pnpm typecheck` | TypeScript tanpa emit |
| `pnpm lint` | Oxlint dengan type-aware |
| `pnpm test` | Vitest (web) dan Jest (API) |
| `pnpm check` | lint + typecheck + test |
| `pnpm build` | Build semua |
| `pnpm format` | Prettier |

### Worker latar

```bash
pnpm --filter @hadir/api worker:outbox        # kirim ulang pekerjaan tertunda
pnpm --filter @hadir/api worker:maintenance   # tutup episode basi, pangkas kredensial
```

---

## Konfigurasi

Semua variabel API ada di `apps/api/.env`; contoh lengkap dengan nilai bawaan ada di
`apps/api/.env.example`.

| Variabel | Bawaan | Catatan |
|---|---|---|
| `PORT` | `3000` | Port API |
| `WEB_ORIGIN` | `http://localhost:5173` | Daftar origin CORS, dipisah koma |
| `DATABASE_URL` | `postgres://hadir:hadir@localhost:5432/hadir` | Wajib `postgres://` atau `postgresql://` |
| `REDIS_URL` | `redis://localhost:6379` | Dipakai rate limit dan cache kabar |
| `SESSION_SECRET` | — | Minimal 32 karakter; wajib nyata di produksi |
| `QR_KEYRING_JSON` | — | Kunci tanda tangan QR, berbentuk `{"202610":{"id":"k1","secret":"..."}}` |
| `DEV_TOOLS` | `false` (contoh dev: `true`) | Menyalakan `/v1/dev/*`; ditolak bila `NODE_ENV=production` |
| `EPISODE_TAU_MINUTES` | `45` | Batas analisis satu episode |
| `EPISODE_IDLE_MINUTES` | `10` | Episode dianggap berhenti bila tanpa heartbeat |
| `EPISODE_MAX_MINUTES` | `180` | Batas absolut sekaligus jendela koreksi |

Tiga parameter episode itu harus naik berurutan: `idle < tau < max`.

Web hanya mengenal satu variabel build:

| Variabel | Bawaan | Catatan |
|---|---|---|
| `VITE_API_URL` | kosong | Kosongkan di dev karena Vite memakai proxy. Isi dengan origin API di produksi |

---

## Data demo

`db:seed` menghasilkan 1 kota, 2 koridor, 12 halte, 24 perangkat, dan 1.260 episode simulasi yang
tersebar pada 27 hari terakhir.

Semua episode simulasi membawa penanda `qualityFlags: ["simulated"]`, dan tidak dipakai untuk
menyimpulkan angka publik. Seed menghapus hanya baris bertanda itu, jadi data non-demo tidak
tersentuh dan seed aman dijalankan berulang. Seed menolak berjalan bila `NODE_ENV=production`.

Sebaran harinya sengaja tidak rata, dan jumlah episode per halte mengikuti bobot sehingga papan
menunjukkan gradien nyata. Pada jendela 7 hari, halte teramai memuat sekitar 87 episode sementara
yang tersepi sekitar 16 — cukup untuk memperlihatkan perbedaan, tanpa membuat semua halte tampak
seragam.

---

## Pengujian

```bash
pnpm test                 # semua
pnpm --filter @hadir/web test
pnpm --filter @hadir/api test
```

Keadaan saat README ini ditulis:

| Paket | Berkas suite | Tes | Alat |
|---|---|---|---|
| `@hadir/web` | 40 | 783 | Vitest |
| `@hadir/api` | 46 | 496 | Jest |

Yang diuji bukan hanya fungsi murni, tetapi juga hal yang mudah rusak tanpa terlihat:

- `lib/csp.test.ts` — menolak atribut `style` dan HTML mentah, dan memeriksa isi CSP hasil build.
- `lib/sw.test.ts` — service worker dijalankan di `node:vm` dengan cache tiruan.
- `lib/page-meta.test.ts` — memastikan setiap rute di `routeTree.gen.ts` punya judul dan arahan
  `robots`, sehingga tidak ada halaman yang berbagi judul.
- `lib/news.test.ts` — menolak URL non-HTTP, jalur gambar di luar proksi, dan karakter kontrol.
- `lib/map.test.ts` — membuktikan gratikula dan skala terbentuk, serta titik tidak keluar bidang.

Pengujian end-to-end dan audit aksesibilitas otomatis **belum ada**. Keduanya memerlukan perambatan
nyata (Playwright) dan database hidup.

---

## Keamanan

Ringkasan yang bisa diperiksa sendiri di kode:

- **Cookie perangkat**: `HttpOnly`, `SameSite=Lax`, `Secure` di produksi. Identitas perangkat
  diputar harian sehingga tidak bisa dipakai melacak lintas hari.
- **CSRF**: token ganda, diperiksa pada setiap mutasi. Klien mengirim `X-CSRF-Token`, dan mutasi
  tanpa `Idempotency-Key` tidak diulang otomatis.
- **Idempotensi**: setiap penulisan wajib bertanda; kunci disimpan dengan cakupan per operasi supaya
  dua perangkat tidak bertabrakan.
- **BOLA pada rute mitra**: seluruh kueri mitra melewati method yang mengunci institusi. Objek milik
  instansi lain dijawab `404`, bukan `403`, agar keberadaannya tidak bocor.
- **RLS PostgreSQL**: tabel laporan dan media dilindungi policy yang membaca `current_scope()` dan
  `current_institution()`, jadi isolasi tetap berlaku walau ada bug di lapisan aplikasi.
- **Jejak audit** append-only: peran aplikasi hanya punya `SELECT` dan `INSERT`, dan trigger menolak
  `UPDATE`, `DELETE`, serta `TRUNCATE`.
- **Gambar kabar transportasi** tidak diambil langsung peramban. Server menerbitkan token HMAC
  berbatas waktu; proksi hanya mau mengambil dari daftar host penerbit, menolak redirect, mewajibkan
  `Content-Type: image/*`, dan berhenti di 2 MB.
- **Parser RSS** ditulis sendiri dan menolak `<!DOCTYPE>` maupun `<!ENTITY>`, sehingga XXE dan
  serangan entitas mengembang tidak berlaku.
- **Header**: `helmet`, batas body 256 KB, galat berbentuk `application/problem+json` tanpa stack
  trace, `X-Request-Id` untuk penelusuran.

---

## Pemecahan masalah

**`Database tidak bisa dihubungi`**
Jalankan `pnpm start:check` untuk melihat URL yang dipakai. Bila memakai Docker, periksa
`pnpm db:logs`. Bila memakai PostgreSQL lokal, pastikan peran dan basis data sudah dibuat
(lihat [PostgreSQL lokal tanpa Docker](#postgresql-lokal-tanpa-docker)).

**`extension "postgis" is not available`**
PostGIS belum terpasang di server database. Docker sudah membawanya; untuk instalasi lokal:
`sudo pacman -S postgis` (Arch) atau `sudo apt install postgresql-18-postgis-3` (Debian/Ubuntu).

**`Port 3000 sudah dipakai`**
Hentikan proses yang menempatinya, atau pilih port lain:
`HADIR_API_PORT=3100 HADIR_WEB_PORT=5273 pnpm start`.

**`Docker dipaksa tetapi tidak bisa dipakai`**
Host tidak mendukung jaringan bridge Docker. Jalankan `pnpm start:local` dan pakai PostgreSQL/Redis
yang terpasang langsung.

**API tidak ikut menyala padahal web jalan**
Periksa bahwa `apps/api/package.json` punya skrip `dev`. Turbo hanya menjalankan skrip bernama `dev`
di setiap paket; tanpa itu, paket dilewati tanpa peringatan.

**Halaman tampak memakai data lama setelah seed ulang**
Cache Redis kabar berumur 15 menit, dan service worker menyimpan cangkang aplikasi. Hapus cache
peramban, atau bersihkan kunci `hadir:news:*` di Redis.

**`Migration gagal: Checksum migration berubah`**
Berkas migrasi yang sudah pernah dijalankan tidak boleh disunting. Kembalikan isinya, atau buat
migrasi baru untuk perubahan berikutnya.

---

## Batasan yang perlu diketahui

Ini bukan proyek yang selesai. Yang berikut belum ada, dan disebutkan supaya tidak dikira sudah:

- **Belum ada data lapangan.** Seluruh angka berasal dari seed simulasi dan diberi label.
- **Estimator masih deskriptif.** `methodVersion` masih sederhana; belum ada Kaplan–Meier atau
  bootstrap CI penuh.
- **Peta berupa skema posisi**, bukan peta jalan. Ubin peta ditunda karena melebihi anggaran ukuran
  yang ditetapkan dokumentasi.
- **Kabar transportasi hanya berskala nasional.** Sumber berita daerah yang sah dan gratis tidak
  tersedia; agregator menolak penggunaan non-pribadi. Antarmuka menyatakan ini apa adanya.
- **Manajemen anggota instansi belum ada** karena endpoint-nya belum dibuat di API.
- **Audit aksesibilitas otomatis dan uji end-to-end belum ada.**
- **Pembayaran, tarif, dan tiket tidak disentuh sama sekali.**

---

## Lisensi

Kode: Apache-2.0. Dokumentasi: CC BY 4.0. Data contoh bukan data layanan nyata.
