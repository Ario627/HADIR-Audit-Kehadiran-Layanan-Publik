import type { NewsRegionCode } from '../../lib/news';
import { NEWS_REGIONS, NEWS_REGION_LABELS } from '../../lib/news';

export interface NewsRegionPickProps {
  value: NewsRegionCode;
  onChange: (next: NewsRegionCode) => void;
}

export function NewsRegionPick({ value, onChange }: NewsRegionPickProps) {
  return (
    <div className="news-regions" role="group" aria-label="Cakupan berita">
      {NEWS_REGIONS.map((code) => (
        <button
          key={code}
          type="button"
          className="news-region"
          aria-pressed={code === value}
          onClick={() => {
            onChange(code);
          }}
        >
          {NEWS_REGION_LABELS[code]}
        </button>
      ))}
    </div>
  );
}
