// ═══════════════════════════════════════════
// Core validation logic
// ═══════════════════════════════════════════

/**
 * Split text into sentences (rough but effective).
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/**
 * Count words in text.
 */
function countWords(text) {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Validate agent output quality against criteria.
 */
export function validateOutput(output, task_description, criteria) {
  const issues = [];
  let score = 100;

  const wordCount = countWords(output);

  // Length check
  if (criteria.max_length != null) {
    if (output.length > criteria.max_length) {
      issues.push({
        type: 'length_exceeded',
        description: `Output is ${output.length} chars, exceeds max of ${criteria.max_length}`,
        severity: 'medium',
      });
      score -= 15;
    }
  }

  // Required keywords
  if (criteria.required_keywords && criteria.required_keywords.length > 0) {
    const lowerOutput = output.toLowerCase();
    const missing = criteria.required_keywords.filter((kw) => !lowerOutput.includes(kw.toLowerCase()));
    if (missing.length > 0) {
      issues.push({
        type: 'missing_keywords',
        description: `Missing required keywords: ${missing.join(', ')}`,
        severity: 'high',
      });
      const penalty = Math.min(30, missing.length * 10);
      score -= penalty;
    }
  }

  // Forbidden patterns
  if (criteria.forbidden_patterns && criteria.forbidden_patterns.length > 0) {
    for (const pattern of criteria.forbidden_patterns) {
      try {
        const regex = new RegExp(pattern, 'gi');
        const matches = output.match(regex);
        if (matches && matches.length > 0) {
          issues.push({
            type: 'forbidden_pattern',
            description: `Found forbidden pattern "${pattern}" (${matches.length} occurrence(s))`,
            severity: 'high',
          });
          score -= 20;
        }
      } catch {
        // Invalid regex, try literal match
        if (output.toLowerCase().includes(pattern.toLowerCase())) {
          issues.push({
            type: 'forbidden_pattern',
            description: `Found forbidden content: "${pattern}"`,
            severity: 'high',
          });
          score -= 20;
        }
      }
    }
  }

  // Claim density check
  if (criteria.factual_claims_count != null) {
    // Estimate claims: sentences with numbers, dates, percentages, proper nouns
    const sentences = splitSentences(output);
    const claimPatterns = /\d+[\d,.]*%?|\b\d{4}\b|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/gi;
    let claimSentences = 0;
    for (const s of sentences) {
      if (claimPatterns.test(s)) claimSentences++;
      claimPatterns.lastIndex = 0;
    }

    if (claimSentences > criteria.factual_claims_count) {
      issues.push({
        type: 'high_claim_density',
        description: `Estimated ${claimSentences} factual claims, threshold is ${criteria.factual_claims_count}. High claim density increases hallucination risk.`,
        severity: 'medium',
      });
      score -= 10;
    }
  }

  // Empty or trivially short output
  if (wordCount < 5) {
    issues.push({
      type: 'too_short',
      description: `Output is only ${wordCount} words — likely incomplete`,
      severity: 'critical',
    });
    score -= 40;
  }

  // Task relevance: check if any words from task description appear
  if (task_description && task_description.length > 0) {
    const taskWords = task_description
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const lowerOutput = output.toLowerCase();
    const matches = taskWords.filter((w) => lowerOutput.includes(w));
    const relevance = taskWords.length > 0 ? matches.length / taskWords.length : 1;

    if (relevance < 0.2 && taskWords.length >= 3) {
      issues.push({
        type: 'low_relevance',
        description: `Output shares only ${Math.round(relevance * 100)}% vocabulary overlap with task description`,
        severity: 'medium',
      });
      score -= 15;
    }
  }

  score = Math.max(0, Math.min(100, score));
  const pass = score >= 60 && !issues.some((i) => i.severity === 'critical');

  let recommendation = 'Output meets quality standards.';
  if (!pass) {
    const criticals = issues.filter((i) => i.severity === 'critical');
    const highs = issues.filter((i) => i.severity === 'high');
    if (criticals.length > 0) {
      recommendation = `Critical issues found: ${criticals.map((i) => i.type).join(', ')}. Output should be rejected and regenerated.`;
    } else if (highs.length > 0) {
      recommendation = `High-severity issues: ${highs.map((i) => i.type).join(', ')}. Revise output before accepting.`;
    } else {
      recommendation = `Score below passing threshold (${score}/100). Review and improve output quality.`;
    }
  }

  return { pass, score, issues, recommendation };
}

/**
 * Check hallucination risk.
 */
export function checkHallucinationRisk(output, source_text, claim_count) {
  const sentences = splitSentences(output);
  const unsupportedClaims = [];
  let riskScore = 0;

  if (source_text && source_text.length > 0) {
    // Source-grounded check: for each output sentence, check keyword overlap with source
    const sourceWords = new Set(
      source_text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
    );

    let supportedCount = 0;
    for (const sentence of sentences) {
      const sentenceWords = sentence
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const overlap = sentenceWords.filter((w) => sourceWords.has(w)).length;
      const ratio = sentenceWords.length > 0 ? overlap / sentenceWords.length : 0;

      if (ratio < 0.15 && sentenceWords.length >= 4) {
        unsupportedClaims.push(sentence.slice(0, 120) + (sentence.length > 120 ? '...' : ''));
        riskScore += 15;
      } else {
        supportedCount++;
      }
    }

    // Normalize risk
    if (sentences.length > 0) {
      riskScore = Math.round((unsupportedClaims.length / sentences.length) * 100);
    }
  } else {
    // No source — flag specific/verifiable claims as potential hallucinations
    const specificPatterns = [
      /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%/g,          // percentages
      /\$\d[\d,.]+/g,                                 // dollar amounts
      /\b(?:19|20)\d{2}\b/g,                          // years
      /https?:\/\/\S+/g,                               // URLs
      /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,              // dates
      /"[^"]{5,}"/g,                                   // quoted text (possible fabricated quotes)
    ];

    let specificCount = 0;
    for (const sentence of sentences) {
      let hasSpecific = false;
      for (const pattern of specificPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(sentence)) {
          hasSpecific = true;
          specificCount++;
          break;
        }
      }
      if (hasSpecific && specificCount > (claim_count || 5)) {
        unsupportedClaims.push(sentence.slice(0, 120) + (sentence.length > 120 ? '...' : ''));
      }
    }

    riskScore = Math.min(100, specificCount * 12);
  }

  let risk_level = 'low';
  if (riskScore > 60) risk_level = 'high';
  else if (riskScore > 30) risk_level = 'medium';

  const confidence = Math.min(95, 50 + sentences.length * 2);

  let suggestion = 'Output appears grounded. Standard review recommended.';
  if (risk_level === 'high') {
    suggestion = 'High hallucination risk detected. Require source citations for all factual claims before accepting.';
  } else if (risk_level === 'medium') {
    suggestion = 'Moderate risk. Spot-check specific numbers, dates, and quoted text against sources.';
  }

  return {
    risk_level,
    unsupported_claims: unsupportedClaims.slice(0, 10),
    confidence,
    suggestion,
  };
}

/**
 * Check scope compliance.
 */
export function checkScopeCompliance(output, scope) {
  const violations = [];
  const lowerOutput = output.toLowerCase();
  const wordCount = countWords(output);

  // Max words check
  if (scope.max_words != null && wordCount > scope.max_words) {
    violations.push({
      rule: 'max_words',
      detail: `Output is ${wordCount} words, exceeds limit of ${scope.max_words}`,
    });
  }

  // Forbidden topics
  if (scope.forbidden_topics && scope.forbidden_topics.length > 0) {
    for (const topic of scope.forbidden_topics) {
      if (lowerOutput.includes(topic.toLowerCase())) {
        violations.push({
          rule: 'forbidden_topic',
          detail: `Output references forbidden topic: "${topic}"`,
        });
      }
    }
  }

  // Required sections
  let sectionsFound = 0;
  if (scope.required_sections && scope.required_sections.length > 0) {
    for (const section of scope.required_sections) {
      // Check for section header patterns: "## Section", "Section:", "**Section**"
      const patterns = [
        new RegExp(`#+\\s*${escapeRegex(section)}`, 'i'),
        new RegExp(`\\*\\*${escapeRegex(section)}\\*\\*`, 'i'),
        new RegExp(`${escapeRegex(section)}\\s*:`, 'i'),
      ];
      const found = patterns.some((p) => p.test(output));
      if (found) {
        sectionsFound++;
      } else {
        violations.push({
          rule: 'missing_section',
          detail: `Required section not found: "${section}"`,
        });
      }
    }
  }

  // Allowed topics relevance check
  let topicUtilization = 100;
  if (scope.allowed_topics && scope.allowed_topics.length > 0) {
    const topicsCovered = scope.allowed_topics.filter((t) => lowerOutput.includes(t.toLowerCase()));
    topicUtilization = Math.round((topicsCovered.length / scope.allowed_topics.length) * 100);

    // Check if output discusses things outside allowed topics
    // (Heuristic: if output has very low overlap with allowed topic keywords, it may be off-scope)
    if (topicUtilization === 0 && scope.allowed_topics.length > 0) {
      violations.push({
        rule: 'off_topic',
        detail: `Output does not reference any allowed topics: ${scope.allowed_topics.join(', ')}`,
      });
    }
  }

  const compliant = violations.length === 0;

  // Calculate utilization: how much of the allowed scope was used
  let scopeUtilization = topicUtilization;
  if (scope.required_sections && scope.required_sections.length > 0) {
    const sectionUtil = Math.round((sectionsFound / scope.required_sections.length) * 100);
    scopeUtilization = Math.round((topicUtilization + sectionUtil) / 2);
  }

  return {
    compliant,
    violations,
    scope_utilization_percent: scopeUtilization,
  };
}

/**
 * Escape regex special characters.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
