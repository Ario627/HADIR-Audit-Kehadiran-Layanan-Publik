import type { AuditService } from '../common/audit/audit.service';

export interface AuditStubRecorder {
  records: Record<string, unknown>[];
  denials: Record<string, unknown>[];
}

export function auditStub(): AuditService {
  return {
    record: async () => undefined,
    denial: async () => undefined,
  } as unknown as AuditService;
}

export function recordingAudit(): { service: AuditService } & AuditStubRecorder {
  const records: Record<string, unknown>[] = [];
  const denials: Record<string, unknown>[] = [];
  const service = {
    record: async (input: unknown) => {
      records.push(input as Record<string, unknown>);
    },
    denial: async (input: unknown) => {
      denials.push(input as Record<string, unknown>);
    },
  } as unknown as AuditService;
  return { service, records, denials };
}
