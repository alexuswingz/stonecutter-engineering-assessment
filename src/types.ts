import type { Document } from './knowledge.ts';

export type ReportStatus = 'complete' | 'partial';

/** One imported report (raw.subscription_reports) with what was actually loaded for it. */
export interface SourceReport {
  reportId: string; publisherReportId: string; revision: number; status: ReportStatus;
  periodEnd: string; generatedAt: string; extractedAt: string;
  declaredOfferCount: number; declaredActiveSubscriptions: number;
  loadedOfferCount: number; loadedActiveSubscriptions: number;
  /** Part of the figure in the shipped weekly mart. */
  usedByPipeline: boolean;
  /** The single report chosen by sql/select-reports.sql. */
  selected: boolean;
  /** Set when the publisher export lists this report as replaced; null when current or unknown. */
  supersededBy: string | null;
  /** False when the publisher export has no record of this report. */
  knownToPublisher: boolean;
}

/** The publisher's own current report for a week, read from data/exports (authoritative). */
export interface PublisherSnapshot {
  publisherReportId: string; status: ReportStatus; periodEnd: string; generatedAt: string;
  offerCount: number; activeSubscriptions: number;
  /** Offer rows present in the export and their sum, checked against the header totals. */
  offersListed: number; offersTotal: number;
}

/** What the internal weekly mart holds for a week: the figure the original report was built on. */
export interface PipelineSnapshot {
  activeSubscriptions: number; sourceReportIds: string[]; sourceComplete: boolean; sourcePeriodEnd: string;
}

export interface WeekEvidence {
  periodStart: string; expectedPeriodEnd: string;
  pipeline: PipelineSnapshot | null;
  selected: SourceReport | null;
  publisher: PublisherSnapshot | null;
  reports: SourceReport[];
  /** Filled by python/reconcile.py: the figure the sources support, and whether it covers the full week. */
  verifiedActiveSubscriptions?: number | null;
  verifiedThrough?: string | null;
  complete?: boolean;
}

export interface Evidence {
  brandId: string; brandName: string; marketplace: string;
  periodStart: string; expectedPeriodEnd: string; asOf: string;
  current: WeekEvidence; previous: WeekEvidence;
  /** Verified figures and growth, filled by python/reconcile.py. Null means unknown, never zero. */
  activeSubscriptions: number | null; previousSubscriptions: number | null;
  growthPct: number | null;
  /** Growth implied by the shipped mart, kept only to show what the pipeline claimed. */
  pipelineGrowthPct?: number | null;
  sourcePeriodEnd: string | null;
  sourceComplete: boolean; sourceReports: string[]; ingestedAt: string | null;
  previousSourceComplete: boolean; previousSourcePeriodEnd: string | null;
  netSales: number; adSpend: number; attributedAdSales: number; roas: number | null;
  inventoryUnits: number;
  sourceSnapshots: { reportId: string; activeSubscriptions: number }[];
  /** Internally loaded total of the selected current report, and its difference from the publisher total. */
  sourceTotal?: number; reconciliationDelta?: number | null;
}

export interface Check {
  code: string; week: 'current' | 'previous' | 'both';
  passed: boolean;
  /** A failed blocking check means a growth claim or promotion change is not supported. */
  blocking: boolean;
  title: string; detail: string;
  /** What to do about a failure. */
  action?: string;
  reportIds: string[];
}
export interface Quality { status: 'ready' | 'insufficient'; reasons: string[]; checks: Check[] }

export type Action = 'expand_promotion' | 'hold';
export interface Recommendation {
  action: Action; budgetChangePct: number;
  narrative: string; citations: string[];
}
/** The only action the policy authorizes for this evidence. */
export interface PolicyOutcome {
  action: Action; budgetChangePct: number;
  expansionSupported: boolean;
  /** Why an expansion is not supported; empty when it is. */
  blockers: string[];
  nextAction: string;
}
export interface AnalystContext {
  systemPolicy: string; evidence: Evidence; quality: Quality; documents: Document[];
}
export interface Report {
  evidence: Evidence; quality: Quality; outcome: PolicyOutcome; recommendation: Recommendation;
  trace: {
    sql: string; parameters: string[]; context: AnalystContext; proposal: Recommendation;
    proposalAccepted: boolean; validation: string[];
  };
}
