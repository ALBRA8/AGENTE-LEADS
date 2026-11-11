// ============================================================
// src/lib/ai/scoring.ts — Lead Score 0-100 (ported from V2 P1.1)
// ============================================================

// scoring.ts — no import from qualification needed (self-contained types)

export interface LeadScoreResult {
  score: number;
  breakdown: { field: string; points: number; reason: string }[];
}

export function scoreLead(lead: {
  tier?: string;
  nicheFit?: string | null;
  painDetected?: boolean;
  painType?: string | null;
  techStack?: string | null;
  freshnessData?: string | null;
  city?: string | null;
  category?: string | null;
  validation?: any;
  research_state?: string;
  evidence?: any[];
}): LeadScoreResult {
  const breakdown: { field: string; points: number; reason: string }[] = [];

  // Email validation
  if (lead.validation?.email?.status === "valid" && lead.validation.email.confidence === "high") {
    breakdown.push({ field: "email_validation", points: 20, reason: "email valid + SMTP check" });
  } else if (lead.validation?.email?.status === "valid") {
    breakdown.push({ field: "email_validation", points: 15, reason: "email valid" });
  } else if (lead.validation?.email?.status === "invalid") {
    breakdown.push({ field: "email_validation", points: -10, reason: "email invalid" });
  }

  // Domain validation
  if (lead.validation?.domain?.status === "valid") {
    breakdown.push({ field: "domain_validation", points: 15, reason: "domain resolves" });
  }

  // Found evidence
  const evidence = lead.evidence || [];
  const foundFields = evidence.filter((e: any) => e.status === "FOUND");
  const fieldPoints: Record<string, number> = {
    website: 10, phone: 5, instagram: 10, linkedin: 10,
  };
  for (const ev of foundFields) {
    if (fieldPoints[ev.field] !== undefined) {
      breakdown.push({ field: `${ev.field}_found`, points: fieldPoints[ev.field], reason: `${ev.field} found` });
    }
  }

  // Identity consistency
  if (lead.validation?.identity?.status === "valid") {
    breakdown.push({ field: "identity_consistency", points: 5, reason: "domains match" });
  } else if (lead.validation?.identity?.status === "conflict") {
    breakdown.push({ field: "identity_conflict", points: -10, reason: "domain mismatch" });
  }

  // Research state bonus
  const stateBonus: Record<string, number> = {
    VALIDATED: 15, RESEARCHED: 10, DISCOVERED: 5, STORED: 15, RESEARCHING: 2, FAILED: 0,
  };
  const statePts = stateBonus[lead.research_state ?? ""] ?? 0;
  breakdown.push({ field: "research_state", points: statePts, reason: `${lead.research_state} state` });

  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, breakdown };
}
