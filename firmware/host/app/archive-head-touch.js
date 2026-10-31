import Si12T from 'embedded:sensor/Touch/Si12T';

// Use the official Si12T driver and the already-initialized CoreS3 internal bus.
export default function createHeadTouchConstructor() {
  let driver;
  try {
    driver=new Si12T({sensor:{...device.i2c.internal,io:device.io.SMBus},channels:3,sensitivityLevel:3});
    driver.sample();
    trace('[head-touch] Si12T ready: official three-channel input enabled\n');
  }catch(error){
    driver?.close?.();
    trace('[head-touch] sensor unavailable: '+String(error)+'\n');
    return undefined;
  }
  return class {
    constructor(_options){return driver;}
  };
}
