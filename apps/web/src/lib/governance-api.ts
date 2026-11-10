import type {
  AppealCreate,
  AppealGrounds,
  AppealView,
  InstitutionScorecard,
  InstitutionScorecardList,
  PanelView,
} from '@hadir/contracts';
import { apiSendChecked } from './api';
import {
  appealListSchema,
  appealSchema,
  panelSchema,
  scorecardListSchema,
  scorecardSchema,
} from './governance-guards';

const REPORT_PATH = '/v1/reports';
const APPEAL_PATH = '/v1/appeals';
const INSTITUTION_PATH = '/v1/institutions';

export async function fetchPanel(publicId: string): Promise<PanelView> {
  const envelope = await apiSendChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}/panel`,
    panelSchema,
    { method: 'GET' },
  );
  return envelope.data;
}

export async function fetchAppeals(publicId: string): Promise<AppealView[]> {
  const envelope = await apiSendChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}/appeals`,
    appealListSchema,
    { method: 'GET' },
  );
  return envelope.data;
}

export async function fetchMyAppeals(): Promise<AppealView[]> {
  const envelope = await apiSendChecked(`${APPEAL_PATH}/mine`, appealListSchema, {
    method: 'GET',
  });
  return envelope.data;
}

export async function submitAppeal(
  publicId: string,
  grounds: AppealGrounds,
  statement: string,
  evidenceUrls: string[],
  idempotencyKey: string,
): Promise<AppealView> {
  const body: AppealCreate = { grounds, statement, evidenceUrls };
  const envelope = await apiSendChecked(
    `${REPORT_PATH}/${encodeURIComponent(publicId)}/appeals`,
    appealSchema,
    { method: 'POST', body, idempotencyKey },
  );
  return envelope.data;
}

export async function fetchScorecard(
  institutionId: string,
  windowDays = 90,
): Promise<InstitutionScorecard> {
  const envelope = await apiSendChecked(
    `${INSTITUTION_PATH}/${encodeURIComponent(institutionId)}/scorecard?windowDays=${String(windowDays)}`,
    scorecardSchema,
    { method: 'GET' },
  );
  return envelope.data;
}

export async function fetchScorecards(
  windowDays = 90,
): Promise<InstitutionScorecardList> {
  const envelope = await apiSendChecked(
    `${INSTITUTION_PATH}?windowDays=${String(windowDays)}`,
    scorecardListSchema,
    { method: 'GET' },
  );
  return envelope.data;
}
