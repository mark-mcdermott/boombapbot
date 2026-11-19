//! A run of the app that checks itself, for whoever builds it: with
//! `BOOMBAPBOT_DESKTOP_CHECK` set, the page plays a beat as a person would
//! (`runShellCheck` in `packages/editor/src/shell-check.ts`), what the page
//! saw and what the engine did are printed as one line of JSON, and the app
//! closes. `reopen` as its value also makes
//! the engine again halfway, as a change of sound device does. The run
//! exports each kind of file too, to a folder of its own in the system's
//! temporary folder, since nobody is there to be asked where to keep them.

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process;
use std::sync::Once;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::bridge::Bridge;

const VARIABLE: &str = "BOOMBAPBOT_DESKTOP_CHECK";
const GIVE_UP_AFTER: Duration = Duration::from_secs(90);

static STARTED: Once = Once::new();

fn mode() -> Option<String> {
    env::var(VARIABLE).ok().filter(|mode| !mode.is_empty())
}

const NOT_ASKED: &str = "This is not a check run.";

/// Where a check run's exports are written, in place of asking.
pub fn export_folder() -> Option<PathBuf> {
    mode().map(|_| env::temp_dir().join("boombapbot-desktop-check"))
}

/// Empties the check's own folder of what an earlier run exported.
fn start_with_no_exports() -> Result<(), String> {
    let folder = export_folder().ok_or(NOT_ASKED)?;
    if folder.exists() {
        fs::remove_dir_all(&folder).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&folder).map_err(|error| error.to_string())
}

/// What the run was asked for, or nothing when it is not a check run. The
/// first time it is asked in a check run, the check's folder is emptied and
/// a clock starts that ends a check that never finishes.
#[tauri::command(async)]
pub fn check_mode() -> Result<Option<String>, String> {
    let Some(mode) = mode() else { return Ok(None) };
    let mut started = Ok(());
    STARTED.call_once(|| {
        thread::spawn(|| {
            thread::sleep(GIVE_UP_AFTER);
            println!(
                "{}",
                json!({ "ok": false, "report": { "failed": "the check did not finish" } })
            );
            process::exit(2);
        });
        started = start_with_no_exports();
    });
    started.map(|()| Some(mode))
}

/// As if the sound device had said its stream cannot go on.
#[tauri::command(async)]
pub fn check_lose(bridge: State<'_, Bridge>) -> Result<(), String> {
    mode().ok_or(NOT_ASKED)?;
    bridge.lose()
}

/// What the engine and its device say of themselves now.
#[tauri::command(async)]
pub fn check_engine(bridge: State<'_, Bridge>) -> Result<Value, String> {
    mode().ok_or(NOT_ASKED)?;
    serde_json::to_value(bridge.snapshot()?).map_err(|error| error.to_string())
}

/// The files this run has exported: each one's name, its length and how it begins.
#[tauri::command(async)]
pub fn check_exports() -> Result<Value, String> {
    let folder = export_folder().ok_or(NOT_ASKED)?;
    let mut exports = Vec::new();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        exports.push(json!({
            "name": path.file_name().map(|name| name.to_string_lossy()),
            "bytes": bytes.len(),
            "begins": String::from_utf8_lossy(&bytes[..bytes.len().min(4)]),
        }));
    }
    Ok(Value::Array(exports))
}

/// Prints what the page found and closes the app, with 0 if the page says
/// the check passed: a beat played and was not silent, by its own account
/// and the engine's.
#[tauri::command(async)]
pub fn check_report(app: AppHandle, report: Value) -> Result<(), String> {
    mode().ok_or(NOT_ASKED)?;
    let ok = report.get("ok").and_then(Value::as_bool).unwrap_or(false);
    println!("{}", json!({ "ok": ok, "report": report }));
    app.exit(if ok { 0 } else { 1 });
    Ok(())
}
