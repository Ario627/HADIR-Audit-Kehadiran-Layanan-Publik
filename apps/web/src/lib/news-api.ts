import { apiSendChecked, withQuery, type PayloadSchema } from './api';
import { toNewsFeed, type NewsFeed, type NewsRegionCode } from './news';

export function newsQueryKey(region: NewsRegionCode) {
  return ['news', region] as const;
}

const newsFeedSchema: PayloadSchema<NewsFeed> = {
  safeParse(value: unknown) {
    const feed = toNewsFeed(value);
    return feed === null ? { success: false as const } : { success: true as const, data: feed };
  },
};

export async function fetchNews(region: NewsRegionCode): Promise<NewsFeed> {
  const envelope = await apiSendChecked(
    withQuery('/v1/news', { region }),
    newsFeedSchema,
    { method: 'GET', timeoutMs: 12_000 },
  );
  return envelope.data;
}
