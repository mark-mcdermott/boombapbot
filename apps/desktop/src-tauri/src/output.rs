//! The sound device: a CPAL output stream whose callback is the one caller
//! of the engine's render, and the engine it plays, made at the device's rate.

use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BufferSize, Device, ErrorKind, FromSample, SampleFormat, SizedSample, Stream, StreamConfig, SupportedBufferSize,
};

use crate::engine::{Engine, Meter, Renderer};

/// The buffer asked of a device that lets one be chosen: short enough that a
/// tapped hit sounds at once.
const BUFFER_FRAMES: u32 = 256;
/// How long a device is given to start.
const START_TIMEOUT: Duration = Duration::from_secs(5);

/// What the device says about a stream since it was last asked. CPAL may say
/// it on the audio thread, so saying it is setting a bit and no more.
#[derive(Debug, Default)]
pub struct StreamNews {
    flags: AtomicU8,
    xruns: AtomicU32,
}

impl StreamNews {
    /// The default device changed and the stream followed it there.
    pub const MOVED: u8 = 1;
    /// The stream cannot go on as it is: its device left, or its rate changed.
    pub const LOST: u8 = 2;

    pub fn say(&self, flag: u8) {
        self.flags.fetch_or(flag, Ordering::Relaxed);
    }

    /// The news since the last call.
    pub fn take(&self) -> u8 {
        self.flags.swap(0, Ordering::Relaxed)
    }

    pub fn xruns(&self) -> u32 {
        self.xruns.load(Ordering::Relaxed)
    }

    fn hear(&self, kind: ErrorKind) {
        match kind {
            ErrorKind::DeviceChanged => self.say(Self::MOVED),
            ErrorKind::Xrun => {
                self.xruns.fetch_add(1, Ordering::Relaxed);
            }
            // The stream plays on, without the scheduling it asked for.
            ErrorKind::RealtimeDenied => {}
            _ => self.say(Self::LOST),
        }
    }
}

/// What a device was opened as, for diagnostics.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFacts {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: String,
    /// Frames in each buffer the device asks for, where it says.
    pub buffer_frames: Option<u32>,
}

/// An engine and the stream that plays it. The stream is first, so that it
/// is gone, and its callback with it, before the engine is.
pub struct Output {
    stream: Stream,
    pub engine: Engine,
    pub meter: Arc<Meter>,
    pub news: Arc<StreamNews>,
    pub facts: DeviceFacts,
}

impl Output {
    /// Opens the default output device and makes an engine at its rate.
    pub fn open() -> Result<Self, String> {
        let device = cpal::default_host()
            .default_output_device()
            .ok_or("There is no sound output device.")?;
        let supported = device
            .default_output_config()
            .map_err(|error| format!("The sound device gave no format: {error}"))?;
        let mut config = supported.config();
        config.buffer_size = match supported.buffer_size() {
            SupportedBufferSize::Range { min, max } => BufferSize::Fixed(BUFFER_FRAMES.clamp(*min, *max)),
            SupportedBufferSize::Unknown => BufferSize::Default,
        };

        let engine = Engine::new(f64::from(config.sample_rate))?;
        let meter = Arc::new(Meter::default());
        let news = Arc::new(StreamNews::default());
        // The one renderer of this engine, called only by the stream below, which `Output` drops first.
        let renderer = unsafe { engine.renderer(meter.clone()) };
        let stream = build(&device, config, supported.sample_format(), renderer, news.clone())?;
        stream
            .play()
            .map_err(|error| format!("The sound device did not start: {error}"))?;

        let facts = DeviceFacts {
            name: device
                .description()
                .map(|description| description.name().to_string())
                .unwrap_or_default(),
            sample_rate: config.sample_rate,
            channels: config.channels,
            sample_format: supported.sample_format().to_string(),
            buffer_frames: stream.buffer_size().ok(),
        };
        Ok(Self {
            stream,
            engine,
            meter,
            news,
            facts,
        })
    }

    /// The rate the default output device runs at now, which is another
    /// device's once the default has changed.
    pub fn default_rate() -> Option<u32> {
        let device = cpal::default_host().default_output_device()?;
        Some(device.default_output_config().ok()?.sample_rate())
    }

    /// Frames in each buffer the device asks for now.
    pub fn buffer_frames(&self) -> Option<u32> {
        self.stream.buffer_size().ok()
    }
}

fn build(
    device: &Device,
    config: StreamConfig,
    format: SampleFormat,
    renderer: Renderer,
    news: Arc<StreamNews>,
) -> Result<Stream, String> {
    match format {
        SampleFormat::F32 => stream::<f32>(device, config, renderer, news),
        SampleFormat::F64 => stream::<f64>(device, config, renderer, news),
        SampleFormat::I16 => stream::<i16>(device, config, renderer, news),
        SampleFormat::I32 => stream::<i32>(device, config, renderer, news),
        SampleFormat::U16 => stream::<u16>(device, config, renderer, news),
        other => Err(format!(
            "The sound device wants {other} samples, which this app does not write."
        )),
    }
}

fn stream<T>(
    device: &Device,
    config: StreamConfig,
    mut renderer: Renderer,
    news: Arc<StreamNews>,
) -> Result<Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels);
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _: &cpal::OutputCallbackInfo| renderer.fill(output, channels),
            move |error: cpal::Error| news.hear(error.kind()),
            Some(START_TIMEOUT),
        )
        .map_err(|error| format!("The sound device could not be opened: {error}"))
}
