// Maps a CI job name to a pipeline stage, so bottlenecks are comparable across repos.

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(e2e|end.to.end|playwright|cypress|maestro|detox)\b/i, 'e2e'],
  [/\b(integration|it|contract)\b/i, 'integration'],
  [/\b(lint|format|prettier|eslint|style)\b/i, 'lint'],
  [/\b(type.?check|tsc|types)\b/i, 'typecheck'],
  [/\b(unit|test|tests|spec|jest|vitest|pytest)\b/i, 'unit'],
  [/\b(build|compile|bundle|package|docker)\b/i, 'build'],
  [/\b(install|deps|dependencies|setup|bootstrap)\b/i, 'install'],
  [/\b(deploy|release|publish|ship)\b/i, 'deploy'],
  [/\b(security|audit|codeql|scan|sast)\b/i, 'security'],
];

export const STAGES = [
  'queue', 'install', 'build', 'lint', 'typecheck', 'unit', 'integration', 'e2e', 'security', 'deploy', 'other',
] as const;

export function stageOf(jobName: string, overrides: Readonly<Record<string, string>> = {}): string {
  const override = overrides[jobName];
  if (override) return override;
  for (const [pattern, stage] of RULES) {
    if (pattern.test(jobName)) return stage;
  }
  return 'other';
}
