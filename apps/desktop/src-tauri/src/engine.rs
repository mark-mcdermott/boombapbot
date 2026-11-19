//! The engine behind its C ABI, split the way its threading contract splits
//! it: an `Engine` for the one thread that makes control calls, and a
//! `Renderer` for the audio thread, which calls `snare_engine_render` and
//! nothing else.

use std::ffi::c_int;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use cpal::{FromSample, Sample};

use crate::ffi;
use crate::messages::{Command, Measure, MeasureKind, Panel, Pattern, Report, Sound, Variation};

/// The most frames one render call is asked for. A longer buffer is rendered
/// in pieces, which the engine promises sounds the same.
const RENDER_FRAMES: usize = 2048;
/// Measures read from the log at a time. A buffer rarely begins more than one.
const MEASURE_BATCH: usize = 16;
/// How long a control call waits for the audio thread to empty a full queue.
const QUEUE_WAIT: Duration = Duration::from_millis(250);

/// What the audio thread leaves for the control thread to read. Atomics
/// only: the audio thread never waits for whoever reads them.
#[derive(Debug, Default)]
pub struct Meter {
    /// The largest absolute output sample since it was last taken, as the bits of an `f32`.
    peak: AtomicU32,
    /// How many buffers the device has asked for.
    buffers: AtomicU64,
}

impl Meter {
    fn note(&self, peak: f32) {
        // The bits of a float that is not negative order as the float does.
        self.peak.fetch_max(peak.to_bits(), Ordering::Relaxed);
        self.buffers.fetch_add(1, Ordering::Relaxed);
    }

    /// The peak since the last call, which starts the next one from silence.
    pub fn take_peak(&self) -> f32 {
        f32::from_bits(self.peak.swap(0, Ordering::Relaxed))
    }

    pub fn buffers(&self) -> u64 {
        self.buffers.load(Ordering::Relaxed)
    }
}

/// One engine, for the thread that controls it.
pub struct Engine {
    raw: NonNull<ffi::SnareEngine>,
    sample_rate: f64,
}

// An engine is made on the control thread and stays there. What the audio
// thread gets is a `Renderer`.
unsafe impl Send for Engine {}

impl Engine {
    pub fn new(sample_rate: f64) -> Result<Self, String> {
        let abi = unsafe { ffi::snare_abi_version() };
        if abi != ffi::SNARE_ABI_VERSION {
            return Err(format!(
                "This app was built for engine ABI {}, and the engine linked into it is {abi}.",
                ffi::SNARE_ABI_VERSION
            ));
        }
        let raw = unsafe { ffi::snare_engine_create(sample_rate) };
        NonNull::new(raw)
            .map(|raw| Self { raw, sample_rate })
            .ok_or_else(|| format!("The engine cannot run at {sample_rate} Hz."))
    }

    pub fn sample_rate(&self) -> f64 {
        self.sample_rate
    }

    /// The audio thread's half of this engine.
    ///
    /// # Safety
    ///
    /// The engine must outlive every call to the renderer, and only one
    /// renderer of an engine may ever be called: `snare_engine_render` has
    /// one caller.
    pub unsafe fn renderer(&self, meter: Arc<Meter>) -> Renderer {
        Renderer {
            engine: self.raw,
            left: vec![0.0; RENDER_FRAMES].into_boxed_slice(),
            right: vec![0.0; RENDER_FRAMES].into_boxed_slice(),
            meter,
        }
    }

    /// Makes a queued control call. The queue empties at every buffer the
    /// audio thread renders, so a full one is waited for briefly.
    fn ask(&self, what: &str, call: impl Fn(*mut ffi::SnareEngine) -> c_int) -> Result<(), String> {
        let mut waited = Duration::ZERO;
        loop {
            match call(self.raw.as_ptr()) {
                ffi::SNARE_OK => return Ok(()),
                ffi::SNARE_ERR_QUEUE_FULL if waited < QUEUE_WAIT => {
                    thread::sleep(Duration::from_millis(1));
                    waited += Duration::from_millis(1);
                }
                code => return Err(format!("The engine refused {what} ({code}).")),
            }
        }
    }

    /// Does what one command asks. A sound made is acknowledged by its slot.
    pub fn apply(&self, command: &Command) -> Result<Option<Report>, String> {
        match command {
            Command::Synth { sound } => {
                self.synth(sound)?;
                return Ok(Some(Report::Sound { slot: sound.sound }));
            }
            Command::Tracks { tracks } => {
                for track in tracks {
                    self.ask("a track", |engine| unsafe {
                        ffi::snare_engine_set_track(engine, track.track, track.slot, track.pan, track.choke_group)
                    })?;
                    self.ask("a track's level", |engine| unsafe {
                        ffi::snare_engine_set_track_level(engine, track.track, track.gain)
                    })?;
                }
            }
            Command::Mix {
                plain,
                accented,
                master,
            } => {
                self.ask("the accent", |engine| unsafe {
                    ffi::snare_engine_set_accent(engine, *plain, *accented)
                })?;
                self.ask("the volume", |engine| unsafe {
                    ffi::snare_engine_set_master_volume(engine, *master)
                })?;
            }
            Command::Patterns { patterns } => {
                for entry in patterns {
                    let pattern = pattern_of(&entry.pattern)?;
                    self.ask("a pattern", |engine| unsafe {
                        ffi::snare_engine_set_pattern(engine, entry.index, &pattern)
                    })?;
                }
            }
            Command::Tempo { bpm } => self.ask("the tempo", |engine| unsafe {
                ffi::snare_engine_set_tempo(engine, *bpm)
            })?,
            Command::Panel { panel } => {
                let panel = panel_of(panel);
                self.ask("the panel", |engine| unsafe {
                    ffi::snare_engine_set_panel(engine, &panel)
                })?;
            }
            Command::Cue { pattern } => self.ask("a cue", |engine| unsafe {
                ffi::snare_engine_cue_pattern(engine, *pattern)
            })?,
            Command::Effect { effect, wet } => {
                self.ask("the effect", |engine| unsafe {
                    ffi::snare_engine_set_effect(engine, *effect, *wet)
                })?;
            }
            Command::Fill { armed } => {
                self.ask("the fill-in", |engine| unsafe {
                    ffi::snare_engine_arm_fill(engine, c_int::from(*armed))
                })?;
            }
            Command::Song { rhythms, looped } => {
                let count = c_int::try_from(rhythms.len()).map_err(|_| "The song is too long.".to_string())?;
                self.ask("a song", |engine| unsafe {
                    ffi::snare_engine_set_song(engine, rhythms.as_ptr(), count, c_int::from(*looped))
                })?;
            }
            Command::Play => self.ask("play", |engine| unsafe { ffi::snare_engine_play(engine) })?,
            Command::Stop => self.ask("stop", |engine| unsafe { ffi::snare_engine_stop(engine) })?,
            Command::Trigger { track, accent } => {
                self.ask("a hit", |engine| unsafe {
                    ffi::snare_engine_trigger(engine, *track, c_int::from(*accent))
                })?;
            }
        }
        Ok(None)
    }

    /// Synthesises a sound at this engine's rate, here on the control thread,
    /// and gives it to its slot.
    fn synth(&self, sound: &Sound) -> Result<(), String> {
        let params = ffi::SnareSoundParams {
            sound: sound.sound,
            tune: sound.tune,
            tone: sound.tone,
            decay: sound.decay,
            snappy: sound.snappy,
            seed: 0,
        };
        match unsafe { ffi::snare_engine_synth_sound(self.raw.as_ptr(), &params) } {
            ffi::SNARE_OK => Ok(()),
            code => Err(format!("Sound {} could not be made ({code}).", sound.sound)),
        }
    }

    /// Frees replaced sounds whose tails have finished.
    pub fn collect(&self) {
        unsafe { ffi::snare_engine_collect(self.raw.as_ptr()) };
    }

    /// Takes the measures begun since the last call, oldest first.
    pub fn take_measures(&self) -> Vec<Measure> {
        let mut taken = Vec::new();
        let mut batch = [ffi::SnareMeasure::default(); MEASURE_BATCH];
        loop {
            let count = unsafe {
                ffi::snare_engine_read_measures(self.raw.as_ptr(), batch.as_mut_ptr(), MEASURE_BATCH as c_int)
            };
            let count = usize::try_from(count).unwrap_or(0).min(MEASURE_BATCH);
            taken.extend(batch[..count].iter().map(|measure| Measure {
                frame: measure.frame,
                ordinal: measure.ordinal,
                pattern: measure.pattern,
                kind: match measure.kind {
                    1 => MeasureKind::Fill,
                    2 => MeasureKind::Intro,
                    _ => MeasureKind::Basic,
                },
                position: measure.position,
            }));
            if count < MEASURE_BATCH {
                return taken;
            }
        }
    }

    pub fn is_playing(&self) -> bool {
        unsafe { ffi::snare_engine_is_playing(self.raw.as_ptr()) != 0 }
    }

    pub fn current_step(&self) -> i32 {
        unsafe { ffi::snare_engine_current_step(self.raw.as_ptr()) }
    }

    pub fn current_pattern(&self) -> i32 {
        unsafe { ffi::snare_engine_current_pattern(self.raw.as_ptr()) }
    }

    pub fn frames_rendered(&self) -> f64 {
        unsafe { ffi::snare_engine_frames_rendered(self.raw.as_ptr()) }
    }

    pub fn stop_frame(&self) -> f64 {
        unsafe { ffi::snare_engine_stop_frame(self.raw.as_ptr()) }
    }

    pub fn active_voices(&self) -> i32 {
        unsafe { ffi::snare_engine_active_voices(self.raw.as_ptr()) }
    }

    pub fn stolen_voices(&self) -> u32 {
        unsafe { ffi::snare_engine_stolen_voices(self.raw.as_ptr()) }
    }

    pub fn output_level(&self) -> f64 {
        unsafe { ffi::snare_engine_output_level(self.raw.as_ptr()) }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        unsafe { ffi::snare_engine_destroy(self.raw.as_ptr()) };
    }
}

fn pattern_of(pattern: &Pattern) -> Result<ffi::SnarePattern, String> {
    if pattern.rows.len() > ffi::SNARE_TRACKS {
        return Err(format!(
            "A pattern has {} rows, and the engine has {} tracks.",
            pattern.rows.len(),
            ffi::SNARE_TRACKS
        ));
    }
    let mut rows = [0; ffi::SNARE_TRACKS];
    rows[..pattern.rows.len()].copy_from_slice(&pattern.rows);
    Ok(ffi::SnarePattern {
        rows,
        len1: pattern.first_length,
        len2: pattern.second_length,
        steps_per_beat: pattern.steps_per_beat,
        swing: pattern.swing,
    })
}

fn variation_of(variation: Variation) -> u8 {
    match variation {
        Variation::A => 0,
        Variation::Ab => 1,
        Variation::B => 2,
    }
}

fn panel_of(panel: &Panel) -> ffi::SnarePanel {
    ffi::SnarePanel {
        rhythm: panel.rhythm,
        variation: variation_of(panel.variation),
        fill_rhythm: panel.fill_rhythm,
        fill_variation: variation_of(panel.fill_variation),
        auto_fill: panel.auto_fill,
        first_beat_rule: u8::from(panel.first_beat_rule),
        reserved: [0; 2],
    }
}

/// The audio thread's half of an engine. Everything it touches was made
/// before the stream started: filling a buffer allocates nothing, takes no
/// lock and calls nothing but the engine's render.
pub struct Renderer {
    engine: NonNull<ffi::SnareEngine>,
    left: Box<[f32]>,
    right: Box<[f32]>,
    meter: Arc<Meter>,
}

// Handed to the audio thread once, when the stream is built, and called only there.
unsafe impl Send for Renderer {}

impl Renderer {
    /// Renders the next frames into a device's buffer of interleaved
    /// samples: left and right on its first two channels and silence on any
    /// others, or the two mixed down for a device with one.
    pub fn fill<T>(&mut self, output: &mut [T], channels: usize)
    where
        T: Sample + FromSample<f32>,
    {
        // A device always has a channel; this keeps a wrong count from dividing by nothing.
        let channels = channels.max(1);
        let mut peak = 0.0_f32;
        for block in output.chunks_mut(RENDER_FRAMES * channels) {
            let frames = block.len() / channels;
            // At most RENDER_FRAMES, the length of both buffers.
            unsafe {
                ffi::snare_engine_render(
                    self.engine.as_ptr(),
                    self.left.as_mut_ptr(),
                    self.right.as_mut_ptr(),
                    frames as c_int,
                )
            };
            let rendered = self.left[..frames].iter().zip(&self.right[..frames]);
            for (frame, (&left, &right)) in block.chunks_exact_mut(channels).zip(rendered) {
                // `max` passes over a sample that is not a number.
                peak = peak.max(left.abs()).max(right.abs());
                match frame {
                    [mono] => *mono = T::from_sample((left + right) * 0.5),
                    [first, second, others @ ..] => {
                        *first = T::from_sample(left);
                        *second = T::from_sample(right);
                        others.fill(T::EQUILIBRIUM);
                    }
                    [] => {}
                }
            }
        }
        self.meter.note(peak);
    }
}
