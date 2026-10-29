import type { ReportDraft } from '../../lib/draft';
import { draftAgeText, draftSummary } from '../../lib/draft';

export interface DraftBannerProps {
  draft: ReportDraft;
  saving: boolean;
  savedAt: number | null;
  now: number;
  onDiscard: () => void;
}

export interface DraftSavedProps {
  saving: boolean;
  savedAt: number | null;
  now: number;
}

function ageWithoutPrefix(savedAt: number, now: number): string {
  return draftAgeText(savedAt, now).replace('disimpan ', '');
}

export function DraftBanner({ draft, saving, savedAt, now, onDiscard }: DraftBannerProps) {
  const stamp = savedAt === null ? draft.savedAt : savedAt;
  return (
    <div className="draftbar" role="status">
      <div>
        <p className="draftbar-title">
          {saving ? 'Menyimpan draf…' : 'Draf dipulihkan dari perangkat ini'}
        </p>
        <p className="draftbar-meta">
          {draftSummary(draft, now)} · {draftAgeText(stamp, now)}
        </p>
      </div>
      <button type="button" className="link-button" onClick={onDiscard}>
        Hapus draf
      </button>
    </div>
  );
}

export function DraftSaved({ saving, savedAt, now }: DraftSavedProps) {
  if (saving) {
    return (
      <p className="draftnote" role="status">
        Menyimpan draf…
      </p>
    );
  }
  if (savedAt === null) {
    return null;
  }
  return (
    <p className="draftnote" role="status">
      Draf tersimpan {ageWithoutPrefix(savedAt, now)}
    </p>
  );
}