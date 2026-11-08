import type { CameraCaptureOptions, CameraFrame, RobotCamera } from 'camera'

const NULL_CAMERA: RobotCamera = {
  available: false,
  start() {},
  stop() {},
  close() {},
  async capture() {
    return undefined
  },
}

function traceMessage(message: string): void {
  ;(globalThis as typeof globalThis & { trace?: (message: string) => void }).trace?.(message)
}

function isThenable(value: unknown): value is Promise<void> {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { then?: unknown }).then === 'function'
}

type ManagedTouchPanel = {
  start(): void
  stop(): void
}

export type RuntimeCameraConstructorParam = {
  camera?: RobotCamera
  touchPanel?: ManagedTouchPanel
}

export class StackchanRuntimeCamera implements RobotCamera {
  #camera: RobotCamera
  #cameraActive = false
  #touchPanel: ManagedTouchPanel | undefined
  #touchPanelPaused = false

  constructor(params: RuntimeCameraConstructorParam) {
    this.#camera = params.camera ?? NULL_CAMERA
    this.#touchPanel = params.touchPanel
  }

  get available(): boolean | undefined {
    return this.#camera.available
  }

  get camera(): RobotCamera {
    return this
  }

  start(options?: Parameters<RobotCamera['start']>[0]): Promise<void> | void {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      traceMessage('[runtime-camera] start begin\n')
      const result = this.#camera.start(options)
      if (isThenable(result)) {
        return result.then(
          () => {
            traceMessage('[runtime-camera] start done\n')
            this.#cameraActive = true
          },
          (error) => {
            // Native start may have partially reserved I2C/DMA resources.
            // Only a confirmed close may restore shared touch hardware.
            throw error
          },
        )
      }
      traceMessage('[runtime-camera] start done\n')
      this.#cameraActive = true
    } catch (error) {
      // Do not restart touch until the native camera is closed.
      throw error
    }
  }

  stop(): Promise<void> | void {
    const wasActive = this.#cameraActive
    const finish = () => {
      traceMessage('[runtime-camera] stop camera done\n')
      this.#cameraActive = false
      if (wasActive) {
        traceMessage('[runtime-camera] touch panel resume begin\n')
        this.#resumeTouchPanel()
        traceMessage('[runtime-camera] touch panel resume done\n')
      }
    }

    try {
      traceMessage('[runtime-camera] stop begin\n')
      const result = this.#camera.stop()
      if (isThenable(result)) {
        return result.then(
          () => finish(),
          (error) => {
            // Keep the bus reserved on stop failure; close() may retry.
            throw error
          },
        )
      }
      finish()
    } catch (error) {
      throw error
    }
  }

  close(onStage?: (stage: string) => void): Promise<void> | void {
    // Optional, archive-only numeric RTC checkpoint callback; no SD writes.
    const checkpoint = (stage: string) => onStage?.(stage)
    const done = () => {
      traceMessage('[runtime-camera] close done\n')
      this.#cameraActive = false
      // The touch sensor shares CoreS3 internal I2C pins with camera SCCB.
      // Never restart it until the native camera has released its bus.
      checkpoint('TOUCH_RESUME_BEGIN')
      this.#resumeTouchPanel()
      checkpoint('TOUCH_RESUME_DONE')
    }
    const fail = (error: unknown): never => {
      // Unsafe to restart touch: native stop/close did not confirm release.
      // Retain the active/paused state until a successful retry or reboot.
      traceMessage('[runtime-camera] close failed; touch remains paused\n')
      throw error
    }
    const finish = (): Promise<void> | void => {
      try {
        checkpoint('CAMERA_NATIVE_CLOSE_BEGIN')
        const result = this.#camera.close?.()
        if (isThenable(result)) return result.then(
          () => {
            checkpoint('CAMERA_NATIVE_CLOSE_DONE')
            done()
          },
          fail,
        )
        checkpoint('CAMERA_NATIVE_CLOSE_DONE')
        done()
      } catch (error) {
        fail(error)
      }
    }

    try {
      traceMessage('[runtime-camera] close begin\n')
      checkpoint('CAMERA_STOP_BEGIN')
      const result = this.#camera.stop()
      if (isThenable(result)) return result.then(
        () => {
          checkpoint('CAMERA_STOP_DONE')
          return finish()
        },
        fail,
      )
      checkpoint('CAMERA_STOP_DONE')
      return finish()
    } catch (error) {
      return fail(error)
    }
  }

  async capture(options?: Parameters<RobotCamera['capture']>[0]) {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      traceMessage('[runtime-camera] capture begin\n')
      const frame = await this.#camera.capture(options)
      traceMessage(`[runtime-camera] capture done frame=${frame ? 'yes' : 'no'}\n`)
      // The frame is still backed by native camera DMA memory.
      // Keep touch paused through JPEG conversion until stop()/close().
      this.#cameraActive = true
      return frame
    } catch (error) {
      // Upstream photo() attempts native close before touch may resume.
      throw error
    }
  }

  /**
   * Photo-only fast path: process the still frame on the SAME Promise
   * continuation where the native capture resolved. The ordinary capture()
   * path adds another Promise resolution before photo/JPEG/SD code runs,
   * which is where the CoreS3 hardware watchdog traced its last stall.
   *
   * Processors are synchronous and must release the frame before returning.
   * Leave the touch panel paused until the processor closes the camera.
   */
  async captureWithProcessor<T>(
    options: CameraCaptureOptions,
    processor: (frame: CameraFrame) => T,
  ): Promise<T> {
    const wasActive = this.#cameraActive
    if (!wasActive) this.#pauseTouchPanel()
    try {
      traceMessage('[runtime-camera] processor capture begin\n')
      const frame = await this.#camera.capture(options)
      traceMessage(`[runtime-camera] processor frame ready=${frame ? 'yes' : 'no'}\n`)
      if (!frame) throw new Error('No camera frame')
      this.#cameraActive = true
      // This log MUST be immediately followed by CAMERA_CAPTURE from the
      // processor; there must not be another await or Promise here.
      traceMessage('[runtime-camera] processor enter\n')
      return processor(frame)
    } catch (error) {
      // A failed capture can leave the sensor allocated; do not race touch.
      throw error
    }
  }

  #pauseTouchPanel(): void {
    if (!this.#touchPanel || this.#touchPanelPaused) return
    this.#touchPanel.stop()
    this.#touchPanelPaused = true
  }

  #resumeTouchPanel(): void {
    if (!this.#touchPanel || !this.#touchPanelPaused) return
    try {
      this.#touchPanel.start()
      // The panel remains logically paused until its hardware start succeeds.
      // A failed restart must not make close() report a recovered device.
      this.#touchPanelPaused = false
    } catch (error) {
      traceMessage(`[runtime-camera] touch panel restart error ${errorMessage(error)}\n`)
      // Preserve the paused state for a later explicit retry and let the
      // photo teardown keep its recovery guard instead of claiming success.
      throw error
    }
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}
