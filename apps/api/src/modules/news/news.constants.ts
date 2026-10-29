export interface NewsRegion {
  code: string;
  label: string;
  places: readonly string[];
}

export interface NewsFeedSource {
  url: string;
  publisher: string;
}

export const NEWS_REGIONS: Readonly<Record<string, NewsRegion>> = {
  banyumas: {
    code: 'banyumas',
    label: 'Banyumas',
    places: ['banyumas', 'purwokerto', 'cilacap', 'purbalingga', 'banjarnegara', 'jateng', 'jawa tengah'],
  },
  semarang: {
    code: 'semarang',
    label: 'Semarang',
    places: ['semarang', 'ungaran', 'kendal', 'demak', 'jateng', 'jawa tengah'],
  },
  jateng: {
    code: 'jateng',
    label: 'Jawa Tengah',
    places: ['jateng', 'jawa tengah', 'purwokerto', 'semarang', 'solo', 'surakarta', 'magelang', 'tegal', 'pekalongan'],
  },
  nasional: {
    code: 'nasional',
    label: 'Nasional',
    places: [],
  },
};

export const DEFAULT_REGION = 'banyumas';

export const NEWS_FEEDS: readonly NewsFeedSource[] = [
  { url: 'https://www.cnnindonesia.com/otomotif/rss', publisher: 'CNN Indonesia' },
  { url: 'https://www.cnnindonesia.com/nasional/rss', publisher: 'CNN Indonesia' },
  { url: 'https://rss.tempo.co/nasional', publisher: 'Tempo' },
  { url: 'https://www.antaranews.com/rss/terkini.xml', publisher: 'Antara' },
  { url: 'https://www.cnbcindonesia.com/rss', publisher: 'CNBC Indonesia' },
];

export const TRANSPORT_TERMS: readonly string[] = [
  'bus',
  'angkot',
  'angkutan',
  'brt',
  'transjakarta',
  'trans ',
  'halte',
  'terminal',
  'tarif',
  'trayek',
  'rute',
  'transportasi',
  'perhubungan',
  'dishub',
  'damri',
  'kereta',
  'krl',
  'mrt',
  'lrt',
  'kendaraan',
  'penumpang',
  'kemacetan',
  'lalu lintas',
  'jalan raya',
  'sepeda motor',
  'ojek',
  'taksi',
  'bahan bakar',
  'bbm',
  'euro 4',
  'ganjil genap',
  'parkir',
  'jembatan',
  'lebaran',
  'mudik',
];

export const NEWS_MAX_ITEMS = 14;
export const NEWS_MAX_EXCERPT = 190;
export const NEWS_FEED_TIMEOUT_MS = 4_000;
export const NEWS_MAX_FEED_BYTES = 512 * 1024;
export const NEWS_MAX_ITEMS_PER_FEED = 120;
export const NEWS_CACHE_TTL_S = 900;
export const NEWS_MEMORY_TTL_MS = 300_000;
export const NEWS_MAX_AGE_DAYS = 14;
export const NEWS_MAX_TITLE = 160;
export const NEWS_MAX_URL = 500;
export const NEWS_MAX_SOURCE = 60;

export const NEWS_MEDIA_ALLOWED_HOSTS: readonly string[] = [
  'akcdn.detik.net.id',
  'awsimages.detik.net.id',
  'cdn.cnnindonesia.com',
  'asset.kompas.com',
  'cdn-asset.kompas.com',
  'img.antaranews.com',
  'awsimages.detik.net.id',
];

export const NEWS_MEDIA_MAX_BYTES = 2 * 1024 * 1024;
export const NEWS_MEDIA_TIMEOUT_MS = 5_000;
export const NEWS_MEDIA_CACHE_S = 86_400;
export const NEWS_MEDIA_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_MEDIA_MIME: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];