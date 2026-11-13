# macOS arm64 packaging

macOS packages contain a native Apple Silicon addon built from the pinned Dawn
engine and are built separately from Linux packages. The staged package has
macOS arm64 metadata and includes the addon, JavaScript, declarations, license,
and third-party notices. Intel Macs and Windows are unsupported; Windows native
support remains a follow-up to issue #43.

On macOS arm64, `bun run setup` followed by `bun run package:verify` builds the
package and exercises npm and Bun consumers with Node.js and Bun. The package
verification includes presentation and lifecycle checks; Linux-specific X11
close injection and no-display initialization checks do not run on macOS.
`bun run release:prepare` checks the tarball's metadata and native architecture,
then creates the release tarball, checksum, and notes in `build/release-macos/`.

The release workflow creates the existing Linux draft independently. A macOS
asset is attached only after its macOS job passes and the attachment job verifies
the checksum and confirms that the release remains a draft. Check the release
assets and the accompanying macOS notes before installing; a Linux-only draft
does not imply macOS availability. Hosted validation uses Apple's virtual Metal
device. Physical GPU behavior, older macOS versions, and Intel Macs are not
established by this CI run. No macOS minimum version beyond that of the tested
runner is claimed.
Code signing, notarization, and Gatekeeper behavior have not been verified.
