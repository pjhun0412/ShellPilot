import type { SessionItem } from '@/types/workspace';
import { runAiPrompt, runReadonlyRemoteCommands } from './aiBridge';

export interface ReadonlyToolStep {
  command: string;
  name: string;
  workingDirectory?: string;
}

export interface ReadonlyToolPlan {
  cost: ReadonlyToolCost;
  executionMode: ReadonlyToolExecutionMode;
  intent: ReadonlyToolIntent;
  name: string;
  suggestions?: ReadonlyToolSuggestion[];
  tool: ReadonlyToolIntentParams;
}

export interface ReadonlyToolResult {
  context: string;
  failed: boolean;
  planName: string;
  records: ReadonlyToolExecutionRecord[];
}

export type ReadonlyToolIntent =
  | 'analyze_log'
  | 'find_file'
  | 'inspect_path'
  | 'inspect_network'
  | 'inspect_process'
  | 'list_current_directory'
  | 'list_home'
  | 'read_file'
  | 'quick_health'
  | 'read_log'
  | 'system_snapshot';

export type ReadonlyToolIntentParams =
  | { intent: 'analyze_log'; lines?: number; path?: string }
  | { intent: 'find_file'; query: string }
  | { intent: 'inspect_path'; path: string }
  | { intent: 'inspect_network'; port?: number; query?: string }
  | { intent: 'inspect_process'; query: string }
  | { intent: 'list_current_directory' }
  | { intent: 'list_home' }
  | { intent: 'read_file'; path: string; workingDirectory?: string }
  | { intent: 'quick_health' }
  | { intent: 'read_log'; path: string }
  | { intent: 'system_snapshot' };

interface ClassifiedToolIntent {
  source: 'classifier' | 'fast-path';
  tool: ReadonlyToolIntentParams;
}

interface ClassifierJsonResponse {
  intent?: string;
  params?: {
    lines?: unknown;
    path?: unknown;
    port?: unknown;
    query?: unknown;
  };
}

interface ToolCatalogEntry {
  argHint?: string;
  cost: ReadonlyToolCost;
  description: string;
  examples: string[];
  execution?: ReadonlyToolExecutionMode | ((tool: ReadonlyToolIntentParams) => ReadonlyToolExecutionMode);
  id: ReadonlyToolIntent;
  match?: (prompt: string, normalized: string) => ReadonlyToolIntentParams | undefined;
  needsArg: boolean;
  suggestions?: ReadonlyToolSuggestion[];
}

export type ReadonlyToolCost = 'heavy' | 'instant' | 'light';
export type ReadonlyToolExecutionMode = 'auto' | 'confirm';

export interface ReadonlyToolSuggestion {
  intent: ReadonlyToolIntent;
  label: string;
  tool: ReadonlyToolIntentParams;
}

export interface ReadonlyToolExecutionRecord {
  command: string;
  error?: string;
  exitCode?: number;
  name: string;
  stderr: string;
  stdout: string;
  status: 'failed' | 'success';
}

type RemoteOsFamily = 'darwin' | 'linux' | 'unknown' | 'windows';

interface RemoteOsProbe {
  family: RemoteOsFamily;
  label: string;
}

interface ReadonlyRuntimeToolPlan extends ReadonlyToolPlan {
  steps: ReadonlyToolStep[];
}

export interface MutatingActionProposal {
  actionLabel: string;
  reason: string;
  risk: string;
}

export type ToolPlanDecision =
  | { kind: 'ready'; plan: ReadonlyToolPlan }
  | { intent: ReadonlyToolIntent; kind: 'missing_params'; missing: ReadonlyToolParamName[] }
  | { kind: 'none' }
  | { kind: 'parse_failed' };

type ReadonlyToolParamName = 'path' | 'query';
export interface ReadonlyToolRoutingContext {
  currentDirectory?: string;
}

const REMOTE_OS_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const remoteOsCache = new Map<string, { detectedAt: number; probe: RemoteOsProbe }>();
const remoteOsInflight = new Map<string, Promise<RemoteOsProbe>>();

const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: 'quick_health',
    cost: 'light',
    description: 'Fast first-pass health check: uptime/load, memory, disk, and OS identity',
    examples: [
      'server is slow',
      'why is this server lagging',
      'basic server health',
      '\uC11C\uBC84\uAC00 \uB290\uB824',
      '\uC11C\uBC84 \uC0C1\uD0DC \uC774\uC0C1\uD574',
      '\uC751\uB2F5\uC774 \uB290\uB9BC',
      '\uC65C \uBC84\uBC85\uC784',
    ],
    match: matchQuickHealthIntent,
    needsArg: false,
    execution: 'auto',
    suggestions: [
      { intent: 'system_snapshot', label: 'Run deeper system snapshot', tool: { intent: 'system_snapshot' } },
      { intent: 'inspect_network', label: 'Inspect network and ports', tool: { intent: 'inspect_network' } },
      { intent: 'inspect_process', label: 'Inspect a process or service', tool: { intent: 'inspect_process', query: '' } },
      { intent: 'analyze_log', label: 'Analyze a specific log path', tool: { intent: 'analyze_log', path: '' } },
    ],
  },
  {
    id: 'system_snapshot',
    cost: 'heavy',
    description: 'Deeper system info: memory, disk, CPU, uptime, OS, and process table',
    examples: ['full system snapshot', 'deep server diagnosis', '\uC790\uC138\uD55C \uC11C\uBC84 \uC9C4\uB2E8'],
    needsArg: false,
    // Confirm because the output is broad and can expose sensitive process
    // command lines, not because the user intent is ambiguous.
    execution: 'confirm',
  },
  {
    id: 'list_home',
    cost: 'light',
    description: 'List files in the home directory',
    examples: ['what is in home', 'list home directory', '\uD648\uC5D0 \uBB50 \uC788\uC5B4'],
    match: matchHomeListingIntent,
    needsArg: false,
    execution: 'auto',
  },
  {
    id: 'list_current_directory',
    cost: 'light',
    description: 'List files in the current working directory',
    examples: ['what is here', 'list current directory', '\uD604\uC7AC \uACBD\uB85C \uBAA9\uB85D', '\uC5EC\uAE30 \uD30C\uC77C \uBB50'],
    match: matchCurrentDirectoryIntent,
    needsArg: false,
    execution: 'auto',
  },
  {
    id: 'find_file',
    cost: 'heavy',
    description: 'Search the home directory for a file, directory, or path by name or pattern',
    examples: ['find nginx.conf', 'search backup file', 'find git directory', '\uD30C\uC77C \uCC3E\uC544\uC918', '\uB514\uB809\uD1A0\uB9AC \uCC3E\uC544\uC918'],
    execution: 'auto',
    match: matchFindFileIntent,
    needsArg: true,
    argHint: 'file, directory, or path name pattern to search for',
  },
  {
    id: 'analyze_log',
    cost: 'heavy',
    description: 'Inspect a log file or log directory and collect recent warning/error lines',
    examples: ['analyze errors in /var/log/app.log', '\uB85C\uADF8 \uC5D0\uB7EC \uBD84\uC11D'],
    execution: 'auto',
    match: matchExplicitLogAnalysisIntent,
    needsArg: true,
    argHint: 'absolute log path and optional line count',
  },
  {
    id: 'read_log',
    cost: 'light',
    description: 'Read the last lines of a log file at an absolute path',
    examples: ['read /var/log/app.log', 'tail this log', '\uB85C\uADF8 \uC77D\uC5B4\uC918'],
    execution: 'auto',
    needsArg: true,
    argHint: 'absolute file path',
  },
  {
    id: 'read_file',
    cost: 'light',
    description: 'Read the contents of a specific file at an absolute path',
    examples: ['read /home/app/tsconfig.json', 'show file contents', '\uD30C\uC77C \uB0B4\uC6A9 \uC77D\uC5B4\uC918'],
    execution: 'auto',
    match: matchExplicitReadFileIntent,
    needsArg: true,
    argHint: 'absolute file path',
  },
  {
    id: 'inspect_path',
    cost: 'light',
    description: 'Inspect a specific absolute path: stat it, list it if it is a directory, tail it if it is a file',
    examples: ['what is /tmp/a.txt', 'file permission for /tmp/a.txt', '\uD30C\uC77C \uAD8C\uD55C \uBB50\uC57C'],
    execution: 'auto',
    match: matchExplicitPathInspectionIntent,
    needsArg: true,
    argHint: 'absolute path to a file or directory',
  },
  {
    id: 'inspect_network',
    cost: 'heavy',
    description: 'Inspect listening ports, active TCP sockets, or a specific port/process name',
    examples: ['what ports are listening', 'is port 8080 open', '\uD3EC\uD2B8 \uC5F4\uB824\uC788\uC5B4'],
    execution: (tool) => (tool.intent === 'inspect_network' && (tool.port || tool.query) ? 'auto' : 'confirm'),
    match: matchNetworkIntent,
    needsArg: false,
  },
  {
    id: 'inspect_process',
    cost: 'light',
    description: 'Inspect whether a process is running and capture process command lines that may reveal paths',
    examples: ['is tomcat running', 'where is nginx process', '\uD1B0\uCEA3 \uB5A0\uC788\uC5B4'],
    execution: 'auto',
    match: matchProcessIntent,
    needsArg: true,
    argHint: 'process name, service name, or executable keyword',
  },
];

const ABSOLUTE_PATH_PATTERN = /\/[\w.-]+(?:\/[\w.-]+)+\/?/;
const PORT_PATTERN = /(?:port|\uD3EC\uD2B8|:)\s*(\d{2,5})\b/i;

export function createReadonlyToolPlan(prompt: string, context?: ReadonlyToolRoutingContext): ReadonlyToolPlan | undefined {
  const decision = createReadonlyToolDecision(prompt, context);

  return decision.kind === 'ready' ? decision.plan : undefined;
}

export function createReadonlyToolDecision(prompt: string, context?: ReadonlyToolRoutingContext): ToolPlanDecision {
  const classified = createFastPathToolIntent(prompt, context);

  if (!classified) {
    if (isCurrentDirectoryReadFilePrompt(prompt, context)) {
      return { intent: 'read_file', kind: 'missing_params', missing: ['path'] };
    }

    return { kind: 'none' };
  }

  return buildToolDecision(classified.tool);
}

export function createReadonlyToolDecisionFromTool(tool: ReadonlyToolIntentParams): ToolPlanDecision {
  return buildToolDecision(tool);
}

export function createMutatingActionProposal(prompt: string): MutatingActionProposal | undefined {
  const normalized = prompt.toLowerCase();

  if (!isMutatingPrompt(normalized) || isReadonlyQuestionPrompt(normalized)) {
    return undefined;
  }

  return {
    actionLabel: inferMutatingActionLabel(normalized),
    reason: 'This request would change the remote system, so ShellPilot must ask before running it.',
    risk: 'No command was executed. Review the proposed action before approval support is enabled.',
  };
}

export function prewarmRemoteOs(panelId: string, session?: SessionItem) {
  if (session?.kind !== 'ssh') {
    return;
  }

  void detectRemoteOs(panelId, session).catch(() => undefined);
}

function createFastPathToolIntent(prompt: string, context?: ReadonlyToolRoutingContext): ClassifiedToolIntent | undefined {
  const normalized = prompt.toLowerCase();
  const relativeReadFileTool = matchRelativeReadFileIntent(prompt, normalized, context);

  if (relativeReadFileTool) {
    return { source: 'fast-path', tool: relativeReadFileTool };
  }

  for (const entry of TOOL_CATALOG) {
    const tool = entry.match?.(prompt, normalized);

    if (tool) {
      return { source: 'fast-path', tool };
    }
  }

  return undefined;
}

export async function classifyToolDecision(prompt: string, providerId: string): Promise<ToolPlanDecision> {
  const classified = await classifyToolIntent(prompt, providerId);

  if (!classified) {
    return { kind: 'none' };
  }

  return buildToolDecision(classified.tool);
}

export async function classifyToolPlan(prompt: string, providerId: string): Promise<ReadonlyToolPlan | undefined> {
  const decision = await classifyToolDecision(prompt, providerId);

  return decision.kind === 'ready' ? decision.plan : undefined;
}

async function classifyToolIntent(prompt: string, providerId: string): Promise<ClassifiedToolIntent | undefined> {
  const catalogText = TOOL_CATALOG.map(
    (tool) => [
      `- ${tool.id}${tool.needsArg ? ` (${tool.argHint})` : ''}: ${tool.description}`,
      `  cost=${tool.cost}`,
      `  examples=${tool.examples.slice(0, 3).join(' | ')}`,
    ].join('\n'),
  ).join('\n');
  const classifierPrompt = [
    'You are a routing classifier for ShellPilot.',
    'Choose at most one read-only intent. Do not invent tools, shell commands, or execution plans.',
    'Respond with compact JSON only. Do not include Markdown, prose, or code fences.',
    'Schema:',
    '{"intent":"<intent_id>","params":{}}',
    'Use {"intent":"none","params":{}} when no remote tool is needed.',
    'If the user asks to modify remote state, such as deleting, writing, moving, copying, chmod/chown, or starting/stopping/restarting a service, return {"intent":"none","params":{}}.',
    'For find_file use params.query. For read_log and inspect_path use params.path.',
    'For read_file use params.path when the user asks to read or show a file content.',
    'For quick_health use no params when the user asks for broad slowness, lag, or first-pass server health.',
    'Use system_snapshot only when the user asks for a detailed/full/deep system diagnostic.',
    'For analyze_log use params.path and optionally params.lines. Only choose analyze_log when the user provides an explicit absolute log path.',
    'For inspect_network optionally use params.port or params.query when the question mentions a port or process name.',
    'For inspect_process use params.query when the user asks whether a process/service is running or asks for its executable/config path.',
    '',
    'Available intents:',
    catalogText,
    '- none: no remote tool is needed to answer this question',
    '',
    `User question: "${prompt}"`,
  ].join('\n');

  try {
    const response = await runAiPrompt({ prompt: classifierPrompt, providerId, timeoutSeconds: 4 });

    const tool = parseToolClassification(response.output);

    return tool ? { source: 'classifier', tool } : undefined;
  } catch {
    return undefined;
  }
}

export async function collectReadonlyToolContext(panelId: string, session: SessionItem, plan: ReadonlyToolPlan): Promise<ReadonlyToolResult> {
  const osProbe = await detectRemoteOs(panelId, session);
  const runtimePlan = buildToolPlanForRemoteOs(plan.tool, osProbe);
  if (!runtimePlan) {
    return {
      context: `Remote read-only tool plan could not be built for ${plan.name} on ${osProbe.label}.`,
      failed: true,
      planName: plan.name,
      records: [],
    };
  }
  const chunks: string[] = [
    `Remote read-only tool plan: ${runtimePlan.name}`,
    `Plan cost: ${runtimePlan.cost}`,
    `Execution mode: ${runtimePlan.executionMode}`,
    `Remote OS: ${osProbe.label}`,
  ];

  if (runtimePlan.suggestions?.length) {
    chunks.push(
      [
        'Suggested next checks:',
        ...runtimePlan.suggestions.map((suggestion) => `- ${suggestion.label} (${suggestion.intent})`),
      ].join('\n'),
    );
  }
  const records: ReadonlyToolExecutionRecord[] = [];
  let failed = false;

  // One batched call reuses a single SSH connection for every step instead of
  // reconnecting per command, which used to dominate plan latency.
  let results: Awaited<ReturnType<typeof runReadonlyRemoteCommands>>;

  try {
    results = await runReadonlyRemoteCommands(
      panelId,
      session,
      runtimePlan.steps.map((step) => ({
        command: step.command,
        workingDirectory: step.workingDirectory,
      })),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    for (const step of runtimePlan.steps) {
      records.push({ command: formatDisplayedCommand(step), error: message, name: step.name, status: 'failed', stderr: '', stdout: '' });
      chunks.push([`## ${step.name}`, `Command: ${formatDisplayedCommand(step)}`, 'Tool status: failed', `Error: ${message}`].join('\n'));
    }

    chunks.push('Some read-only tools failed. Do not pretend failed tool output exists.');

    return { context: chunks.join('\n\n'), failed: true, planName: runtimePlan.name, records };
  }

  runtimePlan.steps.forEach((step, index) => {
    const result = results[index];

    if (result.error) {
      failed = true;
      records.push({ command: formatDisplayedCommand(step), error: result.error, name: step.name, status: 'failed', stderr: '', stdout: '' });
      chunks.push(
        [`## ${step.name}`, `Command: ${formatDisplayedCommand(step)}`, 'Tool status: failed', `Error: ${result.error}`].join('\n'),
      );
      return;
    }

    const stdout = truncateToolOutput(result.stdout);
    const stderr = truncateToolOutput(result.stderr);

    records.push({
      command: formatDisplayedCommand(step),
      exitCode: result.exitCode,
      name: step.name,
      status: 'success',
      stderr,
      stdout,
    });

    chunks.push(
      [
        `## ${step.name}`,
        `Command: ${formatDisplayedCommand(step)}`,
        `Exit code: ${result.exitCode ?? 'unknown'}`,
        stdout ? `STDOUT:\n${stdout}` : undefined,
        stderr ? `STDERR:\n${stderr}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  });

  if (failed) {
    chunks.push('Some read-only tools failed. Do not pretend failed tool output exists.');
  }

  return {
    context: chunks.join('\n\n'),
    failed,
    planName: runtimePlan.name,
    records,
  };
}

function buildToolDecision(tool: ReadonlyToolIntentParams): ToolPlanDecision {
  const missing = getMissingReadonlyToolParams(tool);

  if (missing.length > 0) {
    return { intent: tool.intent, kind: 'missing_params', missing };
  }

  return { kind: 'ready', plan: buildToolPlan(tool) };
}

function buildToolPlan(tool: ReadonlyToolIntentParams): ReadonlyToolPlan {
  const catalogEntry = getCatalogEntry(tool.intent);

  return {
    cost: catalogEntry?.cost ?? 'light',
    executionMode: resolveExecutionMode(catalogEntry, tool),
    intent: tool.intent,
    name: tool.intent,
    suggestions: catalogEntry?.suggestions,
    tool,
  };
}

function resolveExecutionMode(catalogEntry: ToolCatalogEntry | undefined, tool: ReadonlyToolIntentParams): ReadonlyToolExecutionMode {
  if (!catalogEntry?.execution) {
    return 'auto';
  }

  return typeof catalogEntry.execution === 'function' ? catalogEntry.execution(tool) : catalogEntry.execution;
}

function buildToolPlanForRemoteOs(tool: ReadonlyToolIntentParams, os: RemoteOsProbe): ReadonlyRuntimeToolPlan | undefined {
  const basePlan = buildToolPlan(tool);
  const plan = buildToolPlanSteps(tool, os);

  return plan
    ? {
        cost: basePlan.cost,
        executionMode: basePlan.executionMode,
        intent: tool.intent,
        name: plan.name,
        suggestions: basePlan.suggestions,
        steps: plan.steps,
        tool,
      }
    : undefined;
}

function buildToolPlanSteps(tool: ReadonlyToolIntentParams, os: RemoteOsProbe): Pick<ReadonlyRuntimeToolPlan, 'name' | 'steps'> | undefined {
  switch (tool.intent) {
    case 'analyze_log': {
      const path = sanitizeAbsolutePath(tool.path);
      const lines = sanitizeLineCount(tool.lines) ?? 200;

      if (!path) {
        return undefined;
      }

      if (os.family === 'windows') {
        return unsupportedPlan('analyze_log', os, 'Windows log analysis needs a dedicated PowerShell recipe.');
      }

      return {
        name: 'analyze_log',
        steps: [
          { command: `stat -- "${path}"`, name: 'log_path_stat' },
          { command: `find "${path}" -maxdepth 2 -type f -iname "*.log"`, name: 'nearby_log_files' },
          { command: `tail -n ${lines} -- "${path}"`, name: 'recent_log_tail_if_file' },
          { command: `grep -r -n -i -m 80 "error" -- "${path}"`, name: 'error_lines' },
          { command: `grep -r -n -i -m 80 "warn" -- "${path}"`, name: 'warning_lines' },
          { command: `grep -r -n -i -m 80 "fail" -- "${path}"`, name: 'failure_lines' },
          { command: `journalctl -n ${Math.min(lines, 300)} -p warning`, name: 'recent_journal_warnings' },
        ],
      };
    }
    case 'system_snapshot': {
      if (os.family === 'darwin') {
        return {
          name: 'system_snapshot',
          steps: [
            { command: 'id', name: 'identity' },
            { command: 'sw_vers', name: 'os_release' },
            { command: 'uname -a', name: 'kernel' },
            { command: 'uptime', name: 'uptime' },
            { command: 'vm_stat', name: 'memory' },
            { command: 'df -h', name: 'disk' },
            { command: 'sysctl -n machdep.cpu.brand_string', name: 'cpu_model' },
            { command: 'ps aux', name: 'process_table' },
          ],
        };
      }

      if (os.family === 'windows') {
        return {
          name: 'system_snapshot',
          steps: [
            { command: 'whoami', name: 'identity' },
            { command: 'ver', name: 'os_release' },
            { command: 'tasklist /v', name: 'process_table' },
            { command: 'wmic os get Caption,Version,LastBootUpTime', name: 'windows_os' },
            { command: 'wmic logicaldisk get DeviceID,Size,FreeSpace', name: 'disk' },
            { command: 'wmic cpu get Name', name: 'cpu_model' },
          ],
        };
      }

      return {
        name: 'system_snapshot',
        steps: [
          { command: 'id', name: 'identity' },
          { command: 'cat /etc/os-release', name: 'os_release' },
          { command: 'uname -a', name: 'kernel' },
          { command: 'uptime', name: 'uptime' },
          { command: 'free -h', name: 'memory' },
          { command: 'df -h', name: 'disk' },
          { command: 'grep -m1 "model name" /proc/cpuinfo', name: 'cpu_model' },
          { command: 'ps -eo pid,ppid,comm,%cpu,%mem --sort=-%cpu', name: 'top_processes' },
        ],
      };
    }
    case 'quick_health': {
      if (os.family === 'darwin') {
        return {
          name: 'quick_health',
          steps: [
            { command: 'sw_vers', name: 'os_release' },
            { command: 'uptime', name: 'uptime' },
            { command: 'vm_stat', name: 'memory' },
            { command: 'df -h', name: 'disk' },
          ],
        };
      }

      if (os.family === 'windows') {
        return {
          name: 'quick_health',
          steps: [
            { command: 'ver', name: 'os_release' },
            { command: 'wmic os get Caption,Version,LastBootUpTime,FreePhysicalMemory,TotalVisibleMemorySize', name: 'windows_os_memory' },
            { command: 'wmic logicaldisk get DeviceID,Size,FreeSpace', name: 'disk' },
          ],
        };
      }

      return {
        name: 'quick_health',
        steps: [
          { command: 'cat /etc/os-release', name: 'os_release' },
          { command: 'uptime', name: 'uptime' },
          { command: 'free -h', name: 'memory' },
          { command: 'df -h', name: 'disk' },
        ],
      };
    }
    case 'list_home':
      if (os.family === 'windows') {
        return {
          name: 'list_home',
          steps: [{ command: 'dir %USERPROFILE%', name: 'home_listing' }],
        };
      }

      return {
        name: 'list_home',
        steps: [{ command: 'ls -lah ~', name: 'home_listing' }],
      };
    case 'list_current_directory':
      if (os.family === 'windows') {
        return {
          name: 'list_current_directory',
          steps: [{ command: 'dir .', name: 'current_directory_listing' }],
        };
      }

      return {
        name: 'list_current_directory',
        steps: [{ command: 'ls -lah .', name: 'current_directory_listing' }],
      };
    case 'find_file': {
      const name = sanitizeFilePattern(tool.query);

      if (!name) {
        return undefined;
      }

      if (os.family === 'windows') {
        return unsupportedPlan('find_file', os, 'Windows file search needs a dedicated safe recipe.');
      }

      return {
        name: 'find_file',
        steps: [{ command: `find ~ -maxdepth 6 -iname "*${name}*"`, name: 'find_file' }],
      };
    }
    case 'inspect_network': {
      const query = sanitizeFilePattern(tool.query);
      const port = sanitizePort(tool.port);
      const steps: ReadonlyToolStep[] =
        os.family === 'windows'
          ? [
              { command: 'netstat -ano', name: 'network_connections' },
              { command: 'tasklist /v', name: 'process_table' },
            ]
          : os.family === 'darwin'
            ? [
                { command: 'netstat -an', name: 'network_connections' },
                { command: 'lsof -nP -iTCP', name: 'tcp_processes' },
              ]
            : [
                { command: 'ss -tulpen', name: 'listening_sockets' },
                { command: 'ss -tan', name: 'tcp_connections' },
                { command: 'netstat -tulpen', name: 'netstat_listening_sockets' },
              ];

      if (port && os.family === 'linux') {
        steps.unshift(
          { command: `ss -tulpen sport = :${port}`, name: 'listening_sockets_for_port' },
          { command: `ss -tan sport = :${port}`, name: 'tcp_local_port_connections' },
          { command: `ss -tan dport = :${port}`, name: 'tcp_remote_port_connections' },
        );
      }

      if (query && os.family !== 'windows') {
        steps.push({ command: `pgrep -af "${query}"`, name: 'process_command_line_matches' });
      }

      return {
        name: 'inspect_network',
        steps,
      };
    }
    case 'inspect_process': {
      const query = sanitizeFilePattern(tool.query);

      if (!query) {
        return undefined;
      }

      if (os.family === 'windows') {
        return {
          name: 'inspect_process',
          steps: [
            { command: 'tasklist /v', name: 'process_table' },
            { command: `wmic process where "CommandLine like '%${query}%'" get ProcessId,Name,ExecutablePath,CommandLine`, name: 'process_command_line_matches' },
          ],
        };
      }

      return {
        name: 'inspect_process',
        steps: [
          { command: `pgrep -af "${query}"`, name: 'process_command_line_matches' },
          {
            command: os.family === 'darwin'
              ? 'ps aux'
              : 'ps -eo pid,ppid,user,comm,args --sort=comm',
            name: 'process_table',
          },
        ],
      };
    }
    case 'read_log': {
      const path = sanitizeAbsolutePath(tool.path);

      if (!path) {
        return undefined;
      }

      if (os.family === 'windows') {
        return unsupportedPlan('read_log', os, 'Windows log reading needs a dedicated safe recipe.');
      }

      return {
        name: 'read_log',
        steps: [{ command: `tail -n 200 -- "${path}"`, name: 'read_log' }],
      };
    }
    case 'read_file': {
      const absolutePath = sanitizeAbsoluteOrHomePath(tool.path);
      const relativePath = sanitizeRelativePath(tool.path);
      const workingDirectory = sanitizeAbsoluteOrHomePath(tool.workingDirectory);

      if (!absolutePath && (!relativePath || !workingDirectory)) {
        return undefined;
      }

      if (os.family === 'windows') {
        return unsupportedPlan('read_file', os, 'Windows file reading needs Windows path parsing before it can run safely.');
      }

      const path = absolutePath || relativePath;

      return {
        name: 'read_file',
        steps: [
          { command: `stat -- ${formatRemotePathArgument(path)}`, name: 'file_stat', workingDirectory: workingDirectory || undefined },
          { command: `cat -- ${formatRemotePathArgument(path)}`, name: 'file_contents', workingDirectory: workingDirectory || undefined },
        ],
      };
    }
    case 'inspect_path': {
      const path = sanitizeAbsolutePath(tool.path);

      if (!path) {
        return undefined;
      }

      if (os.family === 'windows') {
        return unsupportedPlan('inspect_path', os, 'Windows path inspection needs Windows path parsing before it can run safely.');
      }

      return {
        name: 'inspect_path',
        steps: [
          { command: `stat -- "${path}"`, name: 'stat' },
          { command: `ls -lah -- "${path}"`, name: 'list_if_directory' },
          { command: `tail -n 200 -- "${path}"`, name: 'tail_if_file' },
        ],
      };
    }
    default:
      return undefined;
  }
}

function unsupportedPlan(name: string, os: RemoteOsProbe, reason: string): Pick<ReadonlyRuntimeToolPlan, 'name' | 'steps'> {
  return {
    name,
    steps: [
      {
        command: os.family === 'windows' ? 'ver' : 'uname -a',
        name: `${name}_unsupported_on_${os.family}`,
      },
      {
        command: os.family === 'windows' ? 'whoami' : 'id',
        name: reason,
      },
    ],
  };
}

function getMissingReadonlyToolParams(tool: ReadonlyToolIntentParams): ReadonlyToolParamName[] {
  switch (tool.intent) {
    case 'analyze_log':
      return sanitizeAbsolutePath(tool.path) ? [] : ['path'];
    case 'find_file':
      return sanitizeFilePattern(tool.query) ? [] : ['query'];
    case 'inspect_network':
      return [];
    case 'inspect_path':
      return sanitizeAbsolutePath(tool.path) ? [] : ['path'];
    case 'inspect_process':
      return sanitizeFilePattern(tool.query) ? [] : ['query'];
    case 'list_current_directory':
    case 'quick_health':
    case 'list_home':
    case 'system_snapshot':
      return [];
    case 'read_log':
      return sanitizeAbsolutePath(tool.path) ? [] : ['path'];
    case 'read_file':
      return sanitizeAbsoluteOrHomePath(tool.path) || (sanitizeRelativePath(tool.path) && sanitizeAbsoluteOrHomePath(tool.workingDirectory))
        ? []
        : ['path'];
    default:
      return ['query'];
  }
}

async function detectRemoteOs(panelId: string, session: SessionItem): Promise<RemoteOsProbe> {
  const cacheKey = getRemoteOsCacheKey(panelId, session);
  const cached = remoteOsCache.get(cacheKey);

  if (cached && Date.now() - cached.detectedAt < REMOTE_OS_CACHE_TTL_MS) {
    return cached.probe;
  }

  const inflight = remoteOsInflight.get(cacheKey);

  if (inflight) {
    return inflight;
  }

  const probePromise = probeRemoteOs(panelId, session, cacheKey).finally(() => {
    remoteOsInflight.delete(cacheKey);
  });

  remoteOsInflight.set(cacheKey, probePromise);
  return probePromise;
}

async function probeRemoteOs(panelId: string, session: SessionItem, cacheKey: string): Promise<RemoteOsProbe> {
  try {
    const results = await runReadonlyRemoteCommands(panelId, session, ['uname -s', 'ver']);
    const unixName = results[0]?.stdout.trim().toLowerCase() ?? '';
    const windowsVersion = results[1]?.stdout.trim().toLowerCase() ?? '';

    if (unixName.includes('darwin')) {
      return cacheRemoteOs(cacheKey, { family: 'darwin', label: 'macOS / Darwin' });
    }

    if (unixName.includes('linux')) {
      return cacheRemoteOs(cacheKey, { family: 'linux', label: 'Linux' });
    }

    if (windowsVersion.includes('windows')) {
      return cacheRemoteOs(cacheKey, { family: 'windows', label: 'Windows' });
    }

    return cacheRemoteOs(cacheKey, {
      family: 'unknown',
      label: unixName || windowsVersion || 'Unknown remote OS',
    });
  } catch {
    return cacheRemoteOs(cacheKey, { family: 'linux', label: 'Linux default recipe (OS probe failed)' });
  }
}

function getRemoteOsCacheKey(panelId: string, session: SessionItem) {
  return `${panelId}:${session.username ?? ''}@${session.host}:${session.port ?? 22}`;
}

function cacheRemoteOs(cacheKey: string, probe: RemoteOsProbe) {
  remoteOsCache.set(cacheKey, { detectedAt: Date.now(), probe });
  return probe;
}

function parseToolClassification(output: string): ReadonlyToolIntentParams | undefined {
  const jsonTool = parseJsonToolClassification(output);

  if (jsonTool) {
    return jsonTool;
  }

  const match = output.match(/TOOL:\s*([a-z_]+)\s*\|\s*ARGS:\s*(.*)/i);

  if (!match) {
    return undefined;
  }

  const toolId = match[1].trim().toLowerCase();
  const argsRaw = match[2].trim();
  const arg = argsRaw && argsRaw.toUpperCase() !== 'NONE' ? argsRaw : undefined;

  switch (toolId) {
    case 'analyze_log':
      return { intent: 'analyze_log', path: arg, lines: extractLineCount(arg ?? '') };
    case 'quick_health':
      return { intent: 'quick_health' };
    case 'system_snapshot':
      return { intent: 'system_snapshot' };
    case 'list_home':
      return { intent: 'list_home' };
    case 'list_current_directory':
      return { intent: 'list_current_directory' };
    case 'find_file':
      return { intent: 'find_file', query: arg ?? '' };
    case 'inspect_network':
      return { intent: 'inspect_network', port: extractPortArgument(arg ?? ''), query: arg };
    case 'inspect_process':
      return { intent: 'inspect_process', query: arg ?? '' };
    case 'read_log':
      return { intent: 'read_log', path: arg ?? '' };
    case 'read_file':
      return { intent: 'read_file', path: arg ?? '' };
    case 'inspect_path':
      return { intent: 'inspect_path', path: arg ?? '' };
    default:
      return undefined;
  }
}

function parseJsonToolClassification(output: string): ReadonlyToolIntentParams | undefined {
  const jsonText = extractJsonObject(output);

  if (!jsonText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(jsonText) as ClassifierJsonResponse;
    const intent = typeof parsed.intent === 'string' ? parsed.intent.trim().toLowerCase() : '';
    const params = parsed.params ?? {};

    switch (intent) {
      case 'analyze_log': {
        const path = typeof params.path === 'string' ? params.path : undefined;
        return { intent: 'analyze_log', path, lines: parseLineCountValue(params.lines) };
      }
      case 'quick_health':
        return { intent: 'quick_health' };
      case 'system_snapshot':
        return { intent: 'system_snapshot' };
      case 'list_home':
        return { intent: 'list_home' };
      case 'list_current_directory':
        return { intent: 'list_current_directory' };
      case 'find_file': {
        const query = typeof params.query === 'string' ? params.query : '';
        return { intent: 'find_file', query };
      }
      case 'inspect_network': {
        const query = typeof params.query === 'string' ? params.query : undefined;
        return { intent: 'inspect_network', port: parsePortValue(params.port), query };
      }
      case 'inspect_process': {
        const query = typeof params.query === 'string' ? params.query : '';
        return { intent: 'inspect_process', query };
      }
      case 'read_log': {
        const path = typeof params.path === 'string' ? params.path : '';
        return { intent: 'read_log', path };
      }
      case 'read_file': {
        const path = typeof params.path === 'string' ? params.path : '';
        return { intent: 'read_file', path };
      }
      case 'inspect_path': {
        const path = typeof params.path === 'string' ? params.path : '';
        return { intent: 'inspect_path', path };
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function extractJsonObject(output: string): string | undefined {
  const trimmed = output.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return undefined;
  }

  return trimmed.slice(start, end + 1);
}

function extractPathArgument(prompt: string): string | undefined {
  const match = prompt.match(ABSOLUTE_PATH_PATTERN);
  return match ? match[0] : undefined;
}

function extractPortArgument(value: string): number | undefined {
  const match = value.match(PORT_PATTERN);

  if (!match) {
    return undefined;
  }

  return sanitizePort(Number(match[1]));
}

function extractLineCount(value: string): number | undefined {
  const match = value.match(/(?:last|tail|-n|\uCD5C\uADFC|\uB9C8\uC9C0\uB9C9)\s*(\d{2,5})\b/i);

  if (!match) {
    return undefined;
  }

  return sanitizeLineCount(Number(match[1]));
}

function parseLineCountValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return sanitizeLineCount(value);
  }

  if (typeof value === 'string') {
    return sanitizeLineCount(Number(value.trim()));
  }

  return undefined;
}

function parsePortValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return sanitizePort(value);
  }

  if (typeof value === 'string') {
    return sanitizePort(Number(value.trim()));
  }

  return undefined;
}

function sanitizePort(value?: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    return undefined;
  }

  return value;
}

function sanitizeLineCount(value?: number, fallback?: number) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 20), 1000);
}

function sanitizeAbsolutePath(value?: string) {
  const trimmed = sanitizeToolArgument(value);

  if (!trimmed || !trimmed.startsWith('/')) {
    return '';
  }

  return trimmed;
}

function sanitizeAbsoluteOrHomePath(value?: string) {
  const trimmed = sanitizeToolArgument(value);

  if (!trimmed || (!trimmed.startsWith('/') && !trimmed.startsWith('~/'))) {
    return '';
  }

  return trimmed.replace(/\/+$/g, '') || '/';
}

function sanitizeFilePattern(value?: string) {
  return sanitizeToolArgument(value);
}

function sanitizeToolArgument(value?: string) {
  return (value ?? '').replace(/["'`\\;&|$<>\n\r]/g, '').trim().slice(0, 200);
}

function getCatalogEntry(intent: ReadonlyToolIntent) {
  return TOOL_CATALOG.find((entry) => entry.id === intent);
}

function matchExplicitLogAnalysisIntent(prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  const explicitPath = extractPathArgument(prompt);

  if (!explicitPath || shouldAvoidReadonlyPathFastPath(normalized) || !isLogAnalysisPrompt(prompt)) {
    return undefined;
  }

  return { intent: 'analyze_log', path: explicitPath, lines: extractLineCount(prompt) };
}

function matchExplicitReadFileIntent(prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  const explicitPath = extractPathArgument(prompt);

  if (!explicitPath || shouldAvoidReadonlyPathFastPath(normalized) || !isReadFilePrompt(prompt)) {
    return undefined;
  }

  return { intent: 'read_file', path: explicitPath };
}

function matchExplicitPathInspectionIntent(prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  const explicitPath = extractPathArgument(prompt);

  if (!explicitPath || shouldAvoidReadonlyPathFastPath(normalized)) {
    return undefined;
  }

  return { intent: 'inspect_path', path: explicitPath };
}

function matchProcessIntent(prompt: string): ReadonlyToolIntentParams | undefined {
  const processQuery = extractProcessQuery(prompt);

  if (!processQuery || !isProcessInspectionPrompt(prompt)) {
    return undefined;
  }

  return { intent: 'inspect_process', query: processQuery };
}

function matchNetworkIntent(prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  if (!includesAny(normalized, [
    'port',
    'ports',
    'listen',
    'listening',
    'socket',
    'sockets',
    'network',
    'connection',
    'connections',
    'netstat',
    'ss ',
    '\uD3EC\uD2B8',
    '\uB9AC\uC2A4\uB2DD',
    '\uB124\uD2B8\uC6CC\uD06C',
    '\uC18C\uCF13',
    '\uC811\uC18D',
    '\uC5F0\uACB0',
  ])) {
    return undefined;
  }

  return { intent: 'inspect_network', port: extractPortArgument(prompt), query: extractProcessQuery(prompt) };
}

function matchQuickHealthIntent(_prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  const normalizedLoose = normalizeIntentText(normalized);
  const examples = getCatalogEntry('quick_health')?.examples ?? [];
  const directSignals = [
    'server status',
    'system info',
    'slow',
    'lag',
    'latency',
    'health',
    'resource',
    'memory',
    'disk',
    'cpu',
    'uptime',
    '\uC11C\uBC84\uC0C1\uD0DC',
    '\uC2DC\uC2A4\uD15C',
    '\uC6B4\uC601\uCCB4\uC81C',
    '\uBA54\uBAA8\uB9AC',
    '\uB514\uC2A4\uD06C',
    '\uB9AC\uC18C\uC2A4',
  ];
  const fuzzySignals = [
    '\uB290\uB9AC',
    '\uB290\uB824',
    '\uB290\uB9BC',
    '\uB290\uB9B0',
    '\uBC84\uBC85',
    '\uAD7C\uB370',
  ];

  if (
    includesAny(normalizedLoose, directSignals.map(normalizeIntentText)) ||
    includesAny(normalizedLoose, fuzzySignals.map(normalizeIntentText)) ||
    matchesIntentExamples(normalizedLoose, examples)
  ) {
    return { intent: 'quick_health' };
  }

  return undefined;
}

function matchHomeListingIntent(_prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  if (includesAny(normalized, ['home', '\uD648', 'home \uACBD\uB85C', '\uD648 \uACBD\uB85C'])) {
    return { intent: 'list_home' };
  }

  return undefined;
}

function matchCurrentDirectoryIntent(_prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  if (includesAny(normalized, [
    'current path',
    'current directory',
    '\uD604\uC7AC \uACBD\uB85C',
    '\uD604\uC7AC \uB514\uB809\uD1A0\uB9AC',
    '\uC5EC\uAE30',
    '\uD30C\uC77C \uBB50',
    '\uBAA9\uB85D',
  ])) {
    return { intent: 'list_current_directory' };
  }

  return undefined;
}

function matchRelativeReadFileIntent(
  prompt: string,
  normalized: string,
  context?: ReadonlyToolRoutingContext,
): ReadonlyToolIntentParams | undefined {
  const currentDirectory = sanitizeAbsoluteOrHomePath(context?.currentDirectory);

  if (!currentDirectory || extractPathArgument(prompt) || shouldAvoidReadonlyPathFastPath(normalized) || !isReadFilePrompt(prompt)) {
    return undefined;
  }

  const relativePath = extractRelativeFilePath(prompt);

  if (!relativePath) {
    return undefined;
  }

  return { intent: 'read_file', path: relativePath, workingDirectory: currentDirectory };
}

function isCurrentDirectoryReadFilePrompt(prompt: string, context?: ReadonlyToolRoutingContext) {
  if (context?.currentDirectory || !isReadFilePrompt(prompt)) {
    return false;
  }

  return Boolean(extractRelativeFilePath(prompt) && includesAny(prompt.toLowerCase(), [
    'current path',
    'current directory',
    '\uD604\uC7AC \uACBD\uB85C',
    '\uD604\uC7AC \uB514\uB809\uD1A0\uB9AC',
    '\uC5EC\uAE30',
  ]));
}

function matchFindFileIntent(prompt: string, normalized: string): ReadonlyToolIntentParams | undefined {
  if (!includesAny(normalized, [
    'find',
    'search',
    'locate',
    'exists',
    'where is',
    'directory',
    'folder',
    'file',
    'path',
    '\uCC3E',
    '\uAC80\uC0C9',
    '\uC788\uB294\uC9C0',
    '\uB514\uB809\uD1A0\uB9AC',
    '\uD3F4\uB354',
    '\uD30C\uC77C',
    '\uACBD\uB85C',
  ])) {
    return undefined;
  }

  const query = extractFindQuery(prompt);

  return query ? { intent: 'find_file', query } : undefined;
}

function shouldAvoidReadonlyPathFastPath(normalized: string) {
  return isMutatingPrompt(normalized) && !isReadonlyQuestionPrompt(normalized);
}

function normalizeIntentText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s.,!?'"`~()[\]{}:;_/\\-]+/g, '')
    .replace(/[ㅋㅎㅠㅜ]+/g, '')
    .trim();
}

function matchesIntentExamples(normalizedPrompt: string, examples: string[]) {
  return examples.some((example) => {
    const normalizedExample = normalizeIntentText(example);

    return (
      normalizedExample.length >= 4 &&
      (normalizedPrompt.includes(normalizedExample) ||
        normalizedExample.includes(normalizedPrompt) ||
        levenshteinDistance(normalizedPrompt.slice(0, Math.max(normalizedExample.length, 8)), normalizedExample) <= 2)
    );
  });
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const nextDiagonal = previous[rightIndex];
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + cost,
      );
      diagonal = nextDiagonal;
    }
  }

  return previous[right.length];
}

function includesAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function truncateToolOutput(value: string) {
  if (value.length <= MAX_TOOL_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n\n[ShellPilot truncated ${value.length - MAX_TOOL_OUTPUT_CHARS} characters of read-only tool output.]`;
}

function extractProcessQuery(prompt: string): string | undefined {
  const normalized = prompt.toLowerCase();
  const knownProcessKeywords = [
    'apache',
    'catalina',
    'httpd',
    'java',
    'mariadb',
    'mysql',
    'nginx',
    'node',
    'postgres',
    'redis',
    'tomcat',
    '\uD1B0\uCEA3',
  ];
  const knownProcess = knownProcessKeywords.find((keyword) => normalized.includes(keyword));

  if (knownProcess) {
    return knownProcess;
  }

  const processMatch = normalized.match(/(?:process|service|daemon)\s+([a-z0-9._-]{2,64})/i);

  return processMatch ? processMatch[1] : undefined;
}

function extractFindQuery(prompt: string): string | undefined {
  const trimmed = prompt.trim();
  const quoted = trimmed.match(/["'`]([^"'`]{1,120})["'`]/);

  if (quoted?.[1]) {
    return sanitizeFilePattern(quoted[1]);
  }

  const beforeType = trimmed.match(
    /([^\s"'`]{1,120})\s*(?:directory|folder|file|path|\uB514\uB809\uD1A0\uB9AC|\uD3F4\uB354|\uD30C\uC77C|\uACBD\uB85C)/i,
  );

  if (beforeType?.[1]) {
    return sanitizeFilePattern(beforeType[1]);
  }

  const afterVerb = trimmed.match(
    /(?:find|search|locate|\uCC3E\uC544|\uCC3E|\uAC80\uC0C9)\s+(?:for\s+)?([^\s"'`]{1,120})/i,
  );

  if (afterVerb?.[1]) {
    return sanitizeFilePattern(afterVerb[1]);
  }

  return undefined;
}

function extractRelativeFilePath(prompt: string): string | undefined {
  const trimmed = prompt.trim();
  const quoted = trimmed.match(/["'`]([^"'`]{1,160})["'`]/);
  const candidate = quoted?.[1] ?? trimmed.match(/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/)?.[1];
  const sanitized = sanitizeRelativePath(candidate);

  return sanitized || undefined;
}

function sanitizeRelativePath(value?: string) {
  const sanitized = sanitizeToolArgument(value);

  if (!sanitized || sanitized.startsWith('/') || sanitized.startsWith('~/') || sanitized.includes('..')) {
    return '';
  }

  return sanitized;
}

function formatRemotePathArgument(path: string) {
  return path.startsWith('~/') ? path : `"${path}"`;
}

function formatDisplayedCommand(step: ReadonlyToolStep) {
  return step.workingDirectory ? `(cd ${step.workingDirectory}) ${step.command}` : step.command;
}

function isProcessInspectionPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return includesAny(normalized, [
    'running',
    'process',
    'service',
    'daemon',
    'path',
    'where',
    '\uB5A0\uC788',
    '\uB728\uC788',
    '\uC2E4\uD589',
    '\uD504\uB85C\uC138\uC2A4',
    '\uC11C\uBE44\uC2A4',
    '\uACBD\uB85C',
    '\uC5B4\uB514',
  ]);
}

function isLogAnalysisPrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return includesAny(normalized, [
    'log',
    'logs',
    'error',
    'errors',
    'warn',
    'warning',
    'warnings',
    'fail',
    'failed',
    'failure',
    'exception',
    'traceback',
    'analyze',
    'analyse',
    '\uB85C\uADF8',
    '\uC5D0\uB7EC',
    '\uACBD\uACE0',
    '\uC2E4\uD328',
    '\uBD84\uC11D',
    '\uC608\uC678',
  ]);
}

function isReadFilePrompt(prompt: string) {
  const normalized = prompt.toLowerCase();

  return includesAny(normalized, [
    'content',
    'contents',
    'read',
    'show',
    'cat',
    'view',
    '\uB0B4\uC6A9',
    '\uC77D\uC5B4',
    '\uBCF4\uC5EC',
    '\uCD9C\uB825',
  ]);
}

function isMutatingPrompt(normalized: string) {
  return includesAny(normalized, [
    'append',
    'backup',
    'chmod',
    'chown',
    'copy',
    'create',
    'delete',
    'disable',
    'enable',
    'export',
    'mkdir',
    'move',
    'overwrite',
    'remove',
    'rename',
    'restart',
    'save',
    'start',
    'stop',
    'systemctl',
    'tee',
    'touch',
    'write',
    '\uB0B4\uBCF4\uB0B4',
    '\uC0DD\uC131',
    '\uC0AD\uC81C',
    '\uC800\uC7A5',
    '\uBCF5\uC0AC',
    '\uC774\uB3D9',
    '\uC774\uB984\uBCC0\uACBD',
    '\uB36E\uC5B4',
    '\uC2DC\uC791',
    '\uC911\uC9C0',
    '\uC7AC\uC2DC\uC791',
    '\uAD8C\uD55C',
  ]);
}

function isReadonlyQuestionPrompt(normalized: string) {
  return includesAny(normalized, [
    'check',
    'describe',
    'exists',
    'find',
    'inspect',
    'list',
    'lookup',
    'read',
    'search',
    'show',
    'tell',
    'view',
    'what',
    'when',
    'where',
    '\uAC80\uC0AC',
    '\uAC80\uC0C9',
    '\uB098\uC640',
    '\uB0B4\uC6A9',
    '\uC77D\uC5B4',
    '\uBAA9\uB85D',
    '\uBCF4\uC5EC',
    '\uC54C\uB824',
    '\uC5B8\uC81C',
    '\uC5B4\uB514',
    '\uC788\uB294\uC9C0',
    '\uC870\uD68C',
    '\uCC3E\uC544',
    '\uD655\uC778',
    '\uBB50',
    '\uBB34\uC5C7',
  ]);
}

function inferMutatingActionLabel(normalized: string) {
  if (includesAny(normalized, ['delete', 'remove', '\uC0AD\uC81C'])) {
    return 'Delete remote files or data';
  }

  if (includesAny(normalized, ['copy', 'move', 'rename', '\uBCF5\uC0AC', '\uC774\uB3D9', '\uC774\uB984\uBCC0\uACBD'])) {
    return 'Copy, move, or rename remote files';
  }

  if (includesAny(normalized, ['chmod', 'chown', '\uAD8C\uD55C'])) {
    return 'Change remote file ownership or permissions';
  }

  if (includesAny(normalized, ['systemctl', 'restart', 'start', 'stop', 'enable', 'disable', '\uC7AC\uC2DC\uC791', '\uC2DC\uC791', '\uC911\uC9C0'])) {
    return 'Change a remote service state';
  }

  if (includesAny(normalized, ['export', 'save', 'write', 'tee', 'touch', 'create', 'append', '\uB0B4\uBCF4\uB0B4', '\uC800\uC7A5', '\uC0DD\uC131'])) {
    return 'Write or create a remote file';
  }

  return 'Mutate the remote system';
}
