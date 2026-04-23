// ═══════════════════════════════════════════
// SQLite-backed storage for QC validation data
// ═══════════════════════════════════════════

import { getDb } from './db.js';

/**
 * Log a validation result for an agent.
 */
export function logValidation(agent_id, { output_hash, score, pass, issues_count, issues = [] }) {
  const db = getDb();

  // Keep last 500 validations per agent — delete oldest if over limit
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM validations WHERE agent_id = ?').get(agent_id).cnt;
  if (count >= 500) {
    const oldest = db.prepare(
      'SELECT id FROM validations WHERE agent_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(agent_id, count - 499);
    const del = db.prepare('DELETE FROM validations WHERE id = ?');
    for (const row of oldest) del.run(row.id);
  }

  db.prepare(`
    INSERT INTO validations (agent_id, output_hash, score, pass, issues_count, issues_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    agent_id,
    output_hash,
    score,
    pass ? 1 : 0,
    issues_count,
    JSON.stringify(issues),
    new Date().toISOString()
  );

  const total = db.prepare('SELECT COUNT(*) AS cnt FROM validations WHERE agent_id = ?').get(agent_id).cnt;

  return {
    logged: true,
    agent_id,
    total_validations: total,
  };
}

/**
 * Get failure patterns for a specific agent.
 */
export function getFailurePatterns(agent_id) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT score, pass, issues_json FROM validations WHERE agent_id = ? ORDER BY created_at ASC'
  ).all(agent_id);

  if (rows.length === 0) {
    return {
      agent_id,
      total_validations: 0,
      pass_rate: 0,
      avg_score: 0,
      most_common_issues: [],
      trend: 'stable',
      message: 'No validation data for this agent.',
    };
  }

  const total = rows.length;
  const passes = rows.filter((r) => r.pass === 1).length;
  const passRate = Math.round((passes / total) * 100);
  const avgScore = Math.round(rows.reduce((s, r) => s + r.score, 0) / total);

  // Aggregate issue types
  const issueCounts = new Map();
  for (const row of rows) {
    const issues = JSON.parse(row.issues_json || '[]');
    for (const issue of issues) {
      const t = issue.type || 'unknown';
      issueCounts.set(t, (issueCounts.get(t) || 0) + 1);
    }
  }

  const mostCommonIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({
      type,
      count,
      percentage: Math.round((count / total) * 100),
    }));

  // Trend: compare last 25% vs first 25%
  let trend = 'stable';
  if (total >= 8) {
    const quarter = Math.floor(total / 4);
    const earlyAvg = rows.slice(0, quarter).reduce((s, r) => s + r.score, 0) / quarter;
    const lateAvg = rows.slice(-quarter).reduce((s, r) => s + r.score, 0) / quarter;
    const diff = lateAvg - earlyAvg;
    if (diff > 5) trend = 'improving';
    else if (diff < -5) trend = 'degrading';
  }

  return {
    agent_id,
    total_validations: total,
    pass_rate: passRate,
    avg_score: avgScore,
    most_common_issues: mostCommonIssues,
    trend,
  };
}

/**
 * Generate a quality report across all agents.
 */
export function generateQualityReport() {
  const db = getDb();
  const agentRows = db.prepare('SELECT DISTINCT agent_id FROM validations').all();
  const agents = agentRows.map((r) => r.agent_id);

  if (agents.length === 0) {
    return {
      total_agents: 0,
      overall_pass_rate: 0,
      agents: [],
      worst_performers: [],
      best_performers: [],
      recommendations: ['No validation data yet. Start validating agent outputs to build quality metrics.'],
      generated_at: new Date().toISOString(),
    };
  }

  const agentSummaries = agents.map((id) => {
    const patterns = getFailurePatterns(id);
    return {
      agent_id: id,
      total_validations: patterns.total_validations,
      pass_rate: patterns.pass_rate,
      avg_score: patterns.avg_score,
      trend: patterns.trend,
      top_issue: patterns.most_common_issues[0]?.type || 'none',
    };
  });

  // Overall stats
  const totals = db.prepare('SELECT COUNT(*) AS total, SUM(pass) AS passes FROM validations').get();
  const totalVals = totals.total;
  const totalPasses = totals.passes || 0;
  const overallPassRate = totalVals > 0 ? Math.round((totalPasses / totalVals) * 100) : 0;

  // Sort for best/worst
  const sorted = [...agentSummaries].sort((a, b) => a.avg_score - b.avg_score);
  const worstPerformers = sorted.slice(0, 3).filter((a) => a.avg_score < 70);
  const bestPerformers = sorted.slice(-3).reverse().filter((a) => a.avg_score > 0);

  // Recommendations
  const recommendations = [];
  if (overallPassRate < 70) {
    recommendations.push('Overall pass rate is below 70%. Review agent prompts and scope definitions.');
  }
  const degrading = agentSummaries.filter((a) => a.trend === 'degrading');
  if (degrading.length > 0) {
    recommendations.push(`${degrading.length} agent(s) show degrading quality trends: ${degrading.map((a) => a.agent_id).join(', ')}.`);
  }
  if (worstPerformers.length > 0) {
    recommendations.push(`Focus QC attention on: ${worstPerformers.map((a) => a.agent_id).join(', ')}.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('All agents performing within acceptable quality thresholds.');
  }

  return {
    total_agents: agents.length,
    total_validations: totalVals,
    overall_pass_rate: overallPassRate,
    agents: agentSummaries,
    worst_performers: worstPerformers,
    best_performers: bestPerformers,
    recommendations,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Get dashboard data (for resource endpoint).
 */
export function getDashboardData() {
  return generateQualityReport();
}
