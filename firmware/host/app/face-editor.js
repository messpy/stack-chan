import { faceBounds, faceTemplate, faceTransform, validateFace } from './face-format.js'

const $ = (id) => document.getElementById(id),
  canvas = $('drawing'),
  ctx = canvas.getContext('2d'),
  preview = $('preview').getContext('2d')
let face = faceTemplate(),
  savedFace = null,
  part = 'leftEye',
  undo = [],
  redo = [],
  drawing = null,
  dirty = false
const clone = (v) => JSON.parse(JSON.stringify(v)),
  draftKey = 'stackchan-face-draft-v1'
function notice(text, error = false) {
  $('notice').textContent = text
  $('notice').dataset.error = String(error)
}
async function request(op, args = {}) {
  const onDevice = location.port === '8082'
  const response = await fetch(onDevice ? '/rpc' : '/api/face/' + op, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(onDevice ? { op: '/face/' + op, args } : args),
  })
  const value = await response.json()
  if (!response.ok || value.error) throw Error(value.error || '本体に接続できません')
  return value
}
function strokes() {
  return face.frames[$('expression').value] || face.frames.neutral
}
function editable() {
  const expression = $('expression').value
  if (!face.frames[expression]) face.frames[expression] = []
  return face.frames[expression]
}
function checkpoint() {
  undo.push(clone(face))
  if (undo.length > 30) undo.shift()
  redo = []
}
function changed() {
  dirty = true
  try {
    localStorage.setItem(draftKey, JSON.stringify(face))
  } catch (_) {}
  render()
}
function install(value) {
  face = clone(value)
  undo = []
  redo = []
  dirty = false
  $('expression').value = 'neutral'
  $('background').value = face.background
  $('name').value = face.name
  render()
}
function draw(context, pose = {}, selection = false) {
  context.fillStyle = face.background
  context.fillRect(0, 0, 320, 240)
  const list = strokes()
  for (const stroke of list) {
    const bounds = faceBounds(list, stroke.part),
      points = stroke.points.map((point) => faceTransform(point, stroke.part, bounds, pose))
    context.save()
    context.strokeStyle = stroke.color
    context.fillStyle = stroke.color
    context.lineWidth = stroke.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.globalAlpha = selection && stroke.part !== part ? 0.55 : 1
    context.beginPath()
    if (stroke.kind === 'path') {
      context.moveTo(...points[0])
      if (points.length === 1) context.lineTo(points[0][0] + 0.1, points[0][1])
      else for (const point of points.slice(1)) context.lineTo(...point)
      context.stroke()
    } else {
      const x = Math.min(points[0][0], points[1][0]),
        y = Math.min(points[0][1], points[1][1]),
        w = Math.max(1, Math.abs(points[1][0] - points[0][0])),
        h = Math.max(1, Math.abs(points[1][1] - points[0][1]))
      if (stroke.kind === 'rect') context.rect(x, y, w, h)
      else context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (stroke.fill) context.fill()
      else context.stroke()
    }
    context.restore()
  }
}
function render() {
  draw(ctx, {}, true)
  for (const button of document.querySelectorAll('[data-part]'))
    button.setAttribute('aria-pressed', String(button.dataset.part === part))
  $('undo').disabled = !undo.length
  $('redo').disabled = !redo.length
}
function point(event) {
  const r = canvas.getBoundingClientRect()
  return [
    Math.max(0, Math.min(320, Math.round(((event.clientX - r.left) * 320) / r.width))),
    Math.max(0, Math.min(240, Math.round(((event.clientY - r.top) * 240) / r.height))),
  ]
}
function erase(position) {
  const list = editable()
  for (let i = list.length - 1; i >= 0; i--) {
    const stroke = list[i]
    if (stroke.part !== part) continue
    const b = faceBounds([stroke], part)
    if (Math.abs(position[0] - b.cx) <= b.width / 2 + 12 && Math.abs(position[1] - b.cy) <= b.height / 2 + 12) {
      list.splice(i, 1)
      break
    }
  }
}
canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  checkpoint()
  canvas.setPointerCapture(event.pointerId)
  const p = point(event),
    kind = $('tool').value
  if (kind === 'eraser') {
    drawing = { erase: true }
    erase(p)
  } else {
    drawing = {
      part,
      kind,
      color: $('color').value,
      width: Number($('width').value),
      fill: $('fill').checked,
      points: kind === 'path' ? [p] : [p, p],
    }
    editable().push(drawing)
  }
  changed()
})
canvas.addEventListener('pointermove', (event) => {
  if (!drawing) return
  const p = point(event)
  if (drawing.erase) erase(p)
  else if (drawing.kind === 'path') {
    const last = drawing.points.at(-1)
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2.5 && drawing.points.length < 600) drawing.points.push(p)
  } else drawing.points[1] = p
  changed()
})
function end() {
  drawing = null
  render()
}
canvas.addEventListener('pointerup', end)
canvas.addEventListener('pointercancel', end)
for (const button of document.querySelectorAll('[data-part]'))
  button.onclick = () => {
    part = button.dataset.part
    render()
  }
$('expression').onchange = render
$('copyNeutral').onclick = () => {
  if ($('expression').value === 'neutral') return
  checkpoint()
  face.frames[$('expression').value] = clone(face.frames.neutral)
  changed()
}
$('undo').onclick = () => {
  if (!undo.length) return
  redo.push(clone(face))
  face = undo.pop()
  $('background').value = face.background
  changed()
}
$('redo').onclick = () => {
  if (!redo.length) return
  undo.push(clone(face))
  face = redo.pop()
  $('background').value = face.background
  changed()
}
$('clearPart').onclick = () => {
  checkpoint()
  face.frames[$('expression').value] = editable().filter((stroke) => stroke.part !== part)
  changed()
}
$('background').oninput = () => {
  face.background = $('background').value
  changed()
}
$('name').oninput = () => {
  face.name = $('name').value
  changed()
}
function replace(value) {
  if (dirty && !confirm('編集中の絵を切り替えますか？ 下書きは残ります。')) return
  install(value)
}
for (const button of document.querySelectorAll('[data-template]'))
  button.onclick = () => {
    const name = button.dataset.template,
      next = faceTemplate(name)
    if (name === 'blank') {
      next.name = 'マイフェイス'
      next.frames.neutral = []
    }
    replace(next)
  }
$('deviceTemplate').onclick = () => {
  if (savedFace) replace(savedFace)
  else notice('本体に保存した顔はまだ読み込めていません。', true)
}
$('draft').onclick = () => {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey))
    if (!value) throw Error()
    replace(validateFace(value))
  } catch (_) {
    notice('このブラウザに有効な下書きはありません。', true)
  }
}
$('apply').onclick = async () => {
  try {
    const valid = validateFace(face)
    $('apply').disabled = true
    notice('本体へ保存しています…')
    await request('save', { face: valid })
    savedFace = clone(valid)
    dirty = false
    $('connection').textContent = '本体に反映済み'
    notice('SDへ保存して本体の顔に反映しました。')
  } catch (error) {
    notice(error.message, true)
  } finally {
    $('apply').disabled = false
  }
}
$('restore').onclick = async () => {
  try {
    await request('restore')
    $('connection').textContent = '本体は標準の顔'
    notice('本体を標準の顔に戻しました。絵は保存されています。')
  } catch (error) {
    notice(error.message, true)
  }
}
$('export').onclick = () => {
  try {
    const blob = new Blob([JSON.stringify(validateFace(face), null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = 'stackchan-face.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (error) {
    notice(error.message, true)
  }
}
$('import').onclick = () => $('file').click()
$('file').onchange = async () => {
  const file = $('file').files[0]
  if (!file) return
  try {
    if (file.size > 100000) throw Error('顔ファイルが大きすぎます')
    replace(validateFace(JSON.parse(await file.text())))
  } catch (error) {
    notice(error.message, true)
  }
  $('file').value = ''
}
install(face)
request('get')
  .then((value) => {
    savedFace = validateFace(value.face)
    if (!dirty) install(savedFace)
    $('connection').textContent = value.enabled ? '本体のマイフェイス' : '本体に接続済み'
    notice('パーツを選んで描いてください。')
  })
  .catch(() => {
    $('connection').textContent = 'ブラウザで編集中'
    notice(
      '本体にはまだ接続できません。絵の編集とファイル保存は使えます。設定画面から開くか、本体の更新後に保存してください。',
      true,
    )
  })
function animate(time) {
  const phase = time % 3400,
    blink = $('blink').checked && phase > 3100 ? Math.abs(phase - 3250) / 150 : 1,
    mouth = $('talk').checked ? (Math.sin(time / 130) + 1) / 2 : 0
  draw(preview, { left: blink, right: blink, mouth })
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)
