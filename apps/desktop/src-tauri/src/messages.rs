//! What crosses between the page and the engine, in the shapes the editor
//! gives them (`packages/editor/src/engine/messages.ts`): the commands of
//! `NativeEngineCommand` coming in, and the reports of `EngineReport` going
//! out.

use serde::{Deserialize, Serialize};

/// One sound's knobs, each from 0 to 1. Its number is also its slot.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct Sound {
    pub sound: i32,
    pub tune: f32,
    pub tone: f32,
    pub decay: f32,
    pub snappy: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub track: i32,
    pub slot: i32,
    pub pan: f32,
    pub choke_group: i32,
    pub gain: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    /// A bit mask a track: bit n is step n. Tracks left out are empty.
    pub rows: Vec<u32>,
    pub first_length: u8,
    pub second_length: u8,
    pub steps_per_beat: u8,
    pub swing: u8,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct BankPattern {
    pub index: i32,
    pub pattern: Pattern,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Variation {
    A,
    Ab,
    B,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub rhythm: u8,
    pub variation: Variation,
    pub fill_rhythm: u8,
    pub fill_variation: Variation,
    pub auto_fill: u8,
    pub first_beat_rule: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    /// The engine makes the sound itself, at its own rate, and acknowledges by slot.
    Synth {
        sound: Sound,
    },
    Tracks {
        tracks: Vec<Track>,
    },
    Mix {
        plain: f64,
        accented: f64,
        master: f64,
    },
    Patterns {
        patterns: Vec<BankPattern>,
    },
    Tempo {
        bpm: f64,
    },
    Panel {
        panel: Panel,
    },
    Cue {
        pattern: i32,
    },
    /// The effect by the engine's own number: this app keeps no list of them.
    Effect {
        effect: i32,
        wet: f64,
    },
    Fill {
        armed: bool,
    },
    Song {
        rhythms: Vec<u8>,
        #[serde(rename = "loop")]
        looped: bool,
    },
    Play,
    Stop,
    Trigger {
        track: i32,
        accent: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MeasureKind {
    Basic,
    Fill,
    Intro,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Measure {
    pub frame: f64,
    pub ordinal: i32,
    pub pattern: i32,
    pub kind: MeasureKind,
    pub position: i32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Report {
    /// The engine was made again by this app, at this rate, and has been told nothing.
    Ready {
        sample_rate: f64,
    },
    Error {
        message: String,
    },
    Sound {
        slot: i32,
    },
    Position {
        step: i32,
        pattern: i32,
        playing: bool,
    },
    Measures {
        measures: Vec<Measure>,
    },
    Ended,
    Level {
        level: f64,
    },
    Stats {
        frames: f64,
        peak: f32,
        peak_ever: f32,
        voices: i32,
        stolen: u32,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn command(value: serde_json::Value) -> Command {
        serde_json::from_value(value).expect("a command the editor sends")
    }

    #[test]
    fn reads_the_commands_as_the_editor_writes_them() {
        assert_eq!(
            command(
                json!({ "type": "synth", "sound": { "sound": 3, "tune": 0.25, "tone": 0.5, "decay": 0.75, "snappy": 1 } })
            ),
            Command::Synth {
                sound: Sound {
                    sound: 3,
                    tune: 0.25,
                    tone: 0.5,
                    decay: 0.75,
                    snappy: 1.0
                }
            }
        );
        assert_eq!(
            command(
                json!({ "type": "tracks", "tracks": [{ "track": 1, "slot": 0, "pan": -0.5, "chokeGroup": 2, "gain": 0.8 }] })
            ),
            Command::Tracks {
                tracks: vec![Track {
                    track: 1,
                    slot: 0,
                    pan: -0.5,
                    choke_group: 2,
                    gain: 0.8
                }]
            }
        );
        assert_eq!(
            command(json!({ "type": "patterns", "patterns": [{ "index": 2, "pattern": {
                "rows": [0, 4369, 4294967295u32], "firstLength": 16, "secondLength": 0, "stepsPerBeat": 4, "swing": 64 } }] })),
            Command::Patterns {
                patterns: vec![BankPattern {
                    index: 2,
                    pattern: Pattern {
                        rows: vec![0, 4369, u32::MAX],
                        first_length: 16,
                        second_length: 0,
                        steps_per_beat: 4,
                        swing: 64
                    },
                }]
            }
        );
        assert_eq!(
            command(
                json!({ "type": "panel", "panel": { "rhythm": 3, "variation": "ab", "fillRhythm": 12,
                "fillVariation": "b", "autoFill": 4, "firstBeatRule": true } })
            ),
            Command::Panel {
                panel: Panel {
                    rhythm: 3,
                    variation: Variation::Ab,
                    fill_rhythm: 12,
                    fill_variation: Variation::B,
                    auto_fill: 4,
                    first_beat_rule: true
                }
            }
        );
        assert_eq!(
            command(json!({ "type": "mix", "plain": 0.6, "accented": 1, "master": 0.8 })),
            Command::Mix {
                plain: 0.6,
                accented: 1.0,
                master: 0.8
            }
        );
        assert_eq!(
            command(json!({ "type": "tempo", "bpm": 97.5 })),
            Command::Tempo { bpm: 97.5 }
        );
        assert_eq!(
            command(json!({ "type": "cue", "pattern": 1 })),
            Command::Cue { pattern: 1 }
        );
        assert_eq!(
            command(json!({ "type": "effect", "effect": 9, "wet": 0.3 })),
            Command::Effect { effect: 9, wet: 0.3 }
        );
        assert_eq!(
            command(json!({ "type": "fill", "armed": true })),
            Command::Fill { armed: true }
        );
        assert_eq!(
            command(json!({ "type": "song", "rhythms": [0, 1, 12], "loop": true })),
            Command::Song {
                rhythms: vec![0, 1, 12],
                looped: true
            }
        );
        assert_eq!(command(json!({ "type": "play" })), Command::Play);
        assert_eq!(command(json!({ "type": "stop" })), Command::Stop);
        assert_eq!(
            command(json!({ "type": "trigger", "track": 5, "accent": false })),
            Command::Trigger {
                track: 5,
                accent: false
            }
        );
    }

    #[test]
    fn refuses_what_is_not_a_command() {
        assert!(serde_json::from_value::<Command>(json!({ "type": "sound", "slot": 0, "pcm": [] })).is_err());
        assert!(serde_json::from_value::<Command>(json!({ "type": "tempo" })).is_err());
    }

    #[test]
    fn writes_the_reports_as_the_editor_reads_them() {
        let written = |report: Report| serde_json::to_value(report).expect("a report");
        assert_eq!(
            written(Report::Ready { sample_rate: 48000.0 }),
            json!({ "type": "ready", "sampleRate": 48000.0 })
        );
        assert_eq!(
            written(Report::Error {
                message: "no device".into()
            }),
            json!({ "type": "error", "message": "no device" })
        );
        assert_eq!(
            written(Report::Sound { slot: 4 }),
            json!({ "type": "sound", "slot": 4 })
        );
        assert_eq!(
            written(Report::Position {
                step: 3,
                pattern: 1,
                playing: true
            }),
            json!({ "type": "position", "step": 3, "pattern": 1, "playing": true })
        );
        assert_eq!(
            written(Report::Measures {
                measures: vec![Measure {
                    frame: 96.0,
                    ordinal: 1,
                    pattern: 2,
                    kind: MeasureKind::Fill,
                    position: -1
                }]
            }),
            json!({ "type": "measures", "measures": [{ "frame": 96.0, "ordinal": 1, "pattern": 2, "kind": "fill", "position": -1 }] })
        );
        assert_eq!(written(Report::Ended), json!({ "type": "ended" }));
        assert_eq!(
            written(Report::Level { level: 0.25 }),
            json!({ "type": "level", "level": 0.25 })
        );
        assert_eq!(
            written(Report::Stats {
                frames: 4800.0,
                peak: 0.5,
                peak_ever: 0.75,
                voices: 2,
                stolen: 1
            }),
            json!({ "type": "stats", "frames": 4800.0, "peak": 0.5, "peakEver": 0.75, "voices": 2, "stolen": 1 })
        );
    }
}
