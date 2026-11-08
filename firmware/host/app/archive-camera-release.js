// Close frame first, stop the camera (restoring runtime touch-panel state),
// then close its native instance to release DMA/internal memory.
// Both operations must run even when one of them raises an exception.
export async function releaseCameraResources(camera,frame,report=()=>{}) {
  let firstError
  const attempt=async (stage,operation)=>{
    try {await operation()}
    catch(error){if(!firstError)firstError=error;report(stage,error)}
  }
  await attempt('frame-close',()=>frame?.close?.())
  await attempt('camera-stop',()=>camera.stop())
  if(typeof camera.close==='function')
    await attempt('camera-close',()=>camera.close())
  if(firstError)throw firstError
}
