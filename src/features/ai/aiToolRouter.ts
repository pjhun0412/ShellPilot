import type { SessionItem } from '@/types/workspace';
import { runAiPrompt, runReadonlyRemoteCommand } from './aiBridge';

export interface ReadonlyToolStep {
  command: string;
  name: string;
}

export interface ReadonlyToolPlan {
  name: string;
  steps: ReadonlyToolStep[];
}

export interface ReadonlyToolResult {
  context: string;
  failed: boolean;
}

type ToolId =
  | 'find_file'
  | 'inspect_path'
  | 'list_current_directory'
  | 'list_home'
  | 'read_log'
  | 'system_snapshot';

interface ToolCatalogEntry {
  argHint?: string;
  description: string;
  id: ToolId;
  needsArg: boolean;
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
  const explicitPath = extractPathArgument(prompt);

  if (explicitPath) {
    return buildToolPlan('inspect_path', explicitPath);
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
    return buildToolPlan('system_snapshot');
  }

  if (includesAny(normalized, [
    'home',
    '\uD648',
    'home \uACBD\uB85C',
    '\uD648 \uACBD\uB85C',
  ])) {
    return buildToolPlan('list_home');
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
    return buildToolPlan('list_current_directory');
  }

  return undefined;
}

export async function classifyToolPlan(prompt: string, providerId: string): Promise<ReadonlyToolPlan | undefined> {
  const catalogText = TOOL_CATALOG.map(
    (tool) => `- ${tool.id}${tool.needsArg ? ` (${tool.argHint})` : ''}: ${tool.description}`,
  ).join('\n');
  const classifierPrompt = [
    'You are a routing classifier for ShellPilot.',
    'Choose at most one tool. Do not invent tools or shell commands.',
    'Respond with EXACTLY one line and nothing else, in this exact format:',
    'TOOL: <tool_id> | ARGS: <argument or NONE>',
    '',
    'Available tools:',
    catalogText,
    '- none: no remote tool is needed to answer this question',
    '',
    `User question: "${prompt}"`,
  ].join('\n');

  try {
    const response = await runAiPrompt({ prompt: classifierPrompt, providerId });

    return parseToolClassification(response.output);
  } catch {
    return undefined;
  }
}

export async function collectReadonlyToolContext(panelId: string, session: SessionItem, plan: ReadonlyToolPlan): Promise<ReadonlyToolResult> {
  const chunks: string[] = [`Remote read-only tool plan: ${plan.name}`];
  let failed = false;

  for (const step of plan.steps) {
    try {
      const result = await runReadonlyRemoteCommand(panelId, session, step.command);

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
  };
}

function buildToolPlan(toolId: string, rawArg?: string): ReadonlyToolPlan | undefined {
  switch (toolId) {
    case 'system_snapshot':
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
    case 'list_home':
      return {
        name: 'list_home',
        steps: [{ command: 'ls -lah ~', name: 'home_listing' }],
      };
    case 'list_current_directory':
      return {
        name: 'list_current_directory',
        steps: [{ command: 'ls -lah .', name: 'current_directory_listing' }],
      };
    case 'find_file': {
      const name = sanitizeFilePattern(rawArg);

      if (!name) {
        return undefined;
      }

      return {
        name: 'find_file',
        steps: [{ command: `find ~ -maxdepth 6 -iname "*${name}*"`, name: 'find_file' }],
      };
    }
    case 'read_log': {
      const path = sanitizeAbsolutePath(rawArg);

      if (!path) {
        return undefined;
      }

      return {
        name: 'read_log',
        steps: [{ command: `tail -n 200 -- "${path}"`, name: 'read_log' }],
      };
    }
    case 'inspect_path': {
      const path = sanitizeAbsolutePath(rawArg);

      if (!path) {
        return undefined;
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

function parseToolClassification(output: string): ReadonlyToolPlan | undefined {
  const match = output.match(/TOOL:\s*([a-z_]+)\s*\|\s*ARGS:\s*(.*)/i);

  if (!match) {
    return undefined;
  }

  const toolId = match[1].trim().toLowerCase();
  const argsRaw = match[2].trim();
  const arg = argsRaw && argsRaw.toUpperCase() !== 'NONE' ? argsRaw : undefined;

  return buildToolPlan(toolId, arg);
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
