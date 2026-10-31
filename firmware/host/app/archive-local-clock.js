import Time from 'time'
import Timer from 'timer'
let rtc,
  lastSaved = 0,
  lastError = '',
  restored = false
const valid = (epoch) => Number.isFinite(epoch) && epoch >= 1700000000000 && epoch < Date.UTC(2100, 0, 1)
const bcd = (n) => (Math.floor(n / 10) << 4) | (n % 10)
const decimal = (n) => {
  if ((n & 15) > 9 || n >> 4 > 9) throw new Error('RTCの値が不正です')
  return (n >> 4) * 10 + (n & 15)
}
export function decodeRTC(bytes) {
  if (bytes.length !== 7 || bytes[0] & 128) throw new Error('RTCの電池または時刻を確認してください')
  const second = decimal(bytes[0] & 127),
    minute = decimal(bytes[1] & 127),
    hour = decimal(bytes[2] & 63),
    day = decimal(bytes[3] & 63),
    month = decimal(bytes[5] & 31),
    year = (bytes[5] & 128 ? 1900 : 2000) + decimal(bytes[6])
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second),
    d = new Date(epoch)
  if (
    !valid(epoch) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    d.getUTCDate() !== day
  )
    throw new Error('RTCの時刻が未設定です')
  return epoch
}
export function encodeRTC(epoch) {
  if (!valid(epoch)) throw new Error('時刻が範囲外です')
  const d = new Date(epoch)
  return Uint8Array.of(
    bcd(d.getUTCSeconds()),
    bcd(d.getUTCMinutes()),
    bcd(d.getUTCHours()),
    bcd(d.getUTCDate()),
    d.getUTCDay(),
    bcd(d.getUTCMonth() + 1),
    bcd(d.getUTCFullYear() % 100),
  )
}
export function clockParts(epoch = Date.now()) {
  const d = new Date(valid(epoch) ? epoch + 9 * 3600000 : Date.UTC(2026, 0, 1))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  }
}
export function japaneseEpoch(parts) {
  const { year, month, day, hour, minute } = parts
  if (
    ![year, month, day, hour, minute].every(Number.isInteger) ||
    year < 2024 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    throw new Error('日時を確認してください')
  const epoch = Date.UTC(year, month - 1, day, hour, minute) - 9 * 3600000
  const actual = clockParts(epoch)
  for (const key of ['year', 'month', 'day', 'hour', 'minute'])
    if (parts[key] !== actual[key]) throw new Error('存在しない日付です')
  return epoch
}
function saveRTC() {
  if (!rtc || !valid(Date.now())) return
  try {
    rtc.writeBuffer(2, encodeRTC(Date.now()))
    rtc.writeUint8(0, rtc.readUint8(0) & ~0x20)
    const check = new Uint8Array(7)
    rtc.readBuffer(2, check)
    if (Math.abs(decodeRTC(check) - Date.now()) > 3000) throw new Error('RTC verification')
    lastSaved = Date.now()
    lastError = ''
  } catch (_) {
    lastError = 'RTCへ保存できませんでした'
  }
}
export function setLocalTime(epoch) {
  if (!valid(epoch)) throw new Error('日時を確認してください')
  Time.set(Math.floor(epoch / 1000))
  saveRTC()
  return localClockStatus()
}
export function localClockStatus() {
  return { ready: valid(Date.now()), rtc: !!rtc, restored, lastSaved, error: lastError, parts: clockParts() }
}
export function startLocalClock() {
  let probed = false
  try {
    rtc = new device.io.SMBus({ ...device.i2c.internal, hz: 400000, address: 0x51 })
    const bytes = new Uint8Array(7)
    rtc.readBuffer(2, bytes)
    probed = true
    if (rtc.readUint8(0) & 0x20) throw new Error('RTC stopped')
    const epoch = decodeRTC(bytes)
    if (!valid(Date.now())) {
      Time.set(Math.floor(epoch / 1000))
      restored = true
    }
    trace('[local-clock] RTC available\n')
  } catch (_) {
    if (!probed) {
      try {
        rtc?.close()
      } catch (_) {}
      rtc = undefined
    }
    lastError = rtc ? 'RTCの時刻を設定してください' : 'RTCを利用できません。時計を本体で設定してください'
    trace('[local-clock] clock setup may be required\n')
  }
  if (valid(Date.now())) saveRTC()
  Timer.repeat(() => {
    if (valid(Date.now()) && Math.abs(Date.now() - lastSaved) >= 60000) saveRTC()
  }, 30000)
}
