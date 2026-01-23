/**
 * Reglint GitHub Action
 *
 * Scans code for GDPR, CCPA, and HIPAA compliance violations in CI/CD pipelines.
 *
 * This action:
 * 1. Gets changed files from pull requests or push events
 * 2. Filters for supported code file extensions
 * 3. Reads file contents from the repository
 * 4. Calls the Reglint Lambda API for compliance analysis
 * 5. Counts violations by severity level
 * 6. Checks against configured thresholds
 * 7. Posts formatted results as a PR comment (if enabled)
 * 8. Sets outputs for downstream workflow steps
 * 9. Fails or passes the build based on threshold checks
 */

const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

// ============================================================================
// CONSTANTS
// ============================================================================

// Reglint Lambda API endpoint for compliance analysis
const REGLINT_API_URL = 'https://jjeu54sgnro4odqvth5yhkahki0cfwpt.lambda-url.us-east-1.on.aws/';

// Supported code file extensions for scanning
const SUPPORTED_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx',  // JavaScript/TypeScript
  '.py',                          // Python
  '.java',                        // Java
  '.go',                          // Go
  '.rb',                          // Ruby
  '.php',                         // PHP
  '.cs',                          // C#
  '.cpp', '.c'                    // C/C++
];

// Map file extensions to language identifiers for the API
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
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if a file path has a supported code extension
 * @param {string} filePath - The file path to check
 * @returns {boolean} - True if the file extension is supported
 */
function isSupportedFile(filePath) {
  const lowerPath = filePath.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

/**
 * Gets the language identifier for a file based on its extension
 * @param {string} filePath - The file path
 * @returns {string} - The language identifier
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
 * Handles both responses with and without the summary field
 * @param {Object} response - The API response containing violations
 * @returns {Object} - Counts by severity level
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

  // Otherwise, count violations manually by iterating through the array
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
 * @param {Object} counts - The violation counts by severity
 * @param {Object} thresholds - The maximum allowed violations per severity
 * @returns {Object} - Object with passed status and exceeded thresholds
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
 * @param {Object} v - The violation object
 * @returns {string} - Formatted markdown for the violation
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
 * @param {Array} violations - The list of violations
 * @param {Object} counts - The violation counts by severity
 * @param {boolean} passed - Whether the scan passed threshold checks
 * @param {Array} exceededThresholds - List of exceeded thresholds
 * @returns {string} - Formatted markdown comment
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

/**
 * Sets all action outputs with provided counts
 * @param {Object} counts - The violation counts
 * @param {boolean} passed - Whether the scan passed
 */
function setOutputs(counts, passed) {
  core.setOutput('total-violations', counts.total.toString());
  core.setOutput('critical-count', counts.critical.toString());
  core.setOutput('high-count', counts.high.toString());
  core.setOutput('medium-count', counts.medium.toString());
  core.setOutput('low-count', counts.low.toString());
  core.setOutput('passed', passed.toString());
}

/**
 * Sets default outputs when no files are scanned
 */
function setDefaultOutputs() {
  core.setOutput('total-violations', '0');
  core.setOutput('critical-count', '0');
  core.setOutput('high-count', '0');
  core.setOutput('medium-count', '0');
  core.setOutput('low-count', '0');
  core.setOutput('passed', 'true');
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function run() {
  try {
    core.info('🛡️ Starting Reglint compliance scan...');

    // ========================================================================
    // 1. GET INPUTS AND CONFIGURATION
    // ========================================================================

    const apiKey = core.getInput('api-key', { required: true });
    const frameworksInput = core.getInput('frameworks') || 'GDPR,CCPA';
    const maxCritical = parseInt(core.getInput('max-critical') || '0', 10);
    const maxHigh = parseInt(core.getInput('max-high') || '3', 10);
    const maxMedium = parseInt(core.getInput('max-medium') || '10', 10);
    const maxLow = parseInt(core.getInput('max-low') || '999', 10);
    const commentPR = (core.getInput('comment-pr') || 'true').toLowerCase() === 'true';

    // Parse frameworks into an array
    const frameworks = frameworksInput.split(',').map(f => f.trim().toUpperCase());

    core.info(`📋 Scanning for: ${frameworks.join(', ')}`);
    core.info(`📏 Thresholds - Critical: ${maxCritical}, High: ${maxHigh}, Medium: ${maxMedium}, Low: ${maxLow}`);

    const thresholds = { maxCritical, maxHigh, maxMedium, maxLow };

    // ========================================================================
    // 2. GET GITHUB CONTEXT AND TOKEN
    // ========================================================================

    const context = github.context;
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
      core.warning('⚠️ GITHUB_TOKEN not found - Cannot post PR comments or fetch PR files');
    }

    const octokit = token ? github.getOctokit(token) : null;
    const { owner, repo } = context.repo;

    // ========================================================================
    // 3. GET CHANGED FILES BASED ON EVENT TYPE
    // ========================================================================

    let changedFiles = [];
    const eventName = context.eventName;

    core.info(`📌 Event type: ${eventName}`);

    if (eventName === 'pull_request' || eventName === 'pull_request_target') {
      // For pull request events, use the pulls API to get changed files
      if (!octokit) {
        core.setFailed('❌ GITHUB_TOKEN is required for pull_request events');
        return;
      }

      const prNumber = context.payload.pull_request?.number;
      if (!prNumber) {
        core.setFailed('❌ Could not determine pull request number');
        return;
      }

      core.info(`🔍 Fetching files from PR #${prNumber}...`);

      // Fetch all changed files from the PR (handles pagination)
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100
      });

      // Filter out deleted files and non-code files
      changedFiles = files
        .filter(f => f.status !== 'removed')
        .filter(f => isSupportedFile(f.filename))
        .map(f => f.filename);

    } else if (eventName === 'push') {
      // For push events, extract changed files from commit payloads
      const commits = context.payload.commits || [];
      const fileSet = new Set();

      for (const commit of commits) {
        // Collect added and modified files from each commit
        const added = commit.added || [];
        const modified = commit.modified || [];

        for (const file of [...added, ...modified]) {
          if (isSupportedFile(file)) {
            fileSet.add(file);
          }
        }
      }

      changedFiles = Array.from(fileSet);

    } else {
      // Unsupported event type
      core.warning(`⚠️ Unsupported event type: ${eventName}. Only pull_request and push are supported.`);
      core.info('ℹ️ Exiting without scanning');
      setDefaultOutputs();
      return;
    }

    core.info(`📁 Found ${changedFiles.length} changed code files to scan`);

    // ========================================================================
    // 4. HANDLE NO FILES TO SCAN
    // ========================================================================

    if (changedFiles.length === 0) {
      core.info('✅ No code files to scan - exiting successfully');
      setDefaultOutputs();
      return;
    }

    // ========================================================================
    // 5. READ FILE CONTENTS
    // ========================================================================

    core.info('📖 Reading file contents...');

    const filesToAnalyze = [];
    let readSuccessCount = 0;
    let readFailCount = 0;

    for (const filePath of changedFiles) {
      try {
        // Use the GitHub API to get file contents
        if (!octokit) {
          core.warning(`⚠️ Cannot read ${filePath} - GITHUB_TOKEN not available`);
          readFailCount++;
          continue;
        }

        // Determine the ref (SHA) to use for fetching file contents
        let ref;
        if (eventName === 'pull_request' || eventName === 'pull_request_target') {
          ref = context.payload.pull_request?.head?.sha;
        } else {
          ref = context.sha;
        }

        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref
        });

        // Decode base64 content
        if (response.data.type === 'file' && response.data.content) {
          const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
          const language = getLanguage(filePath);

          filesToAnalyze.push({
            path: filePath,
            content,
            language
          });
          readSuccessCount++;
        } else {
          core.warning(`⚠️ Unexpected response type for ${filePath}`);
          readFailCount++;
        }

      } catch (error) {
        core.warning(`⚠️ Failed to read file ${filePath}: ${error.message}`);
        readFailCount++;
      }
    }

    core.info(`📖 Successfully read ${readSuccessCount} files${readFailCount > 0 ? ` (${readFailCount} failed)` : ''}`);

    // Check if we have any files to analyze
    if (filesToAnalyze.length === 0) {
      core.warning('⚠️ No files could be read - exiting');
      setDefaultOutputs();
      return;
    }

    // ========================================================================
    // 6. CALL REGLINT LAMBDA API
    // ========================================================================

    core.info('🚀 Analyzing with Reglint AI...');

    const requestBody = {
      files: filesToAnalyze,
      frameworks
    };

    let apiResponse;
    try {
      const response = await fetch(REGLINT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        timeout: 120000 // 2 minute timeout
      });

      // Check for authentication errors
      if (response.status === 401 || response.status === 403) {
        core.setFailed('❌ Authentication failed - please check your API key');
        return;
      }

      // Check for other HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        core.setFailed(`❌ API request failed with status ${response.status}: ${errorText}`);
        return;
      }

      apiResponse = await response.json();

    } catch (error) {
      if (error.type === 'request-timeout' || error.code === 'ETIMEDOUT') {
        core.setFailed('❌ API request timed out - please try again');
      } else {
        core.setFailed(`❌ API request failed: ${error.message}`);
      }
      return;
    }

    // ========================================================================
    // 7. COUNT VIOLATIONS BY SEVERITY
    // ========================================================================

    const violations = apiResponse.violations || [];
    const counts = countViolationsBySeverity(apiResponse);

    core.info(`📊 Results: Critical=${counts.critical}, High=${counts.high}, Medium=${counts.medium}, Low=${counts.low}`);

    // ========================================================================
    // 8. CHECK THRESHOLDS
    // ========================================================================

    const thresholdResult = checkThresholds(counts, thresholds);

    // ========================================================================
    // 9. SET OUTPUTS
    // ========================================================================

    setOutputs(counts, thresholdResult.passed);

    // ========================================================================
    // 10. POST PR COMMENT (IF ENABLED)
    // ========================================================================

    if (commentPR && (eventName === 'pull_request' || eventName === 'pull_request_target')) {
      if (!octokit) {
        core.warning('⚠️ Cannot post PR comment - GITHUB_TOKEN not available');
      } else {
        const prNumber = context.payload.pull_request?.number;

        if (prNumber) {
          try {
            const comment = formatPRComment(
              violations,
              counts,
              thresholdResult.passed,
              thresholdResult.exceeded
            );

            // Check for existing Reglint comment to update instead of creating new
            const existingComments = await octokit.rest.issues.listComments({
              owner,
              repo,
              issue_number: prNumber
            });

            const reglintComment = existingComments.data.find(
              c => c.body && c.body.includes('🛡️ Reglint Compliance Report')
            );

            if (reglintComment) {
              // Update existing comment
              await octokit.rest.issues.updateComment({
                owner,
                repo,
                comment_id: reglintComment.id,
                body: comment
              });
              core.info('💬 Updated existing PR comment with results');
            } else {
              // Create new comment
              await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body: comment
              });
              core.info('💬 Posted PR comment with results');
            }

          } catch (error) {
            core.warning(`⚠️ Failed to post PR comment: ${error.message}`);
          }
        }
      }
    }

    // ========================================================================
    // 11. PASS OR FAIL THE BUILD
    // ========================================================================

    if (thresholdResult.passed) {
      core.info('✅ Compliance scan passed all thresholds!');
    } else {
      core.setFailed(`❌ Compliance scan failed - Exceeded thresholds: ${thresholdResult.exceeded.join(', ')}`);
    }

  } catch (error) {
    // Catch any unexpected errors
    core.setFailed(`❌ Unexpected error: ${error.message}`);
  }
}

// Run the action
run();
