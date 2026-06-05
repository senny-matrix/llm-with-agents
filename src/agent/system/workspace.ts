import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve } from 'node:path';

interface WorkspaceContext {
  cwd: string;
  hostname: string;
  user: string;
  os: string;
  shell: string;
  nodeVersion: string;
  gitBranch: string;
  gitRoot: string;
  gitStatus: string;
  projectFiles: string;
  agentFiles: string[];
}

function exec(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function gatherWorkspaceContext(): WorkspaceContext {
  const cwd = process.cwd();

  const gitRoot = exec('git rev-parse --show-toplevel', cwd) || cwd;
  const gitBranch = exec('git branch --show-current', cwd) || 'unknown';
  const gitStatus = exec('git status --short', cwd).slice(0, 2000) || 'clean';

  // List project files (top 2 levels, excluding node_modules, dist, .git)
  let projectFiles = '';
  try {
    projectFiles = execSync(
      'find . -maxdepth 2 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.idea/*" -not -path "*/.*" | head -80',
      { encoding: 'utf8', cwd, timeout: 3000 }
    ).trim();
  } catch {
    projectFiles = '';
  }

  // Check for project-level instruction files
  const agentFiles: string[] = [];
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules', 'CONTRIBUTING.md', 'README.md']) {
    const fp = resolve(cwd, f);
    if (existsSync(fp)) {
      agentFiles.push(f);
    }
  }

  return {
    cwd,
    hostname: hostname(),
    user: process.env.USER || process.env.USERNAME || 'unknown',
    os: `${process.platform} ${process.arch}`,
    shell: process.env.SHELL || process.env.COMSPEC || 'unknown',
    nodeVersion: process.version,
    gitBranch,
    gitRoot,
    gitStatus,
    projectFiles,
    agentFiles,
  };
}

export function buildSystemPrompt(basePrompt: string, ctx: WorkspaceContext): string {
  const sections: string[] = [basePrompt];

  // Workspace section
  sections.push(`
<workspace_context>
You are working in the following environment:
- Current directory: ${ctx.cwd}
- Host: ${ctx.hostname} (user: ${ctx.user})
- OS: ${ctx.os}
- Shell: ${ctx.shell}
- Node.js: ${ctx.nodeVersion}
- Git branch: ${ctx.gitBranch}
- Git root: ${ctx.gitRoot}
- Git status:
${ctx.gitStatus || '  (clean)'}
</workspace_context>`);

  // Project structure section
  if (ctx.projectFiles) {
    sections.push(`
<project_structure>
Key project files (top 2 levels):
${ctx.projectFiles}
</project_structure>`);
  }

  // Agent instruction files
  for (const f of ctx.agentFiles) {
    const fp = resolve(ctx.cwd, f);
    try {
      const content = readFileSync(fp, 'utf8');
      const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n... (truncated)' : content;
      sections.push(`
<project_instructions path="${fp}">
${truncated}
</project_instructions>`);
    } catch {
      // skip
    }
  }

  sections.push(`
<guidelines>
- You are an expert coding assistant operating inside an AI agent harness.
- Available tools: readFile (with offset/limit), writeFile, editFile, listFiles, deleteFile, grep, runCommand, executeCode, webSearch, dateTime, imageInfo, imageToBase64, plus any MCP tools (prefixed with server name).
- For file editing, use editFile with exact text replacement. Keep oldText minimal but unique.
- For reading large files, use readFile with offset/limit parameters.
- For searching code, use grep with regex patterns.
- Run shell commands with runCommand. Commands time out after 30 seconds.
- Use executeCode (JavaScript/TypeScript/Python) for computation or multi-line scripts. No shell escaping needed.
- For images: use imageInfo to check format/size first, then imageToBase64 to encode for analysis.
- Be concise. Use file paths clearly. Verify changes when possible.
- The user is a developer using you as a co-pilot inside their editor.
</guidelines>`);

  return sections.join('\n');
}
