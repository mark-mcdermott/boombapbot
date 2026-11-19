//! The engine's C ABI (`engine/include/boombapbot/engine.h`), as far as this
//! app calls it. The layouts are pinned by the engine's own `test_abi.c`,
//! and the tests below hold these to the same sizes.

use std::ffi::c_int;

pub const SNARE_ABI_VERSION: u32 = 3;
pub const SNARE_TRACKS: usize = 12;
pub const SNARE_OK: c_int = 0;
pub const SNARE_ERR_QUEUE_FULL: c_int = -1;

#[repr(C)]
pub struct SnareEngine {
    _opaque: [u8; 0],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SnarePattern {
    pub rows: [u32; SNARE_TRACKS],
    pub len1: u8,
    pub len2: u8,
    pub steps_per_beat: u8,
    pub swing: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SnarePanel {
    pub rhythm: u8,
    pub variation: u8,
    pub fill_rhythm: u8,
    pub fill_variation: u8,
    pub auto_fill: u8,
    pub first_beat_rule: u8,
    pub reserved: [u8; 2],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SnareMeasure {
    pub frame: f64,
    pub ordinal: i32,
    pub pattern: i32,
    pub kind: i32,
    pub position: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SnareSoundParams {
    pub sound: i32,
    pub tune: f32,
    pub tone: f32,
    pub decay: f32,
    pub snappy: f32,
    pub seed: u32,
}

extern "C" {
    pub fn snare_abi_version() -> u32;

    pub fn snare_engine_create(sample_rate: f64) -> *mut SnareEngine;
    pub fn snare_engine_destroy(engine: *mut SnareEngine);
    pub fn snare_engine_synth_sound(engine: *mut SnareEngine, params: *const SnareSoundParams) -> c_int;
    pub fn snare_engine_collect(engine: *mut SnareEngine) -> c_int;

    pub fn snare_engine_set_tempo(engine: *mut SnareEngine, bpm: f64) -> c_int;
    pub fn snare_engine_set_track(
        engine: *mut SnareEngine,
        track: c_int,
        slot: c_int,
        pan: f32,
        choke_group: c_int,
    ) -> c_int;
    pub fn snare_engine_set_track_level(engine: *mut SnareEngine, track: c_int, gain: f64) -> c_int;
    pub fn snare_engine_set_accent(engine: *mut SnareEngine, plain_gain: f64, accent_gain: f64) -> c_int;
    pub fn snare_engine_set_master_volume(engine: *mut SnareEngine, volume: f64) -> c_int;
    pub fn snare_engine_set_effect(engine: *mut SnareEngine, effect: c_int, wet: f64) -> c_int;
    pub fn snare_engine_set_pattern(engine: *mut SnareEngine, index: c_int, pattern: *const SnarePattern) -> c_int;
    pub fn snare_engine_cue_pattern(engine: *mut SnareEngine, index: c_int) -> c_int;
    pub fn snare_engine_set_panel(engine: *mut SnareEngine, panel: *const SnarePanel) -> c_int;
    pub fn snare_engine_set_song(engine: *mut SnareEngine, rhythms: *const u8, count: c_int, looped: c_int) -> c_int;
    pub fn snare_engine_arm_fill(engine: *mut SnareEngine, armed: c_int) -> c_int;
    pub fn snare_engine_play(engine: *mut SnareEngine) -> c_int;
    pub fn snare_engine_stop(engine: *mut SnareEngine) -> c_int;
    pub fn snare_engine_trigger(engine: *mut SnareEngine, track: c_int, accent: c_int) -> c_int;

    pub fn snare_engine_render(engine: *mut SnareEngine, left: *mut f32, right: *mut f32, frames: c_int);

    pub fn snare_engine_is_playing(engine: *const SnareEngine) -> c_int;
    pub fn snare_engine_current_step(engine: *const SnareEngine) -> c_int;
    pub fn snare_engine_current_pattern(engine: *const SnareEngine) -> c_int;
    pub fn snare_engine_frames_rendered(engine: *const SnareEngine) -> f64;
    pub fn snare_engine_stop_frame(engine: *const SnareEngine) -> f64;
    pub fn snare_engine_active_voices(engine: *const SnareEngine) -> c_int;
    pub fn snare_engine_stolen_voices(engine: *const SnareEngine) -> u32;
    pub fn snare_engine_output_level(engine: *const SnareEngine) -> f64;
    pub fn snare_engine_read_measures(engine: *mut SnareEngine, out: *mut SnareMeasure, max_measures: c_int) -> c_int;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::size_of;

    #[test]
    fn the_linked_engine_speaks_this_abi() {
        assert_eq!(unsafe { snare_abi_version() }, SNARE_ABI_VERSION);
    }

    /// The sizes the WebAssembly bridge writes by hand (`wasm-engine.ts`).
    #[test]
    fn the_structs_are_laid_out_as_the_header_has_them() {
        assert_eq!(size_of::<SnarePattern>(), 52);
        assert_eq!(size_of::<SnarePanel>(), 8);
        assert_eq!(size_of::<SnareMeasure>(), 24);
        assert_eq!(size_of::<SnareSoundParams>(), 24);
    }
}
