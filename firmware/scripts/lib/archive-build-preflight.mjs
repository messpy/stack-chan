/**
 * Identify the CoreS3 Archive build without affecting unrelated mcconfig targets.
 */
export function archiveBuildPreflight(args) {
  const platformIndex = args.indexOf('-p')
  const platform = platformIndex < 0 ? '' : args[platformIndex + 1]
  if (platform !== 'esp32/m5stack_cores3') return null
  if (!args.some(value => /(?:^|[/\\])manifest_archive_private\.json$/.test(value))) return null
  return {
    platformName: 'm5stack_cores3',
    mode: args.includes('-d') ? 'debug' : args.includes('-i') ? 'instrument' : 'release',
    archive: true,
  }
}
