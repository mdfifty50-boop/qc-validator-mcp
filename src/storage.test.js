/**
 * Tests for qc-validator-mcp storage.js (SQLite-backed).
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { logValidation, getFailurePatterns, generateQualityReport } from './storage.js';
import { _resetDb, _closeDb } from './db.js';

// Redirect to a temp SQLite DB before any test opens it
before(() => {
  _closeDb();
  process.env.QC_DATA_DIR = '/tmp/qc-validator-test-' + Date.now();
});

beforeEach(() => {
  _resetDb();
});

// ═══════════════════════════════════════════
// logValidation
// ═══════════════════════════════════════════

describe('logValidation', () => {
  it('should log a validation and return agent stats', () => {
    const result = logValidation('agent-1', {
      output_hash: 'abc123',
      score: 85,
      pass: true,
      issues_count: 0,
      issues: [],
    });

    assert.equal(result.logged, true);
    assert.equal(result.agent_id, 'agent-1');
    assert.equal(result.total_validations, 1);
  });

  it('should accumulate multiple validations for the same agent', () => {
    logValidation('agent-1', { output_hash: 'h1', score: 80, pass: true, issues_count: 0 });
    logValidation('agent-1', { output_hash: 'h2', score: 60, pass: false, issues_count: 2 });
    const result = logValidation('agent-1', { output_hash: 'h3', score: 75, pass: true, issues_count: 1 });

    assert.equal(result.total_validations, 3);
  });

  it('should persist validations independently per agent', () => {
    logValidation('agent-a', { output_hash: 'h1', score: 90, pass: true, issues_count: 0 });
    logValidation('agent-b', { output_hash: 'h2', score: 50, pass: false, issues_count: 3 });

    const patternsA = getFailurePatterns('agent-a');
    const patternsB = getFailurePatterns('agent-b');

    assert.equal(patternsA.total_validations, 1);
    assert.equal(patternsA.pass_rate, 100);
    assert.equal(patternsB.total_validations, 1);
    assert.equal(patternsB.pass_rate, 0);
  });
});

// ═══════════════════════════════════════════
// getFailurePatterns
// ═══════════════════════════════════════════

describe('getFailurePatterns', () => {
  it('should return empty data for unknown agent', () => {
    const result = getFailurePatterns('nobody');
    assert.equal(result.total_validations, 0);
    assert.equal(result.pass_rate, 0);
    assert.equal(result.avg_score, 0);
    assert.ok(result.message);
  });

  it('should calculate pass rate and average score correctly', () => {
    logValidation('agent-1', { output_hash: 'h1', score: 80, pass: true, issues_count: 0 });
    logValidation('agent-1', { output_hash: 'h2', score: 60, pass: true, issues_count: 1 });
    logValidation('agent-1', { output_hash: 'h3', score: 40, pass: false, issues_count: 3 });
    logValidation('agent-1', { output_hash: 'h4', score: 20, pass: false, issues_count: 5 });

    const result = getFailurePatterns('agent-1');
    assert.equal(result.total_validations, 4);
    assert.equal(result.pass_rate, 50); // 2/4 = 50%
    assert.equal(result.avg_score, 50); // (80+60+40+20)/4 = 50
  });

  it('should surface most common issue types', () => {
    logValidation('agent-1', {
      output_hash: 'h1', score: 50, pass: false, issues_count: 2,
      issues: [{ type: 'missing_keywords', severity: 'high' }, { type: 'too_short', severity: 'critical' }],
    });
    logValidation('agent-1', {
      output_hash: 'h2', score: 60, pass: false, issues_count: 1,
      issues: [{ type: 'missing_keywords', severity: 'high' }],
    });

    const result = getFailurePatterns('agent-1');
    assert.ok(result.most_common_issues.length > 0);
    assert.equal(result.most_common_issues[0].type, 'missing_keywords');
    assert.equal(result.most_common_issues[0].count, 2);
  });
});

// ═══════════════════════════════════════════
// generateQualityReport
// ═══════════════════════════════════════════

describe('generateQualityReport', () => {
  it('should return empty report when no data', () => {
    const report = generateQualityReport();
    assert.equal(report.total_agents, 0);
    assert.equal(report.overall_pass_rate, 0);
    assert.equal(report.agents.length, 0);
    assert.ok(report.recommendations.length > 0);
  });

  it('should calculate overall pass rate across all agents', () => {
    // agent-1: 2 pass, 0 fail
    logValidation('agent-1', { output_hash: 'h1', score: 90, pass: true, issues_count: 0 });
    logValidation('agent-1', { output_hash: 'h2', score: 85, pass: true, issues_count: 0 });
    // agent-2: 0 pass, 2 fail
    logValidation('agent-2', { output_hash: 'h3', score: 30, pass: false, issues_count: 4 });
    logValidation('agent-2', { output_hash: 'h4', score: 40, pass: false, issues_count: 3 });

    const report = generateQualityReport();
    assert.equal(report.total_agents, 2);
    assert.equal(report.total_validations, 4);
    assert.equal(report.overall_pass_rate, 50);
  });

  it('should list agents with summaries', () => {
    logValidation('agt-x', { output_hash: 'h1', score: 75, pass: true, issues_count: 1 });

    const report = generateQualityReport();
    const agt = report.agents.find((a) => a.agent_id === 'agt-x');
    assert.ok(agt);
    assert.equal(agt.total_validations, 1);
    assert.equal(agt.pass_rate, 100);
  });
});
