/**
 * What every project document has in common, whichever machine made it, and
 * the codec a build makes from the machines it includes.
 *
 * This is the plain JSON project used for local drafts and JSON import and
 * export. It is not the future portable `.boombapbot` bundle.
 */
export const PROJECT_FORMAT = 'boombapbot.project';
export const PROJECT_FILE_EXTENSION = '.boombapbot.json';
export const MAX_PROJECT_BYTES = 1_000_000;

export interface ProjectBase {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  /** The machine the project belongs to. The first machine's documents have none. */
  machine?: string;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type ParseResult<Document extends ProjectBase = ProjectBase> =
  | {
      ok: true;
      project: Document;
      /** What a document from elsewhere lost on the way in. Empty for a current one. */
      changes: string[];
    }
  | { ok: false; errors: string[] };

/** The fields that say whose a document is, before anything else is checked. */
export interface ProjectHeader {
  schemaVersion?: unknown;
  machine?: unknown;
}

export interface NewDocumentOptions {
  id: string;
  now: Date;
}

/** One machine's documents: how to tell them, read them, write them and start one. */
export interface DocumentKind<Document extends ProjectBase> {
  machine: string;
  /** Where this machine keeps its draft in local storage. */
  draftKey: string;
  /** Where earlier versions kept it, newest first. Read when there is no draft; never written. */
  earlierDraftKeys: readonly string[];
  owns(header: ProjectHeader): boolean;
  /** Validates a document this machine owns, bringing an older one up to date. Never throws. */
  parse(input: unknown): ParseResult<Document>;
  /** Takes over a document no machine in the build owns, or returns null when it cannot. */
  adopt?(input: unknown): ParseResult<Document> | null;
  serialize(project: Document): string;
  /** A new project with the machine's starter content. */
  create(options: NewDocumentOptions): Document;
}

export interface ProjectCodec<Document extends ProjectBase> {
  /** Reads a document, letting a machine adopt one that none owns. Never throws. */
  parse(input: unknown): ParseResult<Document>;
  /** Reads a document only if a machine in the build owns it. Never throws. */
  parseOwned(input: unknown): ParseResult<Document>;
  /** Parses project JSON text. Never throws. */
  parseText(text: string): ParseResult<Document>;
  serialize(project: Document): string;
}

const NOT_A_PROJECT = 'This is not a boombapbot project file.';
const NO_SUCH_MACHINE = 'This project was made on a machine this build does not have.';

function headerOf(input: unknown): ProjectHeader & { format?: unknown } {
  return typeof input === 'object' && input !== null ? input : {};
}

export function createProjectCodec<Document extends ProjectBase>(
  kinds: readonly DocumentKind<Document>[],
): ProjectCodec<Document> {
  const read = (input: unknown, adopting: boolean): ParseResult<Document> => {
    const header = headerOf(input);
    if (typeof input === 'object' && input !== null && header.format !== PROJECT_FORMAT) {
      return { ok: false, errors: [NOT_A_PROJECT] };
    }
    const owner = kinds.find((kind) => kind.owns(header));
    if (owner) return owner.parse(input);
    if (adopting) {
      for (const kind of kinds) {
        const adopted = kind.adopt?.(input);
        if (adopted) return adopted;
      }
    }
    return { ok: false, errors: [NO_SUCH_MACHINE] };
  };

  return {
    parse: (input) => read(input, true),
    parseOwned: (input) => read(input, false),
    parseText(text) {
      if (text.length > MAX_PROJECT_BYTES) {
        return { ok: false, errors: ['The file is too large to be a boombapbot project.'] };
      }
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return { ok: false, errors: ['The file is not valid JSON.'] };
      }
      return read(value, true);
    },
    serialize(project) {
      const owner = kinds.find((kind) => kind.owns(project));
      if (!owner) throw new Error(NO_SUCH_MACHINE);
      return owner.serialize(project);
    },
  };
}
