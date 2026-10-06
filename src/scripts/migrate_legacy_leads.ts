// ============================================================
// src/scripts/migrate_legacy_leads.ts
// One-time migration: legacy `leads` table (conversations DB) →
// new `lead_intelligence_leads` table (lead-intelligence DB).
//
// The legacy schema (src/database/sqlite.ts):
//   leads (
//     id           INTEGER PRIMARY KEY AUTOINCREMENT,
//     email        TEXT UNIQUE NOT NULL,
//     username     TEXT,
//     url          TEXT,
//     followers    TEXT,
//     status       TEXT,
//     source       TEXT,
//     created_at   TEXT NOT NULL DEFAULT (datetime('now')),
//     updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
//   )
//
// The new schema is defined in src/agent/storage/lead_intelligence.ts.
// saveLead handles the INSERT/UPSERT and the per-field evidence rows.
//
// Run with:  npx tsx src/scripts/migrate_legacy_leads.ts
//
// Idempotent: re-running is safe — saveLead upserts on dedup_signature
// collisions, and the legacy rows are opened readonly so we never
// mutate the conversations DB.
// ============================================================

import "dotenv/config";
import Database from "better-sqlite3";
import fs from "fs";
import { saveLead } from "../agent/storage/lead_intelligence.js";
import { found, notFound } from "../agent/core/evidence.js";
import { buildDedupSignature, type Lead } from "../agent/core/lead.js";

const CONV_DB_PATH = process.env.DB_PATH ?? "./data/agente-leads.db";

async function main(): Promise<void> {
  console.log(`[migrate] reading legacy leads from ${CONV_DB_PATH}`);
  if (!fs.existsSync(CONV_DB_PATH)) {
    console.log(`[migrate] conversations DB not found — nothing to migrate.`);
    return;
  }

  const convDb = new Database(CONV_DB_PATH, { readonly: true });
  let legacyRows: any[] = [];
  try {
    legacyRows = convDb.prepare("SELECT * FROM leads").all() as any[];
  } catch (e: any) {
    console.log(
      `[migrate] no legacy 'leads' table found (${e.message}) — nothing to migrate.`
    );
    convDb.close();
    return;
  }
  convDb.close();

  console.log(`[migrate] found ${legacyRows.length} legacy leads to migrate`);

  let migrated = 0;
  let skipped = 0;
  for (const row of legacyRows) {
    // Skip if no email AND no username — we need at least one identity signal
    if (!row.email && !row.username) {
      console.log(
        `[migrate] skipping lead ${row.id} (no email, no username)`
      );
      skipped++;
      continue;
    }

    const lead: Lead = {
      name: row.username || row.email || `legacy_lead_${row.id}`,
      username: row.username || null,
      email: row.email || undefined,
      url: row.url || undefined,
      website: row.url || undefined,
      sources: row.source
        ? [row.source, "legacy_migration"]
        : ["legacy_migration"],
      discovered_at: row.created_at || new Date().toISOString(),
      evidence: row.email
        ? [
            found(
              "email",
              row.email,
              "legacy_migration",
              "migrated from legacy leads table"
            ),
          ]
        : [notFound("email", "legacy_migration")],
      validation: {},
      research_state: "RESEARCHED",
      dedup_signature: buildDedupSignature({
        name: row.username || row.email,
        username: row.username,
        email: row.email,
        website: row.url,
      }),
    };

    try {
      const stored = saveLead(lead);
      console.log(
        `[migrate] ✓ migrated lead ${row.id} → ${stored.id} (${row.email || row.username})`
      );
      migrated++;
    } catch (e: any) {
      console.error(`[migrate] ✗ failed to migrate lead ${row.id}: ${e.message}`);
      skipped++;
    }
  }

  console.log(`[migrate] done. migrated=${migrated}, skipped=${skipped}`);
}

main().catch((e) => {
  console.error("[migrate] fatal:", e);
  process.exit(1);
});
