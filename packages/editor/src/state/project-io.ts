import {
  MAX_PROJECT_BYTES,
  PROJECT_FILE_EXTENSION,
  parseProjectText,
  serializeProject,
  type ParseResult,
  type Project,
} from '@boombapbot/contracts';

/** A file-system-safe base name for exports. */
export function exportBaseName(project: Project): string {
  const slug = project.name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .slice(0, 48);
  return slug || 'boombapbot-beat';
}

export function projectFileName(project: Project): string {
  return `${exportBaseName(project)}${PROJECT_FILE_EXTENSION}`;
}

export function projectFileContents(project: Project): string {
  return serializeProject(project);
}

/**
 * Reads a project file chosen by the user. The result is either a valid
 * project or a list of reasons; the caller decides what to do with it, so an
 * invalid file can never replace the current draft.
 */
export async function readProjectFile(file: Blob): Promise<ParseResult> {
  if (file.size > MAX_PROJECT_BYTES) {
    return { ok: false, errors: ['The file is too large to be a boombapbot project.'] };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, errors: ['The file could not be read.'] };
  }
  return parseProjectText(text);
}

/** Saves bytes as a download. Browser only. */
export function downloadBytes(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
