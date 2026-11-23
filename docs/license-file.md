# The license file

What the server hands a buyer of the upgrade so that a program can tell,
with no server to ask, that it was paid for. The site, the desktop app and
the phone apps check one with `verifyLicenseFile` in
`packages/contracts/src/license-file.ts`. The VST3 plugin has to make the
same check in C++, and this page is what it follows. Change the code and
this page together.

Where a program keeps the file, and how the desktop app and the plugin share
one, is not decided here.

## The file

A license file is one line of ASCII text in three parts joined by full
stops:

```
boombapbot-license.<payload>.<signature>
```

- `boombapbot-license` is fixed. It is signed with the payload, so a
  signature the same key made for anything else is not one for a license.
- `<payload>` is base64url, without padding (RFC 4648, section 5), of a
  JSON object in UTF-8.
- `<signature>` is base64url, without padding, of a 64-byte Ed25519
  signature: 86 characters.

The signature is over the bytes of the text before the last full stop, as
they are in the file: `boombapbot-license.<payload>`. Nothing is signed in
any other encoding, so a program never has to write JSON to check a file;
it checks the bytes it was given and only then reads them.

Space, tabs and line endings before or after the line are not part of it. A
file is under 2048 characters; anything longer is refused unread.

## The payload

```json
{"version":1,"licenseId":"3f2b8c1e-9a47-4d0b-b6e2-5c81f0a7d394","issuedAt":"2026-11-22T12:00:00.000Z","unlocks":["upgrade"]}
```

| Field | What it is |
| --- | --- |
| `version` | The number `1`. A file with any other number is refused. |
| `licenseId` | The license's public id on the server, a UUID. It names the purchase, not a device or a person. |
| `issuedAt` | When this file was made, as an ISO 8601 moment in UTC. It is a record only: a file does not run out. |
| `unlocks` | A list of names, at least one. `upgrade` is everything the one-time upgrade pays for. A program ignores a name it does not know. |

The server writes the fields in that order with no space between them, but
a program must not depend on the order, and ignores a field it does not
know. A field can be added without a new version. A change that an older
program would misread takes a new version number, which older programs
refuse.

There is no expiry and nothing about a device. A refund marks the license
on the server so that it gives out no more files; the files already given
out keep verifying, by design.

## The key

Ed25519, as in RFC 8032, without a context and without prehashing. The
server signs with a 32-byte seed kept in `LICENSE_SIGNING_KEY`. Every program
has the 32-byte public key built in: `LICENSE_PUBLIC_KEY` in
`packages/contracts/src/license-file.ts`, as base64url, and the same bytes in
the plugin. `pnpm license:keypair` makes a pair and prints both halves, the
public one as C++ bytes too.

## Checking a file

1. Trim the space around the text. Refuse it if it was over 2048 characters.
2. Split it at full stops. Refuse it unless there are exactly three parts,
   the first is `boombapbot-license`, and neither of the others is empty.
3. Decode the second and third parts as base64url. Refuse padding, any
   character outside the alphabet, and any text that would not encode back
   to itself. Refuse it unless the signature is 64 bytes.
4. Check the signature over the ASCII bytes of
   `boombapbot-license.<payload>` with the built-in public key. Use a strict
   check: refuse a signature whose `S` is not below the group order, a point
   that is not encoded canonically, and a public key of small order.
   libsodium's `crypto_sign_verify_detached` is a check of that kind. Refuse
   the file if the check fails.
5. Only now read the payload as JSON. Refuse it if it is not an object.
6. If `version` is a number other than `1`, refuse it as a version this
   program does not read.
7. Refuse it unless `licenseId` is a UUID, `issuedAt` is a moment, and
   `unlocks` is a list of at least one non-empty string.
8. The paid effects are unlocked if `unlocks` holds `upgrade`.

`verifyLicenseFile` answers with one of three reasons for a refusal, and
the plugin should keep the same three so a person is told the same thing
everywhere: `malformed` (steps 1 to 3, 5 and 7), `bad_signature` (step 4)
and `unsupported_version` (step 6).

## A worked example

Made with the key pair of RFC 8032, section 7.1, test 1, which anybody can
read and which signs nothing real.

- Seed: `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60`
- Public key: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`

The payload above, signed, is this file:

```
boombapbot-license.eyJ2ZXJzaW9uIjoxLCJsaWNlbnNlSWQiOiIzZjJiOGMxZS05YTQ3LTRkMGItYjZlMi01YzgxZjBhN2QzOTQiLCJpc3N1ZWRBdCI6IjIwMjYtMTEtMjJUMTI6MDA6MDAuMDAwWiIsInVubG9ja3MiOlsidXBncmFkZSJdfQ.mPyrMgMf4Pcw9sm3Z8j3mWZtAuOSYKulYqsstJpknUvhr3QoNhOBvTvJWIr8hvssyw8eai5d2uwo4qdSCk3-BA
```

It verifies against that public key, and changing any one character of it
makes it fail. `packages/contracts/test/license-file.test.ts` holds the same
example, so the page and the code cannot drift apart unnoticed.

## Getting one from the server

| Request | Who | Answer |
| --- | --- | --- |
| `POST /api/upgrade/license` with `{"key":"BOOM-…"}` | Anybody with a key; no account | `{"file":"boombapbot-license.…"}` |
| `GET /api/upgrade/license` | A logged-in account that has upgraded | The same |

A refusal is `{"code","message"}` like the upgrade's other routes:
`unknown_key` (404), `no_license` (404), `signed_out` (401), `withdrawn`
(403, the license was refunded or taken back), `too_many` (429, one address
may try ten keys in ten minutes), `invalid` (400) and `no_signing_key` (503,
the server has no `LICENSE_SIGNING_KEY`). A file can be fetched as often as
it is wanted, on as many machines; each fetch is signed afresh, so two
files for one license differ in `issuedAt` and signature and are both good.
