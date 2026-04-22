import JSZip from "jszip";

const OFFICE_DOCUMENT_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function collapseWhitespace(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripXmlText(value: string): string {
  const text = value
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/a:p>/g, "\n")
    .replace(/<\/row>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  return collapseWhitespace(decodeXmlEntities(text));
}

function naturalSort(values: string[]): string[] {
  return [...values].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function readZipTextFile(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    return "";
  }
  return await file.async("text");
}

async function extractDocxText(zip: JSZip): Promise<string> {
  const parts = await Promise.all(
    [
      "word/document.xml",
      ...naturalSort(
        Object.keys(zip.files).filter(
          (name) => /^word\/(header|footer)\d+\.xml$/i.test(name) && !zip.files[name]?.dir,
        ),
      ),
    ].map((name) => readZipTextFile(zip, name)),
  );
  return collapseWhitespace(parts.map(stripXmlText).filter(Boolean).join("\n\n"));
}

function parseSharedStrings(xml: string): string[] {
  const matches = Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g));
  return matches.map((match) => stripXmlText(match[1] ?? ""));
}

function decodeExcelColumnName(index: number): string {
  let current = index;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label || "A";
}

function parseExcelCellReference(ref: string | undefined, fallbackIndex: number): string {
  const match = /^([A-Z]+)\d+$/i.exec(ref ?? "");
  return match?.[1]?.toUpperCase() ?? decodeExcelColumnName(fallbackIndex + 1);
}

function parseWorksheetText(xml: string, sharedStrings: string[]): string {
  const rowMatches = Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g));
  const lines: string[] = [];
  for (const rowMatch of rowMatches) {
    const rowXml = rowMatch[1] ?? "";
    const cellMatches = Array.from(rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g));
    const cells: string[] = [];
    cellMatches.forEach((cellMatch, index) => {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const ref = /(?:^|\s)r="([^"]+)"/.exec(attrs)?.[1];
      const type = /(?:^|\s)t="([^"]+)"/.exec(attrs)?.[1];
      let value = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      if (!value) {
        value = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? "";
      }
      if (type === "s") {
        const sharedIndex = Number(value);
        value = Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? "") : "";
      } else {
        value = collapseWhitespace(decodeXmlEntities(value));
      }
      if (!value) {
        return;
      }
      cells.push(`${parseExcelCellReference(ref, index)}=${value}`);
    });
    if (cells.length > 0) {
      lines.push(cells.join(" | "));
    }
  }
  return collapseWhitespace(lines.join("\n"));
}

async function extractXlsxText(zip: JSZip): Promise<string> {
  const sharedStrings = parseSharedStrings(await readZipTextFile(zip, "xl/sharedStrings.xml"));
  const worksheetNames = naturalSort(
    Object.keys(zip.files).filter(
      (name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name) && !zip.files[name]?.dir,
    ),
  );
  const worksheets = await Promise.all(worksheetNames.map((name) => readZipTextFile(zip, name)));
  return collapseWhitespace(
    worksheets
      .map((xml, index) => {
        const text = parseWorksheetText(xml, sharedStrings);
        return text ? `Sheet ${index + 1}\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n"),
  );
}

async function extractPptxText(zip: JSZip): Promise<string> {
  const slideNames = naturalSort(
    Object.keys(zip.files).filter(
      (name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name) && !zip.files[name]?.dir,
    ),
  );
  const slides = await Promise.all(slideNames.map((name) => readZipTextFile(zip, name)));
  return collapseWhitespace(
    slides
      .map((xml, index) => {
        const text = stripXmlText(xml);
        return text ? `Slide ${index + 1}\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n"),
  );
}

export function isOfficeDocumentMime(mimeType: string | undefined): boolean {
  return typeof mimeType === "string" && OFFICE_DOCUMENT_MIMES.has(mimeType);
}

export async function extractOfficeContent(params: {
  buffer: Buffer;
  mimeType: string;
  maxChars: number;
}): Promise<string> {
  const zip = await JSZip.loadAsync(params.buffer);
  let text = "";
  switch (params.mimeType) {
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      text = await extractDocxText(zip);
      break;
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      text = await extractXlsxText(zip);
      break;
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      text = await extractPptxText(zip);
      break;
  }
  return text.length > params.maxChars ? text.slice(0, params.maxChars) : text;
}
