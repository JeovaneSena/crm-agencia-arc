import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
const walk = d => readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`])
for (const file of [...walk('src'),...walk('supabase/functions')].filter(f=>/\.tsx?$/.test(f)&&!f.endsWith('prompt-oficial.ts'))) {
 const src=readFileSync(file,'utf8'), tree=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS)
 function visit(n) {
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isJsxText(n)||[ts.SyntaxKind.TemplateHead,ts.SyntaxKind.TemplateMiddle,ts.SyntaxKind.TemplateTail].includes(n.kind)) {
   const t=n.text??''
   if (/(?:\b(?:pacientes?|clínica|odont\w*|dentistas?|sorriso|dentes|lentes|clareamento)\b|(?:a|na|pela|uma|da) diagnóstico|vira.*Cliente|torna.*cliente)/i.test(t) && /\s/.test(t)) console.log(`${file}:${tree.getLineAndCharacterOfPosition(n.getStart(tree)).line+1}: ${t.trim()}`)
  }
  ts.forEachChild(n,visit)
 }
 visit(tree)
}
