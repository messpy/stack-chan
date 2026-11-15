# CoreS3 xsl argument-file workaround (PR #102)

## Observed failure

Large Archive release builds can fail at xsl modules with Linux E2BIG (Argument list too long).
Unit-test success is not evidence that CoreS3 firmware builds successfully.

## Change

The CoreS3 firmware build wrapper checks the local Moddable SDK make.esp32.mk recipe.
It replaces the exact legacy xsl recipe with a GNU Make file function that writes
the long module list to the build output args.txt. The linker reads that file with
the literal xsl args.txt argument from the matching TMP_DIR working directory.
Unknown SDK recipes or missing xsl args.txt support fail closed.

This is a persistent, idempotent change to the locally installed Moddable SDK.
It does not modify source manifests, flash, NVS, SD content, or credentials.
Concurrent builds sharing one Moddable SDK should not be run during the transition.

## Verification

- node --test scripts/lib/moddable-xsl-args.test.mjs
- node --test scripts/lib/firmware-command.test.mjs
- npm run test:unit
- npm run build:m5stackchan_cores3 -- --mode=release --manifest host/app/manifest_archive_private.json

Real hardware builds and device acceptance remain unverified by local mock tests.

## Rollback

From firmware/ with the original MODDABLE environment variable loaded:

    node --input-type=module -e "import { restoreModdableXslArgsFile as restore } from './scripts/lib/moddable-xsl-args.mjs'; console.log(restore())"

This reverses only the xsl recipe modification; unrelated SDK patches are preserved.
