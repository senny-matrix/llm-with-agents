import React from "react";
import { Box, Text } from "ink";

interface MarkdownProps {
  children: string;
}

/**
 * Simple Markdown-to-ANSI renderer for Ink TUI.
 * Handles: headings, bold, italic, code blocks, inline code, lists, blockquotes.
 */
export function Markdown({ children: raw }: MarkdownProps) {
  const lines = raw.split("\n");
  const elements: React.ReactElement[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trim().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
        codeBlockLines = [];
        continue;
      } else {
        // End code block
        inCodeBlock = false;
        elements.push(
          <Box key={`cb-${i}`} flexDirection="column" marginLeft={1} marginY={1}>
            <Box paddingLeft={1} paddingRight={1}>
              <Text dimColor>
                ┌── {codeBlockLang || "code"} ──
              </Text>
            </Box>
            {codeBlockLines.map((cl, ci) => (
              <Box key={ci} paddingLeft={1} paddingRight={1}>
                <Text color="cyan" dimColor>
                  │{" "}
                </Text>
                <Text color="white">{cl}</Text>
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
    elements.push(
      <Box key="cb-open" flexDirection="column" marginLeft={1} marginY={1}>
        <Box paddingLeft={1} paddingRight={1}>
          <Text dimColor>┌── {codeBlockLang || "code"} ──</Text>
        </Box>
        {codeBlockLines.map((cl, ci) => (
          <Box key={ci} paddingLeft={1} paddingRight={1}>
            <Text color="cyan" dimColor>│ </Text>
            <Text color="white">{cl}</Text>
          </Box>
        ))}
      </Box>,
    );
  }

  return <Box flexDirection="column">{elements}</Box>;
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
