# Project guidance

hostframe aims to provide native desktop graphics applications in TypeScript using Dawn for WebGPU and GLFW for windows and input, across Node.js and Bun. Read `README.md` for the proposed architecture and API. Distinguish intended behavior from implemented and verified behavior.

## Architecture

- Inspect the existing structure and conventions before choosing where code belongs. Organize code by responsibility and logical boundaries; place code with the subsystem that owns its behavior.
- Keep modules focused. Split modules when they contain concerns that change independently; use line count as a signal to investigate, not a fixed limit.
- Use descriptive names and clear dependency direction. Avoid circular dependencies and oversized miscellaneous `utils` modules. Name shared modules after the behavior they provide.
- Reuse behavior when it has the same meaning and its callers should evolve together. Avoid speculative abstractions based only on similar syntax, and keep refactoring proportional to the task.
- Keep the public TypeScript API, native resource ownership and presentation, and transport across the TypeScript/native bridge distinct. Make ownership and interfaces at these boundaries explicit.
- Centralize shared defaults and mappings. Give each an authoritative definition in the subsystem that owns it.

## Derivation and duplication

- Prioritize repetition that can cause behavioral or contract drift, especially across C++ and TypeScript. Prefer existing library definitions and typed registrations over parallel handwritten interfaces, constant values, and runtime registries. For example, [the native bridge](packages/native/bridge.ts) imports generated addon types, and [the input constant generator](scripts/native/input-constants.ts) discovers GLFW constants and obtains their values from the compiler. Keep its small naming override table in one place; do not replace automatic discovery with a per-key inventory.
- Carry the same typed data through a subsystem when possible. [WindowInput](packages/native/src/input.h) queues the `InputEvent` variant directly rather than maintaining a second generic event record and a conversion switch. [Native extraction](scripts/native/extract-declarations.ts) generates runtime event names from that variant, which [TypeScript listeners](packages/core/input.ts) use instead of a second event-name allowlist.
- Reuse generated contracts where this is straightforward and prevents drift. [Window.draw](packages/core/window.ts) derives its callback parameter from the generated native method, and [the compute fixture](packages/native/test/compute.ts) uses the generated addon module type. Do not recreate these signatures locally.
- Leave trivial repetition alone when eliminating it would add more complexity, dependencies, indirection, or maintenance than it removes. Explicit binding member registrations in [record_fields.h](packages/native/src/record_fields.h) are appropriate. The small presentation-mode mappings in [present_mode.h](packages/native/src/present_mode.h) and [binding_types.h](packages/native/src/binding_types.h) do not justify a new reflection or generation system by themselves.
- Preserve useful independence at boundaries: runtime lifecycle checks are still required alongside static types, and regression tests should assert expected behavior independently of the implementation. Do not deduplicate these merely because values or checks look similar. Keep policy decisions, such as supported presentation modes, explicit rather than automatically exposing every upstream possibility.

## Resource ownership and execution

- Encode resource ownership and lifecycle in the implementation. Use C++ RAII and appropriate smart pointers for native resources, explicit disposal at the TypeScript boundary, and runtime checks for invalid lifecycle operations.
- Define who owns each resource, how ownership is transferred, how it is released, and what operations remain valid after disposal. Ensure cleanup is safe after partial initialization and repeated disposal.
- Enforce execution constraints at integration boundaries. Make thread affinity, callback scheduling, asynchronous GPU progress, and the acquire → render → present sequence explicit in control flow.
- Use types to express constraints where practical, and runtime guards or assertions where types cannot enforce them. TypeScript types alone cannot prevent stale references or enforce native thread affinity and callback timing.
- Document ownership transfers, lifetime constraints, and caller obligations that cannot be enforced directly. Comments supplement enforcement rather than replace it.

## Upstream integration

- Prefer public Dawn and GLFW interfaces. Establish the need for upstream changes through a prototype before introducing patches.
- Keep necessary upstream patches small, localized, and documented. Keep hostframe windowing and presentation implementation in its own source files.

## Native build tooling

- Keep setup/build orchestration in Bun/TypeScript under `scripts/`, with `scripts/native.ts` as the command entry point. Use Bun Shell for command execution and `Bun.spawn` where timeout/signal handling is needed. Use the project-owned CMake targets in `packages/native/`; never invoke Dawn's engine build as a fallback.
- Maintain pinned inputs in `scripts/native/dawn.lock.json`; keep path resolution and platform selection in `scripts/native/release.ts`. Match source, headers, and engine revisions, verify archive checksums, and keep selected dependency revisions aligned with Dawn's `DEPS`.
- Treat `vendor/` and `build/` as generated inputs/output. Apply binding changes to the build-owned copy through `scripts/native/generate.ts`.
- Run `bun run native:build` and `bun run native:verify` for native changes. Exercise `bun run native:verify --presentation` when window/surface behavior changes and a macOS desktop or X11/Vulkan environment is available. The build script audits compilation sources before building.
- The current build configuration supports Linux x64/X11 and macOS arm64/Cocoa with Metal. See `docs/native-build.md` for prerequisites, update procedures, verified runtimes, and limitations.

## TypeScript style

- Write project-owned scripts, source, and tests in TypeScript. Do not add `.js`, `.mjs`, or `.cjs` files to the repository; generated JavaScript stays in ignored build output.
- Follow the shared TypeScript style enforced by the repository's [`.oxlintrc.json`](.oxlintrc.json). Treat that configuration as the source of truth for enforced formatting and lint rules.
- Use two-space indentation, double quotes, semicolons, no trailing commas, and function declarations. Use arrow callbacks where appropriate and follow the configuration's control-flow spacing rules.
- Prefer inferred return types. Add explicit return types when needed to express an intended contract, preserve a named type, resolve an inference limitation, or declare a type predicate or assertion signature.
- Run `bun run lint` on changes to TypeScript code and resolve introduced violations.

## Validation and documentation

- Validate the behavior being changed before calling it complete. Use focused tests for logic, rendered screenshots for appearance, exercised flows for interactions, and integration checks for native boundaries.
- Verify windowing, presentation, resource lifecycle, and runtime compatibility through actual runtime behavior. Compilation alone does not establish correctness.
- Cover meaningful failure cases, including partial initialization and disposal, when relevant to the change. Preserve regression tests where ongoing protection is warranted.
- Run relevant existing checks and required suites. State which operating systems and JavaScript runtimes were actually verified, and distinguish blocked checks from successful validation.
- Keep documentation and examples aligned with implementation. Clearly label proposed APIs and unverified compatibility or performance claims.
