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
const exec = require('@actions/exec');

// ============================================================================
// CONSTANTS
// ============================================================================

// Reglint Backend API endpoint for compliance analysis
const REGLINT_API_URL = 'https://reglint.ai/api/code/analyze-stream';

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
 * Gets all files from the repository recursively
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} ref - Git reference (branch/commit SHA)
 * @returns {Promise<Array>} - Array of file paths
 */
async function getAllRepoFiles(octokit, owner, repo, ref) {
  const allFiles = [];
  
  async function getTreeRecursive(treeSha) {
    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: 'true'
    });
    
    for (const item of data.tree) {
      if (item.type === 'blob' && isSupportedFile(item.path)) {
        allFiles.push(item.path);
      }
    }
  }
  
  // Get the commit to find the tree SHA
  const { data: commit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: ref
  });
  
  await getTreeRecursive(commit.tree.sha);
  
  return allFiles;
}

/**
 * Scans files one-by-one against the Reglint backend API
 * @param {Array} files - Array of file objects with path, content, language
 * @param {Array} frameworks - Compliance frameworks to check
 * @param {string} apiKey - Reglint API key for authentication
 * @param {string} mode - 'fast' (rules only) or 'full' (rules + RAG + Claude)
 * @param {string} industry - Industry context: general, healthcare, fintech, hr
 * @returns {Promise<Object|null>} - Combined violations, or null if a fatal auth/limit error occurred
 */
async function scanFilesInBatches(files, frameworks, apiKey, mode, industry) {
  const allViolations = [];
  let successCount = 0;
  let failCount = 0;
  let lastScansRemaining = null;

  core.info(`📦 Scanning ${files.length} file(s) with mode="${mode}" industry="${industry}"`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      core.info(`📤 Scanning file ${i + 1}/${files.length}: ${file.path}...`);

      const response = await fetch(REGLINT_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: file.content,
          filename: file.path,
          language: file.language,
          mode,
          industry
        }),
        timeout: 120000
      });

      if (response.status === 401) {
        core.setFailed('Authentication failed: Invalid API key. Get your key at reglint.ai/settings/api-keys');
        return null;
      }
      if (response.status === 403) {
        core.setFailed('Access denied: Subscription required. Visit reglint.ai/settings/billing to subscribe.');
        return null;
      }
      if (response.status === 429) {
        core.setFailed('Monthly scan limit reached. Please upgrade your plan at reglint.ai/settings/billing');
        return null;
      }
      if (response.status === 503) {
        core.setFailed('Reglint service temporarily unavailable. Please try again.');
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      allViolations.push(...(result.violations || []));
      if (result.scansRemaining !== undefined) lastScansRemaining = result.scansRemaining;
      successCount++;

      core.info(`✅ File ${i + 1} scanned: ${(result.violations || []).length} violations found`);

    } catch (error) {
      core.warning(`⚠️ File ${i + 1} (${file.path}) failed: ${error.message}`);
      failCount++;
    }
  }

  core.info(`📊 Scan completed: ${successCount}/${files.length} files succeeded`);

  return {
    violations: allViolations,
    scansRemaining: lastScansRemaining,
    summary: {
      total_violations: allViolations.length,
      critical: allViolations.filter(v => (v.severity || '').toLowerCase() === 'critical').length,
      high: allViolations.filter(v => (v.severity || '').toLowerCase() === 'high').length,
      medium: allViolations.filter(v => (v.severity || '').toLowerCase() === 'medium').length,
      low: allViolations.filter(v => (v.severity || '').toLowerCase() === 'low').length
    }
  };
}

/**
 * Creates a GitHub issue with the full scan report
 * @param {Object} octokit - GitHub API client
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Array} violations - The list of violations
 * @param {Object} counts - The violation counts by severity
 * @param {Array} authorStats - Statistics grouped by author
 * @returns {Promise<number>} - The created issue number
 */
async function createIssueReport(octokit, owner, repo, violations, counts, authorStats) {
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  let issueBody = `# 🛡️ Reglint Full Repository Scan Report\n\n`;
  issueBody += `**Scan Date:** ${date} at ${time}\n`;
  issueBody += `**Total Violations:** ${counts.total}\n\n`;
  issueBody += `---\n\n`;
  
  // Author Summary
  if (authorStats && authorStats.length > 0) {
    issueBody += `## 👥 Violations by Author\n\n`;
    issueBody += `| Author | Critical | High | Medium | Low | Total |\n`;
    issueBody += `|--------|----------|------|--------|-----|-------|\n`;
    
    for (const author of authorStats) {
      const displayName = author.name === 'Unknown' ? 'Unknown' : author.name;
      issueBody += `| ${displayName} | ${author.critical} | ${author.high} | ${author.medium} | ${author.low} | **${author.total}** |\n`;
    }
    
    issueBody += `| **Total** | **${counts.critical}** | **${counts.high}** | **${counts.medium}** | **${counts.low}** | **${counts.total}** |\n\n`;
    issueBody += `---\n\n`;
  }
  
  // Overall Summary
  issueBody += `## 📊 Overall Summary\n\n`;
  issueBody += `| Severity | Count |\n`;
  issueBody += `|----------|-------|\n`;
  issueBody += `| 🔴 Critical | ${counts.critical} |\n`;
  issueBody += `| 🟠 High | ${counts.high} |\n`;
  issueBody += `| 🟡 Medium | ${counts.medium} |\n`;
  issueBody += `| 🟢 Low | ${counts.low} |\n`;
  issueBody += `| **Total** | **${counts.total}** |\n\n`;
  issueBody += `---\n\n`;
  
  // Group violations by severity
  const critical = violations.filter(v => (v.severity || '').toLowerCase() === 'critical');
  const high = violations.filter(v => (v.severity || '').toLowerCase() === 'high');
  const medium = violations.filter(v => (v.severity || '').toLowerCase() === 'medium');
  const low = violations.filter(v => (v.severity || '').toLowerCase() === 'low');
  
  // Critical Issues (show all)
  if (critical.length > 0) {
    issueBody += `## 🔴 Critical Issues (${critical.length})\n\n`;
    for (const v of critical) { // Show all critical issues
      issueBody += formatViolation(v);
    }
  }
  
  // High Issues (show all in collapsed section)
  if (high.length > 0) {
    issueBody += `<details>\n<summary>🟠 High Priority Issues (${high.length})</summary>\n\n`;
    for (const v of high) { // Show all high issues
      issueBody += formatViolation(v);
    }
    issueBody += `\n</details>\n\n`;
  }
  
  // Medium Issues (show all in collapsed section)
  if (medium.length > 0) {
    issueBody += `<details>\n<summary>🟡 Medium Priority Issues (${medium.length})</summary>\n\n`;
    for (const v of medium) { // Show all medium issues
      issueBody += formatViolation(v);
    }
    issueBody += `\n</details>\n\n`;
  }
  
  // Low Issues (show all in collapsed section)
  if (low.length > 0) {
    issueBody += `<details>\n<summary>🟢 Low Priority Issues (${low.length})</summary>\n\n`;
    for (const v of low) { // Show all low issues
      issueBody += formatViolation(v);
    }
    issueBody += `\n</details>\n\n`;
  }
  
  // Footer
  issueBody += `---\n\n`;
  issueBody += `_Generated by [Reglint](https://reglint.com) - Compliance scanning for developers_`;
  
  // Create the issue
  const { data: issue } = await octokit.rest.issues.create({
    owner,
    repo,
    title: `🛡️ Compliance Scan Report - ${date}`,
    body: issueBody,
    labels: ['compliance', 'security', 'reglint']
  });
  
  return issue.number;
}

/**
 * Groups violations by author and counts them by severity
 * @param {Array} violations - Array of violation objects with author info
 * @returns {Object} - Object with author statistics
 */
function groupViolationsByAuthor(violations) {
  const authorStats = {};
  
  for (const violation of violations) {
    const author = violation.author || 'Unknown';
    
    if (!authorStats[author]) {
      authorStats[author] = {
        name: author,
        email: violation.email || '',
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        total: 0
      };
    }
    
    const severity = (violation.severity || 'low').toLowerCase();
    if (severity === 'critical') authorStats[author].critical++;
    else if (severity === 'high') authorStats[author].high++;
    else if (severity === 'medium') authorStats[author].medium++;
    else authorStats[author].low++;
    
    authorStats[author].total++;
  }
  
  // Convert to array and sort by total violations (descending)
  return Object.values(authorStats).sort((a, b) => b.total - a.total);
}

/**
 * Gets the author information for a specific line in a file using git blame
 * @param {string} filePath - The file path
 * @param {number} lineNumber - The line number
 * @returns {Promise<Object>} - Object with author name and email
 */
async function getAuthor(filePath, lineNumber) {
  try {
    let output = '';
    let errorOutput = '';

    const options = {
      listeners: {
        stdout: (data) => {
          output += data.toString();
        },
        stderr: (data) => {
          errorOutput += data.toString();
        }
      },
      silent: true,
      ignoreReturnCode: true
    };

    // Run git blame with --porcelain format for easier parsing
    const exitCode = await exec.exec(
      'git',
      ['blame', '--porcelain', '-L', `${lineNumber},${lineNumber}`, filePath],
      options
    );

    if (exitCode !== 0) {
      core.debug(`git blame failed for ${filePath}:${lineNumber} - ${errorOutput}`);
      return { author: 'Unknown', email: '' };
    }

    // Parse porcelain format output
    // Format looks like:
    // <sha> <line-number> <final-line-number> <num-lines>
    // author <author-name>
    // author-mail <<email>>
    // ...
    const lines = output.split('\n');
    let author = 'Unknown';
    let email = '';

    for (const line of lines) {
      if (line.startsWith('author ') && !line.startsWith('author-')) {
        author = line.substring(7).trim();
      } else if (line.startsWith('author-mail ')) {
        // Email is in format <email@example.com>, remove the angle brackets
        const emailMatch = line.match(/<(.+)>/);
        if (emailMatch) {
          email = emailMatch[1];
        }
      }
    }

    return { author, email };

  } catch (error) {
    core.debug(`Error getting author for ${filePath}:${lineNumber} - ${error.message}`);
    return { author: 'Unknown', email: '' };
  }
}

/**
 * Formats a single violation for display in the PR comment
 * @param {Object} v - The violation object
 * @returns {string} - Formatted markdown for the violation
 */
function formatViolation(v) {
  let text = `#### ${v.framework || 'Compliance'} ${v.rule || 'Violation'}\n`;
  text += `- **File:** \`${v.file}${v.line ? `:${v.line}` : ''}\`\n`;
  
  // Add author information if available
  if (v.author && v.author !== 'Unknown') {
    // Extract username from email if available, otherwise use author name
    let username = v.author;
    if (v.email) {
      const emailUsername = v.email.split('@')[0];
      username = emailUsername || v.author;
    }
    text += `- **Author:** @${username}\n`;
  }
  
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
 * @param {boolean} isFullScan - Whether this is a full repository scan
 * @returns {string} - Formatted markdown comment
 */
function formatPRComment(violations, counts, passed, exceededThresholds, isFullScan = false) {
  const statusIcon = passed ? '✅' : '❌';
  const statusText = passed ? 'PASSED' : 'FAILED';
  const scanType = isFullScan ? 'Full Repository Scan' : 'Compliance Report';

  let comment = `## 🛡️ Reglint ${scanType} - ${statusIcon} ${statusText}\n\n`;

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

  // If full scan, show author summary first
  if (isFullScan && violations.length > 0) {
    const authorStats = groupViolationsByAuthor(violations);
    
    comment += `### 👥 Violations by Author\n\n`;
    comment += `| Author | Critical | High | Medium | Low | Total |\n`;
    comment += `|--------|----------|------|--------|-----|-------|\n`;
    
    for (const author of authorStats) {
      const displayName = author.name === 'Unknown' ? 'Unknown' : author.name;
      comment += `| ${displayName} | ${author.critical} | ${author.high} | ${author.medium} | ${author.low} | **${author.total}** |\n`;
    }
    
    // Add totals row
    comment += `| **Total** | **${counts.critical}** | **${counts.high}** | **${counts.medium}** | **${counts.low}** | **${counts.total}** |\n\n`;
    comment += `---\n\n`;
  }

  // 1. Summary table (always visible)
  comment += `### 📊 Overall Summary\n\n`;
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

  // 3. High issues (collapsible - show all)
  if (high.length > 0) {
    comment += `<details>\n<summary>📋 View all ${high.length} high priority issue${high.length > 1 ? 's' : ''}</summary>\n\n`;
    for (const v of high) { // Show all high issues
      comment += formatViolation(v);
    }
    comment += `\n</details>\n\n`;
  }

  // 4. Medium issues (collapsible - show all)
  if (medium.length > 0) {
    comment += `<details>\n<summary>🟡 View all ${medium.length} medium priority issue${medium.length > 1 ? 's' : ''}</summary>\n\n`;
    for (const v of medium) { // Show all medium issues
      comment += formatViolation(v);
    }
    comment += `\n</details>\n\n`;
  }

  // 5. Low issues (collapsible - show all)
  if (low.length > 0) {
    comment += `<details>\n<summary>🟢 View ${low.length} low priority issue${low.length > 1 ? 's' : ''}</summary>\n\n`;
    for (const v of low) { // Show all low issues
      comment += formatViolation(v);
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
    const fullRepoScan = (core.getInput('full-repo-scan') || 'false').toLowerCase() === 'true';
    const shouldCreateIssueReport = (core.getInput('create-issue-report') || 'false').toLowerCase() === 'true';
    const mode = core.getInput('mode') || 'full';
    const industry = core.getInput('industry') || 'general';

    // Parse frameworks into an array
    const frameworks = frameworksInput.split(',').map(f => f.trim().toUpperCase());

    core.info(`📋 Scanning for: ${frameworks.join(', ')}`);
    core.info(`📏 Thresholds - Critical: ${maxCritical}, High: ${maxHigh}, Medium: ${maxMedium}, Low: ${maxLow}`);
    core.info(`⚙️  Analysis mode: ${mode} | Industry: ${industry}`);
    if (fullRepoScan) {
      core.info(`🔍 Scope: Full Repository Scan`);
    } else {
      core.info(`🔍 Scope: Changed Files Only`);
    }

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

    // Check if full repo scan is requested
    if (fullRepoScan) {
      core.info(`🔍 Fetching all files from repository...`);
      
      if (!octokit) {
        core.setFailed('❌ GITHUB_TOKEN is required for full repository scan');
        return;
      }

      try {
        const ref = context.sha;
        changedFiles = await getAllRepoFiles(octokit, owner, repo, ref);
        core.info(`📁 Found ${changedFiles.length} code files in repository`);
      } catch (error) {
        core.setFailed(`❌ Failed to fetch repository files: ${error.message}`);
        return;
      }

    } else if (eventName === 'pull_request' || eventName === 'pull_request_target') {
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
      // For push events, use GitHub API to get changed files
      if (!octokit) {
        core.setFailed('❌ GITHUB_TOKEN is required for push events');
        return;
      }

      try {
        const beforeSha = context.payload.before;
        const afterSha = context.payload.after || context.sha;

        core.info(`🔍 Comparing ${beforeSha.substring(0, 7)}...${afterSha.substring(0, 7)}`);

        // Get the comparison between before and after commits
        const comparison = await octokit.rest.repos.compareCommits({
          owner,
          repo,
          base: beforeSha,
          head: afterSha
        });

        // Extract changed files from the comparison
        const fileSet = new Set();
        for (const file of comparison.data.files || []) {
          if (file.status !== 'removed' && isSupportedFile(file.filename)) {
            fileSet.add(file.filename);
          }
        }

        changedFiles = Array.from(fileSet);

      } catch (error) {
        // Fallback to payload commits if API fails
        core.warning(`⚠️ Failed to fetch changed files via API: ${error.message}`);
        core.info('📋 Falling back to commit payload...');
        
        const commits = context.payload.commits || [];
        const fileSet = new Set();

        for (const commit of commits) {
          const added = commit.added || [];
          const modified = commit.modified || [];

          for (const file of [...added, ...modified]) {
            if (isSupportedFile(file)) {
              fileSet.add(file);
            }
          }
        }

        changedFiles = Array.from(fileSet);
      }

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
    // 6. CALL REGLINT LAMBDA API (WITH BATCHING FOR LARGE SCANS)
    // ========================================================================

    core.info('🚀 Analyzing with Reglint AI...');

    let apiResponse;
    try {
      // Scan all files individually against the Reglint backend API
      apiResponse = await scanFilesInBatches(filesToAnalyze, frameworks, apiKey, mode, industry);

      // null means a fatal error was already reported via core.setFailed inside scanFilesInBatches
      if (apiResponse === null) return;

    } catch (error) {
      if (error.type === 'request-timeout' || error.code === 'ETIMEDOUT') {
        core.setFailed('❌ API request timed out - please try again');
      } else {
        core.setFailed(`❌ API request failed: ${error.message}`);
      }
      return;
    }

    // ========================================================================
    // 7. ADD GIT BLAME AUTHOR INFORMATION TO VIOLATIONS
    // ========================================================================

    const violations = apiResponse.violations || [];
    
    core.info('👤 Adding author information to violations...');
    
    for (const violation of violations) {
      if (violation.file && violation.line) {
        const authorInfo = await getAuthor(violation.file, violation.line);
        violation.author = authorInfo.author;
        violation.email = authorInfo.email;
      } else {
        violation.author = 'Unknown';
        violation.email = '';
      }
    }

    // ========================================================================
    // 8. COUNT VIOLATIONS BY SEVERITY
    // ========================================================================

    const counts = countViolationsBySeverity(apiResponse);

    core.info(`📊 Results: Critical=${counts.critical}, High=${counts.high}, Medium=${counts.medium}, Low=${counts.low}`);
    core.info(`✅ Scan complete. Scans remaining this month: ${apiResponse.scansRemaining ?? 'unlimited'}`);

    // ========================================================================
    // 9. CHECK THRESHOLDS
    // ========================================================================

    const thresholdResult = checkThresholds(counts, thresholds);

    // ========================================================================
    // 10. SET OUTPUTS
    // ========================================================================

    setOutputs(counts, thresholdResult.passed);

    // ========================================================================
    // 11. POST PR COMMENT (IF ENABLED)
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
              thresholdResult.exceeded,
              fullRepoScan
            );

            // Create new comment for each scan
            await octokit.rest.issues.createComment({
              owner,
              repo,
              issue_number: prNumber,
              body: comment
            });
            core.info('💬 Posted new PR comment with scan results');

          } catch (error) {
            core.warning(`⚠️ Failed to post PR comment: ${error.message}`);
          }
        }
      }
    }

    // ========================================================================
    // 12. CREATE GITHUB ISSUE REPORT (IF ENABLED FOR FULL SCAN)
    // ========================================================================

    if (shouldCreateIssueReport && fullRepoScan && counts.total > 0) {
      if (!octokit) {
        core.warning('⚠️ Cannot create issue report - GITHUB_TOKEN not available');
      } else {
        try {
          core.info('📝 Creating GitHub issue with full scan report...');
          
          const authorStats = groupViolationsByAuthor(violations);
          const issueNumber = await createIssueReport(
            octokit,
            owner,
            repo,
            violations,
            counts,
            authorStats
          );
          
          core.info(`✅ Created issue #${issueNumber} with full scan report`);
          core.setOutput('issue-number', issueNumber.toString());
          
        } catch (error) {
          core.warning(`⚠️ Failed to create issue report: ${error.message}`);
        }
      }
    }

    // ========================================================================
    // 13. PASS OR FAIL THE BUILD
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
