//! The license file the app shares with the plugin: one place on the machine
//! that both read, so unlocking the app unlocks the plugin (see
//! docs/license-file.md, "The file on a machine"). The page sends the file's
//! text and never names a place on the disk; whether the text is a good
//! license is for whoever reads it to check.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const FOLDER: &str = "boombapbot";
const FILE: &str = "boombapbot.license";
const PREFIX: &str = "boombapbot-license.";
/// No license file is near this long (`LICENSE_FILE_MAX_LENGTH` in the contracts).
const MAX_LENGTH: usize = 2048;

/// Where the file is kept, under the folder the system gives a person's settings.
fn place_in(settings: &Path) -> PathBuf {
    settings.join(FOLDER).join(FILE)
}

fn place(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .config_dir()
        .map(|settings| place_in(&settings))
        .map_err(|error| format!("This system has no folder for settings: {error}"))
}

/// Whether text has the shape of a license file: its prefix, and only the
/// characters one is written in. Nothing else is ever written to the disk here.
fn is_license_shaped(text: &str) -> bool {
    text.len() <= MAX_LENGTH
        && text.strip_prefix(PREFIX).is_some_and(|rest| {
            !rest.is_empty()
                && rest
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}

/// The file's text, or nothing when there is no file.
fn read(place: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(place) {
        Ok(text) => Ok(Some(text.trim().to_string())),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("The license file could not be read: {error}")),
    }
}

/// Writes the file whole: beside itself first, then moved into place, so the
/// plugin never reads half of one.
fn write(place: &Path, text: &str) -> Result<(), String> {
    if !is_license_shaped(text) {
        return Err("That is not a license file.".to_string());
    }
    let failed = |error: std::io::Error| format!("The license file could not be kept: {error}");
    let folder = place.parent().ok_or("The license file has no folder to go in.")?;
    fs::create_dir_all(folder).map_err(failed)?;
    let beside = place.with_extension("license.new");
    fs::write(&beside, text).map_err(failed)?;
    fs::rename(&beside, place).map_err(failed)
}

/// Removes the file. One that is not there is already removed.
fn remove(place: &Path) -> Result<(), String> {
    match fs::remove_file(place) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("The license file could not be removed: {error}")),
    }
}

#[tauri::command(async)]
pub fn license_read(app: AppHandle) -> Result<Option<String>, String> {
    read(&place(&app)?)
}

#[tauri::command(async)]
pub fn license_write(app: AppHandle, file: String) -> Result<(), String> {
    write(&place(&app)?, &file)
}

#[tauri::command(async)]
pub fn license_remove(app: AppHandle) -> Result<(), String> {
    remove(&place(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const LICENSE: &str = "boombapbot-license.eyJ2ZXJzaW9uIjoxfQ.mPyrMgMf4Pcw9sm3Z8j3_-BA";

    /// A folder of this test's own, removed when the test is done with it.
    struct Settings(PathBuf);

    impl Settings {
        fn new(name: &str) -> Self {
            let folder = std::env::temp_dir().join(format!("boombapbot-license-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&folder);
            Settings(folder)
        }
    }

    impl Drop for Settings {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_file_is_where_the_plugin_looks_for_it() {
        let place = place_in(Path::new("/settings"));
        assert_eq!(place, Path::new("/settings/boombapbot/boombapbot.license"));
    }

    #[test]
    fn a_file_is_kept_read_back_and_removed() {
        let settings = Settings::new("kept");
        let place = place_in(&settings.0);
        assert_eq!(read(&place), Ok(None));
        write(&place, LICENSE).expect("kept");
        assert_eq!(read(&place), Ok(Some(LICENSE.to_string())));
        assert!(!place.with_extension("license.new").exists());
        remove(&place).expect("removed");
        assert_eq!(read(&place), Ok(None));
        remove(&place).expect("removed again, with nothing there");
    }

    #[test]
    fn a_newer_file_replaces_the_one_kept() {
        let settings = Settings::new("replaced");
        let place = place_in(&settings.0);
        let newer = format!("{LICENSE}A");
        write(&place, LICENSE).expect("kept");
        write(&place, &newer).expect("replaced");
        assert_eq!(read(&place), Ok(Some(newer)));
    }

    #[test]
    fn a_file_is_read_without_the_line_ending_an_editor_left() {
        let settings = Settings::new("trimmed");
        let place = place_in(&settings.0);
        fs::create_dir_all(place.parent().expect("a folder")).expect("made");
        fs::write(&place, format!("{LICENSE}\r\n")).expect("written");
        assert_eq!(read(&place), Ok(Some(LICENSE.to_string())));
    }

    #[test]
    fn only_text_shaped_like_a_license_is_written() {
        let settings = Settings::new("refused");
        let place = place_in(&settings.0);
        let long = format!("{PREFIX}{}", "A".repeat(MAX_LENGTH));
        for text in [
            "",
            "boombapbot-license.",
            "BOOM-7K3QF-9XW2M-HT4RD-6VNPA",
            "boombapbot-license.a b",
            "boombapbot-license.a\n../x",
            "boombapbot-license.a/b",
            &long,
        ] {
            assert!(write(&place, text).is_err(), "{text:?}");
        }
        assert_eq!(read(&place), Ok(None));
    }
}
