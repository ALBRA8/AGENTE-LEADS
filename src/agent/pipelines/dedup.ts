// ============================================================
// src/agent/pipelines/dedup.ts
// P0.7 — Multi-signal deduplication.
//
// Match levels:
//   EXACT     — one unique signal matches exactly (email, website)
//   STRONG    — phone, instagram, or domain match
//   PROBABLE   — normalized name + location match
//   NO_MATCH  — nothing matched
//
// The dedup pipeline persists matched leads to the lead_intelligence DB
// via the storage layer. If a match is found, the EXISTING lead is
// updated (not duplicated). If no match, a new Lead row is inserted.
// ============================================================

import type { Lead, MatchLevel } from "../core/lead.js";
import type { ExecutionRecorder } from "../core/execution.js";
import {
  saveLead,
  findDedupMatch,
  recordDedupMatch,
  type StoredLead,
} from "../storage/lead_intelligence.js";

export interface DedupInput {
  lead: Lead;
}

export interface DedupOutput {
  /** The lead that was stored (new or existing) */
  stored: StoredLead;
  /** Whether a new lead was created or an existing one was updated */
  action: "created" | "merged";
  /** Match level with the existing lead (NO_MATCH if new) */
  matchLevel: MatchLevel;
  /** Which signals matched */
  matchedOn: string[];
}

export async function runDedup(
  input: DedupInput,
  trace?: ExecutionRecorder
): Promise<DedupOutput> {
  const lead = input.lead;
  const sig = lead.dedup_signature;
  if (!sig) {
    // No signature → store as new
    const end = trace?.start("dedup", { intent: "store new lead (no signature)" });
    const stored = saveLead(lead);
    end?.({ output: `created lead ${stored.id} (no signature)` });
    return { stored, action: "created", matchLevel: "NO_MATCH", matchedOn: [] };
  }

  const end = trace?.start("dedup", {
    intent: "find dedup match",
    input: { signature: sig },
  });

  const match = findDedupMatch(sig);

  if (!match) {
    // New lead
    const stored = saveLead(lead);
    end?.({ output: `created lead ${stored.id} (NO_MATCH)` });
    return { stored, action: "created", matchLevel: "NO_MATCH", matchedOn: [] };
  }

  // Match found — record the match for audit and merge
  recordDedupMatch(lead.id ?? `pending_${Date.now()}`, match.leadId, match.matchLevel, match.matchedOn);

  // Load the existing lead, merge new evidence/sources, and update.
  // The merged research_state preserves the most advanced state between existing and incoming.
  const existing = getLeadForMerge(match.leadId);
  if (existing) {
    const merged = mergeLeads(existing, lead);
    const stored = saveLead(merged);
    end?.({ output: `merged into lead ${stored.id} (${match.matchLevel} on ${match.matchedOn.join(",")})` });
    return {
      stored,
      action: "merged",
      matchLevel: match.matchLevel,
      matchedOn: match.matchedOn,
    };
  }

  // Existing not loadable (shouldn't happen) → store as new
  const stored = saveLead(lead);
  end?.({ output: `created lead ${stored.id} (existing not loadable)` });
  return { stored, action: "created", matchLevel: match.matchLevel, matchedOn: match.matchedOn };
}

// We import getLeadById lazily to avoid a circular import at module load time
import { getLeadById } from "../storage/lead_intelligence.js";

function getLeadForMerge(id: string): Lead | null {
  const stored = getLeadById(id);
  return stored ?? null;
}

/**
 * Merge a new Lead into an existing one. Strategy:
 *  - For each important field, take the new value ONLY IF:
 *    - existing field is null/empty
 *    - OR existing evidence has status NOT_FOUND and new evidence has FOUND
 *  - Concatenate sources (deduped)
 *  - Concatenate evidence (dedup by field+status)
 *  - Keep existing id, discovered_at
 *  - Keep the more advanced research_state (RESEARCHED > DISCOVERED, VALIDATED > RESEARCHED)
 */
function mergeLeads(existing: Lead, incoming: Lead): Lead {
  const merged: Lead = {
    id: existing.id,
    name: existing.name || incoming.name,
    username: existing.username ?? incoming.username,
    platform: existing.platform ?? incoming.platform,
    url: existing.url ?? incoming.url,
    website: existing.website ?? incoming.website,
    email: existing.email ?? incoming.email,
    phone: existing.phone ?? incoming.phone,
    location: existing.location ?? incoming.location,
    category: existing.category ?? incoming.category,
    niche: existing.niche ?? incoming.niche,
    description: existing.description ?? incoming.description,
    sources: [...new Set([...(existing.sources ?? []), ...(incoming.sources ?? [])])],
    discovered_at: existing.discovered_at,
    evidence: dedupEvidence([...(existing.evidence ?? []), ...(incoming.evidence ?? [])]),
    // FIX (ARCH-H5): validation merge — existing wins per key
    // (prevents incoming "unknown" from overwriting existing "valid")
    validation: mergeValidation(existing.validation ?? {}, incoming.validation ?? {}),
    research_state: pickMoreAdvanced(existing.research_state, incoming.research_state),
    dedup_signature: existing.dedup_signature ?? incoming.dedup_signature,
    lead_score: existing.lead_score ?? incoming.lead_score,
  };
  return merged;
}

/**
 * Merge validation states — existing wins per key.
 * If existing has email:valid and incoming has email:unknown, keep valid.
 * Only fill in keys that existing doesn't have.
 */
function mergeValidation(
  existing: NonNullable<Lead["validation"]>,
  incoming: NonNullable<Lead["validation"]>
): NonNullable<Lead["validation"]> {
  const merged: NonNullable<Lead["validation"]> = { ...existing };
  for (const [key, val] of Object.entries(incoming)) {
    if (!merged[key as keyof typeof merged]) {
      (merged as any)[key] = val;
    }
  }
  return merged;
}

function dedupEvidence(records: Lead["evidence"]): Lead["evidence"] {
  const seen = new Map<string, Lead["evidence"][number]>();
  for (const r of records) {
    // Prefer FOUND > CONFIRMED_ABSENT > NOT_FOUND > INFERRED
    const key = r.field;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
      continue;
    }
    const priority: Record<string, number> = { FOUND: 3, CONFIRMED_ABSENT: 2, NOT_FOUND: 1, INFERRED: 0 };
    if ((priority[r.status] ?? 0) > (priority[existing.status] ?? 0)) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values());
}

function pickMoreAdvanced(a: Lead["research_state"], b: Lead["research_state"]): Lead["research_state"] {
  const order = ["DISCOVERED", "RESEARCHING", "RESEARCHED", "VALIDATED", "STORED", "FAILED"];
  const ai = order.indexOf(a);
  const bi = order.indexOf(b);
  return ai >= bi ? a : b;
}
