// Checks the plugin's reading of the upgrade's license file against
// docs/license-file.md, whose worked example it reads from the page itself,
// and against the key in packages/contracts/src/license-file.ts. Prints one
// line per check and exits non-zero if any check fails.
//
//   ctest --test-dir build/vst3 -R license_file --output-on-failure

#include "LicenseFile.h"
#include "TestLicense.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#if !JUCE_WINDOWS
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace {

using namespace boombapbot::plugin;
using namespace boombapbot::plugin::testing;

int failures = 0;
int checks = 0;

void check(bool passed, const std::string& what) {
  ++checks;
  if (!passed) ++failures;
  std::printf("%s %s\n", passed ? "ok  " : "FAIL", what.c_str());
}

const char* said(const LicenseCheck& result) {
  return result.valid() ? "valid" : licenseRefusalName(*result.refusal);
}

bool refusedAs(const LicenseCheck& result, LicenseRefusal refusal) { return result.refusal == refusal; }

constexpr std::string_view kAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// ---- What the page and the contract say ---------------------------------------

std::string readWhole(const char* path) { return juce::File(path).loadFileAsString().toStdString(); }

// The text between `before` and `after`, the first time `before` is met.
std::string between(const std::string& text, std::string_view before, std::string_view after) {
  const std::size_t start = text.find(before);
  if (start == std::string::npos) return {};
  const std::size_t from = start + before.size();
  const std::size_t end = text.find(after, from);
  return end == std::string::npos ? std::string() : text.substr(from, end - from);
}

template <std::size_t Size>
std::optional<std::array<std::uint8_t, Size>> fromHex(const std::string& hex) {
  if (hex.size() != Size * 2 || !juce::String(hex).containsOnly("0123456789abcdef")) return std::nullopt;
  std::array<std::uint8_t, Size> bytes{};
  for (std::size_t index = 0; index < Size; ++index) {
    bytes[index] = static_cast<std::uint8_t>(juce::String(hex.substr(index * 2, 2)).getHexValue32());
  }
  return bytes;
}

struct WorkedExample {
  std::string file;
  std::string payload;
  std::optional<Seed> seed;
  std::optional<LicenseKey> publicKey;
};

WorkedExample workedExample() {
  const std::string page = readWhole(BOOMBAPBOT_LICENSE_PAGE);
  const std::string prefix = std::string(kLicenseFilePrefix) + ".";
  const std::string example = between(page, "```\n" + prefix + "ey", "\n```");
  return {example.empty() ? std::string() : prefix + "ey" + example, between(page, "```json\n", "\n```"),
          fromHex<32>(between(page, "- Seed: `", "`")), fromHex<32>(between(page, "- Public key: `", "`"))};
}

void testTheBuiltInKey() {
  const std::string contract = readWhole(BOOMBAPBOT_LICENSE_CONTRACT);
  const std::string theirs = between(contract, "export const LICENSE_PUBLIC_KEY = '", "'");
  const std::string ours = toBase64Url(kLicensePublicKey.data(), kLicensePublicKey.size());
  check(!theirs.empty() && theirs == ours,
        "the key built into the plugin is LICENSE_PUBLIC_KEY of packages/contracts/src/license-file.ts (" + ours + ")");
}

// ---- The worked example ---------------------------------------------------------

void testTheWorkedExample(const WorkedExample& example) {
  check(!example.file.empty() && !example.payload.empty() && example.seed && example.publicKey,
        "docs/license-file.md holds a worked example: a payload, a file, a seed and a public key");
  if (example.file.empty() || !example.seed || !example.publicKey) return;

  const LicenseCheck result = verifyLicenseFile(example.file, *example.publicKey);
  check(result.valid() && result.unlocksUpgrade() && result.licenseId == "3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394" &&
            result.issuedAt == "2026-11-22T12:00:00.000Z" && result.unlocks == juce::StringArray("upgrade"),
        std::string("the page's example verifies against the page's key and unlocks the upgrade (") + said(result) + ")");

  const KeyPair pair = keyPairFrom(*example.seed);
  check(pair.publicKey == *example.publicKey && pair.publicKey == rfcKeyPair().publicKey,
        "the page's seed makes the page's public key, the pair of RFC 8032's first test");
  check(licenseFileSaying(example.payload, pair) == example.file && example.payload == kUpgradePayload,
        "signing the page's payload with that seed writes the page's file, letter for letter");

  check(refusedAs(verifyLicenseFile(example.file), LicenseRefusal::badSignature) &&
            refusedAs(verifyLicenseFile(example.file, throwawayKeyPair().publicKey), LicenseRefusal::badSignature),
        "against the plugin's own key, or a key made this minute, it is refused as bad_signature");

  for (const std::string_view around : {"\n", "\r\n", "  \t", "\xef\xbb\xbf"}) {
    const std::string padded = std::string(around) + example.file + std::string(around);
    if (!verifyLicenseFile(padded, *example.publicKey).unlocksUpgrade()) {
      check(false, "space around the line is not part of it");
      return;
    }
  }
  check(true, "space around the line is not part of it: line endings, tabs, a byte order mark");
}

void testEveryChange(const WorkedExample& example) {
  if (example.file.empty() || !example.publicKey) return;
  const std::string& file = example.file;
  const LicenseKey& key = *example.publicKey;

  // Every letter, turned into every other letter of the alphabet and into a
  // few that are in no license file.
  int changes = 0;
  int taken = 0;
  int misread = 0;
  for (std::size_t at = 0; at < file.size(); ++at) {
    for (const char letter : std::string(kAlphabet) + ".=+/ ") {
      if (letter == file[at]) continue;
      std::string changed = file;
      changed[at] = letter;
      const LicenseCheck result = verifyLicenseFile(changed, key);
      ++changes;
      if (result.valid()) ++taken;
      if (refusedAs(result, LicenseRefusal::unsupportedVersion)) ++misread;
    }
  }
  check(taken == 0 && misread == 0,
        "every one-character change to the example is refused, and none as a version (" + std::to_string(changes) +
            " changes, " + std::to_string(taken) + " taken)");

  int cutsTaken = 0;
  for (std::size_t length = 0; length < file.size(); ++length) {
    if (verifyLicenseFile(file.substr(0, length), key).valid()) ++cutsTaken;
  }
  check(cutsTaken == 0, "cut short at every length, from nothing to one letter missing, it is refused (" +
                            std::to_string(file.size()) + " lengths)");

  int editsTaken = 0;
  for (std::size_t at = 0; at <= file.size(); ++at) {
    std::string longer = file;
    longer.insert(at, 1, 'A');
    std::string shorter = file;
    if (at < file.size()) shorter.erase(at, 1);
    if (verifyLicenseFile(longer, key).valid() || (at < file.size() && verifyLicenseFile(shorter, key).valid())) {
      ++editsTaken;
    }
  }
  check(editsTaken == 0, "a letter put in or taken out anywhere is refused");
}

// ---- Payloads, signed properly ----------------------------------------------------

void testPayloads() {
  const KeyPair pair = rfcKeyPair();
  const auto verdict = [&pair](std::string_view payload) {
    return verifyLicenseFile(licenseFileSaying(payload, pair), pair.publicKey);
  };
  const auto fields = [](std::string_view version, std::string_view id, std::string_view issued, std::string_view unlocks) {
    return std::string("{\"version\":") + std::string(version) + ",\"licenseId\":" + std::string(id) +
           ",\"issuedAt\":" + std::string(issued) + ",\"unlocks\":" + std::string(unlocks) + "}";
  };
  constexpr std::string_view kId = "\"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394\"";
  constexpr std::string_view kIssued = "\"2026-11-22T12:00:00.000Z\"";
  constexpr std::string_view kUnlocks = "[\"upgrade\"]";

  struct Case {
    const char* name;
    std::string payload;
  };

  const std::vector<Case> good{
      {"the fields in another order, with one this plugin does not know",
       R"({"unlocks":["upgrade"],"seat":3,"issuedAt":"2026-11-22T12:00:00.000Z","licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","version":1})"},
      {"space between the fields", "{ \"version\" : 1,\n \"licenseId\" : " + std::string(kId) +
                                       ", \"issuedAt\" : " + std::string(kIssued) + ", \"unlocks\" : [ \"upgrade\" ] }"},
      {"a name it does not know beside the upgrade", fields("1", kId, kIssued, "[\"stems\",\"upgrade\"]")},
      {"version 1.0, which is the number 1", fields("1.0", kId, kIssued, kUnlocks)},
      {"a moment to the second", fields("1", kId, "\"2028-02-29T23:59:59Z\"", kUnlocks)},
      {"the nil UUID", fields("1", "\"00000000-0000-0000-0000-000000000000\"", kIssued, kUnlocks)},
      {"a UUID in capitals", fields("1", "\"3F2B8C1E-9A47-4D0B-B6E2-5C81F0A7D394\"", kIssued, kUnlocks)},
  };
  for (const Case& entry : good) {
    const LicenseCheck result = verdict(entry.payload);
    check(result.unlocksUpgrade(), std::string("a signed payload with ") + entry.name + " unlocks the upgrade (" + said(result) + ")");
  }

  const LicenseCheck other = verdict(fields("1", kId, kIssued, "[\"stems\"]"));
  check(other.valid() && !other.unlocksUpgrade() && !upgradeFrom(licenseFileSaying(fields("1", kId, kIssued, "[\"stems\"]"), pair), pair.publicKey).held(),
        "a good file whose unlocks does not hold \"upgrade\" is a license and does not unlock the upgrade");
  const LicenseCheck near = verdict(fields("1", kId, kIssued, "[\"Upgrade\",\"upgrade \",\"upgrades\"]"));
  check(near.valid() && !near.unlocksUpgrade(), "nor do names that are only like \"upgrade\"");

  const std::vector<Case> versions{
      {"version 2", fields("2", kId, kIssued, kUnlocks)},
      {"version 0", fields("0", kId, kIssued, kUnlocks)},
      {"version 1.5", fields("1.5", kId, kIssued, kUnlocks)},
      {"version -1", fields("-1", kId, kIssued, kUnlocks)},
      {"version 2 and nothing else it knows", R"({"version":2,"holder":"somebody"})"},
  };
  for (const Case& entry : versions) {
    const LicenseCheck result = verdict(entry.payload);
    check(refusedAs(result, LicenseRefusal::unsupportedVersion),
          std::string("a signed payload of ") + entry.name + " is refused as unsupported_version (" + said(result) + ")");
  }

  const std::vector<Case> malformed{
      {"text that is not JSON", "this is not JSON"},
      {"nothing but a number", "1"},
      {"a list", "[1,2,3]"},
      {"null", "null"},
      {"a string", "\"upgrade\""},
      {"an empty object", "{}"},
      {"JSON cut short", std::string(kUpgradePayload.substr(0, kUpgradePayload.size() - 1))},
      {"bytes that are not UTF-8", std::string("{\"version\":1,\"note\":\"\xff\xfe\"}")},
      {"a zero byte in it", std::string(kUpgradePayload) + std::string(1, '\0')},
      {"no version", R"({"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","issuedAt":"2026-11-22T12:00:00.000Z","unlocks":["upgrade"]})"},
      {"its version as text", fields("\"1\"", kId, kIssued, kUnlocks)},
      {"its version as true", fields("true", kId, kIssued, kUnlocks)},
      {"no licenseId", R"({"version":1,"issuedAt":"2026-11-22T12:00:00.000Z","unlocks":["upgrade"]})"},
      {"a licenseId that is no UUID", fields("1", "\"license-1\"", kIssued, kUnlocks)},
      {"a licenseId a letter short", fields("1", "\"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d39\"", kIssued, kUnlocks)},
      {"a licenseId of no version a UUID has", fields("1", "\"3f2b8c1e-9a47-0d0b-b6e2-5c81f0a7d394\"", kIssued, kUnlocks)},
      {"a licenseId that is a number", fields("1", "7", kIssued, kUnlocks)},
      {"no issuedAt", R"({"version":1,"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","unlocks":["upgrade"]})"},
      {"a date for issuedAt, with no time", fields("1", kId, "\"2026-11-22\"", kUnlocks)},
      {"an issuedAt with no Z", fields("1", kId, "\"2026-11-22T12:00:00.000\"", kUnlocks)},
      {"an issuedAt in another zone", fields("1", kId, "\"2026-11-22T12:00:00+01:00\"", kUnlocks)},
      {"the thirtieth of February", fields("1", kId, "\"2026-02-30T12:00:00Z\"", kUnlocks)},
      {"the twenty-ninth of February in a year that has none", fields("1", kId, "\"2026-02-29T12:00:00Z\"", kUnlocks)},
      {"twenty-five o'clock", fields("1", kId, "\"2026-11-22T25:00:00Z\"", kUnlocks)},
      {"an issuedAt with no seconds", fields("1", kId, "\"2026-11-22T12:00Z\"", kUnlocks)},
      {"no unlocks", R"({"version":1,"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","issuedAt":"2026-11-22T12:00:00.000Z"})"},
      {"unlocks that is empty", fields("1", kId, kIssued, "[]")},
      {"unlocks that is one name and not a list", fields("1", kId, kIssued, "\"upgrade\"")},
      {"an empty name in unlocks", fields("1", kId, kIssued, "[\"upgrade\",\"\"]")},
      {"a number in unlocks", fields("1", kId, kIssued, "[\"upgrade\",1]")},
  };
  for (const Case& entry : malformed) {
    const LicenseCheck result = verdict(entry.payload);
    check(refusedAs(result, LicenseRefusal::malformed),
          std::string("a signed payload that is ") + entry.name + " is refused as malformed (" + said(result) + ")");
  }
}

// ---- The line and its letters -------------------------------------------------------

void testTheLine() {
  const KeyPair pair = rfcKeyPair();
  const std::string file = licenseFileSaying(kUpgradePayload, pair);
  const std::string prefix(kLicenseFilePrefix);
  const std::string payload = toBase64Url(kUpgradePayload);
  const std::size_t signatureAt = file.rfind('.');
  const std::string signature = file.substr(signatureAt + 1);
  const auto malformed = [&pair](const std::string& text) {
    return refusedAs(verifyLicenseFile(text, pair.publicKey), LicenseRefusal::malformed);
  };

  check(malformed("") && malformed("   \n") && malformed(".") && malformed("..") && malformed(prefix) &&
            malformed(prefix + "." + payload) && malformed(prefix + "." + payload + ".") &&
            malformed(prefix + ".." + signature) && malformed(file + ".extra") && malformed("." + payload + "." + signature),
        "nothing, a line of fewer or more than three parts, and a part left empty are each malformed");
  check(malformed(withSignature("boombapbot-licence." + payload, pair)) &&
            malformed(withSignature("Boombapbot-License." + payload, pair)) &&
            malformed(withSignature("x" + prefix + "." + payload, pair)),
        "a line that starts with anything but boombapbot-license is malformed, signed or not");

  // Padding, and the letters of the other base64, are refused before the
  // signature is looked at, so a signature over them does not help.
  check(malformed(withSignature(prefix + "." + payload + "=", pair)) && malformed(file + "=") && malformed(file + "==") &&
            malformed(prefix + "." + payload + "==." + signature),
        "padding on the payload or on the signature is malformed");
  // The payload's base64 has a + or a / only where base64url has a - or a _.
  const std::string odd = "{\"version\":1,\"note\":\"\xc3\xbf\xc3\xbe\xc3\xbf\xc3\xbe?>?>\"}";
  std::string classic = toBase64Url(odd);
  const bool differs = classic.find('-') != std::string::npos || classic.find('_') != std::string::npos;
  std::replace(classic.begin(), classic.end(), '-', '+');
  std::replace(classic.begin(), classic.end(), '_', '/');
  check(differs && malformed(withSignature(prefix + "." + classic, pair)) &&
            malformed(withSignature(prefix + "." + payload + "!", pair)) &&
            malformed(withSignature(prefix + "." + payload.substr(0, 10) + " " + payload.substr(10), pair)) &&
            malformed(withSignature(prefix + "." + payload.substr(0, 10) + "\xc3\xa9" + payload.substr(10), pair)),
        "a letter outside base64url is malformed: +, /, !, a space inside the line, a letter that is not ASCII");

  // Letters that leave bits over, which no encoder writes.
  const std::string twoOver = toBase64Url("{\"a\":1} ");
  const std::string fourOver = toBase64Url("{\"a\":1}");
  std::string looseTwo = twoOver;
  looseTwo.back() = kAlphabet[kAlphabet.find(looseTwo.back()) + 1];
  std::string looseFour = fourOver;
  looseFour.back() = kAlphabet[kAlphabet.find(looseFour.back()) + 1];
  check(twoOver.size() % 4 == 3 && fourOver.size() % 4 == 2 && malformed(withSignature(prefix + "." + looseTwo, pair)) &&
            malformed(withSignature(prefix + "." + looseFour, pair)) && malformed(withSignature(prefix + ".AAAAA", pair)),
        "text that would not encode back to itself is malformed: bits left over, or one letter alone");

  std::string shortSignature = signature;
  shortSignature.resize(signature.size() - 2);
  check(signature.size() == 86 && malformed(prefix + "." + payload + "." + shortSignature) &&
            malformed(prefix + "." + payload + "." + signature + "AA"),
        "a signature that is not 64 bytes is malformed");

  // Length is counted before the space around the line is taken off.
  const std::string atTheLimit = file + std::string(kLicenseFileLongest - file.size(), ' ');
  const std::string longPayload = "{\"version\":1,\"note\":\"" + std::string(1600, 'n') + "\"}";
  check(verifyLicenseFile(atTheLimit, pair.publicKey).unlocksUpgrade() && malformed(atTheLimit + " ") &&
            malformed(std::string(kLicenseFileLongest, ' ') + file) &&
            licenseFileSaying(longPayload, pair).size() > kLicenseFileLongest && malformed(licenseFileSaying(longPayload, pair)),
        "2048 characters are read and 2049 are malformed, whether they are space or a signed payload");
}

// ---- A strict signature check ---------------------------------------------------------

// The group's order, least byte first.
constexpr std::array<std::uint8_t, 32> kGroupOrder{{0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7,
                                                    0xa2, 0xde, 0xf9, 0xde, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                                                    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10}};

LicenseKey point(std::initializer_list<std::uint8_t> first, std::uint8_t fill, std::uint8_t last) {
  LicenseKey bytes;
  bytes.fill(fill);
  std::copy(first.begin(), first.end(), bytes.begin());
  bytes.back() = last;
  return bytes;
}

LicenseKey withSignBit(LicenseKey bytes) {
  bytes.back() |= 0x80;
  return bytes;
}

std::string fileWith(const std::string& signedPart, const Signature& signature) {
  return signedPart + "." + toBase64Url(signature.data(), signature.size());
}

void testStrictness() {
  const KeyPair pair = rfcKeyPair();
  const std::string signedPart = std::string(kLicenseFilePrefix) + "." + toBase64Url(kUpgradePayload);

  // S and S plus the group's order satisfy the same equation.
  Signature malleable = signatureOver(signedPart, pair);
  unsigned carry = 0;
  for (std::size_t index = 0; index < kGroupOrder.size(); ++index) {
    const unsigned sum = static_cast<unsigned>(malleable[32 + index]) + static_cast<unsigned>(kGroupOrder[index]) + carry;
    malleable[32 + index] = static_cast<std::uint8_t>(sum);
    carry = sum >> 8;
  }
  check(carry == 0 && refusedAs(verifyLicenseFile(fileWith(signedPart, malleable), pair.publicKey), LicenseRefusal::badSignature),
        "a signature whose S has the group's order added to it is refused as bad_signature");

  // The eight points of small order, each written canonically, and five ways
  // of writing one of them that are not canonical. Whoever holds none of the
  // secrets can sign for a key of small order: with S = 0 the equation asks
  // only that R be a multiple of the key, and there are eight to try.
  const LicenseKey orderEight{{0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4,
                               0x89, 0xf2, 0xef, 0x98, 0xf0, 0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6,
                               0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05}};
  const LicenseKey orderEightToo{{0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b,
                                  0x76, 0x0d, 0x10, 0x67, 0x0f, 0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39,
                                  0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a}};
  const LicenseKey one = point({0x01}, 0x00, 0x00);
  const LicenseKey minusOne = point({0xec}, 0xff, 0x7f);
  const LicenseKey zero = point({}, 0x00, 0x00);
  const std::array<LicenseKey, 8> smallOrder{{one, minusOne, zero, withSignBit(zero), orderEight, withSignBit(orderEight),
                                              orderEightToo, withSignBit(orderEightToo)}};
  struct Weak {
    const char* name;
    LicenseKey key;
  };
  std::vector<Weak> weak;
  for (const LicenseKey& key : smallOrder) weak.push_back({"a key of small order", key});
  weak.push_back({"1 written with the sign bit set", withSignBit(one)});
  weak.push_back({"-1 written with the sign bit set", withSignBit(minusOne)});
  weak.push_back({"0 written as the prime", point({0xed}, 0xff, 0x7f)});
  weak.push_back({"0 written as the prime, with the sign bit set", withSignBit(point({0xed}, 0xff, 0x7f))});
  weak.push_back({"1 written as the prime and one", point({0xee}, 0xff, 0x7f)});

  int forged = 0;
  int taken = 0;
  for (const Weak& entry : weak) {
    std::optional<std::string> forgery;
    for (int attempt = 0; attempt < 400 && !forgery; ++attempt) {
      const std::string payload = R"({"version":1,"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","issuedAt":"2026-11-22T12:00:00.)" +
                                  std::to_string(1000 + attempt).substr(1) + R"(Z","unlocks":["upgrade"]})";
      const std::string message = std::string(kLicenseFilePrefix) + "." + toBase64Url(payload);
      for (const LicenseKey& multiple : smallOrder) {
        Signature signature{};
        std::copy(multiple.begin(), multiple.end(), signature.begin());
        if (crypto_ed25519_check(signature.data(), entry.key.data(), reinterpret_cast<const std::uint8_t*>(message.data()),
                                 message.size()) == 0) {
          forgery = fileWith(message, signature);
          break;
        }
      }
    }
    if (forgery) ++forged;
    const bool refused = forgery && refusedAs(verifyLicenseFile(*forgery, entry.key), LicenseRefusal::badSignature);
    if (forgery && !refused) ++taken;
    check(forgery.has_value() && refused,
          std::string("for ") + entry.name + ", a signature the equation alone would take can be made by anybody, and is refused as bad_signature");
  }
  std::printf("     %d of %d weak keys had a forgery made for them, and %d forgeries were taken\n", forged,
              static_cast<int>(weak.size()), taken);

  // A y of the prime and three: not written canonically, and not of small
  // order, so nobody can sign for it and all this shows is that it is refused.
  check(refusedAs(verifyLicenseFile(withSignature(signedPart, pair), point({0xf0}, 0xff, 0x7f)), LicenseRefusal::badSignature),
        "a key whose y is not below the prime is refused as bad_signature");
}

// ---- The file on a machine --------------------------------------------------------------

void testTheFileOnAMachine(const WorkedExample& example) {
  const juce::String told = juce::SystemStats::getEnvironmentVariable(kLicenseFileVariable, {});
  check(told.isNotEmpty(), std::string("the test is told where to keep its license file, in ") + kLicenseFileVariable +
                               " (ctest sets it; it is never the file a person keeps)");
  if (told.isEmpty() || example.file.empty() || !example.publicKey) return;

  const juce::File file = licenseFileOnThisMachine();
  check(file == juce::File::getCurrentWorkingDirectory().getChildFile(told), "and the plugin looks for its file there");
  const juce::File folder = file.getParentDirectory();
  folder.deleteRecursively();
  const LicenseKey& key = *example.publicKey;

  check(readLicenseFile(file).empty() && !upgradeOnThisMachine(key).held(), "no folder and no file is no license");
  folder.createDirectory();
  check(readLicenseFile(file).empty() && !upgradeOnThisMachine(key).held(), "a folder with no file in it is no license");

  file.replaceWithText(juce::String(example.file) + "\n");
  const Upgrade held = upgradeOnThisMachine(key);
  check(held.held() && verifyLicenseFile(held.licenseFile, key).unlocksUpgrade(),
        "the page's example in the file, with the line ending an editor adds, is the upgrade under the page's key");
  check(!upgradeOnThisMachine().held(), "and is no license to the plugin's own key");

  file.replaceWithText("not a license file");
  check(!upgradeOnThisMachine(key).held(), "a file of something else is no license");
  file.replaceWithText("");
  check(!upgradeOnThisMachine(key).held(), "an empty file is no license");
  file.replaceWithText(juce::String(example.file) + juce::String::repeatedString(" ", static_cast<int>(kLicenseFileLongest)));
  check(readLicenseFile(file).empty() && !upgradeOnThisMachine(key).held(), "a file too long to be a license file is not read");

  const KeyPair pair = rfcKeyPair();
  file.replaceWithText(licenseFileSaying(R"({"version":1,"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","issuedAt":"2026-11-22T12:00:00.000Z","unlocks":["stems"]})", pair));
  check(!upgradeOnThisMachine(key).held(), "a good file that unlocks something else is not the upgrade");

  // Something that cannot be read as a file: a folder where the file should be.
  file.deleteFile();
  file.createDirectory();
  check(readLicenseFile(file).empty() && !upgradeOnThisMachine(key).held(), "a folder where the file should be is no license");
  file.deleteRecursively();

#if !JUCE_WINDOWS
  // A file the system will not open. An administrator opens anything, so one is not asked.
  file.replaceWithText(juce::String(example.file));
  const char* const path = file.getFullPathName().toRawUTF8();
  if (::chmod(path, 0) == 0 && ::geteuid() != 0) {
    check(readLicenseFile(file).empty() && !upgradeOnThisMachine(key).held(), "a file nobody may read is no license");
  }
  ::chmod(path, S_IRUSR | S_IWUSR);
#endif
  folder.deleteRecursively();
}

}  // namespace

int main() {
  const WorkedExample example = workedExample();
  testTheBuiltInKey();
  testTheWorkedExample(example);
  testEveryChange(example);
  testPayloads();
  testTheLine();
  testStrictness();
  testTheFileOnAMachine(example);

  std::printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
