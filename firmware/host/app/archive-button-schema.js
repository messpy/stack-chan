export function validateButton(value){
 if(!value||typeof value.text!=='string'||!value.text.trim()||value.text.length>80||!/^#[0-9a-f]{6}$/i.test(value.background)||!/^#[0-9a-f]{6}$/i.test(value.textColor)||!/^([a-z][a-zA-Z0-9_]{0,47})$/.test(value.method))throw new Error('ボタン設定を確認してください');
 return {...value,text:value.text.trim()};
}
export function invokeButton(definition,methods){const button=validateButton(definition);if(!Object.prototype.hasOwnProperty.call(methods,button.method)||typeof methods[button.method]!=='function')throw new Error('未登録のボタンメソッドです');return methods[button.method](button.args||{});}
export function speakerButtons(people){const base=(id,text,background,method,args={})=>({id,text,background,textColor:'#ffffff',method,args});return {people:people.map(p=>base('person-'+p.id,p.name+' で会話','#2563eb','selectPerson',{id:p.id,name:p.name})),register:base('register','登録','#167647','register'),guest:base('guest','ゲストで会話','#596375','guest'),previous:base('previous','前','#596375','previous'),next:base('next','次','#596375','next')};}
