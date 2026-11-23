import { remembered } from './remembered';

/** Whether the lamp over the machine in its picture is lit. */
export type DeskLamp = 'lit' | 'out';

const deskLamp = remembered<DeskLamp>('boombapbot.ritm12.desk-lamp', 'lit', ['out']);

export const setDeskLamp = deskLamp.set;
export const useDeskLamp = deskLamp.use;
