import React from "react";
import { Box, Text } from "ink";

interface MarkdownProps {
  children: string;
}

/**
 * Simple Markdown-to-ANSI renderer for Ink TUI.
 * Handles: headings, bold, italic, code blocks, inline code, lists, blockquotes, tables.
 */
export function Markdown({ children: raw }: MarkdownProps) {
  const lines = raw.split("\n");
  const elements: React.ReactElement[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";
  let inTable = false;
  let tableLines: string[] = [];

  /** Flush accumulated table lines into a rendered table element */
  const flushTable = (key: string) => {
    if (tableLines.length < 2) {
      // Not enough rows for a table — render as plain text
      for (const tl of tableLines) {
        elements.push(<Box key={`${key}-t`}><Text>{renderInline(tl)}</Text></Box>);
      }
      tableLines = [];
      return;
    }
    elements.push(renderTable(tableLines, key));
    tableLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trim().startsWith("```")) {
      if (inTable) flushTable(`tbl-${i}`);
      inTable = false;
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        // End code block
        inCodeBlock = false;
        const lang = codeBlockLang || "text";
        elements.push(
          <Box key={`cb-${i}`} flexDirection="column" marginLeft={1} marginY={1}>
            <Box paddingLeft={1} paddingRight={1}>
              <Text dimColor>
                ┌── {lang} ──
              </Text>
            </Box>
            {codeBlockLines.map((cl, ci) => (
              <Box key={ci} paddingLeft={1} paddingRight={1}>
                <Text color="cyan" dimColor>
                  │{" "}
                </Text>
                <HighlightedCode code={cl} language={lang} />
              </Box>
            ))}
            <Box paddingLeft={1} paddingRight={1}>
              <Text dimColor>└──</Text>
            </Box>
          </Box>,
        );
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Table detection: a line that starts and ends with |
    const isTableRow = /^\s*\|.*\|\s*$/.test(line) && !line.startsWith(">");
    if (isTableRow) {
      if (!inTable) inTable = true;
      tableLines.push(line);
      continue;
    }

    // Non-table line — flush any accumulated table
    if (inTable) {
      flushTable(`tbl-${i}`);
      inTable = false;
    }

    // Skip empty lines between blocks (but keep a spacer)
    if (line.trim() === "") {
      elements.push(<Box key={`sp-${i}`} height={1} />);
      continue;
    }

    // Headings
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^(#{1,6})/)![1].length;
      const text = line.replace(/^#{1,6}\s+/, "");
      const headingColors: Record<number, string> = {
        1: "magentaBright",
        2: "yellow",
        3: "cyan",
        4: "green",
        5: "blue",
        6: "gray",
      };
      const color = headingColors[level] || "white";
      elements.push(
        <Box key={`h-${i}`} marginTop={level <= 2 ? 1 : 0}>
          <Text bold color={color}>
            {level <= 2 ? "" : ""}
            {renderInline(text)}
          </Text>
          {level <= 2 && (
            <Text dimColor>{" "}{"─".repeat(Math.max(0, 40 - text.length))}</Text>
          )}
        </Box>,
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const text = line.slice(2);
      elements.push(
        <Box key={`bq-${i}`} marginLeft={1}>
          <Text color="gray">│ </Text>
          <Text dimColor>{renderInline(text)}</Text>
        </Box>,
      );
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)![1].length;
      const text = line.replace(/^[\s]*[-*+]\s+/, "");
      elements.push(
        <Box key={`ul-${i}`} marginLeft={2 + indent}>
          <Text color="yellow">• </Text>
          <Text>{renderInline(text)}</Text>
        </Box>,
      );
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+\.\s/.test(line)) {
      const indent = line.match(/^(\s*)/)![1].length;
      const num = line.match(/^[\s]*(\d+)\./)![1];
      const text = line.replace(/^[\s]*\d+\.\s+/, "");
      elements.push(
        <Box key={`ol-${i}`} marginLeft={2 + indent}>
          <Text color="yellow">{num}. </Text>
          <Text>{renderInline(text)}</Text>
        </Box>,
      );
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      elements.push(
        <Box key={`hr-${i}`}>
          <Text dimColor>{"─".repeat(40)}</Text>
        </Box>,
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <Box key={`p-${i}`}>
        <Text>{renderInline(line)}</Text>
      </Box>,
    );
  }

  // Handle unclosed code block at end
  if (inCodeBlock && codeBlockLines.length > 0) {
    const lang = codeBlockLang || "text";
    elements.push(
      <Box key="cb-open" flexDirection="column" marginLeft={1} marginY={1}>
        <Box paddingLeft={1} paddingRight={1}>
          <Text dimColor>┌── {lang} ──</Text>
        </Box>
        {codeBlockLines.map((cl, ci) => (
          <Box key={ci} paddingLeft={1} paddingRight={1}>
            <Text color="cyan" dimColor>│ </Text>
            <HighlightedCode code={cl} language={lang} />
          </Box>
        ))}
      </Box>,
    );
  }

  // Handle unflushed table at end
  if (inTable && tableLines.length > 0) {
    flushTable("tbl-end");
  }

  return <Box flexDirection="column">{elements}</Box>;
}

// ---------------------------------------------------------------------------
// Syntax highlighting — tokenizes and colors code for common languages
// ---------------------------------------------------------------------------

interface Token {
  text: string;
  color: string;
  bold?: boolean;
  dimColor?: boolean;
}

/** Shared keyword sets */
const JS_KEYWORDS = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "import", "in", "instanceof", "let",
  "new", "null", "of", "return", "super", "switch", "this", "throw", "true",
  "try", "typeof", "undefined", "var", "void", "while", "with", "yield",
  "async", "static", "private", "public", "protected", "readonly", "abstract",
  "implements", "interface", "type", "namespace", "declare", "keyof", "as",
  "from", "get", "set", "module", "require",
]);

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

const SH_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until",
  "do", "done", "in", "function", "select", "time", "coproc", "return", "exit",
  "break", "continue", "export", "local", "readonly", "unset", "declare",
  "typeset", "eval", "exec", "source", "trap", "alias", "unalias",
]);

const DIFF_HEAD = "cyanBright";
const DIFF_ADD = "green";
const DIFF_DEL = "red";
const DIFF_INFO = "yellow";

/** Map language name to highlighting function */
function getHighlighter(
  lang: string,
): (code: string) => Token[] {
  const l = lang.toLowerCase();
  if (l === "js" || l === "javascript" || l === "mjs" || l === "cjs") return highlightJS;
  if (l === "ts" || l === "typescript" || l === "tsx") return highlightJS;
  if (l === "py" || l === "python" || l === "python3") return highlightPython;
  if (l === "sh" || l === "bash" || l === "shell" || l === "zsh") return highlightShell;
  if (l === "json") return highlightJSON;
  if (l === "diff" || l === "patch") return highlightDiff;
  if (l === "sql") return highlightSQL;
  return highlightGeneric;
}

/** Tokenize a line by regex, capturing groups alternate with plain text */
function tokenizeLine(
  line: string,
  patterns: Array<{ re: RegExp; color: string; bold?: boolean; dim?: boolean }>,
): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < line.length) {
    let earliest: { idx: number; p: (typeof patterns)[0] } | null = null;
    for (const p of patterns) {
      p.re.lastIndex = pos;
      const m = p.re.exec(line);
      if (m && (earliest === null || m.index < earliest.idx)) {
        earliest = { idx: m.index, p };
      }
    }
    if (earliest && earliest.idx >= pos) {
      if (earliest.idx > pos) {
        tokens.push({ text: line.slice(pos, earliest.idx), color: "white" });
      }
      earliest.p.re.lastIndex = pos;
      const m = earliest.p.re.exec(line)!;
      tokens.push({
        text: m[0],
        color: earliest.p.color,
        bold: earliest.p.bold,
        dimColor: earliest.p.dim,
      });
      pos = earliest.p.re.lastIndex;
    } else {
      tokens.push({ text: line.slice(pos), color: "white" });
      break;
    }
  }
  return tokens;
}

// ---- JavaScript / TypeScript ----
function highlightJS(code: string): Token[] {
  return tokenizeLine(code, [
    // Single-line comment
    { re: /\/\/.*$/, color: "gray", dim: true },
    // Block comment (single line)
    { re: /\/\*.*?\*\//, color: "gray", dim: true },
    // String (double-quoted)
    { re: /"(?:[^"\\]|\\.)*"/, color: "green" },
    // String (single-quoted)
    { re: /'(?:[^'\\]|\\.)*'/, color: "green" },
    // Template literal
    { re: /`(?:[^`\\]|\\.)*`/, color: "green" },
    // Regex literal
    { re: /\/(?:[^\/\\]|\\.)+\/[gimsuy]*/, color: "yellow" },
    // Number
    { re: /\b\d+\.?\d*(?:[eE][+-]?\d+)?n?\b/, color: "yellow" },
    // Keyword / boolean / null
    { re: /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g, color: "white" },
  ]).map(t => {
    if (t.color === "white" && JS_KEYWORDS.has(t.text)) {
      return { ...t, color: "blue", bold: true };
    }
    return t;
  });
}

// ---- Python ----
function highlightPython(code: string): Token[] {
  return tokenizeLine(code, [
    // Comment
    { re: /#.*$/, color: "gray", dim: true },
    // f-string
    { re: /f"(?:[^"\\]|\\.)*"/, color: "green" },
    { re: /f'(?:[^'\\]|\\.)*'/, color: "green" },
    // Triple-quoted string
    { re: /""".*?"""/, color: "green" },
    { re: /'''.*?'''/, color: "green" },
    // Regular string
    { re: /"(?:[^"\\]|\\.)*"/, color: "green" },
    { re: /'(?:[^'\\]|\\.)*'/, color: "green" },
    // Number
    { re: /\b\d+\.?\d*(?:[eE][+-]?\d+)?j?\b/, color: "yellow" },
    // Decorator
    { re: /@[a-zA-Z_][a-zA-Z0-9_.]*/, color: "magenta" },
    // Identifier
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, color: "white" },
  ]).map(t => {
    if (t.color === "white" && PY_KEYWORDS.has(t.text)) {
      return { ...t, color: "blue", bold: true };
    }
    return t;
  });
}

// ---- Shell / Bash ----
function highlightShell(code: string): Token[] {
  return tokenizeLine(code, [
    // Comment
    { re: /#.*$/, color: "gray", dim: true },
    // Double-quoted string
    { re: /"(?:[^"\\]|\\.)*"/, color: "green" },
    // Single-quoted string
    { re: /'(?:[^'\\]|\\.)*'/, color: "green" },
    // Variable
    { re: /\$\{[^}]+\}/, color: "yellow" },
    { re: /\$[a-zA-Z_][a-zA-Z0-9_]*/, color: "yellow" },
    // Option flag
    { re: /--?[a-zA-Z][a-zA-Z0-9_-]*/, color: "yellow", dim: true },
    // Number
    { re: /\b\d+\b/, color: "yellow" },
    // Identifier (potential keyword)
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, color: "white" },
  ]).map(t => {
    if (t.color === "white" && SH_KEYWORDS.has(t.text)) {
      return { ...t, color: "blue", bold: true };
    }
    return t;
  });
}

// ---- JSON ----
function highlightJSON(code: string): Token[] {
  // Compact JSON to one line for snippet display, but keep original spacing
  return tokenizeLine(code, [
    // String key/value
    { re: /"(?:[^"\\]|\\.)*"/, color: "green" },
    // Number
    { re: /-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/, color: "yellow" },
    // Boolean / null
    { re: /\b(?:true|false|null)\b/, color: "blue", bold: true },
  ]);
}

// ---- Diff ----
function highlightDiff(code: string): Token[] {
  if (code.startsWith("+")) return [{ text: code, color: DIFF_ADD }];
  if (code.startsWith("-")) return [{ text: code, color: DIFF_DEL }];
  if (code.startsWith("@@")) return [{ text: code, color: DIFF_INFO }];
  if (code.startsWith("diff ") || code.startsWith("index ") || code.startsWith("---") || code.startsWith("+++")) {
    return [{ text: code, color: DIFF_HEAD, bold: true }];
  }
  return [{ text: code, color: "white" }];
}

// ---- SQL ----
function highlightSQL(code: string): Token[] {
  const SQL_KEYWORDS = new Set([
    "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP",
    "ALTER", "TABLE", "INTO", "VALUES", "SET", "JOIN", "LEFT", "RIGHT", "INNER",
    "OUTER", "ON", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE", "BETWEEN",
    "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "AS", "DISTINCT",
    "COUNT", "SUM", "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN", "ELSE", "END",
    "UNION", "ALL", "EXISTS", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "INDEX",
    "CONSTRAINT", "DEFAULT", "CHECK", "UNIQUE", "CASCADE", "TRANSACTION",
    "COMMIT", "ROLLBACK", "BEGIN", "ASC", "DESC", "NULLS", "FIRST", "LAST",
    "WITH", "RECURSIVE", "RETURNING", "IF", "EXISTS", "TEMP", "TEMPORARY",
    "TRUNCATE", "VIEW", "FUNCTION", "PROCEDURE", "TRIGGER", "SCHEMA", "DATABASE",
  ]);
  return tokenizeLine(code, [
    { re: /--.*$/, color: "gray", dim: true },
    { re: /'(?:[^'\\]|\\.)*'/, color: "green" },
    { re: /\b\d+\.?\d*\b/, color: "yellow" },
    { re: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, color: "white" },
  ]).map(t => {
    if (t.color === "white" && SQL_KEYWORDS.has(t.text.toUpperCase())) {
      return { ...t, color: "blue", bold: true };
    }
    return t;
  });
}

// ---- Generic fallback — no coloring, but preserve as plain text ----
function highlightGeneric(code: string): Token[] {
  return [{ text: code, color: "white" }];
}

/** Renders a single line of code with syntax highlighting */
function HighlightedCode({ code, language }: { code: string; language: string }) {
  const highlighter = getHighlighter(language);
  const tokens = highlighter(code);
  return (
    <React.Fragment>
      {tokens.map((t, i) => (
        <Text key={i} color={t.color} bold={t.bold} dimColor={t.dimColor}>
          {t.text}
        </Text>
      ))}
    </React.Fragment>
  );
}

/**
 * Render a markdown table from raw pipe-delimited lines.
 * Detects headers, alignments, and renders with box-drawing borders.
 */
function renderTable(rawLines: string[], key: string): React.ReactElement {
  // Parse rows into cell arrays, trimming whitespace and stripping outer pipes
  const rows = rawLines
    .map(line => {
      let trimmed = line.trim();
      if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
      if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
      return trimmed.split("|").map(c => c.trim());
    })
    .filter(r => r.length > 0);

  if (rows.length === 0) return <Box key={key}><Text>{rawLines[0]}</Text></Box>;

  // First row = headers, second row = alignment (if it looks like |---|:---| etc.)
  let headerRow: string[];
  let dataStartIdx: number;
  let alignments: ("left" | "right" | "center")[];

  if (rows.length >= 2 && /^[-:]+$/.test(rows[1].join("").replace(/\s/g, ""))) {
    headerRow = rows[0];
    dataStartIdx = 2;
    alignments = rows[1].map(cell => {
      const starts = cell.startsWith(":");
      const ends = cell.endsWith(":");
      if (starts && ends) return "center";
      if (ends) return "right";
      return "left";
    });
  } else {
    // No alignment row — treat first row as header anyway
    headerRow = rows[0];
    dataStartIdx = 1;
    alignments = headerRow.map(() => "left" as const);
  }

  const dataRows = rows.slice(dataStartIdx);
  const colCount = headerRow.length;

  // Calculate column widths (min 3, max 30)
  const MAX_COL_WIDTH = 30;
  const widths = Array.from({ length: colCount }, (_, ci) => {
    let w = stripInline(headerRow[ci] || "").length;
    for (const row of dataRows) {
      w = Math.max(w, stripInline(row[ci] || "").length);
    }
    return Math.max(3, Math.min(w + 1, MAX_COL_WIDTH));
  });

  // Helper: pad a cell to its column width
  const pad = (text: string, width: number, align: "left" | "right" | "center") => {
    const stripped = stripInline(text);
    const diff = Math.max(0, width - stripped.length);
    if (align === "right") return " ".repeat(diff) + text;
    if (align === "center") {
      const left = Math.floor(diff / 2);
      return " ".repeat(left) + text + " ".repeat(diff - left);
    }
    return text + " ".repeat(diff);
  };

  // Box-drawing borders
  const sep = "─";
  const join = (left: string, mid: string, right: string) => {
    let s = left;
    for (let ci = 0; ci < colCount; ci++) {
      s += sep.repeat(widths[ci] + 2);
      s += ci < colCount - 1 ? mid : right;
    }
    return s;
  };

  const topBorder = join("┌", "┬", "┐");
  const sepLine = join("├", "┼", "┤");
  const bottomBorder = join("└", "┴", "┘");

  const borderColor = "gray";
  const headerColor = "cyanBright";
  const altRowBg = "#1a1a2e";

  return (
    <Box key={key} flexDirection="column" marginY={1}>
      {/* Top border */}
      <Box>
        <Text color={borderColor} dimColor>{topBorder}</Text>
      </Box>

      {/* Header row */}
      <Box>
        <Text color={borderColor} dimColor>│</Text>
        {headerRow.map((cell, ci) => {
          const padded = pad(cell, widths[ci], alignments[ci] || "left");
          return (
            <React.Fragment key={ci}>
              <Text> </Text>
              <Text bold color={headerColor}>{padded}</Text>
              <Text> </Text>
              <Text color={borderColor} dimColor>│</Text>
            </React.Fragment>
          );
        })}
      </Box>

      {/* Header-data separator */}
      <Box>
        <Text color={borderColor} dimColor>{sepLine}</Text>
      </Box>

      {/* Data rows */}
      {dataRows.map((row, ri) => (
        <Box key={ri}>
          <Text color={borderColor} dimColor>│</Text>
          {Array.from({ length: colCount }, (_, ci) => {
            const cell = row[ci] || "";
            const padded = pad(cell, widths[ci], alignments[ci] || "left");
            const isAlt = ri % 2 === 1;
            return (
              <React.Fragment key={ci}>
                <Text backgroundColor={isAlt ? altRowBg : undefined}> </Text>
                <Text backgroundColor={isAlt ? altRowBg : undefined}>{padded}</Text>
                <Text backgroundColor={isAlt ? altRowBg : undefined}> </Text>
                <Text color={borderColor} dimColor>│</Text>
              </React.Fragment>
            );
          })}
        </Box>
      ))}

      {/* Bottom border */}
      <Box>
        <Text color={borderColor} dimColor>{bottomBorder}</Text>
      </Box>
    </Box>
  );
}

/** Strip inline markdown formatting to get plain-text length for alignment */
function stripInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");
}

/**
 * Render inline markdown: **bold**, *italic*, `code`, [links](url)
 */
function renderInline(text: string): React.ReactNode {
  const tokens: Array<{ type: "text" | "bold" | "italic" | "code" | "link"; content: string; url?: string }> = [];
  let i = 0;

  while (i < text.length) {
    // Code span `...`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        tokens.push({ type: "code", content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Bold **...**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        tokens.push({ type: "bold", content: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Italic *...* (single *, not double)
    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        tokens.push({ type: "italic", content: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Link [...] (...)
    if (text[i] === "[") {
      const closeB = text.indexOf("]", i + 1);
      if (closeB !== -1 && text[closeB + 1] === "(") {
        const closeP = text.indexOf(")", closeB + 2);
        if (closeP !== -1) {
          tokens.push({
            type: "link",
            content: text.slice(i + 1, closeB),
            url: text.slice(closeB + 2, closeP),
          });
          i = closeP + 1;
          continue;
        }
      }
    }

    // Plain text — scan ahead for next special char
    let next = text.length;
    for (const ch of ["`", "*", "["]) {
      const idx = text.indexOf(ch, i + 1);
      if (idx !== -1 && idx < next) next = idx;
    }
    tokens.push({ type: "text", content: text.slice(i, next) });
    i = next;
  }

  return (
    <React.Fragment>
      {tokens.map((t, idx) => {
        switch (t.type) {
          case "bold":
            return <Text key={idx} bold>{t.content}</Text>;
          case "italic":
            return <Text key={idx} dimColor>{t.content}</Text>;
          case "code":
            return <Text key={idx} color="cyan">{t.content}</Text>;
          case "link":
            return (
              <Text key={idx} color="blue">
                {t.content}
                <Text color="gray"> ({t.url})</Text>
              </Text>
            );
          default:
            return <Text key={idx}>{t.content}</Text>;
        }
      })}
    </React.Fragment>
  );
}
