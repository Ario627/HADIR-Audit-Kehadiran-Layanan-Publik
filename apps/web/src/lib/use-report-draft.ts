import type { ReportCategory } from '@hadir/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEBOUNCE_MS, hasContent, type DraftInput, type ReportDraft } from './draft';
import { clearDraft, readDraft, writeDraft } from './draft-store';

export interface DraftFields {
  text: string;
  acknowledged: boolean;
  photoUploadId: string | null;
  photoSavedAt: number | null;
}

export interface DraftContext {
  stopCode: string | null;
  category: ReportCategory | null;
  triageSessionId: string | null;
}

export interface DraftOptions {
  draftId: string;
  fields: DraftFields;
  context: DraftContext;
  onRestore: (draft: ReportDraft) => void;
}

export interface DraftBinding {
  loaded: boolean;
  restored: ReportDraft | null;
  saving: boolean;
  savedAt: number | null;
  discard: () => void;
}

export function useReportDraft({ draftId, fields, context, onRestore }: DraftOptions): DraftBinding {
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState<ReportDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<DraftInput>({ draftId, ...context, ...fields });
  const dirtyRef = useRef(false);
  const loadedOnce = useRef(false);

  latestRef.current = { draftId, ...context, ...fields };

  useEffect(() => {
    if (loadedOnce.current) {
      return;
    }
    loadedOnce.current = true;
    let alive = true;
    void readDraft(draftId).then((draft) => {
      if (!alive) {
        return;
      }
      setLoaded(true);
      if (draft === null) {
        return;
      }
      setRestored(draft);
      setSavedAt(draft.savedAt);
      restoreRef.current(draft);
    });
    return () => {
      alive = false;
    };
  }, [draftId]);

  useEffect(() => {
    const input: DraftInput = { draftId, ...context, ...fields };
    if (!hasContent(input)) {
      return;
    }
    dirtyRef.current = true;
    setSaving(true);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void writeDraft(latestRef.current).then(() => {
        dirtyRef.current = false;
        setSaving(false);
        setSavedAt(Date.now());
      });
    }, DEBOUNCE_MS);
  }, [draftId, context.stopCode, context.category, context.triageSessionId, fields.text, fields.acknowledged, fields.photoUploadId, fields.photoSavedAt]);

  useEffect(() => {
    const flush = (): void => {
      if (!dirtyRef.current) {
        return;
      }
      dirtyRef.current = false;
      void writeDraft(latestRef.current);
    };
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') {
        flush();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    };
  }, []);

  const { text, photoUploadId } = fields;

  useEffect(() => {
    if (restored === null) {
      return;
    }
    if (text !== restored.text || photoUploadId !== restored.photoUploadId) {
      setRestored(null);
    }
  }, [restored, text, photoUploadId]);

  const discard = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    setRestored(null);
    setSavedAt(null);
    setSaving(false);
    void clearDraft();
  }, []);

  return { loaded, restored, saving, savedAt, discard };
}
