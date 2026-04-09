import { spawnSync } from 'node:child_process';

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

export function assertCleanGitState(): void {
  const status = run('git', ['status', '--porcelain']);
  if (status.length > 0) {
    throw new Error(
      `Git working tree is not clean. Commit or stash changes first:\n${status}`
    );
  }
}

export function commitAndPushMetadata(
  metadataPaths: string[],
  month: string,
): void {
  for (const p of metadataPaths) {
    run('git', ['add', p]);
  }
  run('git', ['commit', '-m', `update ${month} rewards metadata with orderHash and txHash`]);
  run('git', ['push']);
}
