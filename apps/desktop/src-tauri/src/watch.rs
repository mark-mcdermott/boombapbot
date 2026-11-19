//! What the page is told about an engine at work, as often as the page's own
//! worklet tells it (`packages/editor/src/engine/worklet/processor.ts`):
//! every measure begun, a position only when it changes, the level thirty
//! times a second while it changes, and the stats ten times a second.

use std::time::{Duration, Instant};

use crate::engine::{Engine, Meter};
use crate::messages::Report;

const LEVEL_EVERY: Duration = Duration::from_nanos(1_000_000_000 / 30);
const STATS_EVERY: Duration = Duration::from_millis(100);

/// What was last told, so that only a change is told again.
pub struct Watch {
    step: i32,
    pattern: i32,
    playing: bool,
    stop_frame: f64,
    level: f64,
    peak_ever: f32,
    level_due: Instant,
    stats_due: Instant,
}

impl Watch {
    pub fn new(now: Instant) -> Self {
        Self {
            step: -1,
            pattern: -1,
            playing: false,
            stop_frame: -1.0,
            level: 0.0,
            peak_ever: 0.0,
            level_due: now + LEVEL_EVERY,
            stats_due: now + STATS_EVERY,
        }
    }

    /// The largest absolute output sample since the engine was made.
    pub fn peak_ever(&self) -> f32 {
        self.peak_ever
    }

    /// Reads the engine and reports what is new. For the control thread.
    pub fn look(&mut self, engine: &Engine, meter: &Meter, now: Instant, report: &mut dyn FnMut(Report)) {
        let measures = engine.take_measures();
        if !measures.is_empty() {
            report(Report::Measures { measures });
        }

        let stop_frame = engine.stop_frame();
        if stop_frame != self.stop_frame {
            self.stop_frame = stop_frame;
            if stop_frame >= 0.0 {
                report(Report::Ended);
            }
        }

        let (step, pattern, playing) = (engine.current_step(), engine.current_pattern(), engine.is_playing());
        if (step, pattern, playing) != (self.step, self.pattern, self.playing) {
            (self.step, self.pattern, self.playing) = (step, pattern, playing);
            report(Report::Position { step, pattern, playing });
        }

        if now >= self.level_due {
            self.level_due = now + LEVEL_EVERY;
            let level = engine.output_level();
            if level != self.level {
                self.level = level;
                report(Report::Level { level });
            }
        }

        if now >= self.stats_due {
            self.stats_due = now + STATS_EVERY;
            let peak = meter.take_peak();
            self.peak_ever = self.peak_ever.max(peak);
            report(Report::Stats {
                frames: engine.frames_rendered(),
                peak,
                peak_ever: self.peak_ever,
                voices: engine.active_voices(),
                stolen: engine.stolen_voices(),
            });
            // A sound a knob replaced is freed here, once its tail has rung out.
            engine.collect();
        }
    }
}
