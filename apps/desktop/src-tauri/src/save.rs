//! Where an exported file goes: the person is asked where to keep it, and it
//! is written there. The page names the file and sends its bytes; it never
//! names a place on the disk.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::check;

/// The place the person chose for the export now being saved.
#[derive(Default)]
pub struct ExportPlace(Mutex<Option<PathBuf>>);

impl ExportPlace {
    fn set(&self, place: Option<PathBuf>) {
        *self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = place;
    }

    fn take(&self) -> Option<PathBuf> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take()
    }
}

/// Asks where to keep a file of this name. False when the person turned it down.
#[tauri::command]
pub async fn export_ask(app: AppHandle, place: State<'_, ExportPlace>, name: String) -> Result<bool, String> {
    // Only ever a file's name: whatever else came with it is dropped.
    let name = Path::new(&name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("boombapbot-beat")
        .to_string();
    // In a check run there is nobody to ask, so the file goes to a folder of the check's own.
    if let Some(folder) = check::export_folder() {
        place.set(Some(folder.join(name)));
        return Ok(true);
    }
    let chosen = app
        .dialog()
        .file()
        .set_file_name(name)
        .blocking_save_file()
        .map(|chosen| {
            chosen
                .into_path()
                .map_err(|error| format!("That place cannot be written to: {error}"))
        })
        .transpose()?;
    let asked = chosen.is_some();
    place.set(chosen);
    Ok(asked)
}

/// Writes the bytes sent to the place just chosen, once.
#[tauri::command(async)]
pub fn export_write(place: State<'_, ExportPlace>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("An export is sent as bytes.".into());
    };
    let place = place.take().ok_or("Nobody was asked where to keep this file.")?;
    fs::write(&place, bytes).map_err(|error| format!("{} could not be written: {error}", place.display()))
}
