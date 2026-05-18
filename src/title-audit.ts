import { App, TFile } from "obsidian";

export interface MarkdownHeading {
  id: number;
  path: string;
  line: number;
  level: 1 | 2 | 3;
  title: string;
  hasAsciiSymbol: boolean;
  missingBacktickWords: string[];
}

export interface TitleReview {
  path: string;
  line: number;
  level: 1 | 2 | 3;
  currentTitle: string;
  isSuitable: boolean;
  recommendedTitle: string;
  reason: string;
}

export interface TitleFormatIssue {
  path: string;
  line: number;
  level: 1 | 2 | 3;
  currentTitle: string;
  issue: string;
  fixedTitle: string;
}

export interface TitleAuditResult {
  scannedCount: number;
  summary: string;
  titleReviews: TitleReview[];
  formatIssues: TitleFormatIssue[];
}

function stripTrailingHashes(title: string): string {
  return title.replace(/\s+#+\s*$/, "").trim();
}

function hasAsciiSymbol(title: string): boolean {
  return /[!-\/:-@\[-`{-~]/.test(title);
}

function findMissingBacktickWords(title: string): string[] {
  const missing = new Set<string>();
  let outside = "";
  let inCode = false;

  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    if (ch === "`") {
      inCode = !inCode;
      outside += " ";
      continue;
    }
    outside += inCode ? " " : ch;
  }

  const wordRe = /[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*/g;
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(outside)) !== null) {
    missing.add(match[0]);
  }

  return Array.from(missing);
}

function wrapEnglishWordsOutsideCode(title: string): string {
  let result = "";
  let segment = "";
  let inCode = false;
  const wordRe = /[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*/g;

  const flushOutside = () => {
    if (!segment) return;
    result += inCode ? segment : segment.replace(wordRe, "`$&`");
    segment = "";
  };

  for (let i = 0; i < title.length; i++) {
    const ch = title[i];
    if (ch === "`") {
      flushOutside();
      result += ch;
      inCode = !inCode;
      continue;
    }
    segment += ch;
  }
  flushOutside();

  return result;
}

export function buildLocalFormatIssues(headings: MarkdownHeading[]): TitleFormatIssue[] {
  return headings
    .filter((heading) => heading.missingBacktickWords.length > 0)
    .map((heading) => ({
      path: heading.path,
      line: heading.line,
      level: heading.level,
      currentTitle: heading.title,
      issue: `英文单词未使用反引号包裹：${heading.missingBacktickWords.join(", ")}`,
      fixedTitle: wrapEnglishWordsOutsideCode(heading.title),
    }));
}

export async function collectFileHeadings(app: App, file: TFile): Promise<MarkdownHeading[]> {
  const content = await app.vault.read(file);
  const lines = content.split(/\r?\n/);
  const headings: MarkdownHeading[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!match) continue;

    const title = stripTrailingHashes(match[2]);
    if (!title) continue;

    headings.push({
      id: headings.length + 1,
      path: file.path,
      line: i + 1,
      level: match[1].length as 1 | 2 | 3,
      title,
      hasAsciiSymbol: hasAsciiSymbol(title),
      missingBacktickWords: findMissingBacktickWords(title),
    });
  }

  return headings;
}
