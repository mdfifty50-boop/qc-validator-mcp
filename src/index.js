#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { validateOutput, checkHallucinationRisk, checkScopeCompliance } from './validators.js';
import { logValidation, getFailurePatterns, generateQualityReport, getDashboardData } from './storage.js';

const server = new McpServer({
  name: 'qc-validator-mcp',
  version: '0.1.0',
  description: 'Runtime quality validation for AI agent outputs — hallucination detection, scope compliance, and output quality scoring',
});

// ═══════════════════════════════════════════
// TOOL 1: validate_output
// ═══════════════════════════════════════════

server.tool(
  'validate_output',
  'Score agent output quality against configurable criteria. Checks length, required keywords, forbidden patterns, claim density, and task relevance.',
  {
    output: z.string().describe('The agent output text to validate'),
    task_description: z.string().describe('Description of what the agent was asked to do'),
    criteria: z.object({
      max_length: z.number().optional().describe('Maximum character length for the output'),
      required_keywords: z.array(z.string()).default([]).describe('Keywords that must appear in the output'),
      forbidden_patterns: z.array(z.string()).default([]).describe('Regex patterns or strings that must NOT appear'),
      factual_claims_count: z.number().optional().describe('Maximum number of factual claims before flagging high density'),
    }).describe('Quality criteria to check against'),
  },
  async ({ output, task_description, criteria }) => {
    const result = validateOutput(output, task_description, criteria);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL 2: check_hallucination_risk
// ═══════════════════════════════════════════

server.tool(
  'check_hallucination_risk',
  'Estimate hallucination likelihood in agent output. If source text is provided, checks grounding. Otherwise flags outputs with high counts of specific numbers, dates, and URLs.',
  {
    output: z.string().describe('The agent output text to analyze'),
    source_text: z.string().optional().default('').describe('Original source material the output should be grounded in (optional)'),
    claim_count: z.number().optional().default(5).describe('Threshold for number of specific claims before flagging as high risk (default 5)'),
  },
  async ({ output, source_text, claim_count }) => {
    const result = checkHallucinationRisk(output, source_text, claim_count);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL 3: check_scope_compliance
// ═══════════════════════════════════════════

server.tool(
  'check_scope_compliance',
  'Validate that agent output stays within a defined scope contract. Checks allowed/forbidden topics, word limits, and required sections.',
  {
    output: z.string().describe('The agent output text to check'),
    scope: z.object({
      allowed_topics: z.array(z.string()).default([]).describe('Topics the output is allowed to discuss'),
      forbidden_topics: z.array(z.string()).default([]).describe('Topics the output must NOT discuss'),
      max_words: z.number().optional().describe('Maximum word count for the output'),
      required_sections: z.array(z.string()).default([]).describe('Section headings that must appear in the output'),
    }).describe('Scope contract to validate against'),
  },
  async ({ output, scope }) => {
    const result = checkScopeCompliance(output, scope);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL 4: log_validation
// ═══════════════════════════════════════════

server.tool(
  'log_validation',
  'Store a validation result for trending and failure pattern analysis. Accumulates per-agent statistics over time.',
  {
    agent_id: z.string().describe('Unique identifier for the agent whose output was validated'),
    output_hash: z.string().describe('Hash or identifier for the specific output that was validated'),
    score: z.number().min(0).max(100).describe('Quality score from 0-100'),
    pass: z.boolean().describe('Whether the output passed validation'),
    issues_count: z.number().int().min(0).describe('Number of issues found'),
  },
  async (params) => {
    const result = logValidation(params.agent_id, {
      output_hash: params.output_hash,
      score: params.score,
      pass: params.pass,
      issues_count: params.issues_count,
    });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL 5: get_failure_patterns
// ═══════════════════════════════════════════

server.tool(
  'get_failure_patterns',
  'Analyze common failure modes for a specific agent. Returns pass rate, average score, most frequent issue types, and quality trend direction.',
  {
    agent_id: z.string().describe('Agent identifier to analyze'),
  },
  async ({ agent_id }) => {
    const result = getFailurePatterns(agent_id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// TOOL 6: generate_quality_report
// ═══════════════════════════════════════════

server.tool(
  'generate_quality_report',
  'Generate a quality dashboard for all validated agents. Shows per-agent summaries, overall pass rate, worst/best performers, and actionable recommendations.',
  {},
  async () => {
    const report = generateQualityReport();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(report, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// RESOURCE: qc://dashboard
// ═══════════════════════════════════════════

server.resource(
  'dashboard',
  'qc://dashboard',
  async () => {
    const data = getDashboardData();
    return {
      contents: [{
        uri: 'qc://dashboard',
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      }],
    };
  }
);

// ═══════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('QC Validator MCP Server running on stdio');
}

main().catch(console.error);
