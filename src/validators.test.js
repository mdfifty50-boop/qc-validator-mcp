/**
 * Tests for qc-validator-mcp validators and storage.
 * Uses node:test + node:assert/strict.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutput, checkHallucinationRisk, checkScopeCompliance } from './validators.js';
import { logValidation, getFailurePatterns, generateQualityReport } from './storage.js';

describe('validateOutput', () => {
  test('passes output that meets all criteria', () => {
    const r = validateOutput(
      'The market analysis shows strong growth in AI tools.',
      'Analyze market trends',
      { required_keywords: ['market', 'AI'], forbidden_patterns: ['ERROR'] }
    );
    assert.ok(r.score > 0);
    assert.equal(r.pass, true);
  });

  test('fails when required keyword is missing', () => {
    const r = validateOutput(
      'This is a report about nothing useful.',
      'Analyze market trends',
      { required_keywords: ['market', 'revenue'] }
    );
    assert.ok(r.issues.some(i => i.type === 'missing_keywords'));
    assert.ok(r.score < 100);
  });

  test('fails when forbidden pattern appears', () => {
    const r = validateOutput(
      'ERROR: system crashed unexpectedly',
      'Generate a report',
      { forbidden_patterns: ['ERROR'] }
    );
    assert.ok(r.issues.some(i => i.type === 'forbidden_pattern'));
    assert.ok(r.score < 100);
  });

  test('fails when output exceeds max_length', () => {
    const longText = 'a'.repeat(200);
    const r = validateOutput(longText, 'Write brief summary', { max_length: 50 });
    assert.ok(r.issues.some(i => i.type === 'length_exceeded'));
  });

  test('returns score between 0 and 100', () => {
    const r = validateOutput('short', 'task', {});
    assert.ok(r.score >= 0 && r.score <= 100);
  });
});

describe('checkHallucinationRisk', () => {
  test('flags high claim density as risky', () => {
    const text = 'On January 1, 2024, at 3:45 PM, the company earned $1.2M. ' +
      'CEO John Smith (DOB: 1975-03-12) said 87.3% of users agreed. ' +
      'The stock hit $142.50 on NYSE: ACME. Revenue was $456,789.';
    const r = checkHallucinationRisk(text, '', 3);
    assert.ok(['medium', 'high'].includes(r.risk_level));
  });

  test('low risk for simple factual text', () => {
    const r = checkHallucinationRisk('The sky is blue and the sun is yellow.', '', 10);
    assert.ok(['low', 'medium'].includes(r.risk_level));
  });

  test('returns risk_level field', () => {
    const r = checkHallucinationRisk('Hello world', '');
    assert.ok(['low', 'medium', 'high'].includes(r.risk_level));
  });
});

describe('checkScopeCompliance', () => {
  test('passes output that mentions allowed topic', () => {
    const r = checkScopeCompliance(
      'This analysis covers AI market trends and pricing models.',
      { allowed_topics: ['AI', 'market'], forbidden_topics: [], max_words: 1000 }
    );
    assert.ok(r.compliant === true || r.violations?.length === 0);
  });

  test('flags forbidden topic', () => {
    const r = checkScopeCompliance(
      'This is about politics and elections.',
      { allowed_topics: ['technology'], forbidden_topics: ['politics'], max_words: 1000 }
    );
    assert.ok(!r.compliant || r.violations?.length > 0);
  });
});

describe('logValidation and getFailurePatterns', () => {
  test('logs validation and returns total_validations', () => {
    const r = logValidation('agent-qc-1', {
      output_hash: 'abc123',
      score: 85,
      pass: true,
      issues_count: 0,
    });
    assert.equal(r.logged, true);
    assert.ok(r.total_validations >= 1);
  });

  test('getFailurePatterns returns stats for logged agent', () => {
    logValidation('agent-qc-1', { output_hash: 'def456', score: 45, pass: false, issues_count: 2 });
    const r = getFailurePatterns('agent-qc-1');
    assert.equal(r.agent_id, 'agent-qc-1');
    assert.ok(r.total_validations >= 2);
    assert.ok(r.avg_score >= 0);
  });

  test('getFailurePatterns returns empty stats for unknown agent', () => {
    const r = getFailurePatterns('unknown-agent-xyz');
    assert.equal(r.total_validations, 0);
  });

  test('generateQualityReport returns report object', () => {
    const r = generateQualityReport();
    assert.ok(r);
    assert.ok(typeof r === 'object');
  });
});
