import type {
  ClosureResult,
  CorroborateResult,
  CreateReportInput,
  CreateReportResult,
  ReportDetail,
  TriageInput,
  TriageResult,
  VerifyClosureInput,
} from '@hadir/contracts';
import { apiSendChecked } from './api';
import {
  closureResultSchema,
  corroborateResultSchema,
  createReportResultSchema,
  reportDetailSchema,
  triageResultSchema,
} from './guards';

const REPORT_PATH = '/v1/reports';
const TRIAGE_PATH = '/v1/triage';

export interface TriageAttempt {
  clientEventId: string;
}

export interface ReportAttempt {
  clientEventId: string;
}

export function reportQueryKey(publicId: string) {
  return ['report', publicId] as const;
}

export async function fetchReport(publicId: string): Promise<ReportDetail> {
  const envelope = await apiSendChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}`,
    reportDetailSchema,
    { method: 'GET' },
  );
  return envelope.data;
}

export async function requestTriage(
  input: Omit<TriageInput, 'clientEventId'>,
  attempt: TriageAttempt,
  idempotencyKey: string,
): Promise<TriageResult> {
  const body: TriageInput = { ...input, clientEventId: attempt.clientEventId };
  const envelope = await apiSendChecked(TRIAGE_PATH, triageResultSchema, {
    method: 'POST',
    body,
    idempotencyKey,
  });
  return envelope.data;
}

export async function submitReport(
  input: Omit<CreateReportInput, 'clientEventId'>,
  attempt: ReportAttempt,
  idempotencyKey: string,
): Promise<CreateReportResult> {
  const body: CreateReportInput = { ...input, clientEventId: attempt.clientEventId };
  const envelope = await apiSendChecked(REPORT_PATH, createReportResultSchema, {
    method: 'POST',
    body,
    idempotencyKey,
  });
  return envelope.data;
}

export async function corroborateReport(
  publicId: string,
  note: string | null,
  idempotencyKey: string,
): Promise<CorroborateResult> {
  const envelope = await apiSendChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}/corroborate`,
    corroborateResultSchema,
    {
      method: 'POST',
      body: note === null ? {} : { note },
      idempotencyKey,
    },
  );
  return envelope.data;
}

export async function verifyReportClosure(
  publicId: string,
  input: Omit<VerifyClosureInput, 'clientEventId'>,
  attempt: ReportAttempt,
  idempotencyKey: string,
): Promise<ClosureResult> {
  const body: VerifyClosureInput = { ...input, clientEventId: attempt.clientEventId };
  const envelope = await apiSendChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}/verify-closure`,
    closureResultSchema,
    { method: 'POST', body, idempotencyKey },
  );
  return envelope.data;
}