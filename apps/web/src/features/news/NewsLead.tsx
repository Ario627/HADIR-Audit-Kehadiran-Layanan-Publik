import { apiAssetUrl } from '../../lib/api';
import { ageLabel, scopeLabel, type NewsItem } from '../../lib/news';

export interface NewsLeadProps {
  item: NewsItem;
  regionLabel: string;
  now: number;
}

export function NewsLead({ item, regionLabel, now }: NewsLeadProps) {
  const image = apiAssetUrl(item.imagePath);
  return (
    <article className="news-lead">
      <a className="news-lead-link" href={item.url} target="_blank" rel="noopener noreferrer">
        {image === null ? null : (
          <span className="news-lead-media">
            <img src={image} alt="" loading="lazy" decoding="async" width="640" height="360" />
          </span>
        )}
        <span className="news-tag" data-scope={item.scope}>
          {scopeLabel(item.scope, regionLabel)}
        </span>
        <h3 className="news-lead-title">{item.title}</h3>
        {item.excerpt.length === 0 ? null : <p className="news-lead-excerpt">{item.excerpt}</p>}
        <span className="news-meta">
          {item.source} · {ageLabel(item.publishedAt, now)}
          <span className="visually-hidden"> (buka di tab baru)</span>
        </span>
      </a>
    </article>
  );
}
