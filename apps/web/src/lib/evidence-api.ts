import type { CaseFile, EvidencePack } from '@hadir/contracts';
import { apiGetChecked, withQuery } from './api';
import { caseFileSchema, evidencePackSchema } from './evidence-guards';

const STOP_PATH = '/v1/stops';
const REPORT_PATH = '/v1/reports';

export type EvidenceWindow = '7d' | '30d';

export async function fetchEvidencePack(
  stopId: string,
  window: EvidenceWindow,
  routeId?: string,
): Promise<EvidencePack> {
  const envelope = await apiGetChecked(
    withQuery(`${STOP_PATH}/${encodeURIComponent(stopId)}/evidence`, { window, routeId }),
    evidencePackSchema,
  );
  return envelope.data;
}

export async function fetchCaseFile(publicId: string): Promise<CaseFile> {
  const envelope = await apiGetChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}/case`,
    caseFileSchema,
  );
  return envelope.data;
}
