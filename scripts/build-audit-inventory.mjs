import fs from 'node:fs';
import ts from 'typescript';
const root='apps-script/versions/v56';
const entries=[];const legacy=[];
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.gs')).sort()) {
  const source=ts.createSourceFile(file,fs.readFileSync(root+'/'+file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  function walk(node,owner='global') {
    if(ts.isFunctionDeclaration(node)&&node.name){owner=node.name.text;if(/Legacy|V\d+_|^myFunction/.test(owner))legacy.push([file,owner]);}
    if(ts.isPropertyAssignment(node)&&node.name.getText(source)==='callback_data'&&!/Legacy|V\d+_|^myFunction/.test(owner)) {
      const parent=node.parent;const text=parent.properties?.find(p=>p.name?.getText(source)==='text')?.initializer?.getText(source)||'';
      entries.push([text,node.initializer.getText(source),file,owner,source.getLineAndCharacterOfPosition(node.pos).line+1]);
    }
    ts.forEachChild(node,n=>walk(n,owner));
  }walk(source);
}
const q=value=>'"'+String(value).replaceAll('"','""')+'"';
fs.writeFileSync('docs/AUDIT_TELEGRAM_BUTTONS.csv',[
 ['label_expression','callback_before_security_sealing','file','renderer','line'].map(q).join(','),
 ...entries.map(r=>r.map(q).join(','))].join('\n')+'\n');
fs.writeFileSync('docs/AUDIT_LEGACY_FUNCTIONS.csv',[
 'file,function',...legacy.map(r=>r.map(q).join(','))].join('\n')+'\n');
console.log(JSON.stringify({renderedCallbackDefinitions:entries.length,retainedLegacyFunctions:legacy.length}));
