export function sanitizeDiagnostic(text, secrets = []) {
  let result = String(text);
  for (const secret of secrets.filter(Boolean)) {
    for (const value of [secret, encodeURIComponent(secret)]) result = result.split(value).join('[REDACTED]');
  }
  return result
    .replace(/(?:gh[pousr]_|github_pat_|pcp_board_)[A-Za-z0-9_]+/g, '[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .slice(0, 4000);
}
