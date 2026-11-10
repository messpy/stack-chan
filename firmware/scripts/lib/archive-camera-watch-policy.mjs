// Host-only P1 prototype: no camera access, image persistence, UI or cloud traffic.
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function rgb565ToGrayDownsample(bytes,width,height,scale=4){
 if(!integer(width,1,320)||!integer(height,1,240)||!integer(scale,1,16))throw new RangeError('invalid dimensions');
 if(!(bytes instanceof Uint8Array)||bytes.length!==width*height*2)throw new RangeError('RGB565LE bytes mismatch');
 const cols=Math.floor(width/scale),rows=Math.floor(height/scale);
 if(cols===0||rows===0||cols*rows>4096)throw new RangeError('downsample exceeds memory budget');
 const gray=new Uint8Array(cols*rows);
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  let sum=0;
  for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
   const at=2*((y*scale+dy)*width+x*scale+dx);
   const pixel=bytes[at]|(bytes[at+1]<<8);
   const r=((pixel>>11)&31)*255/31,g=((pixel>>5)&63)*255/63,b=(pixel&31)*255/31;
   sum+=Math.round((77*r+150*g+29*b)/256);
  }
  gray[y*cols+x]=Math.round(sum/(scale*scale));
 }
 return {width:cols,height:rows,gray};
}

export function compareGrayFrames(previous,current,width,height,options={}){
 if(!(previous instanceof Uint8Array)||!(current instanceof Uint8Array)||previous.length!==width*height||current.length!==previous.length||!integer(width,1,320)||!integer(height,1,240)||width*height>4096)throw new RangeError('gray frame mismatch');
 const {pixelThreshold=18,minChangedRatio=0.09,roi={x:0,y:0,width,height}}=options;
 if(!integer(pixelThreshold,1,255)||!Number.isFinite(minChangedRatio)||minChangedRatio<0||minChangedRatio>1||![roi.x,roi.y,roi.width,roi.height].every(Number.isInteger)||roi.x<0||roi.y<0||roi.width<1||roi.height<1||roi.x+roi.width>width||roi.y+roi.height>height)throw new RangeError('invalid ROI or threshold');
 // Median of all pixel differences is robust to small foreground movement.
 const histogram=new Uint16Array(511);
 let total=0;
 for(let y=roi.y;y<roi.y+roi.height;y++)for(let x=roi.x;x<roi.x+roi.width;x++){
  const i=y*width+x;histogram[current[i]-previous[i]+255]++;total++;
 }
 let count=0,medianDelta=0;
 for(let i=0;i<histogram.length;i++){count+=histogram[i];if(count>Math.floor((total-1)/2)){medianDelta=i-255;break}}
 let changed=0,sum=0;
 for(let y=roi.y;y<roi.y+roi.height;y++)for(let x=roi.x;x<roi.x+roi.width;x++){
  const i=y*width+x;const delta=Math.abs(current[i]-previous[i]-medianDelta);
  sum+=delta;if(delta>=pixelThreshold)changed++;
 }
 const ratio=changed/total;
 return {changedPixels:changed,sampledPixels:total,illuminationOffset:medianDelta,meanResidual:sum/total,ratio,motion:ratio>=minChangedRatio};
}

export function nextMotionAlert(state,score,now,{consecutive=2,cooldownMs=300000}={}){
 if(!state||!Number.isFinite(now)||!Number.isFinite(score)||score<0||score>1||!integer(consecutive,1,20)||!integer(cooldownMs,0,3600000))throw new RangeError('invalid detector state');
 const hits=score>=0.09?Math.min(consecutive,Math.max(0,state.hits||0)+1):0;
 const lastAlert=Number.isFinite(state.lastAlert)?state.lastAlert:null;
 const notify=hits>=consecutive&&(lastAlert===null||now-lastAlert>=cooldownMs);
 return {hits:notify?0:hits,lastAlert:notify?now:lastAlert,notify};
}
