import { expressionName, faceBounds, faceTemplate, faceTransform, validateFace } from 'archive-face-format'
import { changeSettings, getSettings } from 'archive-vault'
import { FaceBase, SimpleFace } from 'behaviors/face'
import { Outline } from 'commodetto/outline'
import { Container, Skin } from 'piu/MC'
import { Shape } from 'piu/shape'

let robot
function outline(stroke, bounds, pose) {
  const path = new Outline.CanvasPath(),
    points = stroke.points.map((p) => faceTransform(p, stroke.part, bounds, pose))
  if (stroke.kind === 'path') {
    path.moveTo(...points[0])
    if (points.length === 1) path.lineTo(points[0][0] + 0.1, points[0][1])
    else for (const p of points.slice(1)) path.lineTo(...p)
  } else {
    const x = Math.min(points[0][0], points[1][0]),
      y = Math.min(points[0][1], points[1][1]),
      w = Math.max(1, Math.abs(points[1][0] - points[0][0])),
      h = Math.max(1, Math.abs(points[1][1] - points[0][1]))
    if (stroke.kind === 'rect') {
      path.moveTo(x, y)
      path.lineTo(x + w, y)
      path.lineTo(x + w, y + h)
      path.lineTo(x, y + h)
      path.closePath()
    } else {
      for (let i = 0; i <= 24; i++) {
        const t = (i * Math.PI * 2) / 24,
          px = x + w / 2 + (Math.cos(t) * w) / 2,
          py = y + h / 2 + (Math.sin(t) * h) / 2
        if (i) path.lineTo(px, py)
        else path.moveTo(px, py)
      }
      path.closePath()
    }
  }
  return stroke.fill && stroke.kind !== 'path'
    ? Outline.fill(path)
    : Outline.stroke(path, stroke.width, Outline.LINECAP_ROUND, Outline.LINEJOIN_ROUND)
}
function createFace(face) {
  const contents = []
  for (const [expression, strokes] of Object.entries(face.frames))
    for (const stroke of strokes) {
      const bounds = faceBounds(strokes, stroke.part)
      contents.push(
        new Shape(null, {
          left: 0,
          top: 0,
          width: 320,
          height: 240,
          skin: new Skin({ fill: stroke.color }),
          Behavior: class extends Behavior {
            onCreate(shape) {
              this.key = ''
              this.cached = []
              shape.fillOutline = outline(stroke, bounds, {})
            }
            onFaceState(shape, state) {
              const name = expressionName(state.emotion),
                selected = face.frames[name]?.length ? name : 'neutral'
              shape.visible = expression === selected
              if (!shape.visible) return
              const eye = stroke.part === 'leftEye' ? state.eyes.left : state.eyes.right
              const pose = {
                left: Math.round(state.eyes.left.open * 3) / 3,
                right: Math.round(state.eyes.right.open * 3) / 3,
                mouth: Math.round(state.mouth.open * 4) / 4,
                gazeX: Math.round(eye.gazeX * 2) / 2,
                gazeY: Math.round(eye.gazeY * 2) / 2,
              }
              const key =
                stroke.part === 'mouth'
                  ? String(pose.mouth)
                  : stroke.part === 'decoration'
                    ? 'fixed'
                    : String(
                        pose[stroke.part === 'leftEye' ? 'left' : 'right'] * 300 +
                          (pose.gazeX * 2 + 4) * 10 +
                          pose.gazeY * 2 +
                          4,
                      )
              if (key === this.key) return
              this.key = key
              let cached = this.cached.find((x) => x.key === key)
              if (!cached) {
                cached = { key, value: outline(stroke, bounds, pose) }
                this.cached.push(cached)
                if (this.cached.length > 2) this.cached.shift()
              }
              shape.fillOutline = cached.value
            }
          },
        }),
      )
    }
  return new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin: new Skin({ fill: face.background }),
    contents: [new FaceBase({ left: 0, top: 0, width: 320, height: 240, contents })],
  })
}
export function faceCommand(op, args = {}) {
  if (op === 'get')
    return { enabled: getSettings().customFaceEnabled === true, face: getSettings().customFace || faceTemplate() }
  if (op === 'save') {
    const face = validateFace(args.face),
      view = createFace(face)
    changeSettings((s) => {
      s.customFace = face
      s.customFaceEnabled = true
    })
    robot.ui.setFace(view)
    robot.ui.showFace()
    return { saved: true, enabled: true }
  }
  if (op === 'restore') {
    changeSettings((s) => {
      s.customFaceEnabled = false
    })
    robot.ui.setFace(new SimpleFace({}))
    robot.ui.showFace()
    return { enabled: false }
  }
  throw Error('Unknown face operation')
}
export function startCustomFace(context) {
  robot = context
  try {
    if (getSettings().customFaceEnabled && getSettings().customFace) {
      robot.ui.setFace(createFace(validateFace(getSettings().customFace)))
    }
  } catch (_) {
    trace('[custom-face] stored face unavailable; default preserved\n')
  }
}
