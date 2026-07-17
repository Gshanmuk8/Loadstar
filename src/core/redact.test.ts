/**
 * Tests for secret redaction.
 *
 * These assert the INVARIANT, not the mechanism — the lesson from D-022/D-026/D-027,
 * where every bug was a mechanism that silently did nothing while looking correct. So:
 * never `expect(patterns).toContain(...)`. Always "this secret does not survive" and
 * "this non-secret does".
 *
 * The second half matters as much as the first. A redactor that eats real evidence has
 * broken the record just as thoroughly as one that leaks — it is just quieter about it.
 */

import { describe, it, expect } from 'vitest'
import { redactText, redactArgs, redactCommand, REDACTED } from './redact.js'

/** No test secret below is real. Shapes are what matter; these are synthetic. */
const FAKE = {
  anthropic: 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  openai: 'sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ghp: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  aws: 'AKIAIOSFODNN7EXAMPLE',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
}

describe('redactText — secrets do not survive', () => {
  it.each([
    ['anthropic key', FAKE.anthropic],
    ['openai key', FAKE.openai],
    ['github token', FAKE.ghp],
    ['aws access key', FAKE.aws],
    ['jwt', FAKE.jwt],
  ])('%s', (_label, secret) => {
    const { value, count } = redactText(`some prefix ${secret} some suffix`)
    expect(value).not.toContain(secret)
    expect(value).toContain(REDACTED)
    expect(count).toBeGreaterThan(0)
  })

  it('strips the password from a connection string but keeps the structure', () => {
    const { value } = redactText('psql postgres://admin:hunter2@db.internal:5432/prod')
    expect(value).not.toContain('hunter2')
    // The reader still needs to know which host and which user. Only the secret goes.
    expect(value).toContain('admin')
    expect(value).toContain('db.internal:5432/prod')
  })

  it('strips a bearer token from a header', () => {
    const { value } = redactText('curl -H "Authorization: Bearer abcdef123456789" https://api.x.com')
    expect(value).not.toContain('abcdef123456789')
    expect(value).toContain('https://api.x.com')
  })

  it('strips secret-named env assignments', () => {
    const { value } = redactText('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI GITHUB_TOKEN=ghs_xyz npm run deploy')
    expect(value).not.toContain('wJalrXUtnFEMI')
    expect(value).not.toContain('ghs_xyz')
    expect(value).toContain('npm run deploy')
  })

  it('is idempotent — redacting twice changes nothing', () => {
    const once = redactText(`export GITHUB_TOKEN=${FAKE.ghp}`).value
    expect(redactText(once).value).toBe(once)
  })

  it('is deterministic — the same input always gives the same output', () => {
    const input = `deploy --token ${FAKE.ghp} to postgres://u:p@h/db`
    expect(redactText(input).value).toBe(redactText(input).value)
  })
})

describe('redactText — evidence survives', () => {
  it.each([
    ['a plain test command', 'npm test'],
    ['a commit sha', 'git checkout 3f2a1b9c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90'],
    ['a uuid', '550e8400-e29b-41d4-a716-446655440000'],
    ['an integrity hash', 'sha512-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'],
    ['an ordinary path', 'src/auth.ts'],
    ['a port mapping', 'docker run -p 8080:80 nginx'],
    ['a recursive mkdir', 'mkdir -p src/components/auth'],
  ])('%s is untouched', (_label, input) => {
    const { value, count } = redactText(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('does not redact GIT_AUTHOR_NAME just because it contains "auth"', () => {
    const input = 'GIT_AUTHOR_NAME=Ada git commit -m ok'
    expect(redactText(input).value).toBe(input)
  })

  it('leaves a non-secret NAME=value alone', () => {
    const input = 'NODE_ENV=production npm run build'
    expect(redactText(input).value).toBe(input)
  })
})

describe('redactArgs — structure-aware', () => {
  it('redacts the value after a sensitive flag', () => {
    // The point of structure-awareness: `s3cr3t` matches no vendor shape and is
    // indistinguishable from an ordinary argument on its own. Only its position gives it
    // away, so a text-only pass would leak it.
    const { value } = redactArgs(['publish', '--token', 's3cr3t', '--access', 'public'])
    expect(value).toEqual(['publish', '--token', REDACTED, '--access', 'public'])
  })

  it('redacts an inline flag value', () => {
    const { value } = redactArgs(['--password=hunter2', 'deploy'])
    expect(value).toEqual([`--password=${REDACTED}`, 'deploy'])
  })

  it('does not eat the next flag when the sensitive flag is a boolean switch', () => {
    const { value } = redactArgs(['--auth', '--verbose'])
    expect(value).toEqual(['--auth', '--verbose'])
  })

  it('preserves argv length exactly', () => {
    const args = ['run', '--token', 'abc', '--x=1', FAKE.ghp, 'end']
    expect(redactArgs(args).value).toHaveLength(args.length)
  })

  it('never merges or reorders arguments', () => {
    const args = ['a b', 'c', '', 'd']
    expect(redactArgs(args).value).toEqual(args)
  })
})

describe('redactCommand — the record cannot disagree with itself', () => {
  it('joins from the redacted parts, so `full` and `args` always agree', () => {
    const { value } = redactCommand('npm', ['publish', '--token', 's3cr3t'])
    expect(value.full).toBe(`npm publish --token ${REDACTED}`)
    expect(value.args).toEqual(['publish', '--token', REDACTED])
    expect(value.full).not.toContain('s3cr3t')
  })

  it('leaves a test command byte-identical, so the fact engine still matches it', () => {
    // RF-01 groups by command string and RF-04 matches test-shaped commands. If redaction
    // perturbed ordinary argv, it would silently break both.
    const { value, count } = redactCommand('npm', ['test'])
    expect(value.full).toBe('npm test')
    expect(count).toBe(0)
  })
})
