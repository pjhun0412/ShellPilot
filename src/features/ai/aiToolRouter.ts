import type { SessionItem } from '@/types/workspace';
import { runAiPrompt, runReadonlyRemoteCommand } from './aiBridge';

export interface ReadonlyToolStep {
  command: string;
  name: string;
}

export interface ReadonlyToolPlan {
  intent: ReadonlyToolIntent;
  name: string;
  steps: ReadonlyToolStep[];
}

export interface ReadonlyToolResult {
  context: string;
  failed: boolean;
  planName: string;
  records: ReadonlyToolExecutionRecord[];
}

type ReadonlyToolIntent =
  | 'find_file'
  | 'inspect_path'
  | 'list_current_directory'
  | 'list_home'
  | 'read_log'
  | 'system_snapshot';

type ReadonlyToolIntentParams =
  | { intent: 'find_file'; query: string }
  | { intent: 'inspect_path'; path: string }
  | { intent: 'list_current_directory' }
  | { intent: 'list_home' }
  | { intent: 'read_log'; path: string }
  | { intent: 'system_snapshot' };

interface ClassifiedToolIntent {
  source: 'classifier' | 'fast-path';
  tool: ReadonlyToolIntentParams;
}

interface ClassifierJsonResponse {
  intent?: string;
  params?: {
    path?: unknown;
    query?: unknown;
  };
}

interface ToolCatalogEntry {
  argHint?: string;
  description: string;
  id: ReadonlyToolIntent;
  needsArg: boolean;
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

const TOOL_CATALOG: ToolCatalogEntry[] = [
  { id: 'system_snapshot', description: 'General system info: memory, disk, CPU, uptime, OS, top processes', needsArg: false },
  { id: 'list_home', description: 'List files in the home directory', needsArg: false },
  { id: 'list_current_directory', description: 'List files in the current working directory', needsArg: false },
  { id: 'find_file', description: 'Search the home directory for a file by name or pattern', needsArg: true, argHint: 'filename or pattern to search for' },
  { id: 'read_log', description: 'Read the last lines of a log file at an absolute path', needsArg: true, argHint: 'absolute file path' },
  { id: 'inspect_path', description: 'Inspect a specific absolute path: stat it, list it if it is a directory, tail it if it is a file', needsArg: true, argHint: 'absolute path to a file or directory' },
];

const ABSOLUTE_PATH_PATTERN = /\/[\w.-]+(?:\/[\w.-]+)+\/?/;

export function createReadonlyToolPlan(prompt: string): ReadonlyToolPlan | undefined {
  const classified = createFastPathToolIntent(prompt);

  return classified ? buildToolPlan(classified.tool) : undefined;
}

function createFastPathToolIntent(prompt: string): ClassifiedToolIntent | undefined {
  const explicitPath = extractPathArgument(prompt);

  if (explicitPath) {
    return {
      source: 'fast-path',
      tool: { intent: 'inspect_path', path: explicitPath },
    };
  }

  const normalized = prompt.toLowerCase();

  if (includesAny(normalized, [
    'server status',
    'system info',
    'slow',
    'lag',
    'os',
    'memory',
    'disk',
    'cpu',
    'uptime',
    'process',
    'resource',
    '\uC11C\uBC84 \uC0C1\uD0DC',
    '\uB290\uB9BC',
    '\uB290\uB824',
    '\uC2DC\uC2A4\uD15C',
    '\uC6B4\uC601\uCCB4\uC81C',
    '\uBA54\uBAA8\uB9AC',
    '\uB514\uC2A4\uD06C',
    '\uD504\uB85C\uC138\uC2A4',
    '\uB9AC\uC18C\uC2A4',
  ])) {
    return {
      source: 'fast-path',
      tool: { intent: 'system_snapshot' },
    };
  }

  if (includesAny(normalized, [
    'home',
    '\uD648',
    'home \uACBD\uB85C',
    '\uD648 \uACBD\uB85C',
  ])) {
    return {
      source: 'fast-path',
      tool: { intent: 'list_home' },
    };
  }

  if (includesAny(normalized, [
    'current path',
    'current directory',
    '\uD604\uC7AC \uACBD\uB85C',
    '\uD604\uC7AC \uB514\uB809\uD1A0\uB9AC',
    '\uC5EC\uAE30',
    '\uD30C\uC77C \uBB50',
    '\uBAA9\uB85D',
  ])) {
    return {
      source: 'fast-path',
      tool: { intent: 'list_current_directory' },
    };
  }

  return undefined;
}

export async function classifyToolPlan(prompt: string, providerId: string): Promise<ReadonlyToolPlan | undefined> {
  const classified = await classifyToolIntent(prompt, providerId);

  return classified ? buildToolPlan(classified.tool) : undefined;
}

async function classifyToolIntent(prompt: string, providerId: string): Promise<ClassifiedToolIntent | undefined> {
  const catalogText = TOOL_CATALOG.map(
    (tool) => `- ${tool.id}${tool.needsArg ? ` (${tool.argHint})` : ''}: ${tool.description}`,
  ).join('\n');
  const classifierPrompt = [
    'You are a routing classifier for ShellPilot.',
    'Choose at most one read-only intent. Do not invent tools, shell commands, or execution plans.',
    'Respond with compact JSON only. Do not include Markdown, prose, or code fences.',
    'Schema:',
    '{"intent":"<intent_id>","params":{}}',
    'Use {"intent":"none","params":{}} when no remote tool is needed.',
    'For find_file use params.query. For read_log and inspect_path use params.path.',
    '',
    'Available intents:',
    catalogText,
    '- none: no remote tool is needed to answer this question',
    '',
    `User question: "${prompt}"`,
  ].join('\n');

  try {
    const response = await runAiPrompt({ prompt: classifierPrompt, providerId });

    const tool = parseToolClassification(response.output);

    return tool ? { source: 'classifier', tool } : undefined;
  } catch {
    return undefined;
  }
}

export async function collectReadonlyToolContext(panelId: string, session: SessionItem, plan: ReadonlyToolPlan): Promise<ReadonlyToolResult> {
  const chunks: string[] = [`Remote read-only tool plan: ${plan.name}`];
  const records: ReadonlyToolExecutionRecord[] = [];
  let failed = false;

  for (const step of plan.steps) {
    try {
      const result = await runReadonlyRemoteCommand(panelId, session, step.command);
      records.push({
        command: step.command,
        exitCode: result.exitCode,
        name: step.name,
        status: 'success',
        stderr: result.stderr,
        stdout: result.stdout,
      });

      chunks.push(
        [
          `## ${step.name}`,
          `Command: ${step.command}`,
          `Exit code: ${result.exitCode ?? 'unknown'}`,
          result.stdout ? `STDOUT:\n${result.stdout}` : undefined,
          result.stderr ? `STDERR:\n${result.stderr}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (error) {
      failed = true;
      records.push({
        command: step.command,
        error: error instanceof Error ? error.message : String(error),
        name: step.name,
        status: 'failed',
        stderr: '',
        stdout: '',
      });
      chunks.push(
        [
          `## ${step.name}`,
          `Command: ${step.command}`,
          'Tool status: failed',
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ].join('\n'),
      );
    }
  }

  if (failed) {
    chunks.push('Some read-only tools failed. Do not pretend failed tool output exists.');
  }

  return {
    context: chunks.join('\n\n'),
    failed,
    planName: plan.name,
    records,
  };
}

function buildToolPlan(tool: ReadonlyToolIntentParams): ReadonlyToolPlan | undefined {
  switch (tool.intent) {
    case 'system_snapshot':
      return {
        intent: tool.intent,
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
    case 'list_home':
      return {
        intent: tool.intent,
        name: 'list_home',
        steps: [{ command: 'ls -lah ~', name: 'home_listing' }],
      };
    case 'list_current_directory':
      return {
        intent: tool.intent,
        name: 'list_current_directory',
        steps: [{ command: 'ls -lah .', name: 'current_directory_listing' }],
      };
    case 'find_file': {
      const name = sanitizeFilePattern(tool.query);

      if (!name) {
        return undefined;
      }

      return {
        intent: tool.intent,
        name: 'find_file',
        steps: [{ command: `find ~ -maxdepth 6 -iname "*${name}*"`, name: 'find_file' }],
      };
    }
    case 'read_log': {
      const path = sanitizeAbsolutePath(tool.path);

      if (!path) {
        return undefined;
      }

      return {
        intent: tool.intent,
        name: 'read_log',
        steps: [{ command: `tail -n 200 -- "${path}"`, name: 'read_log' }],
      };
    }
    case 'inspect_path': {
      const path = sanitizeAbsolutePath(tool.path);

      if (!path) {
        return undefined;
      }

      return {
        intent: tool.intent,
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
    case 'system_snapshot':
      return { intent: 'system_snapshot' };
    case 'list_home':
      return { intent: 'list_home' };
    case 'list_current_directory':
      return { intent: 'list_current_directory' };
    case 'find_file':
      return arg ? { intent: 'find_file', query: arg } : undefined;
    case 'read_log':
      return arg ? { intent: 'read_log', path: arg } : undefined;
    case 'inspect_path':
      return arg ? { intent: 'inspect_path', path: arg } : undefined;
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
      case 'system_snapshot':
        return { intent: 'system_snapshot' };
      case 'list_home':
        return { intent: 'list_home' };
      case 'list_current_directory':
        return { intent: 'list_current_directory' };
      case 'find_file': {
        const query = typeof params.query === 'string' ? params.query : '';
        return query ? { intent: 'find_file', query } : undefined;
      }
      case 'read_log': {
        const path = typeof params.path === 'string' ? params.path : '';
        return path ? { intent: 'read_log', path } : undefined;
      }
      case 'inspect_path': {
        const path = typeof params.path === 'string' ? params.path : '';
        return path ? { intent: 'inspect_path', path } : undefined;
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

function sanitizeAbsolutePath(value?: string) {
  const trimmed = sanitizeToolArgument(value);

  if (!trimmed || !trimmed.startsWith('/')) {
    return '';
  }

  return trimmed;
}

function sanitizeFilePattern(value?: string) {
  return sanitizeToolArgument(value);
}

function sanitizeToolArgument(value?: string) {
  return (value ?? '').replace(/["'`\\;&|$<>\n\r]/g, '').trim().slice(0, 200);
}

function includesAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}
