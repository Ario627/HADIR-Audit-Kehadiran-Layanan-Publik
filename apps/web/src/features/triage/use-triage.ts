import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { checkReportText } from '../../lib/report';
import { requestTriage } from '../../lib/report-api';
import type { ReportCategory } from '@hadir/contracts';
import { uuidv7 } from '../../lib/id';

interface Attempt {
  signature: string;
  idempotencyKey: string;
  clientEventId: string;
}

export interface TriageRequest {
  stopCode: string;
  routeId: string | null;
  category: ReportCategory;
  text: string;
}

function attemptFor(holder: { current: Attempt | null }, signature: string): Attempt {
  const current = holder.current;
  if (current !== null && current.signature === signature) {
    return current;
  }
  const next: Attempt = {
    signature,
    idempotencyKey: uuidv7(),
    clientEventId: uuidv7(),
  };
  holder.current = next;
  return next;
}

export function useTriage() {
  const holder = useRef<Attempt | null>(null);
  return useMutation({
    mutationFn: (request: TriageRequest) => {
      const text = checkReportText(request.text).text;
      const signature = `${request.stopCode}|${request.routeId ?? ''}|${request.category}|${text}`;
      const attempt = attemptFor(holder, signature);
      return requestTriage(
        {
          stopCode: request.stopCode,
          routeId: request.routeId,
          category: request.category,
          ...(text.length === 0 ? {} : { text }),
        },
        { clientEventId: attempt.clientEventId },
        attempt.idempotencyKey,
      );
    },
    retry: 0,
  });
}