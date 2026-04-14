// backend/src/routes/analytics.js
/**
 * Shadow AI Auditor — Analytics Routes
 * Powers the dashboard charts and risk views.
 */
import { Router } from 'express';
import { Event, User, Org } from '../models/index.js';

const router = Router();

// ─── GET /api/analytics/overview ──────────────────────────────────────────────

router.get('/overview', async (req, res) => {
  const days = +(req.query.days ?? 30);
  const since = new Date(Date.now() - days * 86400000);

  const [
    totalEvents,
    highRiskEvents,
    uniqueUsers,
    securityScore,
    topDomains,
  ] = await Promise.all([
    Event.countDocuments({ timestamp: { $gte: since } }),
    Event.countDocuments({ severity: 'HIGH', timestamp: { $gte: since } }),
    Event.distinct('userId', { timestamp: { $gte: since } }).then(a => a.length),
    Org.findOne().select('securityScore').lean(),
    Event.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ]);

  res.json({
    totalEvents,
    highRiskEvents,
    uniqueUsers,
    securityScore: securityScore?.securityScore ?? 100,
    topDomains,
  });
});

// ─── GET /api/analytics/risk-timeline ─────────────────────────────────────────
// Returns daily risk score averages for the chart

router.get('/risk-timeline', async (req, res) => {
  const days = +(req.query.days ?? 30);
  const since = new Date(Date.now() - days * 86400000);

  const data = await Event.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: {
          year:  { $year:  '$timestamp' },
          month: { $month: '$timestamp' },
          day:   { $dayOfMonth: '$timestamp' },
        },
        avgScore: { $avg: '$riskScore' },
        count:    { $sum: 1 },
        high:     { $sum: { $cond: [{ $eq: ['$severity','HIGH']   }, 1, 0] } },
        medium:   { $sum: { $cond: [{ $eq: ['$severity','MEDIUM'] }, 1, 0] } },
        low:      { $sum: { $cond: [{ $eq: ['$severity','LOW']    }, 1, 0] } },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);

  const timeline = data.map(d => ({
    date: `${d._id.year}-${String(d._id.month).padStart(2,'0')}-${String(d._id.day).padStart(2,'0')}`,
    avgScore: Math.round(d.avgScore),
    count: d.count,
    high: d.high,
    medium: d.medium,
    low: d.low,
  }));

  res.json({ timeline });
});

// ─── GET /api/analytics/top-users ─────────────────────────────────────────────

router.get('/top-users', async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);

  const topUsers = await Event.aggregate([
    { $match: { timestamp: { $gte: since }, userRef: { $exists: true } } },
    {
      $group: {
        _id: '$userRef',
        totalEvents: { $sum: 1 },
        highRisk:    { $sum: { $cond: [{ $eq: ['$severity','HIGH']}, 1, 0] } },
        avgScore:    { $avg: '$riskScore' },
      },
    },
    { $sort: { highRisk: -1, avgScore: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
        pipeline: [{ $project: { name: 1, email: 1, department: 1 } }],
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        name:        '$user.name',
        email:       '$user.email',
        department:  '$user.department',
        totalEvents: 1,
        highRisk:    1,
        avgScore:    { $round: ['$avgScore', 0] },
      },
    },
  ]);

  res.json({ topUsers });
});

// ─── GET /api/analytics/severity-breakdown ────────────────────────────────────

router.get('/severity-breakdown', async (req, res) => {
  const since = new Date(Date.now() - 30 * 86400000);

  const breakdown = await Event.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $group: { _id: '$severity', count: { $sum: 1 } } },
  ]);

  res.json({ breakdown });
});

export default router;