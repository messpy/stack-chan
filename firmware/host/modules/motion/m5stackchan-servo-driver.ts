import Timer from 'timer'
import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  type M5StackChanServoConfig,
  RAD_TO_01_DEGREE,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
} from 'm5stackchan-servo'
import {
  type MotionCompletion,
  type MotionDurationSeconds,
  type MotionResultCallback,
  motionDurationSecondsToMilliseconds,
} from 'motion-controller'
import SCServo from 'protocols/scservo'
import { type PY32IOExpander, tryGetSharedPY32IOExpander } from 'py32-io-expander'
import type { Maybe, Rotation } from 'stackchan-util'

type M5StackChanServoDriverProps = Partial<{
  panId: number
  tiltId: number
  yawZeroPosition: number
  pitchZeroPosition: number
  config: Partial<{
    serial: Partial<M5StackChanServoConfig['serial']>
    yaw: Partial<M5StackChanServoConfig['yaw']>
    pitch: Partial<M5StackChanServoConfig['pitch']>
  }>
  serial: Partial<M5StackChanServoConfig['serial']>
  servoPower: {
    type?: 'py32' | 'none'
    pin?: number
    address?: number
  }
}>

let activeDriver: M5StackChanServoDriver | undefined
export function getM5StackChanDriver() { return activeDriver }

export class M5StackChanServoDriver {
  #pan: SCServo
  #tilt: SCServo
  #config: M5StackChanServoConfig
  #positionPoll?: ReturnType<typeof Timer.set>
  #pollingPosition = false
  #lastKnownRotation?: Rotation
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }
  #servoPower?: {
    setEnabled: (enabled: boolean) => void
    diagnostics: () => unknown
  }

  constructor(param: M5StackChanServoDriverProps = {}) {
    this.#config = createM5StackChanServoConfig({
      serial: {
        ...param.config?.serial,
        ...param.serial,
      },
      yaw: {
        ...param.config?.yaw,
        ...(param.panId !== undefined ? { id: param.panId } : {}),
        ...(param.yawZeroPosition !== undefined ? { zeroPosition: param.yawZeroPosition } : {}),
      },
      pitch: {
        ...param.config?.pitch,
        ...(param.tiltId !== undefined ? { id: param.tiltId } : {}),
        ...(param.pitchZeroPosition !== undefined ? { zeroPosition: param.pitchZeroPosition } : {}),
      },
    })
    activeDriver = this
    this.#pan = new SCServo({ id: this.#config.yaw.id, serial: this.#config.serial, awaitWriteResponse: false })
    this.#tilt = new SCServo({ id: this.#config.pitch.id, serial: this.#config.serial, awaitWriteResponse: false })
    if (param.servoPower?.type !== 'none') {
      this.#servoPower = new PY32ServoPower(param.servoPower?.pin ?? 0, param.servoPower?.address)
    }
  }

  getDiagnostics(done: (result: unknown) => void) {
    const power = this.#servoPower?.diagnostics()
    this.#pan.readRawPosition((pan) => {
      this.#tilt.readRawPosition((tilt) => done({ serial: this.#config.serial, power, pan, tilt }))
    })
  }

  get lastKnownRotation() { return this.#lastKnownRotation }

  onAttached() {
    this.#servoPower?.setEnabled(true)
    // Read the initial physical pose once. Repeated polling would share the
    // half-duplex bus with movement commands and can corrupt servo replies.
    this.#positionPoll = Timer.set(() => {
      if (this.#pollingPosition) return
      this.#pollingPosition = true
      this.getRotation((result) => {
        this.#pollingPosition = false
        if (result.success === false) trace(`[m5stackchan-servo] position read failed: ${result.reason}\n`)
      })
    }, 500)
  }

  onDetached() {
    if (this.#positionPoll) Timer.clear(this.#positionPoll)
    this.#positionPoll = undefined
    this.#servoPower?.setEnabled(false)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.#pan.setTorque(torque, (panError) => {
      if (panError != null) {
        callback?.(panError)
        return
      }
      this.#tilt.setTorque(torque, callback)
    })
  }

  applyRotation(ori: Rotation, time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this.#config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this.#config.pitch)
    if (time === 0) {
      this.#pan.setRawPosition(panRawPosition, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPosition(tiltRawPosition, callback)
      })
    } else {
      const goalTimeMilliseconds = motionDurationSecondsToMilliseconds(time)
      this.#pan.setRawPositionInTime(panRawPosition, goalTimeMilliseconds, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPositionInTime(tiltRawPosition, goalTimeMilliseconds, callback)
      })
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this.#pan.readRawPosition((panStatus) => {
      if (panStatus.success === false) {
        this.#returnRotationError(callback, panStatus.reason)
        return
      }
      this.#tilt.readRawPosition((tiltStatus) => {
        if (tiltStatus.success === false) {
          this.#returnRotationError(callback, tiltStatus.reason)
          return
        }
        const yawAngle = rawPositionToAngle(panStatus.value.position, this.#config.yaw)
        const pitchAngle = rawPositionToAngle(tiltStatus.value.position, this.#config.pitch)
        this.#rotation.y = yawAngle / RAD_TO_01_DEGREE
        this.#rotation.p = -(pitchAngle / RAD_TO_01_DEGREE)
        this.#rotation.r = 0.0
        this.#lastKnownRotation = { ...this.#rotation }
        callback(this.#rotationResult)
      })
    })
  }

  #returnRotationError(callback: MotionResultCallback<Maybe<Rotation>>, reason?: string): void {
    this.#rotationErrorResult.reason = reason
    callback(this.#rotationErrorResult)
  }
}

class PY32ServoPower {
  #pin: number
  #expander?: PY32IOExpander

  constructor(pin: number, address?: number) {
    this.#pin = pin
    const expander = tryGetSharedPY32IOExpander(address === undefined ? undefined : { address }, (error) => {
      trace(`[m5stackchan-servo] PY32 servo power init failed: ${error}\n`)
    })
    if (!expander) return
    this.#expander = expander
    expander.setDirection(this.#pin, true)
    expander.setPullMode(this.#pin, true)
    trace(`[m5stackchan-servo] configured PY32 servo power pin ${this.#pin}\n`)
  }

  diagnostics() {
    try {
      const expander = this.#expander
      if (!expander) return { available: false }
      return { available: true, version: expander.readRegister8(2), output: expander.getWriteValue(this.#pin), direction: expander.readRegister8(3) }
    } catch (error) { return { error: String(error) } }
  }

  setEnabled(enabled: boolean) {
    const expander = this.#expander
    if (!expander) return
    expander.digitalWrite(this.#pin, enabled)
    trace(`[m5stackchan-servo] servo power ${enabled ? 'on' : 'off'} (${expander.getWriteValue(this.#pin)})\n`)
  }
}
