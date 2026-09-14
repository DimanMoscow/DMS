import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as measurements from '../../lib/measurement-draft.ts';
const require=createRequire(import.meta.url);
export function miniAppViews(input=fs.readFileSync('app/_components/mini-app-shell.tsx','utf8')) {
  const source=input+
    '\nexport {TodayView, LoadedClientCard, CalendarOnboardingSheet, ConfirmationSheet, ClientsView, ReportView, SystemView};';
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,
    jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};
  vm.runInNewContext(compiled,{exports,require:name=>name==='@/lib/measurement-draft'?measurements:require(name),Date,console});
  return exports;
}
