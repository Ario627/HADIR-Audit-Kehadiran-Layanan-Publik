import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { ReportCategory } from '@hadir/contracts';
import { uuidv7 } from '../../lib/id';
import { checkReportText, rememberOwnReport } from '../../lib/report';
import { corroborateReport, submitReport, verifyReportClosure } from '../../lib/report-api';

interface KeyedAttempt {
  signature: string;
  idempotencyKey: string;
}

interface EventAttempt extends KeyedAttempt {
  clientEventId: string;
}

function keyedFor(holder: { current: KeyedAttempt | null }, signature: string): KeyedAttempt {
  const current = holder.current;
  if (current !== null && current.signature === signature) {
    return current;
  }
  const next: KeyedAttempt = { signature, idempotencyKey: uuidv7() };
  holder.current = next;
  return next;
}

function eventFor(holder: { current: EventAttempt | null }, signature: string): EventAttempt {
  const current = holder.current;
  if (current !== null && current.signature === signature) {
    return current;
  }
  const next: EventAttempt = {
    signature,
    idempotencyKey: uuidv7(),
    clientEventId: uuidv7(),
  };
  holder.current = next;
  return next;
}

export interface CreateReportRequest {
  stopCode: string;
  category: ReportCategory;
  text: string;
  triageSessionId: string | null;
  photoUploadId: string | null;
}

export function useCreateReport() {
  const holder = useRef<EventAttempt | null>(null);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateReportRequest) => {
      const text = checkReportText(request.text).text;
      const signature = [
        request.stopCode,
        request.category,
        text,
        request.triageSessionId ?? '',
        request.photoUploadId ?? '',
      ].join('|');
      const attempt = eventFor(holder, signature);
      return submitReport(
        {
          stopCode: request.stopCode,
          category: request.category,
          text,
          ...(request.triageSessionId === null
            ? {}
            : { triageSessionId: request.triageSessionId }),
          ...(request.photoUploadId === null ? {} : { photoUploadId: request.photoUploadId }),
        },
        { clientEventId: attempt.clientEventId },
        attempt.idempotencyKey,
      );
    },
    onSuccess: (result) => {
      rememberOwnReport(result.report.publicId);
      queryClient.setQueryData(['report', result.report.publicId], result.report);
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    retry: 0,
  });
}

export interface CorroborateRequest {
  publicId: string;
  note: string;
}

export function useCorroborate() {
  const holder = useRef<KeyedAttempt | null>(null);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CorroborateRequest) => {
      const note = request.note.trim();
      const attempt = keyedFor(holder, `${request.publicId}|${note}`);
      return corroborateReport(
        request.publicId,
        note.length === 0 ? null : note,
        attempt.idempotencyKey,
      );
    },
    onSuccess: (result, request) => {
      queryClient.setQueryData(['report', request.publicId], (previous: unknown) => {
        if (previous === null || typeof previous !== 'object') {
          return previous;
        }
        return { ...previous, corroborationCount: result.corroborationCount };
      });
      void queryClient.invalidateQueries({ queryKey: ['report', request.publicId] });
    },
    retry: 0,
  });
}

export interface ClosureRequest {
  publicId: string;
  answer: 'yes' | 'no' | 'partial';
  note: string;
}

export function useVerifyClosure() {
  const holder = useRef<EventAttempt | null>(null);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: ClosureRequest) => {
      const note = request.note.trim();
      const attempt = eventFor(holder, `${request.publicId}|${request.answer}|${note}`);
      return verifyReportClosure(
        request.publicId,
        {
          answer: request.answer,
          ...(note.length === 0 ? {} : { note }),
        },
        { clientEventId: attempt.clientEventId },
        attempt.idempotencyKey,
      );
    },
    onSuccess: (_result, request) => {
      void queryClient.invalidateQueries({ queryKey: ['report', request.publicId] });
    },
    retry: 0,
  });
}