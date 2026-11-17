import { BoombapbotEditor } from '@boombapbot/editor';
import { machine } from '#machine';

interface MachineProps {
  /** Base URL the site is served from. */
  baseUrl?: string;
}

/** The editor, as the drum machine this build is. */
export function Machine({ baseUrl }: MachineProps) {
  return <BoombapbotEditor machine={machine} baseUrl={baseUrl} />;
}
