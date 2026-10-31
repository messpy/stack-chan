import {Container,Label,Text,Skin,Style} from 'piu/MC';
import {ActionButton} from 'ui-controls';
import {uiFont} from 'ui-theme';
export function historyPages(text){
  const pages=[];let lines=[],line='',width=0;
  const endLine=()=>{lines.push(line);line='';width=0;if(lines.length===7){pages.push(lines.join('\n'));lines=[];}};
  for(const char of String(text||'').replace(/\r/g,'')){
    if(char==='\n'){endLine();continue;}
    const size=char.charCodeAt(0)<128?1:2;
    if(width+size>48)endLine();line+=char;width+=size;
  }
  if(line||!lines.length&&!pages.length)endLine();
  if(lines.length)pages.push(lines.join('\n'));return pages;
}
function stamp(value){const d=new Date(value+9*3600000),pad=n=>String(n).padStart(2,'0');return d.getUTCFullYear()+'/'+pad(d.getUTCMonth()+1)+'/'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());}
export function startHistoryUI(robot,actions){
  robot.ui.miniApps.register({id:'archive-history',title:'会話履歴',create(){
    let known=[],current;try{known=actions.people();current=actions.current()}catch(_){}
    const people=[{id:null,name:'全員'},...known];let filter=Math.max(0,people.findIndex(p=>p.id===current?.id));
    let row=0,part=0,result={items:[]},pages=[''];
    const style=new Style({font:uiFont(),color:'black',horizontal:'left',vertical:'top'});
    const meta=new Label(null,{left:8,right:8,top:30,height:18,style,string:''});
    const body=new Text(null,{left:8,right:8,top:50,height:94,style,string:''});
    const position=new Label(null,{left:8,right:8,top:144,height:14,style,string:''});
    const button=(label,onTap,layout)=>new ActionButton({label,onTap},layout);
    const toggle=button('',()=>{filter=(filter+1)%people.length;load();},{left:8,top:0,width:218,height:26});
    const refresh=button('更新',()=>{load();},{right:8,top:0,width:78,height:26});
    const previousText=button('前の文',()=>{if(part>0){part--;render();}},{left:8,top:162,width:70,height:30});
    const nextText=button('次の文',()=>{if(part+1<pages.length){part++;render();}},{left:86,top:162,width:70,height:30});
    const newer=button('新しい',()=>{if(row>0){row--;part=0;render();}},{left:164,top:162,width:70,height:30});
    const older=button('古い',()=>{if(row+1<result.items.length){row++;part=0;render();}},{left:242,top:162,width:70,height:30});
    function render(){
      const item=result.items[row];pages=historyPages(item?.text);part=Math.min(part,pages.length-1);
      toggle.content('label').string='話す人: '+people[filter].name.slice(0,16);
      meta.string=item?stamp(item.created)+' '+(item.role==='assistant'?'StackChan':item.name||'ゲスト')+(item.role==='assistant'&&item.partner?' / '+item.partner:''):'';
      body.string=item?pages[part]:'会話履歴はありません';position.string=item?'履歴 '+(row+1)+' / '+result.items.length+'　文章 '+(part+1)+' / '+pages.length:'';
      previousText.active=part>0;nextText.active=part+1<pages.length;newer.active=row>0;older.active=row+1<result.items.length;
    }
    function load(){try{result=actions.read({user_id:people[filter].id,limit:10});result.items=result.items.slice(0,10);row=0;part=0;render();}catch(_){result={items:[]};render();body.string='SDの会話履歴を読めませんでした。';}}
    load();return {content:new Container(null,{left:0,right:0,top:0,bottom:0,skin:new Skin({fill:'white'}),contents:[toggle,refresh,meta,body,position,previousText,nextText,newer,older]})};
  }});
}
