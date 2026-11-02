import Resource from 'Resource'

const names = { page: 'face-editor-page.txt', script: 'face-editor-script.txt', format: 'face-format-script.txt' }
export function faceEditorAsset(name) {
  if (!names[name]) throw Error('Unknown editor asset')
  return new Resource(names[name])
}
