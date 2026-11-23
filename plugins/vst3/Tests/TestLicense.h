// License files for the tests. They are signed here, with the key pair of
// RFC 8032, section 7.1, test 1, which anybody can read and which signs
// nothing real, or with a pair thrown together as the test runs. The plugin's
// own key signs nothing here: its secret half is the server's alone.
#pragma once

#include "LicenseFile.h"

#include <monocypher-ed25519.h>

#include <array>
#include <cstdint>
#include <string>
#include <string_view>

namespace boombapbot::plugin::testing {

using Seed = std::array<std::uint8_t, 32>;
using Signature = std::array<std::uint8_t, 64>;

struct KeyPair {
  std::array<std::uint8_t, 64> secret{};
  LicenseKey publicKey{};
};

inline constexpr Seed kRfcSeed{{0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a,
                                0xf4, 0x92, 0xec, 0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32,
                                0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60}};

// The payload of the worked example in docs/license-file.md.
inline constexpr std::string_view kUpgradePayload =
    R"({"version":1,"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","issuedAt":"2026-11-22T12:00:00.000Z","unlocks":["upgrade"]})";

// Monocypher wipes the seed it is given, so it is given a copy.
inline KeyPair keyPairFrom(Seed seed) {
  KeyPair pair;
  crypto_ed25519_key_pair(pair.secret.data(), pair.publicKey.data(), seed.data());
  return pair;
}

inline KeyPair rfcKeyPair() { return keyPairFrom(kRfcSeed); }

// A pair nobody has seen before or will again.
inline KeyPair throwawayKeyPair() {
  Seed seed;
  juce::Random random;
  for (std::uint8_t& byte : seed) byte = static_cast<std::uint8_t>(random.nextInt(256));
  return keyPairFrom(seed);
}

inline std::string toBase64Url(const std::uint8_t* bytes, std::size_t size) {
  constexpr std::string_view kAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  std::string text;
  std::uint32_t held = 0;
  int bits = 0;
  for (std::size_t index = 0; index < size; ++index) {
    held = (held << 8) | bytes[index];
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      text += kAlphabet[(held >> bits) & 0x3f];
    }
  }
  if (bits > 0) text += kAlphabet[(held << (6 - bits)) & 0x3f];
  return text;
}

inline std::string toBase64Url(std::string_view bytes) {
  return toBase64Url(reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size());
}

inline Signature signatureOver(std::string_view message, const KeyPair& pair) {
  Signature signature;
  crypto_ed25519_sign(signature.data(), pair.secret.data(), reinterpret_cast<const std::uint8_t*>(message.data()),
                      message.size());
  return signature;
}

// `signedPart` with its signature after a full stop, as a license file ends.
inline std::string withSignature(const std::string& signedPart, const KeyPair& pair) {
  const Signature signature = signatureOver(signedPart, pair);
  return signedPart + "." + toBase64Url(signature.data(), signature.size());
}

// The text of a license file that says `payload`, whatever that is.
inline std::string licenseFileSaying(std::string_view payload, const KeyPair& pair) {
  return withSignature(std::string(kLicenseFilePrefix) + "." + toBase64Url(payload), pair);
}

// The upgrade, held by a file the RFC's key signed and checked against that key.
inline Upgrade heldUpgrade() {
  const KeyPair pair = rfcKeyPair();
  return upgradeFrom(licenseFileSaying(kUpgradePayload, pair), pair.publicKey);
}

}  // namespace boombapbot::plugin::testing
