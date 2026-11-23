#include "LicenseFile.h"

#include <monocypher-ed25519.h>

#include <algorithm>
#include <cmath>
#include <vector>

namespace boombapbot::plugin {
namespace {

using Bytes = std::vector<std::uint8_t>;

constexpr char kSeparator = '.';
constexpr std::size_t kSignatureBytes = 64;

// What JavaScript's trim takes off either end, in UTF-8, so the plugin and
// the site call the same text a file: the ASCII space, U+00A0, U+1680, U+2000
// to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF.
constexpr std::array<std::string_view, 25> kSpace{{
    " ",            "\t",           "\n",           "\v",           "\f",           "\r",           "\xc2\xa0",
    "\xe1\x9a\x80", "\xe2\x80\x80", "\xe2\x80\x81", "\xe2\x80\x82", "\xe2\x80\x83", "\xe2\x80\x84", "\xe2\x80\x85",
    "\xe2\x80\x86", "\xe2\x80\x87", "\xe2\x80\x88", "\xe2\x80\x89", "\xe2\x80\x8a", "\xe2\x80\xa8", "\xe2\x80\xa9",
    "\xe2\x80\xaf", "\xe2\x81\x9f", "\xe3\x80\x80", "\xef\xbb\xbf",
}};

std::string_view trimmed(std::string_view text) {
  const auto spaceAt = [&text](bool front) -> std::size_t {
    for (const std::string_view space : kSpace) {
      if (front ? text.starts_with(space) : text.ends_with(space)) return space.size();
    }
    return 0;
  };
  while (const std::size_t length = spaceAt(true)) text.remove_prefix(length);
  while (const std::size_t length = spaceAt(false)) text.remove_suffix(length);
  return text;
}

int sextet(char letter) {
  if (letter >= 'A' && letter <= 'Z') return letter - 'A';
  if (letter >= 'a' && letter <= 'z') return letter - 'a' + 26;
  if (letter >= '0' && letter <= '9') return letter - '0' + 52;
  if (letter == '-') return 62;
  if (letter == '_') return 63;
  return -1;
}

// The bytes that base64url text spells, or nothing unless it is exactly how
// they would be written: no padding, no letter outside the alphabet, and no
// bits left over that an encoder would have written as zero.
std::optional<Bytes> fromBase64Url(std::string_view text) {
  if (text.empty() || text.size() % 4 == 1) return std::nullopt;
  Bytes bytes;
  bytes.reserve(text.size() * 3 / 4);
  std::uint32_t held = 0;
  int bits = 0;
  for (const char letter : text) {
    const int value = sextet(letter);
    if (value < 0) return std::nullopt;
    held = (held << 6) | static_cast<std::uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push_back(static_cast<std::uint8_t>(held >> bits));
      held &= (1u << bits) - 1u;
    }
  }
  if (held != 0) return std::nullopt;
  return bytes;
}

// ---- The signature ------------------------------------------------------------

// A point is written as its y, least byte first, with the sign of its x in
// the top bit. The field's prime is 2^255 - 19.
constexpr std::uint8_t kPrimeLeastByte = 0xed;

// The y of each of the curve's eight points of small order: two of them have
// y = 0, and the four of order eight share the last two.
constexpr std::array<LicenseKey, 5> kSmallOrderYs{{
    {{0x00}},
    {{0x01}},
    {{0xec, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f}},
    {{0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0,
      0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05}},
    {{0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f,
      0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a}},
}};

// Monocypher checks the equation, and with it that S is below the group
// order and that R is written canonically. It takes any public key that is a
// point, so the two things a strict check also asks of the key are asked
// here: that its y is below the prime, and that it is not of small order. A
// point with x = 0 and the sign bit set has no canonical form; both such
// points are of small order and go out with them, whatever their sign bit.
bool isStrictPublicKey(const LicenseKey& key) {
  LicenseKey y = key;
  y.back() &= 0x7f;
  const bool belowThePrime = y.back() != 0x7f || y.front() < kPrimeLeastByte ||
                             std::any_of(y.begin() + 1, y.end() - 1, [](std::uint8_t byte) { return byte != 0xff; });
  return belowThePrime && std::find(kSmallOrderYs.begin(), kSmallOrderYs.end(), y) == kSmallOrderYs.end();
}

bool signedBy(const LicenseKey& publicKey, std::string_view message, const Bytes& signature) {
  return isStrictPublicKey(publicKey) &&
         crypto_ed25519_check(signature.data(), publicKey.data(),
                              reinterpret_cast<const std::uint8_t*>(message.data()), message.size()) == 0;
}

// ---- The payload --------------------------------------------------------------

bool isHex(char letter) {
  return (letter >= '0' && letter <= '9') || (letter >= 'a' && letter <= 'f') || (letter >= 'A' && letter <= 'F');
}

bool isDigit(char letter) { return letter >= '0' && letter <= '9'; }

constexpr std::string_view kNilUuid = "00000000-0000-0000-0000-000000000000";
constexpr std::string_view kMaxUuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// A UUID as the site's check takes one: of versions 1 to 8 in the RFC's variant, or the nil or the max one.
bool isUuid(std::string_view text) {
  if (text == kNilUuid || text == kMaxUuid) return true;
  if (text.size() != kNilUuid.size()) return false;
  for (std::size_t index = 0; index < text.size(); ++index) {
    const bool dash = kNilUuid[index] == '-';
    if (dash ? text[index] != '-' : !isHex(text[index])) return false;
  }
  constexpr std::size_t kVersionAt = 14;
  constexpr std::size_t kVariantAt = 19;
  return text[kVersionAt] >= '1' && text[kVersionAt] <= '8' &&
         std::string_view("89abAB").find(text[kVariantAt]) != std::string_view::npos;
}

// A moment as the site's check takes one: a real date, a time to the second
// or finer, and a Z. 2026-11-22T12:00:00.000Z.
bool isMoment(std::string_view text) {
  constexpr std::string_view kShape = "0000-00-00T00:00:00";
  if (text.size() <= kShape.size() || text.back() != 'Z') return false;
  for (std::size_t index = 0; index < kShape.size(); ++index) {
    if (kShape[index] == '0' ? !isDigit(text[index]) : text[index] != kShape[index]) return false;
  }
  const std::string_view fraction = text.substr(kShape.size(), text.size() - kShape.size() - 1);
  if (!fraction.empty() && (fraction.front() != '.' || fraction.size() == 1 ||
                            !std::all_of(fraction.begin() + 1, fraction.end(), isDigit))) {
    return false;
  }

  const auto number = [text](std::size_t at, std::size_t digits) {
    int value = 0;
    for (std::size_t index = at; index < at + digits; ++index) value = value * 10 + (text[index] - '0');
    return value;
  };
  const int year = number(0, 4);
  const int month = number(5, 2);
  const int day = number(8, 2);
  const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
  constexpr std::array<int, 12> kDays{{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}};
  if (month < 1 || month > 12) return false;
  const int days = kDays[static_cast<std::size_t>(month - 1)] + (month == 2 && leap ? 1 : 0);
  return day >= 1 && day <= days && number(11, 2) <= 23 && number(14, 2) <= 59 && number(17, 2) <= 59;
}

bool isNumber(const juce::var& value) {
  return value.isInt() || value.isInt64() || (value.isDouble() && std::isfinite(static_cast<double>(value)));
}

// The payload as JSON, or nothing: it has to be UTF-8 through and through.
juce::var readPayload(const Bytes& payload) {
  const auto* const text = reinterpret_cast<const char*>(payload.data());
  const int size = static_cast<int>(payload.size());
  if (std::find(payload.begin(), payload.end(), 0) != payload.end()) return {};
  if (!juce::CharPointer_UTF8::isValidString(text, size)) return {};
  juce::var read;
  if (juce::JSON::parse(juce::String::fromUTF8(text, size), read).failed()) return {};
  return read;
}

LicenseCheck refused(LicenseRefusal refusal) {
  LicenseCheck check;
  check.refusal = refusal;
  return check;
}

}  // namespace

const char* licenseRefusalName(LicenseRefusal refusal) {
  switch (refusal) {
    case LicenseRefusal::malformed:
      return "malformed";
    case LicenseRefusal::badSignature:
      return "bad_signature";
    case LicenseRefusal::unsupportedVersion:
      return "unsupported_version";
  }
  return "malformed";
}

LicenseCheck verifyLicenseFile(std::string_view text, const LicenseKey& publicKey) {
  if (text.size() > kLicenseFileLongest) return refused(LicenseRefusal::malformed);
  const std::string_view file = trimmed(text);
  const std::size_t signatureAt = file.rfind(kSeparator);
  if (signatureAt == std::string_view::npos || std::count(file.begin(), file.end(), kSeparator) != 2) {
    return refused(LicenseRefusal::malformed);
  }
  const std::string_view signedPart = file.substr(0, signatureAt);
  const std::size_t payloadAt = signedPart.find(kSeparator);
  if (signedPart.substr(0, payloadAt) != kLicenseFilePrefix) return refused(LicenseRefusal::malformed);

  const std::optional<Bytes> payloadBytes = fromBase64Url(signedPart.substr(payloadAt + 1));
  const std::optional<Bytes> signature = fromBase64Url(file.substr(signatureAt + 1));
  if (!payloadBytes || !signature || signature->size() != kSignatureBytes) return refused(LicenseRefusal::malformed);

  if (!signedBy(publicKey, signedPart, *signature)) return refused(LicenseRefusal::badSignature);

  // Only now is the payload read.
  const juce::var payload = readPayload(*payloadBytes);
  if (payload.getDynamicObject() == nullptr) return refused(LicenseRefusal::malformed);
  const juce::var& version = payload["version"];
  if (!isNumber(version)) return refused(LicenseRefusal::malformed);
  if (!juce::exactlyEqual(static_cast<double>(version), static_cast<double>(kLicenseFileVersion))) {
    return refused(LicenseRefusal::unsupportedVersion);
  }

  const juce::var& licenseId = payload["licenseId"];
  const juce::var& issuedAt = payload["issuedAt"];
  const juce::Array<juce::var>* const unlocks = payload["unlocks"].getArray();
  if (!licenseId.isString() || !isUuid(licenseId.toString().toStdString()) || !issuedAt.isString() ||
      !isMoment(issuedAt.toString().toStdString()) || unlocks == nullptr || unlocks->isEmpty()) {
    return refused(LicenseRefusal::malformed);
  }
  LicenseCheck check;
  for (const juce::var& name : *unlocks) {
    if (!name.isString() || name.toString().isEmpty()) return refused(LicenseRefusal::malformed);
    check.unlocks.add(name.toString());
  }
  check.licenseId = licenseId.toString();
  check.issuedAt = issuedAt.toString();
  return check;
}

Upgrade upgradeFrom(std::string_view text, const LicenseKey& publicKey) {
  if (!verifyLicenseFile(text, publicKey).unlocksUpgrade()) return {};
  return {std::string(text)};
}

juce::File licenseFileOnThisMachine() {
  const juce::String elsewhere = juce::SystemStats::getEnvironmentVariable(kLicenseFileVariable, {});
  if (elsewhere.isNotEmpty()) return juce::File::getCurrentWorkingDirectory().getChildFile(elsewhere);

#if JUCE_MAC
  // JUCE's folder for application data on macOS is ~/Library.
  const juce::File settings =
      juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("Application Support");
#elif JUCE_WINDOWS
  const juce::File settings = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory);
#else
  const juce::String chosen = juce::SystemStats::getEnvironmentVariable("XDG_CONFIG_HOME", {});
  const juce::File settings = juce::File::isAbsolutePath(chosen)
                                  ? juce::File(chosen)
                                  : juce::File::getSpecialLocation(juce::File::userHomeDirectory).getChildFile(".config");
#endif
  return settings.getChildFile("boombapbot").getChildFile("boombapbot.license");
}

std::string readLicenseFile(const juce::File& file) {
  if (!file.existsAsFile() || file.getSize() > static_cast<juce::int64>(kLicenseFileLongest)) return {};
  juce::MemoryBlock bytes;
  if (!file.loadFileAsData(bytes)) return {};
  return {static_cast<const char*>(bytes.getData()), bytes.getSize()};
}

Upgrade upgradeOnThisMachine(const LicenseKey& publicKey) {
  return upgradeFrom(readLicenseFile(licenseFileOnThisMachine()), publicKey);
}

}  // namespace boombapbot::plugin
