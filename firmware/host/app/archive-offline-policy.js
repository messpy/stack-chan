// One-second observations; a reconnect never enables cloud chat or the microphone.
export class OfflinePolicy {
  constructor(){this.age=0;this.absent=0;this.entered=false;}
  reset(){this.absent=0;this.entered=false;}
  observe({enabled,usb,wifi,setup,busy}){
    this.age++;
    if(!enabled||usb||wifi){this.reset();return false;}
    if(this.age<30||setup){this.absent=0;return false;}
    this.absent=Math.min(10,this.absent+1);
    return this.absent>=10&&!this.entered&&!busy;
  }
  enteredOffline(){this.entered=true;}
}
