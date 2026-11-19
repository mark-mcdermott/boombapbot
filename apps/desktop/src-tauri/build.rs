use std::env;
use std::path::PathBuf;

/// The machine this app is. The engine is only ever built for one.
const MACHINE: &str = "ritm12";

/// Builds the engine with the repository's own CMake, as a static library
/// with the machine's voices in it, and links it.
fn main() {
    let repository = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo sets the manifest directory"))
        .join("../../..")
        .canonicalize()
        .expect("the app sits two folders into the repository");
    let engine = repository.join("engine");
    let machine = repository.join(format!("packages/machine-{MACHINE}"));
    let library = format!("boombapbot_engine_{MACHINE}");

    // Always optimised: the audio thread cannot wait for a debug build of the engine.
    let built = cmake::Config::new(&engine)
        .profile("Release")
        .define("SNARE_BUILD_TESTS", "OFF")
        .define("SNARE_BUILD_TOOLS", "OFF")
        .define("BOOMBAPBOT_MACHINE_DIRS", &machine)
        .build_target(&library)
        .build();
    let libraries = built.join(format!("build/machines/machine-{MACHINE}"));
    println!("cargo:rustc-link-search=native={}", libraries.display());
    // Where a generator that keeps every configuration side by side puts it.
    println!("cargo:rustc-link-search=native={}", libraries.join("Release").display());
    println!("cargo:rustc-link-lib=static={library}");

    // The engine is C++ behind its C ABI, so its runtime comes along.
    match env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("macos" | "ios") => println!("cargo:rustc-link-lib=c++"),
        Ok("windows") => {}
        _ => println!("cargo:rustc-link-lib=stdc++"),
    }

    for sources in [
        engine.join("CMakeLists.txt"),
        engine.join("cmake"),
        engine.join("include"),
        engine.join("src"),
        machine.join("engine"),
    ] {
        println!("cargo:rerun-if-changed={}", sources.display());
    }

    tauri_build::build();
}
