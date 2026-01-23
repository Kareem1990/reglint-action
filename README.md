# Reglint Compliance Scanner

A GitHub Action that scans your code for **GDPR**, **CCPA**, and **HIPAA** compliance violations in CI/CD pipelines.

## Quick Start

Get started in 3 simple steps:

### 1. Get Your API Key

Sign up at [reglint.com](https://reglint.com) to get your API key.

### 2. Add the Secret

Go to your repository **Settings > Secrets and variables > Actions** and add:
- Name: `REGLINT_API_KEY`
- Value: Your API key from step 1

### 3. Create Workflow

Create `.github/workflows/compliance.yml`:

```yaml
name: Compliance Check

on:
  pull_request:
    branches: [main, develop]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint Compliance Check
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

That's it! Reglint will now scan your pull requests for compliance violations.

---

## Configuration Reference

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api-key` | Reglint API key for authentication | Yes | - |
| `frameworks` | Comma-separated compliance frameworks to check | No | `GDPR,CCPA` |
| `max-critical` | Maximum critical violations allowed (0 = zero tolerance) | No | `0` |
| `max-high` | Maximum high severity violations allowed | No | `3` |
| `max-medium` | Maximum medium severity violations allowed | No | `10` |
| `max-low` | Maximum low severity violations allowed (999 = essentially unlimited) | No | `999` |
| `comment-pr` | Whether to post results as PR comment | No | `true` |

### Outputs

| Output | Description |
|--------|-------------|
| `total-violations` | Total number of violations found across all severities |
| `critical-count` | Number of critical severity violations |
| `high-count` | Number of high severity violations |
| `medium-count` | Number of medium severity violations |
| `low-count` | Number of low severity violations |
| `passed` | Boolean - whether the scan passed all threshold checks |

### Using Outputs

```yaml
- name: Reglint Compliance Check
  id: reglint
  uses: YOUR_USERNAME/reglint-action@v1
  with:
    api-key: ${{ secrets.REGLINT_API_KEY }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Check Results
  run: |
    echo "Total violations: ${{ steps.reglint.outputs.total-violations }}"
    echo "Passed: ${{ steps.reglint.outputs.passed }}"
```

---

## Severity Levels Explained

| Severity | Description | Examples |
|----------|-------------|----------|
| **Critical** | Immediate action required. High risk of data breach or regulatory penalty. | Plaintext password storage, unencrypted PII transmission, missing consent mechanisms |
| **High** | Should be fixed before deployment. Significant compliance risk. | Missing data deletion capabilities, inadequate access logging, weak encryption |
| **Medium** | Should be addressed soon. Moderate compliance risk. | Incomplete privacy notices, missing data retention policies |
| **Low** | Minor issues. Good to fix for best practices. | Documentation gaps, minor policy inconsistencies |

---

## Usage Examples

### Example 1: Strict Mode (Production)

Zero tolerance for critical and high issues. Recommended for production branches.

```yaml
name: Compliance Check - Strict

on:
  pull_request:
    branches: [main, production]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint Compliance Check
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
          frameworks: 'GDPR,CCPA,HIPAA'
          max-critical: 0
          max-high: 0
          max-medium: 5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Example 2: Balanced Mode (Most Teams)

Good balance between enforcement and developer velocity. Recommended for most teams.

```yaml
name: Compliance Check - Balanced

on:
  pull_request:
    branches: [main, develop]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint Compliance Check
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
          frameworks: 'GDPR,CCPA'
          max-critical: 0
          max-high: 3
          max-medium: 10
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Example 3: Monitoring Only (Learning)

Track violations without blocking PRs. Good for learning and assessment.

```yaml
name: Compliance Check - Monitor

on:
  pull_request:
    branches: [main, develop]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint Compliance Check
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
          frameworks: 'GDPR'
          max-critical: 999
          max-high: 999
          max-medium: 999
          max-low: 999
          comment-pr: 'true'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Example 4: HIPAA-Focused (Healthcare)

Focus on healthcare compliance requirements.

```yaml
name: HIPAA Compliance Check

on:
  pull_request:
    branches: [main]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint HIPAA Check
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
          frameworks: 'HIPAA'
          max-critical: 0
          max-high: 0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Example 5: Push Events (Direct Commits)

Scan direct commits to main branch (not recommended, but supported).

```yaml
name: Compliance Check - Push

on:
  push:
    branches: [main]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint Compliance Check
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
          comment-pr: 'false'  # No PR to comment on
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Example 6: Using Outputs for Conditional Logic

Use scan results in subsequent workflow steps.

```yaml
name: Compliance with Conditional Steps

on:
  pull_request:
    branches: [main]

jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Reglint Compliance Check
        id: reglint
        uses: YOUR_USERNAME/reglint-action@v1
        with:
          api-key: ${{ secrets.REGLINT_API_KEY }}
          max-critical: 999  # Don't fail, we'll handle manually
          max-high: 999
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Send Slack Alert on Critical Issues
        if: steps.reglint.outputs.critical-count != '0'
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK }} \
            -H 'Content-type: application/json' \
            -d '{"text":"Critical compliance issue detected in PR!"}'

      - name: Fail if Critical Issues Found
        if: steps.reglint.outputs.critical-count != '0'
        run: exit 1
```

---

## How It Works

1. **Trigger** - The action runs on pull_request or push events
2. **Detect Changes** - Fetches changed files from the PR or commit
3. **Filter Files** - Keeps only supported code files (.js, .py, .java, etc.)
4. **Read Content** - Reads file contents from the repository
5. **Analyze** - Sends files to Reglint AI for compliance analysis
6. **Evaluate** - Counts violations and checks against thresholds
7. **Report** - Posts a formatted comment on the PR (if enabled)
8. **Decision** - Passes or fails the workflow based on thresholds

### Supported File Types

| Language | Extensions |
|----------|------------|
| JavaScript/TypeScript | `.js`, `.jsx`, `.ts`, `.tsx` |
| Python | `.py` |
| Java | `.java` |
| Go | `.go` |
| Ruby | `.rb` |
| PHP | `.php` |
| C# | `.cs` |
| C/C++ | `.cpp`, `.c` |

---

## Troubleshooting

### Common Issues

#### "Authentication failed - please check your API key"

- Verify your API key is correct
- Ensure the secret `REGLINT_API_KEY` is properly set in repository settings
- Check that the secret name matches what's used in the workflow

#### "GITHUB_TOKEN is required for pull_request events"

- Add `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to the `env` section
- This token is automatically provided by GitHub Actions

#### "Cannot post PR comment"

- Ensure `GITHUB_TOKEN` is provided in the workflow
- Check that the token has `pull-requests: write` permission
- For private repos, verify the workflow has appropriate permissions

#### "No code files to scan"

This is normal if:
- The PR only changes non-code files (markdown, images, etc.)
- All changed files are in unsupported languages

#### "API request timed out"

- Large PRs with many files may take longer to analyze
- Try reducing the number of files changed per PR
- Contact support if this persists

### Permission Issues

If the action can't post comments or read files, add explicit permissions:

```yaml
jobs:
  compliance:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      # ...
```

---

## API Key Setup

### Getting Your API Key

1. Visit [reglint.com](https://reglint.com)
2. Sign up for an account
3. Navigate to **Settings > API Keys**
4. Click **Generate New Key**
5. Copy the key (it won't be shown again)

### Storing the API Key Securely

**Repository Secret (Recommended for single repo):**
1. Go to your repository on GitHub
2. Click **Settings > Secrets and variables > Actions**
3. Click **New repository secret**
4. Name: `REGLINT_API_KEY`
5. Value: Your API key
6. Click **Add secret**

**Organization Secret (Recommended for multiple repos):**
1. Go to your organization settings
2. Click **Secrets and variables > Actions**
3. Click **New organization secret**
4. Name: `REGLINT_API_KEY`
5. Value: Your API key
6. Select which repositories can access the secret
7. Click **Add secret**

---

## Compliance Frameworks

### GDPR (General Data Protection Regulation)

European Union regulation for data protection and privacy. Reglint checks for:
- Personal data handling violations
- Consent mechanism issues
- Data subject rights implementation
- Security of processing requirements
- Data transfer compliance

### CCPA (California Consumer Privacy Act)

California law protecting consumer privacy rights. Reglint checks for:
- Consumer rights implementation
- Privacy notice requirements
- Data collection practices
- Opt-out mechanisms
- Data sale/sharing compliance

### HIPAA (Health Insurance Portability and Accountability Act)

US law protecting health information. Reglint checks for:
- Protected Health Information (PHI) handling
- Access control requirements
- Audit logging compliance
- Encryption requirements
- Breach notification readiness

---

## Development & Testing

### Running Tests

```bash
npm test
```

This runs a comprehensive test suite (24 tests) that validates:

- **File Filtering** - Keeps code files (.js, .py, etc.), skips non-code files
- **Language Detection** - Correctly identifies file languages from extensions
- **Violation Counting** - Handles responses with and without summary field
- **Threshold Checking** - Pass/fail logic for all severity levels
- **PR Comment Formatting** - Correct markdown output with truncation
- **API Integration** - Payload format, auth headers, error handling
- **End-to-End Scenarios** - Clean scan, within thresholds, exceeds thresholds

### Test Output Example

```
🧪 Running Reglint Action Tests...
==================================================

Testing: File Filtering
  ✓ Keeps .js files
  ✓ Keeps .py files
  ✓ Skips .md files
  ✓ Skips .txt files
✅ File Filtering: PASS

Testing: Threshold Checking (pass)
  ✓ Passes with zero violations
  ✓ Passes when within all thresholds
  ✓ Passes when exactly at thresholds
✅ Threshold Checking (pass): PASS

...

==================================================
📊 Results: 24 passed, 0 failed
==================================================

🎉 All tests passed!
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm test` to ensure all tests pass
5. Submit a pull request

---

## Support

- **Documentation**: [docs.reglint.com](https://docs.reglint.com)
- **Issues**: [GitHub Issues](https://github.com/YOUR_USERNAME/reglint-action/issues)
- **Email**: support@reglint.com

---

## License

MIT License - see [LICENSE](LICENSE) for details.
