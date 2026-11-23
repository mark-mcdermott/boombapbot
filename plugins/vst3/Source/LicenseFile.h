// The upgrade's signed license file: what the server hands a buyer so that a
// program can tell, with no server to ask, that it was paid for. The format
// and the steps of the check are written down in docs/license-file.md, and
// packages/contracts/src/license-file.ts makes the same check for the site
// and the apps. Change the three together.
#pragma once

#include <juce_core/juce_core.h>

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace boombapbot::plugin {

using LicenseKey = std::array<std::uint8_t, 32>;

// The public half of the key the server signs with: the bytes that
// LICENSE_PUBLIC_KEY in packages/contracts/src/license-file.ts spells in
// base64url. A test reads that file and fails if the two ever differ.
inline constexpr LicenseKey kLicensePublicKey{{0xcb, 0xcd, 0x44, 0x78, 0xc3, 0x2c, 0xe1, 0xec, 0x3c, 0xfb, 0x7a,
                                               0x2c, 0xc0, 0x45, 0x6a, 0x35, 0x4c, 0xca, 0xa6, 0x9f, 0x43, 0x07,
                                               0x86, 0x2e, 0xc7, 0xef, 0xfa, 0x19, 0x72, 0x6e, 0x16, 0x09}};

inline constexpr std::string_view kLicenseFilePrefix = "boombapbot-license";
inline constexpr int kLicenseFileVersion = 1;
// Everything the one-time upgrade pays for. A name the plugin does not know is ignored.
inline constexpr const char* kUpgradeUnlock = "upgrade";
// No license file is near this long. Anything longer is not read at all.
inline constexpr std::size_t kLicenseFileLongest = 2048;

// Why a file was refused. `malformed`: it is not a license file, or not a
// whole one. `badSignature`: it was changed, or signed with another key.
// `unsupportedVersion`: it is properly signed, in a format this plugin does
// not read.
enum class LicenseRefusal { malformed, badSignature, unsupportedVersion };

// The refusal as the site and the apps name it.
const char* licenseRefusalName(LicenseRefusal refusal);

struct LicenseCheck {
  // Nothing, when the file is a good one.
  std::optional<LicenseRefusal> refusal;
  juce::String licenseId;
  juce::String issuedAt;
  juce::StringArray unlocks;

  bool valid() const { return !refusal.has_value(); }
  bool unlocksUpgrade() const { return valid() && unlocks.contains(kUpgradeUnlock); }
};

// Whether that text is a license file signed by the holder of `publicKey`,
// and what it unlocks. It reads no file and asks no server. Nothing in the
// text is believed until the signature over it has held, and space around
// it, such as the line ending an editor adds, is not part of it.
LicenseCheck verifyLicenseFile(std::string_view text, const LicenseKey& publicKey = kLicensePublicKey);

// The upgrade as a machine holds it: the text of a license file that checked
// out and pays for it, or nothing.
struct Upgrade {
  std::string licenseFile;
  bool held() const { return !licenseFile.empty(); }
};

// That text as an upgrade: held when it checks out against `publicKey` and unlocks it.
Upgrade upgradeFrom(std::string_view text, const LicenseKey& publicKey = kLicensePublicKey);

// Where the desktop app and the plugin keep the one file they share. This
// environment variable names another place, for the tests.
inline constexpr const char* kLicenseFileVariable = "BOOMBAPBOT_LICENSE_FILE";
juce::File licenseFileOnThisMachine();

// The file's text. A file that is missing, cannot be read or is too long to
// be a license file is no text, and no error.
std::string readLicenseFile(const juce::File& file);

// The upgrade this machine holds, read from its license file. It reads the
// disk, so it is not for the audio thread.
Upgrade upgradeOnThisMachine(const LicenseKey& publicKey = kLicensePublicKey);

}  // namespace boombapbot::plugin
