export const EVIDENCE_MEDIA_TYPES = {
  screenshot: ['image/png', 'image/jpeg'],
  dom_snapshot: ['text/html'],
  accessibility_tree: ['application/json'],
  console_log: ['application/json'],
  network_log: ['application/json'],
  browser_trace: ['application/zip'],
  oracle_result: ['application/json'],
  action_log: ['application/json'],
  human_note: ['text/plain'],
} as const;

export type EvidenceKind = keyof typeof EVIDENCE_MEDIA_TYPES;
export type EvidenceSensitivity = 'standard' | 'sensitive' | 'restricted';
export type EvidenceRedactionState = 'raw' | 'redacted' | 'not_required';
export type EvidenceRetentionClass =
  | 'confirmed_finding'
  | 'passing_run_rich'
  | 'passing_run_summary'
  | 'sensitive_raw'
  | 'audit';
export type EvidenceDeletionState = 'available' | 'deleted';

export interface EvidenceArtifactMetadata {
  id: string;
  tenantId: string;
  projectId: string;
  campaignId: string;
  executionId: string;
  kind: EvidenceKind;
  mediaType: string;
  byteLength: number;
  sha256: string;
  capturedAt: Date;
  sensitivity: EvidenceSensitivity;
  redactionState: EvidenceRedactionState;
  redactionVersion: string | null;
  retentionClass: EvidenceRetentionClass;
  retentionExpiresAt: Date;
  parentArtifactId: string | null;
  deletionState: EvidenceDeletionState;
  deletedAt: Date | null;
}

export interface EvidenceUpload extends Omit<
  EvidenceArtifactMetadata,
  'deletionState' | 'deletedAt'
> {
  body: Buffer;
}

export interface EvidenceAccessGrant {
  authorization: string;
  expiresAt: Date;
}

export interface EvidenceEventReference {
  evidenceId: string;
}

export class EvidenceValidationError extends Error {}
export class EvidenceAccessDeniedError extends Error {}
export class EvidenceConflictError extends Error {}
