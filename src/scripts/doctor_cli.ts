// ============================================================
// src/scripts/doctor_cli.ts
// PRODUCTION CLOSURE §32 — Doctor CLI.
// Usage: npm run doctor
// ============================================================

import "dotenv/config";
import { runDoctor, formatDoctorReport } from "../agent/doctor.js";

const report = runDoctor();
console.log(formatDoctorReport(report));

// Exit code mirrors system health so CI/CD can gate on it.
process.exit(report.status === "down" ? 1 : 0);
