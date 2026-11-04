import Timer from 'timer'

// Absolute targets in radians, inside the manufacturer's mechanical limits.
export const HEAD_ROTATIONS = Object.freeze({
  left: Object.freeze({ y: .3, p: -.25, r: 0 }),
  right: Object.freeze({ y: -.3, p: -.25, r: 0 }),
  up: Object.freeze({ y: 0, p: -.55, r: 0 }),
  down: Object.freeze({ y: 0, p: -.1, r: 0 }),
  center: Object.freeze({ y: 0, p: -.25, r: 0 }),
})

export const headMoveTool = Object.freeze({
  name: 'head_move',
  description: 'スタックちゃん自身の首を動かす。「上を向いて」「下を向いて」「右を向いて」「左を向いて」「正面を向いて」と頼まれたら実行する。カメラ撮影は不要。結果がcommandedなら指示を送った意味であり、目視確認済みとは言わない。',
  inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up','down','left','right','center'] } }, required: ['direction'], additionalProperties: false },
})

export function headDirectionFromText(text) {
  const value = String(text || '').replace(/\s/g, '').replace(/^(?:スタックちゃん|すたっくちゃん)[、,]*/, '').replace(/[。！!？?]+$/, '')
  const match = /^(上|うえ|下|した|右|みぎ|左|ひだり|正面|しょうめん|前|まえ)(?:の方|のほう)?を?(?:向いて|むいて|見て|みて)(?:ください|ね|よ)?$/.exec(value)
  if (!match) return undefined
  return ({上:'up',うえ:'up',下:'down',した:'down',右:'right',みぎ:'right',左:'left',ひだり:'left',正面:'center',しょうめん:'center',前:'center',まえ:'center'})[match[1]]
}

export async function moveHead(robot, args = {}) {
  const direction = args.direction
  if (!Object.hasOwn(HEAD_ROTATIONS, direction)) throw new Error('首の向きは上下・左右・正面から選んでください')
  trace('[head-motion] start direction='+direction+'\n')
  robot.lookAway()
  await robot.setTorque(true)
  try {
    await robot.setPose({ ...robot.pose.body, rotation: { ...HEAD_ROTATIONS[direction] } }, .5)
    await new Promise(resolve => Timer.set(resolve, 650))
    trace('[head-motion] commanded direction=' + direction + ' verified=false\n')
    return { commanded: true, direction }
  } catch (error) {
    trace('[head-motion] failed direction=' + direction + ' reason=' + String(error).slice(0,120) + '\n')
    await robot.setTorque(false)
    throw error
  }
}
