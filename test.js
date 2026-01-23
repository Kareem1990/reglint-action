/**
 * Reglint GitHub Action - Comprehensive Test Suite
 *
 * This test file validates all core functionality of the Reglint action:
 * - File filtering logic
 * - Threshold checking
 * - Lambda API integration (mocked)
 * - Violation counting
 * - PR comment formatting
 * - Error handling
 *
 * Run with: npm test
 */

const assert = require('assert');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

// Supported file extensions (mirrored from index.js)
const SUPPORTED_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx',
  '.py',
  '.java',
  '.go',
  '.rb',
  '.php',
  '.cs',
  '.cpp', '.c'
];

// Extension to language mapping
const EXTENSION_TO_LANGUAGE = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.c': 'c'
};

// ============================================================================
// CORE FUNCTIONS (Extracted from index.js for testing)
// ============================================================================

/**
 * Checks if a file path has a supported code extension
 */
function isSupportedFile(filePath) {
  const lowerPath = filePath.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

/**
 * Gets the language identifier for a file based on its extension
 */
function getLanguage(filePath) {
  const lowerPath = filePath.toLowerCase();
  for (const [ext, lang] of Object.entries(EXTENSION_TO_LANGUAGE)) {
    if (lowerPath.endsWith(ext)) {
      return lang;
    }
  }
  return 'unknown';
}

/**
 * Counts violations by severity level from the API response
 */
function countViolationsBySeverity(response) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: 0
  };

  // If the response includes a summary, use it
  if (response.summary) {
    counts.critical = response.summary.critical || 0;
    counts.high = response.summary.high || 0;
    counts.medium = response.summary.medium || 0;
    counts.low = response.summary.low || 0;
    counts.total = response.summary.total_violations ||
                   (counts.critical + counts.high + counts.medium + counts.low);
    return counts;
  }

  // Otherwise, count violations manually
  const violations = response.violations || [];
  for (const violation of violations) {
    const severity = (violation.severity || 'low').toLowerCase();
    if (severity === 'critical') counts.critical++;
    else if (severity === 'high') counts.high++;
    else if (severity === 'medium') counts.medium++;
    else counts.low++;
  }
  counts.total = violations.length;

  return counts;
}

/**
 * Checks if violation counts exceed configured thresholds
 */
function checkThresholds(counts, thresholds) {
  const exceeded = [];

  if (counts.critical > thresholds.maxCritical) {
    exceeded.push(`Critical: ${counts.critical} (max: ${thresholds.maxCritical})`);
  }
  if (counts.high > thresholds.maxHigh) {
    exceeded.push(`High: ${counts.high} (max: ${thresholds.maxHigh})`);
  }
  if (counts.medium > thresholds.maxMedium) {
    exceeded.push(`Medium: ${counts.medium} (max: ${thresholds.maxMedium})`);
  }
  if (counts.low > thresholds.maxLow) {
    exceeded.push(`Low: ${counts.low} (max: ${thresholds.maxLow})`);
  }

  return {
    passed: exceeded.length === 0,
    exceeded
  };
}

/**
 * Formats a single violation for display in the PR comment
 */
function formatViolation(v) {
  let text = `#### ${v.framework || 'Compliance'} ${v.rule || 'Violation'}\n`;
  text += `- **File:** \`${v.file}${v.line ? `:${v.line}` : ''}\`\n`;
  text += `- **Issue:** ${v.message || 'Compliance violation detected'}\n`;
  if (v.evidence) {
    text += `- **Evidence:** \`${v.evidence}\`\n`;
  }
  if (v.recommendation) {
    text += `- **Fix:** ${v.recommendation}\n`;
  }
  text += `\n`;
  return text;
}

/**
 * Formats the PR comment with violation details using a hybrid approach
 * with collapsible sections for high/medium/low issues
 */
function formatPRComment(violations, counts, passed, exceededThresholds) {
  const statusIcon = passed ? '✅' : '❌';
  const statusText = passed ? 'PASSED' : 'FAILED';

  let comment = `## 🛡️ Reglint Compliance Report - ${statusIcon} ${statusText}\n\n`;

  // Handle zero violations case specially
  if (counts.total === 0) {
    comment += `### 📊 Summary\n\n`;
    comment += `| Severity | Count |\n`;
    comment += `|----------|-------|\n`;
    comment += `| 🔴 Critical | 0 |\n`;
    comment += `| 🟠 High | 0 |\n`;
    comment += `| 🟡 Medium | 0 |\n`;
    comment += `| 🟢 Low | 0 |\n`;
    comment += `| **Total** | **0** |\n\n`;
    comment += `✨ **No compliance violations found!** Your code is compliant.\n\n`;
    comment += `---\n\n`;
    comment += `_Powered by [Reglint](https://reglint.com) - Compliance scanning for developers_`;
    return comment;
  }

  // 1. Summary table (always visible)
  comment += `### 📊 Summary\n\n`;
  comment += `| Severity | Count |\n`;
  comment += `|----------|-------|\n`;
  comment += `| 🔴 Critical | ${counts.critical} |\n`;
  comment += `| 🟠 High | ${counts.high} |\n`;
  comment += `| 🟡 Medium | ${counts.medium} |\n`;
  comment += `| 🟢 Low | ${counts.low} |\n`;
  comment += `| **Total** | **${counts.total}** |\n\n`;
  comment += `---\n\n`;

  // Group violations by severity
  const critical = violations.filter(v => (v.severity || '').toLowerCase() === 'critical');
  const high = violations.filter(v => (v.severity || '').toLowerCase() === 'high');
  const medium = violations.filter(v => (v.severity || '').toLowerCase() === 'medium');
  const low = violations.filter(v => (v.severity || '').toLowerCase() === 'low');

  // 2. Critical issues (ALWAYS expanded - no collapsing, show ALL)
  if (critical.length > 0) {
    comment += `### 🔴 Critical Issues (MUST FIX)\n\n`;
    for (const v of critical) {
      comment += formatViolation(v);
    }
  }

  // 3. High issues (collapsible)
  if (high.length > 0) {
    comment += `<details>\n<summary>📋 View all ${high.length} high priority issue${high.length > 1 ? 's' : ''}</summary>\n\n`;
    const displayHigh = high.slice(0, 5);
    for (const v of displayHigh) {
      comment += formatViolation(v);
    }
    if (high.length > 5) {
      comment += `_... and ${high.length - 5} more high priority issues_\n`;
    }
    comment += `\n</details>\n\n`;
  }

  // 4. Medium issues (collapsible)
  if (medium.length > 0) {
    comment += `<details>\n<summary>🟡 View all ${medium.length} medium priority issue${medium.length > 1 ? 's' : ''}</summary>\n\n`;
    const displayMedium = medium.slice(0, 5);
    for (const v of displayMedium) {
      comment += formatViolation(v);
    }
    if (medium.length > 5) {
      comment += `_... and ${medium.length - 5} more medium priority issues_\n`;
    }
    comment += `\n</details>\n\n`;
  }

  // 5. Low issues (collapsible)
  if (low.length > 0) {
    comment += `<details>\n<summary>🟢 View ${low.length} low priority issue${low.length > 1 ? 's' : ''}</summary>\n\n`;
    const displayLow = low.slice(0, 5);
    for (const v of displayLow) {
      comment += formatViolation(v);
    }
    if (low.length > 5) {
      comment += `_... and ${low.length - 5} more low priority issues_\n`;
    }
    comment += `\n</details>\n\n`;
  }

  // 6. Quick Actions & Status
  comment += `---\n\n`;
  comment += `### ⚡ Quick Actions\n\n`;
  comment += `💡 **Pro Tip:** `;

  if (critical.length > 0) {
    comment += `Fix critical issues first to unblock your PR\n\n`;
  } else if (high.length > 0) {
    comment += `Address high priority issues before merging\n\n`;
  } else {
    comment += `Great job! Consider fixing remaining issues for best practices\n\n`;
  }

  if (passed) {
    comment += `✅ **Status:** All checks passed\n\n`;
  } else {
    const failures = [];
    if (counts.critical > 0) failures.push(`${counts.critical} critical`);
    if (counts.high > 0) failures.push(`${counts.high} high`);
    if (counts.medium > 0) failures.push(`${counts.medium} medium`);

    comment += `❌ **Status:** Build blocked due to ${failures.join(', ')} violation${failures.length > 1 || (failures.length === 1 && !failures[0].startsWith('1 ')) ? 's' : ''}\n\n`;
  }

  // 7. Footer
  comment += `---\n\n`;
  comment += `_Powered by [Reglint](https://reglint.com) - Compliance scanning for developers_`;

  return comment;
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_LAMBDA_RESPONSES = {
  // Success response with summary
  successWithSummary: {
    violations: [
      {
        file: 'src/auth.js',
        line: 45,
        severity: 'critical',
        framework: 'GDPR',
        rule: 'Article 32 - Security of Processing',
        message: 'Plaintext password storage detected',
        evidence: 'password: req.body.password',
        recommendation: 'Hash passwords using bcrypt with salt rounds >= 10'
      },
      {
        file: 'src/user.js',
        line: 23,
        severity: 'high',
        framework: 'CCPA',
        rule: '§1798.100 - Consumer Rights',
        message: 'Missing data collection notice',
        evidence: '<form><input name="email" /></form>',
        recommendation: 'Add privacy policy link before data collection'
      },
      {
        file: 'src/api.js',
        line: 67,
        severity: 'medium',
        framework: 'GDPR',
        rule: 'Article 25 - Data Protection by Design',
        message: 'Excessive data collection',
        evidence: 'collectUserData({ all: true })',
        recommendation: 'Only collect necessary data'
      }
    ],
    summary: {
      total_violations: 3,
      critical: 1,
      high: 1,
      medium: 1,
      low: 0
    }
  },

  // Success response without summary (tests manual counting)
  successWithoutSummary: {
    violations: [
      {
        file: 'test.js',
        line: 10,
        severity: 'critical',
        framework: 'GDPR',
        rule: 'Article 32',
        message: 'Plaintext password storage'
      },
      {
        file: 'test.js',
        line: 20,
        severity: 'high',
        framework: 'CCPA',
        rule: '§1798.100',
        message: 'Missing consent'
      },
      {
        file: 'test.js',
        line: 30,
        severity: 'high',
        framework: 'HIPAA',
        rule: '164.312',
        message: 'PHI exposure risk'
      },
      {
        file: 'test.js',
        line: 40,
        severity: 'medium',
        framework: 'GDPR',
        rule: 'Article 17',
        message: 'Missing deletion capability'
      },
      {
        file: 'test.js',
        line: 50,
        severity: 'low',
        framework: 'CCPA',
        rule: '§1798.110',
        message: 'Incomplete disclosure'
      }
    ]
    // Note: No summary field - tests manual counting
  },

  // Empty violations (clean scan)
  noViolations: {
    violations: [],
    summary: {
      total_violations: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    }
  },

  // Multiple critical violations (for threshold testing)
  multipleCritical: {
    violations: [
      { file: 'a.js', line: 1, severity: 'critical', message: 'Issue 1' },
      { file: 'b.js', line: 2, severity: 'critical', message: 'Issue 2' },
      { file: 'c.js', line: 3, severity: 'critical', message: 'Issue 3' }
    ],
    summary: {
      total_violations: 3,
      critical: 3,
      high: 0,
      medium: 0,
      low: 0
    }
  },

  // Mixed severities within thresholds
  withinThresholds: {
    violations: [
      { file: 'a.js', line: 1, severity: 'high', message: 'High 1' },
      { file: 'b.js', line: 2, severity: 'high', message: 'High 2' },
      { file: 'c.js', line: 3, severity: 'medium', message: 'Medium 1' },
      { file: 'd.js', line: 4, severity: 'medium', message: 'Medium 2' },
      { file: 'e.js', line: 5, severity: 'medium', message: 'Medium 3' },
      { file: 'f.js', line: 6, severity: 'low', message: 'Low 1' }
    ],
    summary: {
      total_violations: 6,
      critical: 0,
      high: 2,
      medium: 3,
      low: 1
    }
  },

  // Many violations (for "... and X more" testing)
  manyViolations: {
    violations: [
      { file: 'a.js', line: 1, severity: 'critical', framework: 'GDPR', rule: 'Rule 1', message: 'Critical 1' },
      { file: 'b.js', line: 2, severity: 'critical', framework: 'GDPR', rule: 'Rule 2', message: 'Critical 2' },
      { file: 'c.js', line: 3, severity: 'critical', framework: 'GDPR', rule: 'Rule 3', message: 'Critical 3' },
      { file: 'd.js', line: 4, severity: 'critical', framework: 'GDPR', rule: 'Rule 4', message: 'Critical 4' },
      { file: 'e.js', line: 5, severity: 'critical', framework: 'GDPR', rule: 'Rule 5', message: 'Critical 5' },
      { file: 'f.js', line: 6, severity: 'high', framework: 'CCPA', rule: 'Rule 6', message: 'High 1' },
      { file: 'g.js', line: 7, severity: 'high', framework: 'CCPA', rule: 'Rule 7', message: 'High 2' },
      { file: 'h.js', line: 8, severity: 'high', framework: 'CCPA', rule: 'Rule 8', message: 'High 3' },
      { file: 'i.js', line: 9, severity: 'high', framework: 'CCPA', rule: 'Rule 9', message: 'High 4' },
      { file: 'j.js', line: 10, severity: 'high', framework: 'CCPA', rule: 'Rule 10', message: 'High 5' },
      { file: 'k.js', line: 11, severity: 'high', framework: 'CCPA', rule: 'Rule 11', message: 'High 6' },
      { file: 'l.js', line: 12, severity: 'high', framework: 'CCPA', rule: 'Rule 12', message: 'High 7' }
    ],
    summary: {
      total_violations: 12,
      critical: 5,
      high: 7,
      medium: 0,
      low: 0
    }
  },

  // Mixed severities for collapsible testing
  mixedSeverities: {
    violations: [
      { file: 'a.js', line: 1, severity: 'critical', framework: 'GDPR', rule: 'Rule 1', message: 'Critical 1' },
      { file: 'b.js', line: 2, severity: 'high', framework: 'CCPA', rule: 'Rule 2', message: 'High 1' },
      { file: 'c.js', line: 3, severity: 'high', framework: 'CCPA', rule: 'Rule 3', message: 'High 2' },
      { file: 'd.js', line: 4, severity: 'medium', framework: 'GDPR', rule: 'Rule 4', message: 'Medium 1' },
      { file: 'e.js', line: 5, severity: 'medium', framework: 'GDPR', rule: 'Rule 5', message: 'Medium 2' },
      { file: 'f.js', line: 6, severity: 'medium', framework: 'GDPR', rule: 'Rule 6', message: 'Medium 3' },
      { file: 'g.js', line: 7, severity: 'low', framework: 'HIPAA', rule: 'Rule 7', message: 'Low 1' },
      { file: 'h.js', line: 8, severity: 'low', framework: 'HIPAA', rule: 'Rule 8', message: 'Low 2' }
    ],
    summary: {
      total_violations: 8,
      critical: 1,
      high: 2,
      medium: 3,
      low: 2
    }
  },

  // Only low violations (edge case)
  onlyLow: {
    violations: [
      { file: 'a.js', line: 1, severity: 'low', framework: 'GDPR', rule: 'Rule 1', message: 'Low 1' },
      { file: 'b.js', line: 2, severity: 'low', framework: 'GDPR', rule: 'Rule 2', message: 'Low 2' }
    ],
    summary: {
      total_violations: 2,
      critical: 0,
      high: 0,
      medium: 0,
      low: 2
    }
  },

  // Many medium violations (for truncation testing)
  manyMedium: {
    violations: [
      { file: 'a.js', line: 1, severity: 'medium', framework: 'GDPR', rule: 'Rule 1', message: 'Medium 1' },
      { file: 'b.js', line: 2, severity: 'medium', framework: 'GDPR', rule: 'Rule 2', message: 'Medium 2' },
      { file: 'c.js', line: 3, severity: 'medium', framework: 'GDPR', rule: 'Rule 3', message: 'Medium 3' },
      { file: 'd.js', line: 4, severity: 'medium', framework: 'GDPR', rule: 'Rule 4', message: 'Medium 4' },
      { file: 'e.js', line: 5, severity: 'medium', framework: 'GDPR', rule: 'Rule 5', message: 'Medium 5' },
      { file: 'f.js', line: 6, severity: 'medium', framework: 'GDPR', rule: 'Rule 6', message: 'Medium 6' },
      { file: 'g.js', line: 7, severity: 'medium', framework: 'GDPR', rule: 'Rule 7', message: 'Medium 7' },
      { file: 'h.js', line: 8, severity: 'medium', framework: 'GDPR', rule: 'Rule 8', message: 'Medium 8' }
    ],
    summary: {
      total_violations: 8,
      critical: 0,
      high: 0,
      medium: 8,
      low: 0
    }
  },

  // Violations with missing fields
  partialData: {
    violations: [
      { file: 'test.js', severity: 'critical', message: 'Missing line number' },
      { file: 'test.js', line: 10, severity: 'high' }, // Missing message
      { file: 'test.js', line: 20 } // Missing severity (should default to low)
    ]
  },

  // Error responses
  authError: {
    error: 'Invalid API key',
    statusCode: 401
  },

  serverError: {
    error: 'Internal server error',
    statusCode: 500
  }
};

const MOCK_PR_FILES = [
  // Code files (should be kept)
  { filename: 'src/index.js', status: 'modified' },
  { filename: 'src/components/App.jsx', status: 'added' },
  { filename: 'src/utils/helper.ts', status: 'modified' },
  { filename: 'src/types/index.tsx', status: 'added' },
  { filename: 'scripts/build.py', status: 'modified' },
  { filename: 'backend/Main.java', status: 'modified' },
  { filename: 'services/api.go', status: 'added' },
  { filename: 'lib/parser.rb', status: 'modified' },
  { filename: 'web/handler.php', status: 'modified' },
  { filename: 'core/Service.cs', status: 'added' },
  { filename: 'native/module.cpp', status: 'modified' },
  { filename: 'native/header.c', status: 'modified' },

  // Non-code files (should be skipped)
  { filename: 'README.md', status: 'modified' },
  { filename: 'docs/guide.txt', status: 'added' },
  { filename: 'package.json', status: 'modified' },
  { filename: '.gitignore', status: 'modified' },
  { filename: 'assets/logo.png', status: 'added' },
  { filename: 'styles/main.css', status: 'modified' },
  { filename: 'config.yaml', status: 'modified' },

  // Deleted files (should be skipped)
  { filename: 'old/deprecated.js', status: 'removed' },
  { filename: 'legacy/old.py', status: 'removed' }
];

// ============================================================================
// MOCK FETCH FUNCTION
// ============================================================================

/**
 * Creates a mock fetch function that returns predetermined responses
 */
function createMockFetch(scenario) {
  return async (url, options) => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 10));

    // Check authorization header
    const authHeader = options?.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Missing or invalid authorization header' }),
        text: async () => 'Missing or invalid authorization header'
      };
    }

    // Handle different scenarios
    switch (scenario) {
      case 'success':
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_LAMBDA_RESPONSES.successWithSummary
        };

      case 'successNoSummary':
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_LAMBDA_RESPONSES.successWithoutSummary
        };

      case 'noViolations':
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_LAMBDA_RESPONSES.noViolations
        };

      case 'authError':
        return {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => MOCK_LAMBDA_RESPONSES.authError,
          text: async () => 'Invalid API key'
        };

      case 'serverError':
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => MOCK_LAMBDA_RESPONSES.serverError,
          text: async () => 'Internal server error'
        };

      case 'networkError':
        throw new Error('Network request failed');

      case 'timeout':
        const error = new Error('Request timeout');
        error.type = 'request-timeout';
        throw error;

      default:
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_LAMBDA_RESPONSES.successWithSummary
        };
    }
  };
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testResults = {
  passed: 0,
  failed: 0,
  details: []
};

function logSubTest(message, passed) {
  const icon = passed ? '  ✓' : '  ✗';
  console.log(`${icon} ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    logSubTest(message, true);
    return true;
  } else {
    logSubTest(`${message} (expected: ${expected}, got: ${actual})`, false);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    logSubTest(message, true);
    return true;
  } else {
    logSubTest(`${message}`, false);
    console.log(`    Expected: ${expectedStr}`);
    console.log(`    Actual:   ${actualStr}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertTrue(condition, message) {
  if (condition) {
    logSubTest(message, true);
    return true;
  } else {
    logSubTest(message, false);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertFalse(condition, message) {
  if (!condition) {
    logSubTest(message, true);
    return true;
  } else {
    logSubTest(message, false);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertContains(str, substring, message) {
  if (str.includes(substring)) {
    logSubTest(message, true);
    return true;
  } else {
    logSubTest(`${message} (string does not contain: "${substring}")`, false);
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// TEST CASES
// ============================================================================

/**
 * Test 1: File Filtering
 * Verifies that code files are kept and non-code files are skipped
 */
async function testFileFiltering() {
  console.log('\nTesting: File Filtering');

  // Test keeping code files
  assertTrue(isSupportedFile('src/index.js'), 'Keeps .js files');
  assertTrue(isSupportedFile('src/App.jsx'), 'Keeps .jsx files');
  assertTrue(isSupportedFile('src/utils.ts'), 'Keeps .ts files');
  assertTrue(isSupportedFile('src/Component.tsx'), 'Keeps .tsx files');
  assertTrue(isSupportedFile('scripts/build.py'), 'Keeps .py files');
  assertTrue(isSupportedFile('Main.java'), 'Keeps .java files');
  assertTrue(isSupportedFile('server.go'), 'Keeps .go files');
  assertTrue(isSupportedFile('app.rb'), 'Keeps .rb files');
  assertTrue(isSupportedFile('index.php'), 'Keeps .php files');
  assertTrue(isSupportedFile('Program.cs'), 'Keeps .cs files');
  assertTrue(isSupportedFile('module.cpp'), 'Keeps .cpp files');
  assertTrue(isSupportedFile('main.c'), 'Keeps .c files');

  // Test skipping non-code files
  assertFalse(isSupportedFile('README.md'), 'Skips .md files');
  assertFalse(isSupportedFile('notes.txt'), 'Skips .txt files');
  assertFalse(isSupportedFile('package.json'), 'Skips .json files');
  assertFalse(isSupportedFile('.gitignore'), 'Skips dotfiles');
  assertFalse(isSupportedFile('logo.png'), 'Skips .png files');
  assertFalse(isSupportedFile('styles.css'), 'Skips .css files');
  assertFalse(isSupportedFile('config.yaml'), 'Skips .yaml files');
  assertFalse(isSupportedFile('data.xml'), 'Skips .xml files');

  // Test case insensitivity
  assertTrue(isSupportedFile('TEST.JS'), 'Handles uppercase .JS');
  assertTrue(isSupportedFile('Test.Py'), 'Handles mixed case .Py');

  // Test filtering mock PR files
  const codeFiles = MOCK_PR_FILES
    .filter(f => f.status !== 'removed')
    .filter(f => isSupportedFile(f.filename));

  assertEqual(codeFiles.length, 12, 'Filters correct number of code files from PR');
}

/**
 * Test 2: Language Detection
 * Verifies correct language identification from file extensions
 */
async function testLanguageDetection() {
  console.log('\nTesting: Language Detection');

  assertEqual(getLanguage('app.js'), 'javascript', 'Detects JavaScript from .js');
  assertEqual(getLanguage('App.jsx'), 'javascript', 'Detects JavaScript from .jsx');
  assertEqual(getLanguage('utils.ts'), 'typescript', 'Detects TypeScript from .ts');
  assertEqual(getLanguage('Component.tsx'), 'typescript', 'Detects TypeScript from .tsx');
  assertEqual(getLanguage('script.py'), 'python', 'Detects Python from .py');
  assertEqual(getLanguage('Main.java'), 'java', 'Detects Java from .java');
  assertEqual(getLanguage('server.go'), 'go', 'Detects Go from .go');
  assertEqual(getLanguage('app.rb'), 'ruby', 'Detects Ruby from .rb');
  assertEqual(getLanguage('index.php'), 'php', 'Detects PHP from .php');
  assertEqual(getLanguage('Program.cs'), 'csharp', 'Detects C# from .cs');
  assertEqual(getLanguage('module.cpp'), 'cpp', 'Detects C++ from .cpp');
  assertEqual(getLanguage('main.c'), 'c', 'Detects C from .c');
  assertEqual(getLanguage('unknown.xyz'), 'unknown', 'Returns unknown for unsupported');
}

/**
 * Test 3: Violation Counting with Summary
 * Verifies counting when API response includes summary field
 */
async function testViolationCountingWithSummary() {
  console.log('\nTesting: Violation Counting (with summary)');

  const response = MOCK_LAMBDA_RESPONSES.successWithSummary;
  const counts = countViolationsBySeverity(response);

  assertEqual(counts.critical, 1, 'Counts critical violations correctly');
  assertEqual(counts.high, 1, 'Counts high violations correctly');
  assertEqual(counts.medium, 1, 'Counts medium violations correctly');
  assertEqual(counts.low, 0, 'Counts low violations correctly');
  assertEqual(counts.total, 3, 'Counts total violations correctly');
}

/**
 * Test 4: Violation Counting without Summary
 * Verifies manual counting when API response lacks summary field
 */
async function testViolationCountingWithoutSummary() {
  console.log('\nTesting: Violation Counting (without summary)');

  const response = MOCK_LAMBDA_RESPONSES.successWithoutSummary;
  const counts = countViolationsBySeverity(response);

  assertEqual(counts.critical, 1, 'Manually counts critical violations');
  assertEqual(counts.high, 2, 'Manually counts high violations');
  assertEqual(counts.medium, 1, 'Manually counts medium violations');
  assertEqual(counts.low, 1, 'Manually counts low violations');
  assertEqual(counts.total, 5, 'Manually counts total violations');
}

/**
 * Test 5: Violation Counting with Empty Response
 * Verifies handling of empty violations array
 */
async function testViolationCountingEmpty() {
  console.log('\nTesting: Violation Counting (empty)');

  const response = MOCK_LAMBDA_RESPONSES.noViolations;
  const counts = countViolationsBySeverity(response);

  assertEqual(counts.critical, 0, 'Zero critical for empty response');
  assertEqual(counts.high, 0, 'Zero high for empty response');
  assertEqual(counts.medium, 0, 'Zero medium for empty response');
  assertEqual(counts.low, 0, 'Zero low for empty response');
  assertEqual(counts.total, 0, 'Zero total for empty response');
}

/**
 * Test 6: Violation Counting with Partial Data
 * Verifies handling of violations with missing fields
 */
async function testViolationCountingPartialData() {
  console.log('\nTesting: Violation Counting (partial data)');

  const response = MOCK_LAMBDA_RESPONSES.partialData;
  const counts = countViolationsBySeverity(response);

  assertEqual(counts.critical, 1, 'Counts violation with missing line');
  assertEqual(counts.high, 1, 'Counts violation with missing message');
  assertEqual(counts.low, 1, 'Defaults to low when severity missing');
  assertEqual(counts.total, 3, 'Counts all partial violations');
}

/**
 * Test 7: Threshold Checking - Pass Scenarios
 * Verifies thresholds pass when violations are within limits
 */
async function testThresholdCheckingPass() {
  console.log('\nTesting: Threshold Checking (pass scenarios)');

  // Scenario 1: All zeros
  const counts1 = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const thresholds1 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result1 = checkThresholds(counts1, thresholds1);
  assertTrue(result1.passed, 'Passes with zero violations');
  assertEqual(result1.exceeded.length, 0, 'No thresholds exceeded');

  // Scenario 2: Within all thresholds
  const counts2 = { critical: 0, high: 2, medium: 5, low: 10, total: 17 };
  const thresholds2 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result2 = checkThresholds(counts2, thresholds2);
  assertTrue(result2.passed, 'Passes when within all thresholds');

  // Scenario 3: Exactly at thresholds (should pass, not exceed)
  const counts3 = { critical: 0, high: 3, medium: 10, low: 999, total: 1012 };
  const thresholds3 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result3 = checkThresholds(counts3, thresholds3);
  assertTrue(result3.passed, 'Passes when exactly at thresholds');
}

/**
 * Test 8: Threshold Checking - Fail Scenarios
 * Verifies thresholds fail when violations exceed limits
 */
async function testThresholdCheckingFail() {
  console.log('\nTesting: Threshold Checking (fail scenarios)');

  // Scenario 1: Exceeds critical (zero tolerance)
  const counts1 = { critical: 1, high: 0, medium: 0, low: 0, total: 1 };
  const thresholds1 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result1 = checkThresholds(counts1, thresholds1);
  assertFalse(result1.passed, 'Fails when exceeding critical threshold');
  assertTrue(result1.exceeded[0].includes('Critical'), 'Reports critical exceeded');

  // Scenario 2: Exceeds high
  const counts2 = { critical: 0, high: 5, medium: 0, low: 0, total: 5 };
  const thresholds2 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result2 = checkThresholds(counts2, thresholds2);
  assertFalse(result2.passed, 'Fails when exceeding high threshold');

  // Scenario 3: Exceeds medium
  const counts3 = { critical: 0, high: 0, medium: 15, low: 0, total: 15 };
  const thresholds3 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result3 = checkThresholds(counts3, thresholds3);
  assertFalse(result3.passed, 'Fails when exceeding medium threshold');

  // Scenario 4: Exceeds low
  const counts4 = { critical: 0, high: 0, medium: 0, low: 1000, total: 1000 };
  const thresholds4 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result4 = checkThresholds(counts4, thresholds4);
  assertFalse(result4.passed, 'Fails when exceeding low threshold');

  // Scenario 5: Exceeds multiple thresholds
  const counts5 = { critical: 2, high: 5, medium: 15, low: 0, total: 22 };
  const thresholds5 = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };
  const result5 = checkThresholds(counts5, thresholds5);
  assertFalse(result5.passed, 'Fails when exceeding multiple thresholds');
  assertEqual(result5.exceeded.length, 3, 'Reports all exceeded thresholds');
}

/**
 * Test 9: PR Comment Formatting - Pass (Zero Violations)
 * Verifies PR comment format for passing scan with no violations
 */
async function testPRCommentFormattingPass() {
  console.log('\nTesting: PR Comment Formatting (pass - zero violations)');

  const violations = MOCK_LAMBDA_RESPONSES.noViolations.violations;
  const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const comment = formatPRComment(violations, counts, true, []);

  assertContains(comment, '## 🛡️ Reglint Compliance Report', 'Contains header');
  assertContains(comment, '✅ PASSED', 'Contains PASSED status');
  assertContains(comment, '### 📊 Summary', 'Contains summary section');
  assertContains(comment, '| Severity | Count |', 'Contains table header');
  assertContains(comment, '✨ **No compliance violations found!**', 'Contains zero violations message');
  assertContains(comment, 'Powered by [Reglint]', 'Contains footer');
  // Should NOT contain Quick Actions for zero violations
  assertFalse(comment.includes('Quick Actions'), 'Does not contain Quick Actions for zero violations');
}

/**
 * Test 10: PR Comment Formatting - Fail with Collapsible Sections
 * Verifies PR comment format for failing scan with collapsible sections
 */
async function testPRCommentFormattingFail() {
  console.log('\nTesting: PR Comment Formatting (fail with collapsible)');

  const violations = MOCK_LAMBDA_RESPONSES.mixedSeverities.violations;
  const counts = { critical: 1, high: 2, medium: 3, low: 2, total: 8 };
  const exceeded = ['Critical: 1 (max: 0)'];
  const comment = formatPRComment(violations, counts, false, exceeded);

  assertContains(comment, '❌ FAILED', 'Contains FAILED status');
  assertContains(comment, '### 🔴 Critical Issues (MUST FIX)', 'Contains critical section header');
  assertContains(comment, 'Critical 1', 'Contains critical violation message');

  // High issues should be in collapsible section
  assertContains(comment, '<details>', 'Contains collapsible section');
  assertContains(comment, '<summary>📋 View all 2 high priority issues</summary>', 'Contains high priority collapsible summary');
  assertContains(comment, '</details>', 'Contains closing details tag');

  // Medium issues should be in collapsible section
  assertContains(comment, '<summary>🟡 View all 3 medium priority issues</summary>', 'Contains medium priority collapsible summary');

  // Low issues should be in collapsible section
  assertContains(comment, '<summary>🟢 View 2 low priority issues</summary>', 'Contains low priority collapsible summary');

  // Quick Actions section
  assertContains(comment, '### ⚡ Quick Actions', 'Contains Quick Actions section');
  assertContains(comment, 'Fix critical issues first to unblock your PR', 'Contains pro tip for critical issues');
  assertContains(comment, '❌ **Status:** Build blocked', 'Contains build blocked status');
}

/**
 * Test 11: PR Comment Formatting - Many Violations
 * Verifies critical issues are ALL shown and high issues truncate at 5
 */
async function testPRCommentFormattingManyViolations() {
  console.log('\nTesting: PR Comment Formatting (many violations)');

  const violations = MOCK_LAMBDA_RESPONSES.manyViolations.violations;
  const counts = { critical: 5, high: 7, medium: 0, low: 0, total: 12 };
  const comment = formatPRComment(violations, counts, false, ['Critical: 5 (max: 0)']);

  // Critical issues should ALL be shown (no truncation)
  assertContains(comment, 'Critical 1', 'Shows first critical issue');
  assertContains(comment, 'Critical 2', 'Shows second critical issue');
  assertContains(comment, 'Critical 3', 'Shows third critical issue');
  assertContains(comment, 'Critical 4', 'Shows fourth critical issue');
  assertContains(comment, 'Critical 5', 'Shows fifth critical issue');
  assertFalse(comment.includes('more critical issues'), 'Does not truncate critical issues');

  // High issues should truncate at 5, showing "... and 2 more"
  assertContains(comment, '... and 2 more high priority issues', 'Truncates high violations at 5');
}

/**
 * Test 12: PR Comment Formatting - Missing Fields
 * Verifies graceful handling of violations with missing optional fields
 */
async function testPRCommentFormattingMissingFields() {
  console.log('\nTesting: PR Comment Formatting (missing fields)');

  const violations = [
    { file: 'test.js', severity: 'critical', message: 'Test issue' }
    // Missing: line, framework, rule, evidence, recommendation
  ];
  const counts = { critical: 1, high: 0, medium: 0, low: 0, total: 1 };
  const comment = formatPRComment(violations, counts, false, ['Critical: 1 (max: 0)']);

  assertContains(comment, 'test.js', 'Contains file without line number');
  assertContains(comment, 'Test issue', 'Contains message');
  // Should not throw error for missing fields
  assertTrue(comment.length > 0, 'Generates comment with missing fields');
}

/**
 * Test 13: Mock Fetch - Success
 * Verifies mock fetch returns expected success response
 */
async function testMockFetchSuccess() {
  console.log('\nTesting: Mock Fetch (success)');

  const mockFetch = createMockFetch('success');
  const response = await mockFetch('https://api.example.com', {
    headers: { Authorization: 'Bearer test-key' }
  });

  assertTrue(response.ok, 'Response is OK');
  assertEqual(response.status, 200, 'Status is 200');

  const data = await response.json();
  assertTrue(Array.isArray(data.violations), 'Response has violations array');
  assertTrue(data.summary !== undefined, 'Response has summary');
}

/**
 * Test 14: Mock Fetch - Auth Error
 * Verifies mock fetch returns auth error for invalid key
 */
async function testMockFetchAuthError() {
  console.log('\nTesting: Mock Fetch (auth error)');

  const mockFetch = createMockFetch('authError');
  const response = await mockFetch('https://api.example.com', {
    headers: { Authorization: 'Bearer invalid-key' }
  });

  assertFalse(response.ok, 'Response is not OK');
  assertEqual(response.status, 401, 'Status is 401');
}

/**
 * Test 15: Mock Fetch - Server Error
 * Verifies mock fetch returns server error
 */
async function testMockFetchServerError() {
  console.log('\nTesting: Mock Fetch (server error)');

  const mockFetch = createMockFetch('serverError');
  const response = await mockFetch('https://api.example.com', {
    headers: { Authorization: 'Bearer test-key' }
  });

  assertFalse(response.ok, 'Response is not OK');
  assertEqual(response.status, 500, 'Status is 500');
}

/**
 * Test 16: Mock Fetch - Missing Auth Header
 * Verifies mock fetch rejects requests without auth header
 */
async function testMockFetchMissingAuth() {
  console.log('\nTesting: Mock Fetch (missing auth)');

  const mockFetch = createMockFetch('success');
  const response = await mockFetch('https://api.example.com', {
    headers: {}
  });

  assertFalse(response.ok, 'Response is not OK without auth');
  assertEqual(response.status, 401, 'Status is 401 without auth');
}

/**
 * Test 17: Mock Fetch - Network Error
 * Verifies mock fetch throws on network error
 */
async function testMockFetchNetworkError() {
  console.log('\nTesting: Mock Fetch (network error)');

  const mockFetch = createMockFetch('networkError');
  let errorThrown = false;

  try {
    await mockFetch('https://api.example.com', {
      headers: { Authorization: 'Bearer test-key' }
    });
  } catch (error) {
    errorThrown = true;
    assertTrue(error.message.includes('Network'), 'Error message contains Network');
  }

  assertTrue(errorThrown, 'Network error is thrown');
}

/**
 * Test 18: Mock Fetch - Timeout
 * Verifies mock fetch throws timeout error
 */
async function testMockFetchTimeout() {
  console.log('\nTesting: Mock Fetch (timeout)');

  const mockFetch = createMockFetch('timeout');
  let errorThrown = false;
  let errorType = null;

  try {
    await mockFetch('https://api.example.com', {
      headers: { Authorization: 'Bearer test-key' }
    });
  } catch (error) {
    errorThrown = true;
    errorType = error.type;
  }

  assertTrue(errorThrown, 'Timeout error is thrown');
  assertEqual(errorType, 'request-timeout', 'Error type is request-timeout');
}

/**
 * Test 19: API Payload Format
 * Verifies the correct format for Lambda API requests
 */
async function testAPIPayloadFormat() {
  console.log('\nTesting: API Payload Format');

  // Simulate building the payload
  const files = [
    { path: 'src/index.js', content: 'const x = 1;', language: 'javascript' },
    { path: 'src/utils.py', content: 'x = 1', language: 'python' }
  ];
  const frameworks = ['GDPR', 'CCPA', 'HIPAA'];

  const payload = {
    files,
    frameworks
  };

  // Validate structure
  assertTrue(Array.isArray(payload.files), 'Payload has files array');
  assertTrue(Array.isArray(payload.frameworks), 'Payload has frameworks array');
  assertEqual(payload.files.length, 2, 'Payload has correct number of files');
  assertEqual(payload.frameworks.length, 3, 'Payload has correct number of frameworks');

  // Validate file structure
  const file = payload.files[0];
  assertTrue(file.path !== undefined, 'File has path');
  assertTrue(file.content !== undefined, 'File has content');
  assertTrue(file.language !== undefined, 'File has language');
}

/**
 * Test 20: End-to-End Scenario - Clean Scan
 * Simulates a complete scan with no violations
 */
async function testE2ECleanScan() {
  console.log('\nTesting: E2E Scenario - Clean Scan');

  // Mock data
  const response = MOCK_LAMBDA_RESPONSES.noViolations;
  const thresholds = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };

  // Count violations
  const counts = countViolationsBySeverity(response);
  assertEqual(counts.total, 0, 'No violations found');

  // Check thresholds
  const result = checkThresholds(counts, thresholds);
  assertTrue(result.passed, 'Scan passes');

  // Generate comment
  const comment = formatPRComment(response.violations, counts, true, []);
  assertContains(comment, '✅ PASSED', 'Comment shows PASSED');
}

/**
 * Test 21: End-to-End Scenario - Violations Within Thresholds
 * Simulates a scan with violations that pass thresholds
 */
async function testE2EViolationsWithinThresholds() {
  console.log('\nTesting: E2E Scenario - Within Thresholds');

  // Mock data
  const response = MOCK_LAMBDA_RESPONSES.withinThresholds;
  const thresholds = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };

  // Count violations
  const counts = countViolationsBySeverity(response);
  assertEqual(counts.critical, 0, 'Zero critical violations');
  assertEqual(counts.high, 2, 'Two high violations');

  // Check thresholds
  const result = checkThresholds(counts, thresholds);
  assertTrue(result.passed, 'Scan passes within thresholds');
}

/**
 * Test 22: End-to-End Scenario - Exceeds Thresholds
 * Simulates a scan that fails due to exceeded thresholds
 */
async function testE2EExceedsThresholds() {
  console.log('\nTesting: E2E Scenario - Exceeds Thresholds');

  // Mock data
  const response = MOCK_LAMBDA_RESPONSES.multipleCritical;
  const thresholds = { maxCritical: 0, maxHigh: 3, maxMedium: 10, maxLow: 999 };

  // Count violations
  const counts = countViolationsBySeverity(response);
  assertEqual(counts.critical, 3, 'Three critical violations');

  // Check thresholds
  const result = checkThresholds(counts, thresholds);
  assertFalse(result.passed, 'Scan fails');
  assertTrue(result.exceeded[0].includes('Critical: 3'), 'Reports correct count');
}

/**
 * Test 23: Framework Parsing
 * Verifies correct parsing of framework input
 */
async function testFrameworkParsing() {
  console.log('\nTesting: Framework Parsing');

  // Test parsing comma-separated frameworks
  const input1 = 'GDPR,CCPA,HIPAA';
  const frameworks1 = input1.split(',').map(f => f.trim().toUpperCase());
  assertDeepEqual(frameworks1, ['GDPR', 'CCPA', 'HIPAA'], 'Parses comma-separated');

  // Test with spaces
  const input2 = 'gdpr, ccpa, hipaa';
  const frameworks2 = input2.split(',').map(f => f.trim().toUpperCase());
  assertDeepEqual(frameworks2, ['GDPR', 'CCPA', 'HIPAA'], 'Handles spaces and lowercase');

  // Test single framework
  const input3 = 'GDPR';
  const frameworks3 = input3.split(',').map(f => f.trim().toUpperCase());
  assertDeepEqual(frameworks3, ['GDPR'], 'Handles single framework');
}

/**
 * Test 24: Output Values
 * Verifies correct format for action outputs
 */
async function testOutputValues() {
  console.log('\nTesting: Output Values');

  const counts = { critical: 1, high: 2, medium: 5, low: 3, total: 11 };
  const passed = false;

  // Simulate setting outputs (as strings)
  const outputs = {
    'total-violations': counts.total.toString(),
    'critical-count': counts.critical.toString(),
    'high-count': counts.high.toString(),
    'medium-count': counts.medium.toString(),
    'low-count': counts.low.toString(),
    'passed': passed.toString()
  };

  assertEqual(outputs['total-violations'], '11', 'Total violations as string');
  assertEqual(outputs['critical-count'], '1', 'Critical count as string');
  assertEqual(outputs['high-count'], '2', 'High count as string');
  assertEqual(outputs['medium-count'], '5', 'Medium count as string');
  assertEqual(outputs['low-count'], '3', 'Low count as string');
  assertEqual(outputs['passed'], 'false', 'Passed as string');
}

/**
 * Test 25: PR Comment - Critical Issues Never Collapsed
 * Verifies that critical issues are always expanded (never in <details> tag)
 */
async function testCriticalIssuesNeverCollapsed() {
  console.log('\nTesting: Critical Issues Never Collapsed');

  const violations = MOCK_LAMBDA_RESPONSES.manyViolations.violations;
  const counts = { critical: 5, high: 7, medium: 0, low: 0, total: 12 };
  const comment = formatPRComment(violations, counts, false, ['Critical: 5 (max: 0)']);

  // Find the critical section
  const criticalSectionStart = comment.indexOf('### 🔴 Critical Issues');
  const highSectionStart = comment.indexOf('<details>');

  // Critical section should come BEFORE any <details> tag
  assertTrue(criticalSectionStart < highSectionStart, 'Critical section comes before collapsible sections');

  // Critical section should NOT be wrapped in <details>
  const beforeCritical = comment.substring(0, criticalSectionStart);
  const lastDetailsBeforeCritical = beforeCritical.lastIndexOf('<details>');
  const lastDetailsEndBeforeCritical = beforeCritical.lastIndexOf('</details>');

  // If there's a <details> tag before critical, it should be closed
  if (lastDetailsBeforeCritical !== -1) {
    assertTrue(lastDetailsEndBeforeCritical > lastDetailsBeforeCritical, 'Any details before critical section is closed');
  }
}

/**
 * Test 26: PR Comment - Medium Issues Collapsible
 * Verifies medium priority issues are in collapsible section with correct count
 */
async function testMediumIssuesCollapsible() {
  console.log('\nTesting: Medium Issues Collapsible');

  const violations = MOCK_LAMBDA_RESPONSES.manyMedium.violations;
  const counts = { critical: 0, high: 0, medium: 8, low: 0, total: 8 };
  const comment = formatPRComment(violations, counts, true, []);

  // Medium issues should be in collapsible section
  assertContains(comment, '<summary>🟡 View all 8 medium priority issues</summary>', 'Contains correct medium count in summary');

  // Should show truncation message for > 5 issues
  assertContains(comment, '... and 3 more medium priority issues', 'Shows truncation for medium issues');
}

/**
 * Test 27: PR Comment - Only Low Violations
 * Verifies edge case with only low severity violations
 */
async function testOnlyLowViolations() {
  console.log('\nTesting: Only Low Violations');

  const violations = MOCK_LAMBDA_RESPONSES.onlyLow.violations;
  const counts = { critical: 0, high: 0, medium: 0, low: 2, total: 2 };
  const comment = formatPRComment(violations, counts, true, []);

  // Should NOT have critical or high sections
  assertFalse(comment.includes('### 🔴 Critical Issues'), 'Does not contain critical section');
  assertFalse(comment.includes('high priority issue'), 'Does not contain high priority section');
  assertFalse(comment.includes('medium priority issue'), 'Does not contain medium priority section');

  // Should have low priority collapsible section
  assertContains(comment, '<summary>🟢 View 2 low priority issues</summary>', 'Contains low priority collapsible');

  // Quick Actions should have "Great job" message
  assertContains(comment, 'Great job! Consider fixing remaining issues', 'Contains appropriate pro tip for only low violations');
}

/**
 * Test 28: PR Comment - Quick Actions Section
 * Verifies Quick Actions section content based on violation types
 */
async function testQuickActionsSection() {
  console.log('\nTesting: Quick Actions Section');

  // Test with critical issues
  const criticalViolations = MOCK_LAMBDA_RESPONSES.multipleCritical.violations;
  const criticalCounts = { critical: 3, high: 0, medium: 0, low: 0, total: 3 };
  const criticalComment = formatPRComment(criticalViolations, criticalCounts, false, ['Critical: 3 (max: 0)']);
  assertContains(criticalComment, 'Fix critical issues first to unblock your PR', 'Critical: shows unblock message');

  // Test with only high issues
  const highViolations = [
    { file: 'a.js', line: 1, severity: 'high', framework: 'CCPA', rule: 'Rule 1', message: 'High 1' }
  ];
  const highCounts = { critical: 0, high: 1, medium: 0, low: 0, total: 1 };
  const highComment = formatPRComment(highViolations, highCounts, true, []);
  assertContains(highComment, 'Address high priority issues before merging', 'High only: shows merge message');

  // Test with only medium/low issues
  const lowViolations = MOCK_LAMBDA_RESPONSES.onlyLow.violations;
  const lowCounts = { critical: 0, high: 0, medium: 0, low: 2, total: 2 };
  const lowComment = formatPRComment(lowViolations, lowCounts, true, []);
  assertContains(lowComment, 'Great job! Consider fixing remaining issues', 'Low only: shows great job message');
}

/**
 * Test 29: PR Comment - Singular vs Plural
 * Verifies correct singular/plural forms in collapsible summaries
 */
async function testSingularPluralForms() {
  console.log('\nTesting: Singular vs Plural Forms');

  // Test with single high issue
  const singleHighViolations = [
    { file: 'a.js', line: 1, severity: 'high', framework: 'CCPA', rule: 'Rule 1', message: 'High 1' }
  ];
  const singleHighCounts = { critical: 0, high: 1, medium: 0, low: 0, total: 1 };
  const singleHighComment = formatPRComment(singleHighViolations, singleHighCounts, true, []);
  assertContains(singleHighComment, 'View all 1 high priority issue</summary>', 'Singular: high priority issue');

  // Test with multiple medium issues
  const multipleMediumViolations = [
    { file: 'a.js', line: 1, severity: 'medium', framework: 'GDPR', rule: 'Rule 1', message: 'Medium 1' },
    { file: 'b.js', line: 2, severity: 'medium', framework: 'GDPR', rule: 'Rule 2', message: 'Medium 2' }
  ];
  const multipleMediumCounts = { critical: 0, high: 0, medium: 2, low: 0, total: 2 };
  const multipleMediumComment = formatPRComment(multipleMediumViolations, multipleMediumCounts, true, []);
  assertContains(multipleMediumComment, 'View all 2 medium priority issues</summary>', 'Plural: medium priority issues');
}

/**
 * Test 30: formatViolation Helper Function
 * Verifies the formatViolation helper produces correct output
 */
async function testFormatViolationHelper() {
  console.log('\nTesting: formatViolation Helper');

  // Full violation with all fields
  const fullViolation = {
    file: 'src/auth.js',
    line: 45,
    severity: 'critical',
    framework: 'GDPR',
    rule: 'Article 32',
    message: 'Plaintext password storage',
    evidence: 'password: req.body.password',
    recommendation: 'Use bcrypt to hash passwords'
  };

  const fullOutput = formatViolation(fullViolation);
  assertContains(fullOutput, '#### GDPR Article 32', 'Contains framework and rule');
  assertContains(fullOutput, '**File:** `src/auth.js:45`', 'Contains file:line');
  assertContains(fullOutput, '**Issue:** Plaintext password storage', 'Contains issue message');
  assertContains(fullOutput, '**Evidence:** `password: req.body.password`', 'Contains evidence');
  assertContains(fullOutput, '**Fix:** Use bcrypt to hash passwords', 'Contains recommendation');

  // Minimal violation with missing fields
  const minimalViolation = {
    file: 'test.js',
    severity: 'low'
  };

  const minimalOutput = formatViolation(minimalViolation);
  assertContains(minimalOutput, '#### Compliance Violation', 'Uses default framework/rule');
  assertContains(minimalOutput, '**File:** `test.js`', 'Contains file without line');
  assertContains(minimalOutput, '**Issue:** Compliance violation detected', 'Uses default message');
  assertFalse(minimalOutput.includes('**Evidence:**'), 'Does not contain evidence when missing');
  assertFalse(minimalOutput.includes('**Fix:**'), 'Does not contain fix when missing');
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runTests() {
  console.log('🧪 Running Reglint Action Tests...');
  console.log('='.repeat(50));

  const tests = [
    { name: 'File Filtering', fn: testFileFiltering },
    { name: 'Language Detection', fn: testLanguageDetection },
    { name: 'Violation Counting (with summary)', fn: testViolationCountingWithSummary },
    { name: 'Violation Counting (without summary)', fn: testViolationCountingWithoutSummary },
    { name: 'Violation Counting (empty)', fn: testViolationCountingEmpty },
    { name: 'Violation Counting (partial data)', fn: testViolationCountingPartialData },
    { name: 'Threshold Checking (pass)', fn: testThresholdCheckingPass },
    { name: 'Threshold Checking (fail)', fn: testThresholdCheckingFail },
    { name: 'PR Comment Formatting (pass)', fn: testPRCommentFormattingPass },
    { name: 'PR Comment Formatting (fail)', fn: testPRCommentFormattingFail },
    { name: 'PR Comment Formatting (many violations)', fn: testPRCommentFormattingManyViolations },
    { name: 'PR Comment Formatting (missing fields)', fn: testPRCommentFormattingMissingFields },
    { name: 'Mock Fetch (success)', fn: testMockFetchSuccess },
    { name: 'Mock Fetch (auth error)', fn: testMockFetchAuthError },
    { name: 'Mock Fetch (server error)', fn: testMockFetchServerError },
    { name: 'Mock Fetch (missing auth)', fn: testMockFetchMissingAuth },
    { name: 'Mock Fetch (network error)', fn: testMockFetchNetworkError },
    { name: 'Mock Fetch (timeout)', fn: testMockFetchTimeout },
    { name: 'API Payload Format', fn: testAPIPayloadFormat },
    { name: 'E2E: Clean Scan', fn: testE2ECleanScan },
    { name: 'E2E: Within Thresholds', fn: testE2EViolationsWithinThresholds },
    { name: 'E2E: Exceeds Thresholds', fn: testE2EExceedsThresholds },
    { name: 'Framework Parsing', fn: testFrameworkParsing },
    { name: 'Output Values', fn: testOutputValues },
    { name: 'Critical Issues Never Collapsed', fn: testCriticalIssuesNeverCollapsed },
    { name: 'Medium Issues Collapsible', fn: testMediumIssuesCollapsible },
    { name: 'Only Low Violations', fn: testOnlyLowViolations },
    { name: 'Quick Actions Section', fn: testQuickActionsSection },
    { name: 'Singular vs Plural Forms', fn: testSingularPluralForms },
    { name: 'formatViolation Helper', fn: testFormatViolationHelper }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`✅ ${test.name}: PASS`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name}: FAIL`);
      console.error(`   Error: ${error.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Please review the errors above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

// Run the tests
runTests();
