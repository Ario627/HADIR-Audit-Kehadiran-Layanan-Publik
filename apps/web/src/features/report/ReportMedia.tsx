import type { ReportMediaItem } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiAssetUrl, apiGetChecked } from '../../lib/api';
import { mediaCaption, mediaMimeLabel, reportMediaListSchema } from '../../lib/report-media';

export function reportMediaQueryKey(publicId: string) {
  return ['report', publicId, 'media'] as const;
}

function MediaFigure({ item, index }: { item: ReportMediaItem; index: number }) {
  const src = apiAssetUrl(item.url);
  const [broken, setBroken] = useState(false);

  if (src === null || broken) {
    return null;
  }

  return (
    <figure className="media-figure">
      <img
        src={src}
        alt={`Lampiran foto ${String(index + 1)} pada laporan ini`}
        width={item.width}
        height={item.height}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          setBroken(true);
        }}
      />
      <figcaption>
        {mediaCaption(item, index)}
        <span className="media-mime">{mediaMimeLabel(item.mime)}</span>
      </figcaption>
    </figure>
  );
}

export function ReportMedia({ publicId }: { publicId: string }) {
  const query = useQuery({
    queryKey: reportMediaQueryKey(publicId),
    queryFn: async (): Promise<ReportMediaItem[]> => {
      const envelope = await apiGetChecked(
        `/v1/reports/${encodeURIComponent(publicId)}/media`,
        {
          safeParse(value: unknown) {
            if (typeof value !== 'object' || value === null) {
              return { success: false as const };
            }
            const items = (value as { items?: unknown }).items;
            return reportMediaListSchema.safeParse(items);
          },
        },
      );
      return envelope.data;
    },
    staleTime: 300_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  if (query.isPending || query.isError) {
    return null;
  }

  if (query.data.length === 0) {
    return null;
  }

  return (
    <section className="report-media" aria-labelledby="report-media-title">
      <h2 className="section-title" id="report-media-title">
        Lampiran foto
      </h2>
      <div className="media-grid">
        {query.data.map((item, index) => (
          <MediaFigure key={item.mediaId} item={item} index={index} />
        ))}
      </div>
      <p className="note">
        Foto tampil hanya setelah lolos moderasi. Lokasi presisi tidak pernah disimpan dari foto.
      </p>
    </section>
  );
}
