const digits = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう']
const hours = [
  'れいじ',
  'いちじ',
  'にじ',
  'さんじ',
  'よじ',
  'ごじ',
  'ろくじ',
  'しちじ',
  'はちじ',
  'くじ',
  'じゅうじ',
  'じゅういちじ',
  'じゅうにじ',
  'じゅうさんじ',
  'じゅうよじ',
  'じゅうごじ',
  'じゅうろくじ',
  'じゅうしちじ',
  'じゅうはちじ',
  'じゅうくじ',
  'にじゅうじ',
  'にじゅういちじ',
  'にじゅうにじ',
  'にじゅうさんじ',
]
const minuteUnits = [
  '',
  'いっぷん',
  'にふん',
  'さんぷん',
  'よんぷん',
  'ごふん',
  'ろっぷん',
  'ななふん',
  'はっぷん',
  'きゅうふん',
]
export function minuteReading(value) {
  if (!Number.isInteger(value) || value < 1 || value > 120) throw new Error('分数を確認してください')
  if (value === 100) return 'ひゃっぷん'
  if (value > 100) return 'ひゃく' + minuteReading(value - 100)
  const tens = Math.floor(value / 10),
    ones = value % 10
  if (!tens) return minuteUnits[ones]
  const prefix = tens === 1 ? '' : digits[tens]
  return ones ? prefix + 'じゅう' + minuteUnits[ones] : prefix + 'じゅっぷん'
}
export function timeSpeech(hour, minute) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error('時刻を確認してください')
  return [
    { text: 'いまは。', pause: 250 },
    { text: hours[hour] + '。', pause: 400 },
    { text: minute ? minuteReading(minute) + 'です。' : 'ちょうどです。', pause: 0 },
  ]
}
export function localSpeech(action, clock, minutes) {
  if (action === 'time' && clock.ready) return timeSpeech(clock.parts.hour, clock.parts.minute)
  if (action === 'time')
    return [
      { text: 'とけいが、まだ、せっていされていません。', pause: 350 },
      { text: 'とけいせっていで、あわせてね。', pause: 0 },
    ]
  if (action === 'timer')
    return [
      { text: minuteReading(minutes) + 'の、たいまーを。', pause: 350 },
      { text: 'せっていしました。', pause: 0 },
    ]
  if (action === 'hello')
    return [
      { text: 'こんにちは。', pause: 350 },
      { text: 'すたっくちゃんです。', pause: 400 },
      { text: 'ねっとがなくても、ここにいるよ。', pause: 0 },
    ]
  if (action === 'stop') return [{ text: 'あらーむを、ていしします。', pause: 0 }]
  return [
    { text: 'ほんたいだけで、うごいています。', pause: 450 },
    { text: 'たいまーと、あらーむが、つかえます。', pause: 450 },
    { text: 'したの、ぼたんを、おしてね。', pause: 0 },
  ]
}
