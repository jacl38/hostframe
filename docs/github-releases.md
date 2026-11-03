# GitHub Releases distribution

The workflow in `.github/workflows/release.yml` builds the Linux x64 package
in a Fedora 44 container. It uses pinned Node.js 26.7.0, Bun 1.3.14, and
Go 1.26.10 versions, a frozen Bun lockfile, and the pinned Dawn inputs.
Actions are pinned to commit hashes. Fedora system packages receive updates;
this establishes a build environment, not bit-for-bit reproducibility or
compatibility with older Linux distributions.

## Workflow and assets

- **Run workflow** (`workflow_dispatch`) builds, tests, and uploads workflow
  artifacts. It does not create a release.
- Pushing a **`v*` tag** runs the same checks, then creates a **draft** GitHub
  release. The tag must exactly match `v` plus `package.json`'s version.
- Versions containing a prerelease suffix are marked as prereleases.
- The draft remains unpublished until a maintainer publishes it on GitHub.
  No npm registry publication occurs.

Build verification includes the native source audit, lint, typecheck, existing
tests, full native presentation checks, and actual tarball installs in clean
npm and Bun consumers. Presentation uses Xvfb and Mesa lavapipe inside the
container; no host display or physical GPU access is needed.

After verification, `bun run release:prepare` assembles:

```text
build/release/
  hostframe-0.1.0-alpha.0-linux-x64.tgz
  SHA256SUMS
  release-notes.md
```

The release tarball contains the same bytes tested by `package:verify`, with
a platform-specific asset name. Release notes record the packaged addon's
actual GLIBC and GLIBCXX symbol requirements, the verified runtimes, and the
pinned Dawn revision. The tarball and checksums become downloadable release
assets; `release-notes.md` supplies the release description.

The build job has read-only repository permissions. Only the draft-release
job receives `contents: write`. Draft creation checks the downloaded tarball
against `SHA256SUMS`, requires a matching tag-push event, and refuses to run
under `act`. It uses the workflow's `GITHUB_TOKEN`; no npm token or personal
access token is needed. An existing release is not overwritten: rerunning
draft creation for an existing tag fails rather than replacing its assets.

## Test locally with the GitHub CLI extension

With `gh act` and access to the Docker daemon:

```sh
gh act workflow_dispatch \
  --workflows .github/workflows/release.yml \
  --job build \
  --platform ubuntu-24.04=fedora:44 \
  --container-architecture linux/amd64 \
  --container-daemon-socket - \
  --artifact-server-path /tmp/hostframe-act-artifacts
```

This runs the actual build job and uses act's local artifact server. It does
not create a GitHub release. Gitignored `vendor/`, `build/`, and `node_modules/`
are not copied into the container, so setup exercises a fresh checkout.
The first run downloads the Fedora image, action implementations, runtimes,
and native build inputs. Allow enough disk space and time for a native build.

If you just joined the Docker group, open a new login session, or run the
command from a `newgrp docker` shell. `sg docker -c 'gh act ...'` also applies
the new group membership to one command. Do not bind the working directory:
the workflow installs packages and builds as the container's root user.

act does not fully reproduce GitHub permissions, concurrency, or hosted
artifact/release services. A successful local build still needs a manual
GitHub workflow run before treating the hosted workflow as verified.

The artifact upload action is pinned to v4.6.2 for local compatibility:
v7's `mime_type` field was rejected by act 0.2.95's artifact server. The
initial cold container run passed native setup, lint/typecheck, tests, the
full presentation suite, packed consumers, and release assembly before
encountering that upload error. The rerun with v4.6.2 passed the complete
build job, all 40 tests, and upload to the local artifact server. The saved
artifact's tarball checksum was verified after extraction. The draft command's flags and checksum rejection are also
covered by a local subprocess test using a stand-in for `gh`; no release
API call is made by that test. Hosted release creation has not been exercised.

## Create a release

1. Commit the code and set `package.json` to the intended release version.
2. Run the workflow manually on GitHub and inspect the build artifact.
3. Create and push the matching tag. For the initial version:

   ```sh
   git tag v0.1.0-alpha.0
   git push origin v0.1.0-alpha.0
   ```

4. Inspect the resulting draft's assets, checksum, requirements, and notes.
5. Publish the draft from GitHub Releases when ready.

The workflow must be committed and pushed before these steps can run on
GitHub. It is not necessary to tag or publish anything to test it locally.

## Install a published release

Use the URL of the **uploaded tarball asset**, rather than GitHub's automatic
source-code archives. For example, once this release exists and is public:

```sh
bun add hostframe@https://github.com/jacl38/ts-dawn/releases/download/v0.1.0-alpha.0/hostframe-0.1.0-alpha.0-linux-x64.tgz
```

Or download the tarball and `SHA256SUMS` into the same directory:

```sh
sha256sum --check SHA256SUMS
npm install ./hostframe-0.1.0-alpha.0-linux-x64.tgz
```

Imports remain `import { Application } from "hostframe"`. The URL pins a
specific release; upgrade by installing a newer version's asset URL. The
normal `@webgpu/types` dependency is still downloaded from the npm registry.
Private repositories need authenticated asset downloads; the public URL
example assumes a public repository and published release.

See [packaging](packaging.md) for native runtime requirements and consumer
validation details.
