import type { DocumentKind, ProjectBase } from '@boombapbot/contracts';
import type { ComponentType, ReactNode } from 'react';
import type { EngineSetup, ExportPlan } from './engine/setup';
import type { EngineMeasure } from './engine/wasm-engine';
import type { EditorState, EditorStore } from './state/store';

/** What the editor lends a machine: its store, and the few things only the runtime can do. */
export interface MachineHost<Document extends ProjectBase, Transient extends object> {
  readonly store: EditorStore<Document, Transient>;
  /** Starts or resumes audio. Call from a user gesture. False when it could not start. */
  ensureAudio(): Promise<boolean>;
  /** Whether audio is running now. Never starts it. */
  audioRunning(): boolean;
  /** Plays one hit of an engine track. */
  trigger(track: number, accent: boolean): void;
  /** Arms or disarms the engine's intro/fill-in. */
  armFill(armed: boolean): void;
  stop(): void;
  /** When the step now sounding was reported, on the `performance.now()` clock. */
  stepStartedAt(): number;
}

/** What starting playback asks of the engine besides the setup: a song of rhythms, or none. */
export interface StartPlan {
  song: number[];
  loop: boolean;
}

/** A machine at work in one mounted editor: what the runtime asks it, and tells it. */
export interface MachineSession<Document extends ProjectBase, Transient extends object> {
  /** Asked when play is pressed. Null leaves the machine stopped. */
  start(): StartPlan | null;
  /** Playback is about to begin. */
  started?(): void;
  /** Playback stopped, by hand or because the engine reached its end. */
  stopped(): void;
  /** The engine began these measures. */
  measures?(measures: EngineMeasure[]): void;
  /** The store changed. */
  changed?(previous: EditorState<Document, Transient>, next: EditorState<Document, Transient>): void;
  /** A key was pressed that is not undo or redo. True when the machine took it. */
  keyDown?(event: KeyboardEvent): boolean;
}

/**
 * The light a machine is seen in, where its panel has one for the light and
 * one for the dark. `use` is a hook: it follows the choice as it changes.
 */
export interface MachineLight {
  use(): 'light' | 'dark';
  set(next: 'light' | 'dark'): void;
}

/** One drum machine: its documents, how they sound, and its panel. */
export interface Machine<
  Document extends ProjectBase,
  Transient extends object,
  Session extends MachineSession<Document, Transient> = MachineSession<Document, Transient>,
> {
  id: string;
  document: DocumentKind<Document>;
  /** The part of a project the machine remembers, and so what undo brings back. */
  memory(project: Document): Partial<Document>;
  /** The transient state the machine starts with. */
  transient: Transient;
  bpm(project: Document): number;
  /** What the engine is asked for. Pure: the same project gives the same setup. */
  setup(project: Document): EngineSetup;
  /** What an export holds, or why there is nothing to export. */
  exportPlan(project: Document): ExportPlan | { error: string };
  session(host: MachineHost<Document, Transient>): Session;
  /**
   * The machine itself. A panel that puts its own start button within a
   * thumb's reach on a phone sets `data-own-transport` on its outermost
   * element, and the editor then leaves its docked start button out.
   */
  Panel: ComponentType;
  /** The machine's own buttons in settings, after undo and redo. */
  SettingsActions: ComponentType;
  /** The machine's own lines in the settings status list. */
  StatusLines: ComponentType;
  /** Anything the machine has to say about itself in settings. */
  Notes: ComponentType;
  /** The machine's own options in settings, each with its label, kept on this device. */
  Options?: ComponentType;
  /** Given by a machine that can be seen in the light or in the dark: the footer then has the switch between them. */
  light?: MachineLight;
  /** How the keyboard works on this machine, for the settings footnote. */
  keysHelp: ReactNode;
  messages: {
    /** Said after a beat from an earlier version was brought up to date. */
    earlierVersion: string;
    /** Said when the saved draft could not be read and a new project was started. */
    unreadableDraft: string;
  };
}
