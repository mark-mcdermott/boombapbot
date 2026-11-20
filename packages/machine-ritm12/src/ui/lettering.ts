import { useSyncExternalStore } from 'react';
import { browserStorage } from '@boombapbot/editor';
import type { EffectKind, VoiceId } from '../document';

/** The language the machine's own lettering is in: on its screen, its keys and its panel. */
export type Script = 'russian' | 'english';

/** Every word the machine letters, in one language. */
export interface Lettering {
  /** What the screen types out when the machine is switched on. */
  boot: readonly string[];
  /** Each voice as its key is lettered, and as the screen's grid names it in three letters. */
  voices: Record<VoiceId, { key: string; short: string }>;
  effects: Record<EffectKind, string>;
  patterns: readonly [string, string, string, string];
  pattern: string;
  tempo: string;
  swing: string;
  accent: string;
  pitch: string;
  decay: string;
  tone: string;
  level: string;
  mix: string;
  volume: string;
  effect: string;
  voice: string;
  size: string;
  sequencer: string;
  hits: string;
  accents: string;
  mute: string;
  clear: string;
  power: string;
  on: string;
  off: string;
  recording: string;
  sounding: string;
  random: string;
  straight: string;
  triplets: string;
}

export const LETTERING: Record<Script, Lettering> = {
  russian: {
    boot: ['НПО «БАРС-7»', 'РИТМ-12  РИТМИЧЕСКИЙ КОМПЬЮТЕР', '', 'ПРОВЕРКА ПАМЯТИ ........ ОК', 'ГОЛОСА 8    ПАТТЕРНЫ 4', '', 'ГОТОВ'],
    voices: {
      kick: { key: 'БАС', short: 'БАС' },
      snare: { key: 'МАЛЫЙ', short: 'МАЛ' },
      clap: { key: 'ХЛОП', short: 'ХЛП' },
      closed_hat: { key: 'ХЭТ З', short: 'ХЭЗ' },
      open_hat: { key: 'ХЭТ О', short: 'ХЭО' },
      tom: { key: 'ТОМ', short: 'ТОМ' },
      rim: { key: 'РИМ', short: 'РИМ' },
      perc: { key: 'ПЕРК', short: 'ПРК' },
    },
    effects: { delay: 'ДИЛЭЙ', reverb: 'РЕВЕРБ', flanger: 'ФЛЭНЖЕР', chorus: 'ХОР' },
    patterns: ['А', 'Б', 'В', 'Г'],
    pattern: 'ПАТТЕРН',
    tempo: 'ТЕМП',
    swing: 'СВИНГ',
    accent: 'АКЦЕНТ',
    pitch: 'ПИТЧ',
    decay: 'ЗАТУХАНИЕ',
    tone: 'ТОН',
    level: 'УРОВЕНЬ',
    mix: 'СМЕСЬ',
    volume: 'ГРОМКОСТЬ',
    effect: 'ЭФФЕКТ',
    voice: 'ГОЛОС',
    size: 'РАЗМЕР',
    sequencer: 'СЕКВЕНСЕР',
    hits: 'УДАРЫ',
    accents: 'АКЦЕНТЫ',
    mute: 'МУТ',
    clear: 'СБРОС',
    power: 'СЕТЬ',
    on: 'ВКЛ',
    off: 'ВЫКЛ',
    recording: 'ЗАПИСЬ',
    sounding: 'ЗВУК',
    random: 'СЛУЧАЙНО',
    straight: 'ПРЯМОЙ',
    triplets: 'ТРИОЛИ',
  },
  english: {
    boot: ['NPO "BARS-7"', 'RITM-12  RHYTHM COMPUTER', '', 'MEMORY CHECK ........... OK', 'VOICES 8    PATTERNS 4', '', 'READY'],
    voices: {
      kick: { key: 'KICK', short: 'KCK' },
      snare: { key: 'SNARE', short: 'SNR' },
      clap: { key: 'CLAP', short: 'CLP' },
      closed_hat: { key: 'HAT C', short: 'CHH' },
      open_hat: { key: 'HAT O', short: 'OHH' },
      tom: { key: 'TOM', short: 'TOM' },
      rim: { key: 'RIM', short: 'RIM' },
      perc: { key: 'PERC', short: 'PRC' },
    },
    effects: { delay: 'DELAY', reverb: 'REVERB', flanger: 'FLANGER', chorus: 'CHORUS' },
    patterns: ['A', 'B', 'C', 'D'],
    pattern: 'PATTERN',
    tempo: 'TEMPO',
    swing: 'SWING',
    accent: 'ACCENT',
    pitch: 'PITCH',
    decay: 'DECAY',
    tone: 'TONE',
    level: 'LEVEL',
    mix: 'MIX',
    volume: 'VOLUME',
    effect: 'EFFECT',
    voice: 'VOICE',
    size: 'MEASURE',
    sequencer: 'SEQUENCER',
    hits: 'HITS',
    accents: 'ACCENTS',
    mute: 'MUTE',
    clear: 'CLEAR',
    power: 'POWER',
    on: 'ON',
    off: 'OFF',
    recording: 'REC',
    sounding: 'ON',
    random: 'RANDOM',
    straight: 'STRAIGHT',
    triplets: 'TRIPLETS',
  },
};

const KEY = 'boombapbot.ritm12.lettering';
const listeners = new Set<() => void>();

function storedScript(): Script {
  return browserStorage()?.getItem(KEY) === 'english' ? 'english' : 'russian';
}

let script: Script | null = null;

function currentScript(): Script {
  script ??= storedScript();
  return script;
}

/** Changes the machine's lettering everywhere at once, and remembers it on this device. */
export function setScript(next: Script): void {
  script = next;
  const storage = browserStorage();
  if (next === 'english') storage?.setItem(KEY, next);
  else storage?.removeItem(KEY);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing it changes it here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    script = storedScript();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The language the machine is lettered in now. */
export function useScript(): Script {
  return useSyncExternalStore(subscribe, currentScript, () => 'russian');
}

/** The machine's words, in the language it is lettered in now. */
export function useLettering(): Lettering {
  return LETTERING[useScript()];
}
