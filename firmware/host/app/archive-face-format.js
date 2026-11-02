export const FACE_PARTS = ['leftEye', 'rightEye', 'mouth', 'decoration']
export const FACE_EXPRESSIONS = ['neutral', 'happy', 'sad', 'angry']
const COLOR = /^#[0-9a-fA-F]{6}$/
export function validateFace(input) {
  if (
    !input ||
    input.version !== 1 ||
    !input.frames ||
    typeof input.frames !== 'object' ||
    Array.isArray(input.frames) ||
    !COLOR.test(input.background)
  )
    throw Error('顔データの形式を確認してください')
  let points = 0,
    strokes = 0
  const face = {
    version: 1,
    name: String(input.name || 'マイフェイス').slice(0, 40),
    background: input.background,
    frames: {},
  }
  for (const expression of FACE_EXPRESSIONS) {
    const frame = input.frames[expression]
    if (frame === undefined) continue
    if (!Array.isArray(frame)) throw Error('表情データを確認してください')
    face.frames[expression] = frame.map((stroke) => {
      if (
        ++strokes > 64 ||
        !stroke ||
        !FACE_PARTS.includes(stroke.part) ||
        !['path', 'rect', 'ellipse'].includes(stroke.kind) ||
        !COLOR.test(stroke.color) ||
        !Number.isFinite(stroke.width) ||
        stroke.width < 1 ||
        stroke.width > 24 ||
        !Array.isArray(stroke.points) ||
        !stroke.points.length
      )
        throw Error('線が多すぎるか、絵の形式が正しくありません')
      if (stroke.kind !== 'path' && stroke.points.length !== 2) throw Error('図形の形式を確認してください')
      const list = stroke.points.map((point) => {
        if (
          ++points > 1200 ||
          !Array.isArray(point) ||
          point.length !== 2 ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) ||
          point[0] < 0 ||
          point[0] > 320 ||
          point[1] < 0 ||
          point[1] > 240
        )
          throw Error('絵が細かすぎるか、画面の外へ出ています')
        return [Math.round(point[0]), Math.round(point[1])]
      })
      return {
        part: stroke.part,
        kind: stroke.kind,
        color: stroke.color,
        width: stroke.width,
        fill: !!stroke.fill,
        points: list,
      }
    })
  }
  if (!face.frames.neutral?.length) throw Error('通常の顔を描いてください')
  if (JSON.stringify(face).length > 30000) throw Error('絵が細かすぎます。線を減らしてください')
  return face
}
const shape = (part, kind, points) => ({ part, kind, points, color: '#ffffff', width: 4, fill: true })
export function faceTemplate(name = 'current') {
  const neutral = [
    shape('leftEye', 'ellipse', [
      [82, 85],
      [98, 101],
    ]),
    shape('rightEye', 'ellipse', [
      [222, 88],
      [238, 104],
    ]),
    shape('mouth', 'rect', [
      [115, 144],
      [205, 152],
    ]),
  ]
  if (name === 'round') {
    neutral[0].points = [
      [72, 72],
      [108, 108],
    ]
    neutral[1].points = [
      [212, 72],
      [248, 108],
    ]
    neutral[2].kind = 'ellipse'
    neutral[2].points = [
      [130, 145],
      [190, 160],
    ]
  }
  return { version: 1, name: name === 'round' ? 'まるい顔' : '今の顔', background: '#000000', frames: { neutral } }
}
export function faceBounds(strokes, part) {
  let minX = 320,
    minY = 240,
    maxX = 0,
    maxY = 0,
    found = false
  for (const stroke of strokes)
    if (stroke.part === part)
      for (const [x, y] of stroke.points) {
        found = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
  if (!found) return { cx: 160, cy: 120, width: 8, height: 8 }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: Math.max(8, maxX - minX),
    height: Math.max(8, maxY - minY),
  }
}
export function faceTransform(point, part, bounds, pose = {}) {
  let [x, y] = point
  if (part === 'leftEye' || part === 'rightEye') {
    const open = part === 'leftEye' ? (pose.left ?? 1) : (pose.right ?? 1)
    y = bounds.cy + (y - bounds.cy) * Math.max(0.08, open)
    x += (pose.gazeX || 0) * 4
    y += (pose.gazeY || 0) * 4
  } else if (part === 'mouth') {
    const open = Math.max(0, Math.min(1, pose.mouth || 0))
    x = bounds.cx + (x - bounds.cx) * (1 - open * 0.44)
    y = bounds.cy + (y - bounds.cy) * (1 + (50 * open) / bounds.height)
  }
  return [x, y]
}
export function expressionName(emotion) {
  return ['neutral', 'angry', 'sad', 'happy'][emotion] || 'neutral'
}
