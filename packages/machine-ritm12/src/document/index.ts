import type { DocumentKind } from '@boombapbot/contracts';
import { adoptEarlier } from './legacy';
import { MACHINE_ID, createProject, parseProject, serializeProject, type Project } from './project';

export * from './machine';
export * from './project';
export * from './starter';
export { adoptEarlier } from './legacy';

/**
 * РИТМ-12's documents. Its draft has a place of its own, so a draft from
 * before it is read once, turned into a РИТМ-12 beat, and left where it was.
 */
export const documentRitm12: DocumentKind<Project> = {
  machine: MACHINE_ID,
  draftKey: 'boombapbot.draft.v3.ritm12',
  earlierDraftKeys: ['boombapbot.draft.v2', 'boombapbot.draft.v1'],
  owns: (header) => header.machine === MACHINE_ID,
  parse: parseProject,
  adopt: adoptEarlier,
  serialize: serializeProject,
  create: ({ id, now }) => createProject({ id, now, name: 'Starter beat' }),
};

/** The name a host imports, whichever machine its build is. */
export { documentRitm12 as documentKind };
