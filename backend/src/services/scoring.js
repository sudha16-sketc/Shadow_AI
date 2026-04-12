/**
 * Security Score Calculator
 * Computes an org-level score (0–100) based on recent violation history.
 * Higher violations → lower score.
 */
import { Event, Org } from '../models/index.js';

const WEIGHTS = { HIGH: 10, MEDIUM: 3, LOW: 1 };
const MAX_DEDUCTION = 100;

export async function recalcSecurityScore() {
  const since = new Date(Date.now() - 7 * 86400000); // last 7 days

  const events = await Event.find({ timestamp: { $gte: since } })
    .select('severity')
    .lean();

  const totalDeduction = events.reduce((acc, e) => acc + (WEIGHTS[e.severity] ?? 0), 0);
  const score = Math.max(0, 100 - Math.min(totalDeduction, MAX_DEDUCTION));

  await Org.updateOne({}, { securityScore: score }, { upsert: true });
  return score;
}