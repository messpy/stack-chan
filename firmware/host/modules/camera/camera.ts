export type CameraImageType = 'rgb565le' | 'rgb565be' | 'yuv422' | 'jpeg'

export type CameraFrame = {
  width: number
  height: number
  imageType: CameraImageType
  buffer: ArrayBuffer
  close?: () => void
}

export type CameraCaptureOptions = {
  width?: number
  height?: number
  imageType?: CameraImageType
}

export interface RobotCamera {
  readonly available?: boolean
  start(options?: CameraCaptureOptions): Promise<void> | void
  stop(): Promise<void> | void
  close?(): Promise<void> | void
  capture(options?: CameraCaptureOptions): Promise<CameraFrame | undefined>
  /**
   * Optional still-photo fast path. The processor runs synchronously on the
   * camera capture completion callback, before a second async return boundary.
   * The processor must not return a Promise or retain the disposable frame.
   */
  captureWithProcessor?<T>(options: CameraCaptureOptions, processor: (frame: CameraFrame) => T): Promise<T>
}
