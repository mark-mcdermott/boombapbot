//! boombapbot on a desktop: the shared editor in a window, playing through
//! the engine built natively and a CPAL output stream.

mod bridge;
mod check;
pub mod engine;
mod ffi;
pub mod messages;
mod output;
mod outside;
mod save;
pub mod watch;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use bridge::Bridge;
use messages::Command;

/// The event every report from the engine reaches the page on.
const REPORT_EVENT: &str = "engine-report";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    sample_rate: f64,
}

/// Opens the sound device and makes the engine at its rate.
#[tauri::command(async)]
fn engine_open(bridge: State<'_, Bridge>) -> Result<Opened, String> {
    bridge.open().map(|sample_rate| Opened { sample_rate })
}

/// Hands the engine these commands, in this order.
#[tauri::command(async)]
fn engine_send(bridge: State<'_, Bridge>, commands: Vec<Command>) -> Result<(), String> {
    bridge.send(commands)
}

#[tauri::command(async)]
fn engine_close(bridge: State<'_, Bridge>) -> Result<(), String> {
    bridge.close()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(outside::links())
        .manage(save::ExportPlace::default())
        .setup(|app| {
            let page = app.handle().clone();
            app.manage(Bridge::start(Box::new(move |report| {
                // A report with no window left to read it is not an error.
                let _ = page.emit(REPORT_EVENT, report);
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_open,
            engine_send,
            engine_close,
            save::export_ask,
            save::export_write,
            check::check_mode,
            check::check_lose,
            check::check_engine,
            check::check_exports,
            check::check_report,
        ])
        .run(tauri::generate_context!())
        .expect("boombapbot could not start");
}
