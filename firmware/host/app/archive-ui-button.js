import {Container,Label,Skin,Style} from 'piu/MC';
import {uiFont} from 'ui-theme';
import {validateButton,invokeButton} from 'archive-button-schema';
export function createUIButton(definition,methods,layout={},onError=()=>{}){
 const data=validateButton(definition),normal=new Skin({fill:data.background}),pressed=new Skin({fill:'#273449'});
 return new Container(null,{...layout,active:true,skin:normal,contents:[new Label(null,{left:4,right:4,top:0,bottom:0,style:new Style({font:uiFont(),color:data.textColor,horizontal:'center',vertical:'middle'}),string:data.text})],Behavior:class extends Behavior{
  onTouchBegan(c,id,x,y){this.x=x;this.y=y;this.cancelled=false;c.skin=pressed;}
  onTouchMoved(c,id,x,y){if(Math.abs(x-this.x)>8||Math.abs(y-this.y)>8){this.cancelled=true;c.skin=normal;}}
  onTouchCancelled(c){this.cancelled=true;c.skin=normal;}
  onTouchEnded(c){c.skin=normal;if(this.cancelled||this.busy)return;this.busy=true;c.active=false;Promise.resolve().then(()=>invokeButton(data,methods)).catch(onError).finally(()=>{this.busy=false;c.active=true;});}
 }});
}
