//! The one thread that controls the engine. Tauri's commands run on threads
//! of their own, so each hands its request to this thread and waits for the
//! answer: every control call the engine gets comes from here, and the
//! sound device's callback is left as the only caller of its render.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::messages::{Command, Report};
use crate::output::{DeviceFacts, Output, StreamNews};
use crate::watch::Watch;

/// How often the engine is read while it plays: often enough that a step is
/// reported within a few milliseconds of sounding.
const PLAYING_PAUSE: Duration = Duration::from_millis(4);
/// And while it is stopped, when only the meter and the stats move.
const RESTING_PAUSE: Duration = Duration::from_millis(16);

/// Where reports go: to the page.
pub type Sink = Box<dyn Fn(Report) + Send>;

enum Request {
    Open(Sender<Result<f64, String>>),
    Send(Vec<Command>, Sender<Result<(), String>>),
    Close(Sender<()>),
    Snapshot(Sender<Option<Snapshot>>),
    Lose,
}

/// The engine and its device as they stand, for diagnostics.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub device: DeviceFacts,
    pub playing: bool,
    pub frames_rendered: f64,
    /// Buffers the device has asked for.
    pub buffers: u64,
    pub output_level: f64,
    pub peak_ever: f32,
    pub xruns: u32,
    /// Times the engine was made again because the device changed.
    pub reopened: u32,
}

/// The way to the control thread. Cheap to clone; the thread ends with the last one.
#[derive(Clone)]
pub struct Bridge {
    requests: Sender<Request>,
}

const GONE: &str = "The engine's thread has stopped.";

impl Bridge {
    pub fn start(sink: Sink) -> Self {
        let (requests, received) = mpsc::channel();
        thread::Builder::new()
            .name("boombapbot-engine".into())
            .spawn(move || {
                Control {
                    sink,
                    sounding: None,
                    reopened: 0,
                }
                .run(received)
            })
            .expect("the engine's control thread starts");
        Self { requests }
    }

    fn ask<Answer>(&self, request: impl FnOnce(Sender<Answer>) -> Request) -> Result<Answer, String> {
        let (answer, answered) = mpsc::channel();
        self.requests.send(request(answer)).map_err(|_| GONE.to_string())?;
        answered.recv().map_err(|_| GONE.to_string())
    }

    /// Opens the sound device and makes the engine at its rate, which is the answer.
    pub fn open(&self) -> Result<f64, String> {
        self.ask(Request::Open)?
    }

    /// Hands the engine these commands, in this order.
    pub fn send(&self, commands: Vec<Command>) -> Result<(), String> {
        self.ask(|answer| Request::Send(commands, answer))?
    }

    pub fn close(&self) -> Result<(), String> {
        self.ask(Request::Close)
    }

    pub fn snapshot(&self) -> Result<Option<Snapshot>, String> {
        self.ask(Request::Snapshot)
    }

    /// For the check run: as if the device had said its stream cannot go on.
    pub fn lose(&self) -> Result<(), String> {
        self.requests.send(Request::Lose).map_err(|_| GONE.to_string())
    }
}

struct Sounding {
    output: Output,
    watch: Watch,
}

impl Sounding {
    fn new(output: Output) -> Self {
        Self {
            output,
            watch: Watch::new(Instant::now()),
        }
    }

    fn pause(&self) -> Duration {
        if self.output.engine.is_playing() {
            PLAYING_PAUSE
        } else {
            RESTING_PAUSE
        }
    }
}

struct Control {
    sink: Sink,
    sounding: Option<Sounding>,
    reopened: u32,
}

impl Control {
    fn run(mut self, requests: Receiver<Request>) {
        loop {
            let waited = match &self.sounding {
                Some(sounding) => requests.recv_timeout(sounding.pause()),
                // Nothing to watch, so nothing wakes this thread but a request.
                None => requests.recv().map_err(|_| RecvTimeoutError::Disconnected),
            };
            match waited {
                Ok(request) => self.answer(request),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            self.watch();
        }
    }

    // A command that has stopped waiting for its answer is not an error here.
    fn answer(&mut self, request: Request) {
        match request {
            Request::Open(answer) => {
                let _ = answer.send(self.open());
            }
            Request::Send(commands, answer) => {
                let _ = answer.send(self.apply(&commands));
            }
            Request::Close(answer) => {
                self.sounding = None;
                let _ = answer.send(());
            }
            Request::Snapshot(answer) => {
                let _ = answer.send(self.snapshot());
            }
            Request::Lose => {
                if let Some(sounding) = &self.sounding {
                    sounding.output.news.say(StreamNews::LOST);
                }
            }
        }
    }

    /// Whoever asks has no engine: a page just loaded, or one whose engine
    /// failed. An engine still here belongs to a page that is gone, so it
    /// goes, and with it whatever it was playing.
    fn open(&mut self) -> Result<f64, String> {
        self.sounding = None;
        let output = Output::open()?;
        let sample_rate = output.engine.sample_rate();
        self.sounding = Some(Sounding::new(output));
        Ok(sample_rate)
    }

    fn apply(&self, commands: &[Command]) -> Result<(), String> {
        let sounding = self.sounding.as_ref().ok_or("The engine is not open.")?;
        for command in commands {
            if let Some(report) = sounding.output.engine.apply(command)? {
                (self.sink)(report);
            }
        }
        Ok(())
    }

    fn snapshot(&self) -> Option<Snapshot> {
        let Sounding { output, watch } = self.sounding.as_ref()?;
        Some(Snapshot {
            device: DeviceFacts {
                buffer_frames: output.buffer_frames(),
                ..output.facts.clone()
            },
            playing: output.engine.is_playing(),
            frames_rendered: output.engine.frames_rendered(),
            buffers: output.meter.buffers(),
            output_level: output.engine.output_level(),
            peak_ever: watch.peak_ever(),
            xruns: output.news.xruns(),
            reopened: self.reopened,
        })
    }

    /// Hears what the device said, and tells the page what the engine did.
    fn watch(&mut self) {
        let Some(Sounding { output, watch }) = &mut self.sounding else {
            return;
        };
        let news = output.news.take();
        let lost = news & StreamNews::LOST != 0;
        // A stream that followed the default device to another one plays on
        // there. It is the engine that must go if that device runs at another rate.
        let moved = news & StreamNews::MOVED != 0
            && Output::default_rate().is_some_and(|rate| f64::from(rate) != output.engine.sample_rate());
        if lost || moved {
            self.reopen();
            return;
        }
        let sink = &self.sink;
        watch.look(&output.engine, &output.meter, Instant::now(), &mut |report| {
            sink(report)
        });
    }

    /// Makes the engine again at the device's rate as it is now. The page
    /// then tells the new engine the beat again, which makes its sounds at
    /// that rate.
    fn reopen(&mut self) {
        // The stream goes first and its engine after it: see `Output`.
        self.sounding = None;
        self.reopened += 1;
        match Output::open() {
            Ok(output) => {
                let sample_rate = output.engine.sample_rate();
                self.sounding = Some(Sounding::new(output));
                (self.sink)(Report::Ready { sample_rate });
            }
            Err(message) => (self.sink)(Report::Error { message }),
        }
    }
}
