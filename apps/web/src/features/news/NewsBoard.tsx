import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '../../lib/errors';
import {
  DEFAULT_NEWS_REGION,
  leadItem,
  restItems,
  type NewsRegionCode,
} from '../../lib/news';
import { newsQuery } from '../../lib/queries';
import { NewsLead } from './NewsLead';
import { NewsRegionPick } from './NewsRegionPick';
import { NewsRow } from './NewsRow';

export function NewsBoard() {
  const [region, setRegion] = useState<NewsRegionCode>(DEFAULT_NEWS_REGION);
  const feed = useQuery(newsQuery(region));

  const items = feed.data?.items ?? [];
  const lead = leadItem(items);
  const rest = restItems(items, lead);
  const regionLabel = feed.data?.region.label ?? 'Banyumas';
  const hasLocal = items.some((item) => item.scope === 'daerah');
  const now = Date.now();
  const failed = feed.isError;

  return (
    <section className="news" id="kabar" aria-labelledby="news-heading">
      <div className="news-head">
        <div>
          <h2 className="label" id="news-heading">
            Kabar transportasi
          </h2>
          <p className="news-lede">
            Dikurasi dari sindikasi penerbit, bukan agregator. HADIR tidak menyalin isi berita;
            setiap judul membuka halaman aslinya.
          </p>
        </div>
        <NewsRegionPick
          value={region}
          onChange={(next) => {
            setRegion(next);
          }}
        />
      </div>

      {hasLocal || items.length === 0 || region === 'nasional' ? null : (
        <p className="news-note" role="status">
          Belum ada kabar {regionLabel} pada sumber hari ini. Semua yang tampil berskala nasional —
          cakupan tetap ditampilkan supaya kamu tidak mengira ini berita daerah.
        </p>
      )}

      {failed ? (
        <p className="news-note" role="status">
          Kabar tidak bisa dimuat sekarang ({describeError(feed.error).title}). Ini tidak
          memengaruhi angka tunggu di atas.
        </p>
      ) : feed.isPending ? (
        <div className="news-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : lead === null ? (
        <p className="news-note" role="status">
          Belum ada kabar transportasi untuk cakupan {regionLabel} hari ini. Sumber hanya menyediakan
          berita nasional, jadi cakupan daerah sering kosong — itu keterbatasan sumber, bukan
          kesalahan muat.
        </p>
      ) : (
        <div className="news-grid" data-count={items.length <= 2 ? 'few' : 'many'}>
          <NewsLead item={lead} regionLabel={regionLabel} now={now} />
          {rest.length === 0 ? null : (
            <ol className="news-rows">
              {rest.map((item) => (
                <NewsRow key={item.id} item={item} now={now} />
              ))}
            </ol>
          )}
        </div>
      )}

      <p className="news-attrib">
        Judul dan cuplikan milik penerbit masing-masing. Gambar disajikan lewat proksi HADIR agar
        alamat IP pembaca tidak dikirim ke server berita.
      </p>
    </section>
  );
}
