// ═══════════════════════════════════════════
// In-memory storage for QC validation data
// ═══════════════════════════════════════════

// agent_id -> { validations: [{timestamp, output_hash, score, pass, issues_count, issues}], stats_cache }
const agentValidations = new Map();

/**
 * Log a validation result for an agent.
 */
export function logValidation(agent_id, { output_hash, score, pass, issues_count, issues = [] }) {
  if (!agentValidations.has(agent_id)) {
    agentValidations.set(agent_id, { validations: [] });
  }

  const entry = agentValidations.get(agent_id);
  entry.validations.push({
    timestamp: new Date().toISOString(),
    output_hash,
    score,
    pass,
    issues_count,
    issues,
  });

  // Keep last 500 validations per agent
  if (entry.validations.length > 500) {
    entry.validations = entry.validations.slice(-500);
  }

  return {
    logged: true,
    agent_id,
    total_validations: entry.validations.length,
  };
}

/**
 * Get failure patterns for a specific agent.
 */
export function getFailurePatterns(agent_id) {
  const entry = agentValidations.get(agent_id);
  if (!entry || entry.validations.length === 0) {
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

  const vals = entry.validations;
  const total = vals.length;
  const passes = vals.filter((v) => v.pass).length;
  const passRate = Math.round((passes / total) * 100);
  const avgScore = Math.round(vals.reduce((s, v) => s + v.score, 0) / total);

  // Aggregate issue types
  const issueCounts = new Map();
  for (const v of vals) {
    for (const issue of v.issues) {
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
    const earlyAvg = vals.slice(0, quarter).reduce((s, v) => s + v.score, 0) / quarter;
    const lateAvg = vals.slice(-quarter).reduce((s, v) => s + v.score, 0) / quarter;
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
  const agents = [...agentValidations.keys()];
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
  let totalVals = 0;
  let totalPasses = 0;
  for (const entry of agentValidations.values()) {
    totalVals += entry.validations.length;
    totalPasses += entry.validations.filter((v) => v.pass).length;
  }
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
