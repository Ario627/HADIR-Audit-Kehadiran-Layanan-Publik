import { apiAssetUrl } from '../../lib/api';
import { ageLabel, type NewsItem } from '../../lib/news';

export interface NewsRowProps {
  item: NewsItem;
  now: number;
}

export function NewsRow({ item, now }: NewsRowProps) {
  const image = apiAssetUrl(item.imagePath);
  return (
    <li className="news-row" data-has-media={image === null ? 'no' : 'yes'}>
      <a className="news-row-link" href={item.url} target="_blank" rel="noopener noreferrer">
        {image === null ? (
          <span className="news-row-mark" aria-hidden="true" data-video={item.hasVideo ? 'yes' : 'no'}>
            {item.hasVideo ? 'Video' : 'Teks'}
          </span>
        ) : (
          <span className="news-row-media">
            <img src={image} alt="" loading="lazy" decoding="async" width="160" height="90" />
            {item.hasVideo ? (
              <span className="news-row-play" aria-hidden="true">
                Video
              </span>
            ) : null}
          </span>
        )}
        <span className="news-row-body">
          <span className="news-row-title">{item.title}</span>
          <span className="news-meta">
            {item.source} · {ageLabel(item.publishedAt, now)}
            <span className="visually-hidden"> (buka di tab baru)</span>
          </span>
        </span>
      </a>
    </li>
  );
}
