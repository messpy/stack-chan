# PR #119: branch-aware private Archive build inputs

Release impact: none. This changes build preparation, not the diagnostic firmware's runtime features or memory thresholds.

## Cause

The PR #119 head (`f40472c13ad725ebff52e72a29680e8d2a04a7f0`) and base `stackchan-super` (`4638143aa9dafc4ae6708f9d301af9ef79324536`) do not include KoeAct. The host's shared private Archive manifest was previously used with `feat/offline-device-apps-20261116` and still includes `../../vendor/koeact/manifest.json`.

The project-local launcher copies that shared private manifest into each integration checkout, then synchronizes public modules and platform mappings. It does not synchronize includes. Therefore the PR #119 integration inherits a dependency belonging to another branch. The failure is not evidence that this diagnostic PR needs the model downloaded or copied into it. Even `mcconfig -t clean` parses the inherited include and fails before compilation.

The existing KoeAct implementation and pinned assets belong to commit `700933a0c283dc9cefea5e934fecb3b39af929cd`, under `firmware/vendor/koeact/`. Its manifest declares ESP-DL 3.3.13 and ESP-DSP 1.8.2. Its checked-in generation script verifies the official model hashes before producing aligned flash constants. Importing that feature and its models into a RAM diagnostic PR would change the object being measured and is deliberately avoided.

## Repair

The npm firmware wrapper prepares a disposable, mode-0600 manifest beside the original private manifest, preserving all relative paths. It removes only the explicitly recognized KoeAct feature include when neither the public Archive include list nor its public module mappings requests KoeAct.

- The original private manifest, credentials, platform mappings and unrelated private extensions remain unchanged.
- If the public checkout requires KoeAct, the include is retained, including when its dependency is genuinely missing. No required dependency is silently disabled or fetched.
- If private KoeAct module mappings conflict with the public checkout, preparation fails instead of guessing.
- Arbitrary missing private includes remain errors.
- Both target cleaning and compilation use the prepared copy. The build-variant fingerprint uses its stable contents, not its random temporary filename.
- The copy is removed on normal/error exit. No private values or JSON parse excerpts are logged.

## Validation

Five behavioral regression cases cover removal of the branch-foreign include, credential preservation, relative-path locality, mode and cleanup; retention of a public required include; public module references; conflicting private feature mappings; and malformed JSON redaction/non-private manifests. They run with the existing `firmware-command.test.mjs` suite. Targeted suite: 16 passed.

Full acceptance command, run against the published PR head:

```bash
bash ~/stackchan.sh --PR 119 --test --build
```

The 2026-11-16 08:38 failed integration `a93d64a1536f` and its logs are preserved. Existing test fixes are retained, not reimplemented. No merge into `stackchan-super`, force push, USB write, device reset, or SD modification is part of this repair. A successful build does not establish device startup or the requested `[boot-heap]` observations.
