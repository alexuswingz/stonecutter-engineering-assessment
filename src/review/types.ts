import type { Action, Evidence, PolicyOutcome, Quality, Recommendation } from '../types.ts';

/** Contracts between the review service, the route handlers and the React client. */

export interface Period { periodStart: string; periodEnd: string; previousStart: string; previousEnd: string; asOf: string }
export interface ScopeInfo extends Period { brandId: string; brandName: string; marketplace: string }

/** Derived on every read, never stored:
 * not_opened -> open -> decided; decided -> needs_attention when the evidence no longer matches. */
export type CaseStatus = 'not_opened' | 'open' | 'decided' | 'needs_attention';

/** Everything the decision was based on, frozen at save time. */
export interface DecisionSnapshot { evidence: Evidence; quality: Quality; outcome: PolicyOutcome }

export interface SavedDecision {
  decisionId: number; decidedAt: string;
  decision: Action; budgetChangePct: number;
  reason: string; nextAction: string; limitations: string[];
  evidenceFingerprint: string; snapshot: DecisionSnapshot;
}

export interface CaseState {
  caseId: string; status: CaseStatus; openedAt: string | null;
  /** Latest decision; earlier ones stay in the store as history. */
  decision: SavedDecision | null; decisionCount: number;
  /** For needs_attention: what differs between the saved evidence and the evidence now. */
  changes: string[];
}

export interface ModelCheck {
  proposal: Recommendation; accepted: boolean; notes: string[];
  documents: { id: string; source: string }[];
}

export interface CaseReview {
  scope: ScopeInfo; evidence: Evidence; quality: Quality; outcome: PolicyOutcome;
  recommendation: Recommendation; model: ModelCheck;
  /** Hash of the decision-relevant evidence. A decision must quote the fingerprint it was made against. */
  fingerprint: string; case: CaseState;
}

export interface CaseSummary {
  brandId: string; brandName: string; marketplace: string;
  pipeline: { current: number | null; growthPct: number | null };
  verified: { current: number | null; growthPct: number | null; complete: boolean; through: string | null };
  qualityStatus: Quality['status'];
  /** Failed checks, and how many of them block a growth claim. */
  issues: number; blocking: number; headline: string;
  outcome: { action: Action; budgetChangePct: number };
  caseStatus: CaseStatus;
  decision: { decision: Action; budgetChangePct: number; decidedAt: string } | null;
}
export interface CaseList { period: Period; cases: CaseSummary[] }

export interface DecisionInput {
  decision: Action; reason: string; nextAction?: string;
  /** Optional; when present it must equal the authorized percentage for the decision. */
  budgetChangePct?: number;
  evidenceFingerprint: string;
}

export interface ClientReport {
  scope: ScopeInfo;
  decisionId: number; decidedAt: string; evidenceFingerprint: string;
  headline: string; narrative: string;
  result: {
    activeSubscriptions: number | null; complete: boolean; through: string | null;
    previousSubscriptions: number | null; growthPct: number | null;
  };
  decision: { action: Action; budgetChangePct: number; label: string; reason: string };
  limitations: string[]; nextAction: string;
  context: { netSales: number; roas: number | null; inventoryUnits: number };
  sources: { week: 'Reporting week' | 'Comparison week'; publisherReportId: string; status: string; periodEnd: string }[];
}

export interface ApiError { error: { code: string; message: string; details: string[] } }
