# qc-validator-mcp

Runtime quality validation for AI agent outputs. Detect hallucinations, enforce scope compliance, and score output quality — all via MCP.

## Install

```bash
npx qc-validator-mcp
```

### Claude Desktop

```json
{
  "mcpServers": {
    "qc-validator": {
      "command": "npx",
      "args": ["qc-validator-mcp"]
    }
  }
}
```

## Tools

### validate_output
Score agent output against configurable criteria: length limits, required keywords, forbidden patterns, and factual claim density.

```
Params: output, task_description, criteria { max_length, required_keywords[], forbidden_patterns[], factual_claims_count }
Returns: { pass, score, issues[], recommendation }
```

### check_hallucination_risk
Estimate hallucination likelihood. With source text, checks sentence-level grounding. Without source, flags outputs dense with specific numbers, dates, and URLs.

```
Params: output, source_text (optional), claim_count (default 5)
Returns: { risk_level, unsupported_claims[], confidence, suggestion }
```

### check_scope_compliance
Validate output against a scope contract — allowed/forbidden topics, word limits, required sections.

```
Params: output, scope { allowed_topics[], forbidden_topics[], max_words, required_sections[] }
Returns: { compliant, violations[], scope_utilization_percent }
```

### log_validation
Store validation results for per-agent trending.

```
Params: agent_id, output_hash, score, pass, issues_count
Returns: { logged, agent_id, total_validations }
```

### get_failure_patterns
Analyze common failure modes for a specific agent.

```
Params: agent_id
Returns: { total_validations, pass_rate, avg_score, most_common_issues[], trend }
```

### generate_quality_report
Quality dashboard across all validated agents — no parameters required.

```
Returns: { total_agents, overall_pass_rate, agents[], worst_performers[], best_performers[], recommendations[] }
```

## Resource

- `qc://dashboard` — Quality metrics for all validated agents

## Architecture

- Pure Node.js ES modules
- In-memory Maps (no external dependencies)
- stdio transport via @modelcontextprotocol/sdk
- Zero configuration required

## License

MIT
