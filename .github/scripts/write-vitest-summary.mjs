#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const [reportPathArg] = process.argv.slice(2)
const reportPath = reportPathArg ?? 'vitest-results.json'
const summaryPath = process.env.GITHUB_STEP_SUMMARY

function readReport(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeTable(value) {
  return escapeHtml(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function formatDuration(durationMs) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) {
    return '-'
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`
  }
  return `${(durationMs / 1000).toFixed(2)} s`
}

function statusLabel(status) {
  switch (status) {
    case 'passed':
      return 'PASS'
    case 'failed':
      return 'FAIL'
    case 'pending':
      return 'SKIP'
    case 'todo':
      return 'TODO'
    default:
      return String(status ?? 'unknown').toUpperCase()
  }
}

function relativeName(name) {
  return path.relative(process.cwd(), name).replaceAll(path.sep, '/')
}

function suiteDuration(suite) {
  if (typeof suite.startTime === 'number' && typeof suite.endTime === 'number') {
    return suite.endTime - suite.startTime
  }
  return suite.assertionResults.reduce((total, test) => total + (test.duration ?? 0), 0)
}

function write(content) {
  if (summaryPath) {
    fs.appendFileSync(summaryPath, content)
    return
  }
  process.stdout.write(content)
}

if (!fs.existsSync(reportPath)) {
  write(
    [
      '# Vitest Test Report',
      '',
      'Vitest did not produce a JSON report. Check the previous workflow steps for install, type check, or test startup failures.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const report = readReport(reportPath)
const suites = [...report.testResults].sort((a, b) => relativeName(a.name).localeCompare(relativeName(b.name)))
const failedTests = suites.flatMap((suite) =>
  suite.assertionResults
    .filter((test) => test.status === 'failed')
    .map((test) => ({ suite, test })),
)
const suiteCounts = suites.reduce(
  (counts, suite) => {
    counts.total += 1
    if (suite.status === 'passed') {
      counts.passed += 1
    } else if (suite.status === 'failed') {
      counts.failed += 1
    } else {
      counts.pending += 1
    }
    return counts
  },
  { total: 0, passed: 0, failed: 0, pending: 0 },
)
const testCounts = suites.flatMap((suite) => suite.assertionResults).reduce(
  (counts, test) => {
    counts.total += 1
    if (test.status === 'passed') {
      counts.passed += 1
    } else if (test.status === 'failed') {
      counts.failed += 1
    } else if (test.status === 'todo') {
      counts.todo += 1
    } else {
      counts.pending += 1
    }
    return counts
  },
  { total: 0, passed: 0, failed: 0, pending: 0, todo: 0 },
)

const lines = [
  '# Vitest Test Report',
  '',
  '## Summary',
  '',
  `- Test Files: ${suiteCounts.passed} passed / ${suiteCounts.total} total`,
  `- Test Results: ${testCounts.passed} passed / ${testCounts.total} total`,
]

if (suiteCounts.failed > 0 || testCounts.failed > 0) {
  lines.push(`- Failures: ${suiteCounts.failed} files / ${testCounts.failed} tests`)
}

if (testCounts.pending > 0 || testCounts.todo > 0) {
  lines.push(`- Skipped or todo: ${testCounts.pending + testCounts.todo}`)
}

lines.push('', '## Test Files', '', '| Status | File | Tests | Duration |', '| --- | --- | ---: | ---: |')

for (const suite of suites) {
  const failed = suite.assertionResults.filter((test) => test.status === 'failed').length
  const passed = suite.assertionResults.filter((test) => test.status === 'passed').length
  const tests = failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`

  lines.push(
    `| ${statusLabel(suite.status)} | \`${escapeTable(relativeName(suite.name))}\` | ${escapeTable(tests)} | ${formatDuration(suiteDuration(suite))} |`,
  )
}

lines.push('', '## Test Cases', '')

for (const suite of suites) {
  lines.push(`<details>`, `<summary><code>${escapeHtml(relativeName(suite.name))}</code></summary>`, '')
  lines.push('| Status | Test | Duration |', '| --- | --- | ---: |')

  for (const test of suite.assertionResults) {
    lines.push(`| ${statusLabel(test.status)} | ${escapeTable(test.fullName)} | ${formatDuration(test.duration)} |`)
  }

  lines.push('', '</details>', '')
}

if (failedTests.length > 0) {
  lines.push('## Failures', '')

  for (const { suite, test } of failedTests) {
    lines.push(`### ${escapeHtml(test.fullName)}`, '')
    lines.push(`File: \`${escapeTable(relativeName(suite.name))}\``, '')

    for (const message of test.failureMessages) {
      lines.push('```text', String(message).replaceAll('```', "'''"), '```', '')
    }
  }
}

write(`${lines.join('\n')}\n`)
