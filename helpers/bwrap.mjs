import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Paperclip's local sandbox emits both merged-/usr symlinks and redundant bind
// mounts to those same destinations. Recent bwrap correctly rejects the latter.
// Remove only identical system read-only binds with a corresponding symlink and
// a read-only /usr mount; preserve all other arguments and confinement.
export function normalizeArgs(args) {
  const links = new Set(); let usrMounted = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ro-bind' && args[i + 1] === '/usr' && args[i + 2] === '/usr') usrMounted = true;
    if (args[i] === '--symlink' && ['/bin', '/sbin', '/lib', '/lib64'].includes(args[i + 2])
        && args[i + 1] === `usr${args[i + 2]}`) links.add(args[i + 2]);
  }
  const result = [];
  for (let i = 0; i < args.length; i++) {
    if (usrMounted && args[i] === '--ro-bind' && args[i + 1] === args[i + 2] && links.has(args[i + 1])) { i += 2; continue; }
    result.push(args[i]);
  }
  return ['--cap-drop', 'ALL', ...result];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const child = spawn('/usr/bin/bwrap', normalizeArgs(process.argv.slice(2)), { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { process.stderr.write('github-auth: cannot start bwrap.\n'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143); });
}
