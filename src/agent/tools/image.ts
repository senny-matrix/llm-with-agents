import { tool } from "ai";
import { z } from "zod";
import { readFileSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// Header parsers — extract image dimensions without full decode
// ---------------------------------------------------------------------------

interface ImageInfo {
  format: string;
  mimeType: string;
  width: number;
  height: number;
  fileSize: number;
  colorDepth?: number;
  hasAlpha?: boolean;
  dpi?: number;
}

function readBytes(path: string, offset: number, length: number): Buffer {
  const fd = readFileSync(path);
  return fd.subarray(offset, offset + length);
}

function readUint16BE(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset);
}

function readUint32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readUint32BE(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

/** PNG: 8-byte signature + IHDR chunk at offset 8 */
function parsePNG(path: string): ImageInfo | null {
  try {
    const buf = readBytes(path, 0, 33);
    // Check signature
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!sig.every((b, i) => buf[i] === b)) return null;

    // IHDR starts at byte 8: 4 bytes length + 4 bytes "IHDR" + 13 bytes data
    const width = readUint32BE(buf, 16);
    const height = readUint32BE(buf, 20);
    const bitDepth = buf[24];
    const colorType = buf[25];

    const hasAlpha = [4, 6].includes(colorType);
    const dpi = readUint32BE(buf, 8); // Not in IHDR, skip DPI for PNG

    return {
      format: "PNG",
      mimeType: "image/png",
      width,
      height,
      fileSize: statSync(path).size,
      colorDepth: bitDepth,
      hasAlpha,
    };
  } catch {
    return null;
  }
}

/** JPEG: Read SOF marker for dimensions */
function parseJPEG(path: string): ImageInfo | null {
  try {
    const size = statSync(path).size;
    const buf = readBytes(path, 0, Math.min(size, 65536));

    // Check SOI marker
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

    let pos = 2;
    while (pos < buf.length - 1) {
      if (buf[pos] !== 0xff) { pos++; continue; }
      const marker = buf[pos + 1];

      // SOF0 (baseline) or SOF2 (progressive)
      if (marker === 0xc0 || marker === 0xc2) {
        const height = readUint16BE(buf, pos + 5);
        const width = readUint16BE(buf, pos + 7);
        const components = buf[pos + 9];
        return {
          format: marker === 0xc2 ? "JPEG (Progressive)" : "JPEG",
          mimeType: "image/jpeg",
          width,
          height,
          fileSize: size,
          colorDepth: 8 * components,
        };
      }

      // SOS (start of scan) — rest is compressed, stop searching
      if (marker === 0xda) break;

      // Skip unknown markers
      if (marker === 0xd8 || marker === 0xd9) { pos += 2; continue; }

      const segLen = readUint16BE(buf, pos + 2);
      pos += 2 + segLen;
    }
    return null;
  } catch {
    return null;
  }
}

/** GIF: 6-byte header + logical screen descriptor */
function parseGIF(path: string): ImageInfo | null {
  try {
    const buf = readBytes(path, 0, 10);
    // Check signature: GIF87a or GIF89a
    if (buf.toString("ascii", 0, 3) !== "GIF") return null;

    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    return {
      format: "GIF",
      mimeType: "image/gif",
      width,
      height,
      fileSize: statSync(path).size,
    };
  } catch {
    return null;
  }
}

/** WebP: RIFF header + VP8/VP8L/VP8X chunk */
function parseWebP(path: string): ImageInfo | null {
  try {
    const buf = readBytes(path, 0, 30);
    if (buf.toString("ascii", 0, 4) !== "RIFF") return null;
    if (buf.toString("ascii", 8, 4) !== "WEBP") return null;

    const chunk = buf.toString("ascii", 12, 4);
    let width = 0;
    let height = 0;
    let hasAlpha = false;

    if (chunk === "VP8X") {
      // Extended format: bit 4 of first byte is alpha flag
      hasAlpha = !!(buf[20] & 0x10);
      width = (buf.readUIntLE(24, 3) & 0xffffff) + 1;
      height = (buf.readUIntLE(27, 3) & 0xffffff) + 1;
    } else if (chunk === "VP8 ") {
      // Lossy: dimensions in 10 bytes starting at offset 26
      width = buf.readUInt16LE(26) & 0x3fff;
      height = buf.readUInt16LE(28) & 0x3fff;
    } else if (chunk === "VP8L") {
      // Lossless: dimensions packed in 4 bytes at offset 21
      const bits = buf.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
      hasAlpha = !!(bits & 0x10000000);
    }

    if (width === 0 || height === 0) return null;

    return {
      format: "WebP",
      mimeType: "image/webp",
      width,
      height,
      fileSize: statSync(path).size,
      hasAlpha,
    };
  } catch {
    return null;
  }
}

/** BMP: 14-byte file header + DIB header */
function parseBMP(path: string): ImageInfo | null {
  try {
    const buf = readBytes(path, 0, 30);
    if (buf.toString("ascii", 0, 2) !== "BM") return null;

    const width = Math.abs(buf.readInt32LE(18));
    const height = Math.abs(buf.readInt32LE(22));
    const bitDepth = buf.readUInt16LE(28);

    return {
      format: "BMP",
      mimeType: "image/bmp",
      width,
      height,
      fileSize: statSync(path).size,
      colorDepth: bitDepth,
    };
  } catch {
    return null;
  }
}

/** SVG: Read as text and parse XML for viewBox/width/height */
function parseSVG(path: string): ImageInfo | null {
  try {
    const content = readFileSync(path, "utf-8").slice(0, 4096);
    if (!content.includes("<svg")) return null;

    let width = 0;
    let height = 0;

    // Try viewBox first (most reliable)
    const vbMatch = content.match(/viewBox=["']([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)["']/);
    if (vbMatch) {
      width = Math.round(parseFloat(vbMatch[3]));
      height = Math.round(parseFloat(vbMatch[4]));
    }

    // Fall back to width/height attributes
    if (width === 0) {
      const wMatch = content.match(/<svg[^>]*\swidth=["'](\d+(?:\.\d+)?)(?:px|em|%)?["']/);
      if (wMatch) width = Math.round(parseFloat(wMatch[1]));
    }
    if (height === 0) {
      const hMatch = content.match(/<svg[^>]*\sheight=["'](\d+(?:\.\d+)?)(?:px|em|%)?["']/);
      if (hMatch) height = Math.round(parseFloat(hMatch[1]));
    }

    return {
      format: "SVG",
      mimeType: "image/svg+xml",
      width,
      height,
      fileSize: statSync(path).size,
    };
  } catch {
    return null;
  }
}

const PARSERS: Array<(path: string) => ImageInfo | null> = [
  parsePNG,
  parseJPEG,
  parseGIF,
  parseWebP,
  parseBMP,
  parseSVG,
];

function parseImage(path: string): ImageInfo | null {
  for (const parser of PARSERS) {
    const result = parser(path);
    if (result) return result;
  }
  return null;
}

// ---------------------------------------------------------------------------
// image_info tool
// ---------------------------------------------------------------------------

export const imageInfo = tool({
  description:
    "Get detailed metadata about an image file: format, dimensions, file size, color depth, DPI, and transparency. " +
    "Use this BEFORE calling readFile on an image to confirm it is a valid image and to understand its properties. " +
    "Supports: PNG, JPEG, GIF, WebP, BMP, SVG.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the image file"),
  }),
  execute: async ({ path }: { path: string }) => {
    try {
      const info = parseImage(path);
      if (!info) {
        return `Not a recognized image format: ${path}. Supported formats: PNG, JPEG, GIF, WebP, BMP, SVG.`;
      }

      const sizeKB = (info.fileSize / 1024).toFixed(1);
      const parts: string[] = [
        `**Image Info:** \`${path}\``,
        `  Format:      ${info.format}`,
        `  MIME type:   ${info.mimeType}`,
        `  Dimensions:  ${info.width} × ${info.height} px`,
        `  File size:   ${sizeKB} KB`,
      ];

      if (info.colorDepth !== undefined) {
        parts.push(`  Color depth: ${info.colorDepth} bits`);
      }
      if (info.hasAlpha !== undefined) {
        parts.push(`  Alpha:       ${info.hasAlpha ? "yes" : "no"}`);
      }
      if (info.dpi !== undefined) {
        parts.push(`  DPI:         ${info.dpi}`);
      }

      const megapixels = ((info.width * info.height) / 1_000_000).toFixed(1);
      parts.push(`  Megapixels:  ${megapixels} MP`);

      return parts.join("\n");
    } catch (e) {
      return `Error reading image: ${(e as Error).message}`;
    }
  },
});

// ---------------------------------------------------------------------------
// image_to_base64 tool
// ---------------------------------------------------------------------------

export const imageToBase64 = tool({
  description:
    "Encode an image file as a base64 data URI. Useful for embedding images inline in HTML, CSS, or Markdown. " +
    "Also reports if the base64 output is too large for practical use. " +
    "Supports: PNG, JPEG, GIF, WebP, BMP, SVG, TIFF, ICO, HEIC.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the image file"),
  }),
  execute: async ({ path }: { path: string }) => {
    try {
      const info = parseImage(path);
      const raw = readFileSync(path);

      const base64 = raw.toString("base64");
      const mime = info?.mimeType || "application/octet-stream";
      const dataUri = `data:${mime};base64,${base64}`;

      const sizeKB = (raw.length / 1024).toFixed(1);
      const b64KB = (base64.length / 1024).toFixed(1);

      const maxPractical = 500 * 1024; // 500 KB base64 is practical limit
      const warnTooLarge = raw.length > maxPractical;

      const parts: string[] = [];

      if (info) {
        parts.push(
          `**Base64 Encoding:** \`${path}\` (${info.format}, ${info.width}×${info.height})`,
        );
      } else {
        parts.push(`**Base64 Encoding:** \`${path}\``);
      }

      parts.push(`  Original: ${sizeKB} KB`);
      parts.push(`  Base64:   ${b64KB} KB`);

      if (warnTooLarge) {
        parts.push(
          `  ⚠️ Warning: Base64 output is ${b64KB} KB — this is large and may be impractical.`,
        );
        parts.push(`  Consider resizing the image before encoding.`);
      }

      parts.push("");
      parts.push(dataUri);

      return parts.join("\n");
    } catch (e) {
      return `Error encoding image: ${(e as Error).message}`;
    }
  },
});
