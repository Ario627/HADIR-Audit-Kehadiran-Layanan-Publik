import { useQuery } from '@tanstack/react-query';
import { apiGetChecked } from '../../lib/api';
import type { PayloadSchema } from '../../lib/api';
import { isRecord, readText } from '../../lib/guards';

export interface StopAuthority {
  institutionId: string;
  institutionName: string;
  siteUrl: string | null;
  verified: boolean;
}

const authorityListSchema: PayloadSchema<StopAuthority[]> = {
  safeParse(value: unknown) {
    if (!Array.isArray(value) || value.length > 10) {
      return { success: false };
    }
    const items: StopAuthority[] = [];
    for (const entry of value) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const institutionId = readText(entry.institutionId, 64);
      const institutionName = readText(entry.institutionName, 160);
      const siteUrl = typeof entry.siteUrl === 'string' ? readText(entry.siteUrl, 500) : null;
      const verified = typeof entry.verified === 'boolean' ? entry.verified : null;
      if (institutionId === null || institutionName === null || verified === null) {
        return { success: false };
      }
      items.push({ institutionId, institutionName, siteUrl, verified });
    }
    return { success: true, data: items };
  },
};

export function stopAuthoritiesQuery(stopCode: string) {
  return {
    queryKey: ['stops', 'authorities', stopCode] as const,
    queryFn: async (): Promise<StopAuthority[]> => {
      const envelope = await apiGetChecked(
        `/v1/stops/by-code/${encodeURIComponent(stopCode)}/authorities`,
        authorityListSchema,
      );
      return envelope.data;
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  };
}

export function StopAuthorities({ stopCode }: { stopCode: string }) {
  const query = useQuery(stopAuthoritiesQuery(stopCode));

  if (query.isPending || query.isError || query.data.length === 0) {
    return null;
  }

  return (
    <section className="authorities" aria-labelledby="authorities-title">
      <h2 className="section-title" id="authorities-title">
        Instansi penanggung jawab
      </h2>
      <ul className="authority-list">
        {query.data.map((item) => (
          <li key={item.institutionId} className="authority-item">
            <span className="authority-name">{item.institutionName}</span>
            <span className={`chip chip--${item.verified ? 'verified' : 'none'}`}>
              {item.verified ? 'pemetaan terverifikasi' : 'pemetaan belum diverifikasi'}
            </span>
            {item.siteUrl === null ? null : (
              <a
                className="dossier-link"
                href={item.siteUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                Situs resmi
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="dossier-sub dossier-sub--quiet">
        Laporan di halte ini dikirim ke instansi yang terdaftar di sini. Pemetaan yang belum
        terverifikasi tetap ditampilkan supaya tidak ada tanggung jawab yang tersembunyi.
      </p>
    </section>
  );
}
