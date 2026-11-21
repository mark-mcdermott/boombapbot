//! Links that lead out of the window. The account's words link to pages of
//! the site, which the window must not turn into: they open in the person's
//! own browser, and the window stays on the machine.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// Whether an address is the app's own page: Tauri's on macOS and on Windows,
/// or the dev server's.
fn is_own_page(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost" | "localhost")),
        _ => false,
    }
}

/// Whether an address may be handed to the person's browser.
fn is_web_page(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

pub fn links<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("outside-links")
        .on_navigation(|_, url| {
            if is_own_page(url) {
                return true;
            }
            if is_web_page(url) {
                if let Err(error) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
                    eprintln!("The browser could not be opened for {url}: {error}");
                }
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(address: &str) -> Url {
        Url::parse(address).expect("an address")
    }

    #[test]
    fn the_window_keeps_its_own_pages() {
        for address in ["tauri://localhost/", "http://tauri.localhost/index.html", "http://localhost:4341/", "about:blank"] {
            assert!(is_own_page(&url(address)), "{address}");
        }
    }

    #[test]
    fn a_page_of_the_site_goes_to_the_browser() {
        let policies = url("https://boombapbot.com/policies");
        assert!(!is_own_page(&policies));
        assert!(is_web_page(&policies));
    }

    #[test]
    fn nothing_but_a_web_page_is_handed_on() {
        for address in ["file:///etc/passwd", "javascript:alert(1)", "smb://server/share", "tauri://elsewhere.example/"] {
            let address = url(address);
            assert!(!is_web_page(&address), "{address}");
        }
        assert!(!is_own_page(&url("file:///etc/passwd")));
    }
}
