#!/usr/bin/env node
// Host-side diagnostic using the installed Paperclip sandbox builder read-only.
// Node 24+ is needed here for loading Paperclip's TypeScript source directly.
import { spawn } from 'node:child_process';
const { buildLocalProcessSandboxSpawnTarget } = await import('/opt/paperclip-ai/packages/adapter-utils/src/local-process-sandbox.ts');
const cwd = '/opt/paperclip-data/instances/default/workspaces/afa5b6fa-291c-4f12-bb66-c766a6077ac1';
const target = await buildLocalProcessSandboxSpawnTarget({
  executable: '/usr/bin/node', cwd,
  args: ['--input-type=module', '-e', `
    import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    const directory=await mkdtemp(tmpdir()+'/paperclip-sandbox-check-');
    await rm(directory,{recursive:true});
    for(const path of ['/etc/paperclip/github/paper-clip-agent-bot.pem','/etc/paperclip-github-auth/paperclip-api-key']) {
      let visible=false;try{await access(path);visible=true;}catch{}
      if(visible)throw new Error('Host credential exposed');
    }
    const status=await readFile('/proc/self/status','utf8');
    if(!/^CapEff:\\s+0+$/m.test(status))throw new Error('Capabilities not dropped');
    console.log('PASS: Paperclip sandbox creates temporary files, hides host keys, and drops capabilities');
  `],
  options: { workspaceDir: cwd, filesystemScope: 'workspace', extraPaths: [{ path: '/opt/paperclip-github-auth', access: 'ro' }], command: '/opt/paperclip-github-auth/bin/paperclip-bwrap' },
});
const child = spawn(target.command, target.args, { cwd: target.cwd, env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp', ...target.env }, stdio: 'inherit' });
child.on('error', () => { process.stderr.write('Sandbox diagnostic could not start.\n'); process.exitCode=1; });
child.on('exit', (code) => { process.exitCode=code??1; });
