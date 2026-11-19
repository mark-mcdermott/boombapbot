//! The audio thread's half of the bridge, driven here with no sound device:
//! the test asks for buffers as a device would. The engine's own promise
//! that its render does not allocate is held by its `test_realtime`; this
//! holds the Rust around it to the same, and checks what comes out.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Arc;
use std::time::{Duration, Instant};

use boombapbot_desktop::engine::{Engine, Meter, Renderer};
use boombapbot_desktop::messages::{BankPattern, Command, MeasureKind, Pattern, Report, Sound, Track};
use boombapbot_desktop::watch::Watch;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static HEAP_CALLS: Cell<usize> = const { Cell::new(0) };
}

/// The system's allocator, counting what a thread asks of it while that thread says to.
struct Counting;

fn note() {
    let _ = COUNTING.try_with(|counting| {
        if counting.get() {
            let _ = HEAP_CALLS.try_with(|calls| calls.set(calls.get() + 1));
        }
    });
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note();
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        note();
        System.dealloc(pointer, layout)
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        note();
        System.realloc(pointer, layout, size)
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// How many times this thread went to the heap while `work` ran.
fn heap_calls(work: impl FnOnce()) -> usize {
    HEAP_CALLS.with(|calls| calls.set(0));
    COUNTING.with(|counting| counting.set(true));
    work();
    COUNTING.with(|counting| counting.set(false));
    HEAP_CALLS.with(|calls| calls.get())
}

const RATE: f64 = 48_000.0;
const KICK: i32 = 1;
const HAT: i32 = 2;

/// An engine told a beat the way the page tells one: two sounds on two
/// tracks, a kick on every beat and a hat between, round and round.
fn engine_with_a_beat() -> Engine {
    let engine = Engine::new(RATE).expect("an engine at 48 kHz");
    let knobs = |sound| Sound {
        sound,
        tune: 0.5,
        tone: 0.5,
        decay: 0.5,
        snappy: 0.5,
    };
    let beat = [
        Command::Tempo { bpm: 120.0 },
        Command::Tracks {
            tracks: vec![
                Track {
                    track: KICK,
                    slot: 0,
                    pan: 0.0,
                    choke_group: 0,
                    gain: 0.9,
                },
                Track {
                    track: HAT,
                    slot: 2,
                    pan: 0.3,
                    choke_group: 0,
                    gain: 0.6,
                },
            ],
        },
        Command::Mix {
            plain: 0.7,
            accented: 1.0,
            master: 0.8,
        },
        Command::Patterns {
            patterns: vec![BankPattern {
                index: 0,
                pattern: Pattern {
                    rows: vec![0, 0x1111, 0x4444],
                    first_length: 16,
                    second_length: 0,
                    steps_per_beat: 4,
                    swing: 0,
                },
            }],
        },
        Command::Cue { pattern: 0 },
        Command::Effect { effect: 0, wet: 0.0 },
    ];
    for command in &beat {
        assert_eq!(engine.apply(command), Ok(None), "{command:?}");
    }
    for sound in [0, 2] {
        assert_eq!(
            engine.apply(&Command::Synth { sound: knobs(sound) }),
            Ok(Some(Report::Sound { slot: sound }))
        );
    }
    engine
}

fn renderer_of(engine: &Engine) -> (Renderer, Arc<Meter>) {
    let meter = Arc::new(Meter::default());
    // The one renderer of this engine, called on this thread while the engine lives.
    (unsafe { engine.renderer(meter.clone()) }, meter)
}

fn all_reports(watch: &mut Watch, engine: &Engine, meter: &Meter, now: Instant) -> Vec<Report> {
    let mut reports = Vec::new();
    watch.look(engine, meter, now, &mut |report| reports.push(report));
    reports
}

#[test]
fn filling_a_buffer_never_goes_to_the_heap() {
    let engine = engine_with_a_beat();
    let (mut renderer, meter) = renderer_of(&engine);
    engine.apply(&Command::Play).expect("play");

    // Buffers as devices ask for them: short, long, longer than one render, and of odd lengths.
    let mut stereo = vec![0.0_f32; 2 * 5000];
    let mut mono = vec![0_i16; 4096];
    let mut surround = vec![0.0_f32; 6 * 512];
    let calls = heap_calls(|| {
        for frames in [64, 128, 256, 480, 512, 1024, 2048, 4096, 5000, 1, 333] {
            renderer.fill(&mut stereo[..2 * frames], 2);
        }
        for _ in 0..40 {
            renderer.fill(&mut mono, 1);
            renderer.fill(&mut surround, 6);
            // A tapped hit reaches the engine through its queue while the beat plays.
            engine
                .apply(&Command::Trigger {
                    track: KICK,
                    accent: true,
                })
                .expect("a hit");
        }
    });

    assert_eq!(calls, 0, "the audio callback allocated or freed");
    assert!(meter.take_peak() > 0.05, "the beat was silent");
    assert!(engine.frames_rendered() > RATE, "more than a second was rendered");
}

#[test]
fn a_buffer_holds_the_beat_however_many_channels_the_device_has() {
    let engine = engine_with_a_beat();
    let (mut renderer, meter) = renderer_of(&engine);
    engine.apply(&Command::Play).expect("play");
    let loudest = |samples: &mut dyn Iterator<Item = f32>| samples.fold(0.0_f32, |peak, sample| peak.max(sample.abs()));

    let mut stereo = vec![0.0_f32; 2 * 4800];
    renderer.fill(&mut stereo, 2);
    let stereo_peak = loudest(&mut stereo.iter().copied());
    assert!(stereo_peak > 0.05);
    assert_eq!(
        meter.take_peak(),
        stereo_peak,
        "the meter holds the largest sample written"
    );

    let mut surround = vec![1.0_f32; 6 * 4800];
    renderer.fill(&mut surround, 6);
    assert!(loudest(&mut surround.chunks(6).flat_map(|frame| [frame[0], frame[1]])) > 0.0);
    assert!(
        surround.chunks(6).all(|frame| frame[2..] == [0.0; 4]),
        "channels past the second are silent"
    );

    let mut mono = vec![0_i16; 4800];
    renderer.fill(&mut mono, 1);
    assert!(
        mono.iter().any(|&sample| sample.unsigned_abs() > 1000),
        "sixteen-bit mono carries the beat too"
    );
}

#[test]
fn the_page_is_told_what_the_worklet_would_tell_it() {
    let engine = engine_with_a_beat();
    let (mut renderer, meter) = renderer_of(&engine);
    let start = Instant::now();
    let mut watch = Watch::new(start);
    let mut buffer = vec![0.0_f32; 2 * 256];

    // Stopped: where the engine stands, once, and nothing after it.
    renderer.fill(&mut buffer, 2);
    assert_eq!(
        all_reports(&mut watch, &engine, &meter, start),
        [Report::Position {
            step: -1,
            pattern: 0,
            playing: false
        }]
    );
    assert_eq!(all_reports(&mut watch, &engine, &meter, start), []);

    // Playing: the measure that began and the step that sounded, each once.
    engine.apply(&Command::Play).expect("play");
    renderer.fill(&mut buffer, 2);
    let reports = all_reports(&mut watch, &engine, &meter, start);
    assert!(
        matches!(&reports[..], [Report::Measures { measures }, Report::Position { step: 0, pattern: 0, playing: true }]
            if measures.len() == 1 && measures[0].ordinal == 1 && measures[0].kind == MeasureKind::Basic),
        "{reports:?}"
    );
    assert_eq!(all_reports(&mut watch, &engine, &meter, start), []);

    // A step is an eighth of a second at this tempo: the next one is reported when it sounds.
    for _ in 0..(RATE as usize / 8 / 256 + 1) {
        renderer.fill(&mut buffer, 2);
    }
    assert_eq!(
        all_reports(&mut watch, &engine, &meter, start),
        [Report::Position {
            step: 1,
            pattern: 0,
            playing: true
        }]
    );

    // The meter thirty times a second and the stats ten: neither before its time.
    let reports = all_reports(&mut watch, &engine, &meter, start + Duration::from_millis(40));
    assert!(
        matches!(&reports[..], [Report::Level { level }] if *level > 0.0),
        "{reports:?}"
    );
    let reports = all_reports(&mut watch, &engine, &meter, start + Duration::from_millis(110));
    let [Report::Stats {
        frames,
        peak,
        peak_ever,
        voices,
        stolen: 0,
    }] = &reports[..]
    else {
        panic!("{reports:?}");
    };
    assert_eq!(*frames, engine.frames_rendered());
    assert!(*peak > 0.05 && peak == peak_ever && *voices >= 1);
    assert_eq!(watch.peak_ever(), *peak);

    // The next stats start from silence, and remember the loudest so far.
    let reports = all_reports(&mut watch, &engine, &meter, start + Duration::from_millis(220));
    assert!(
        matches!(&reports[..], [Report::Stats { peak, peak_ever, .. }] if *peak == 0.0 && *peak_ever > 0.05),
        "{reports:?}"
    );

    engine.apply(&Command::Stop).expect("stop");
    renderer.fill(&mut buffer, 2);
    assert_eq!(
        all_reports(&mut watch, &engine, &meter, start),
        [Report::Position {
            step: -1,
            pattern: 0,
            playing: false
        }]
    );
}

#[test]
fn a_command_the_engine_cannot_take_is_refused_in_words() {
    let engine = engine_with_a_beat();
    let refused = |command: Command| engine.apply(&command).expect_err("a refusal");
    assert!(refused(Command::Tempo { bpm: -1.0 }).contains("the tempo"));
    assert!(refused(Command::Cue { pattern: 99 }).contains("a cue"));
    assert!(refused(Command::Synth {
        sound: Sound {
            sound: 99,
            tune: 0.5,
            tone: 0.5,
            decay: 0.5,
            snappy: 0.5
        }
    })
    .contains("Sound 99"));
    let crowded = Pattern {
        rows: vec![0; 13],
        first_length: 16,
        second_length: 0,
        steps_per_beat: 4,
        swing: 0,
    };
    assert!(refused(Command::Patterns {
        patterns: vec![BankPattern {
            index: 0,
            pattern: crowded
        }]
    })
    .contains("13 rows"));
    assert!(Engine::new(1000.0).is_err());
}
