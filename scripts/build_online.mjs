import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist/online');
await mkdir(output, { recursive: true });
await cp(resolve(root, 'desktop/assets'), output, { recursive: true });
await cp(resolve(root, 'online/browser-runtime.js'), resolve(output, 'browser-runtime.js'));
await cp(resolve(root, 'online/data-tools.js'), resolve(output, 'data-tools.js'));
await cp(resolve(root, 'online/drive-sync.js'), resolve(output, 'drive-sync.js'));
await cp(resolve(root, 'online/google-config.js'), resolve(output, 'google-config.js'));
await cp(resolve(root, 'online/online.css'), resolve(output, 'online.css'));
await cp(resolve(root, 'online/local-folder.js'), resolve(output, 'local-folder.js'));
await cp(resolve(root, 'online/iphone-backup.js'), resolve(output, 'iphone-backup.js'));
await cp(resolve(root, 'online/dialogs.js'), resolve(output, 'dialogs.js'));
await mkdir(resolve(output, 'vendor'), { recursive: true });
await cp(resolve(root, 'online/node_modules/fflate/umd/index.js'), resolve(output, 'vendor/fflate.js'));
await cp(resolve(root, 'online/node_modules/xlsx/dist/xlsx.full.min.js'), resolve(output, 'vendor/xlsx.js'));
await cp(resolve(root, 'online/node_modules/fflate/LICENSE'), resolve(output, 'vendor/fflate-LICENSE.txt'));
await cp(resolve(root, 'online/node_modules/xlsx/LICENSE'), resolve(output, 'vendor/xlsx-LICENSE.txt'));
await cp(resolve(root, 'desktop/assets/templates/archivio_iniziale.json'), resolve(output, 'initial-state.json'));
let html = await readFile(resolve(output, 'index.html'), 'utf8');
html = html.replace('</head>','<link rel="stylesheet" href="/online.css">\n</head>');
html = html.replace('<script defer src="/accounting.js">', '<script defer src="/vendor/fflate.js"></script>\n<script defer src="/vendor/xlsx.js"></script>\n<script defer src="/data-tools.js"></script>\n<script defer src="/browser-runtime.js"></script>\n<script defer src="/drive-sync.js"></script>\n<script defer src="/accounting.js">');
html = html.replace('<script defer src="/drive-sync.js">', '<script defer src="/google-config.js"></script>\n<script defer src="/drive-sync.js">');
html = html.replace('<script defer src="/google-config.js">','<script defer src="/local-folder.js"></script>\n<script defer src="/google-config.js">');
html = html.replace('<script defer src="/local-folder.js">','<script defer src="/iphone-backup.js"></script>\n<script defer src="/local-folder.js">');
// Adapt only online copy: desktop assets, styles and markup remain unchanged.
html = html.replace('<script defer src="/iphone-backup.js">','<script defer src="/dialogs.js"></script>\n<script defer src="/iphone-backup.js">');
const useDialogs = source => source.replace(/\b(confirm|alert|prompt)\(/g,'await QuadraDialog.$1(');
for (const file of ['accounting.js','schedule.js','payments.js','local-folder.js','iphone-backup.js']) {
  let source = await readFile(resolve(output,file),'utf8');
  source = source.replace('function handleAccountingClick(e){','async function handleAccountingClick(e){')
    .replace('function handleScheduleClick(e){','async function handleScheduleClick(e){');
  await writeFile(resolve(output,file),useDialogs(source));
}
let app = await readFile(resolve(output,'app.js'),'utf8');
app = useDialogs(app).replace('function onClick(e){','async function onClick(e){')
  .replace('if(handleScheduleClick(e))','if(await handleScheduleClick(e))')
  .replace('if(handleAccountingClick(e))','if(await handleAccountingClick(e))');
app = app.replace('<div class="top-actions">','<div class="top-actions">${window.QuadraDrive.controls()}');
app = app.replace('function infoStrip(){', 'window.QuadraOnlineReload=async()=>{state=await window.QuadraBrowser.load();render();};\nfunction infoStrip(){');
app = app.replace('<strong>Archivio offline sul tuo PC.</strong> I dati vengono salvati nella cartella privata esterna al programma. Il backup ZIP include anche allegati e PDF. Nessun dato viene inviato online;', '<strong>Archivio locale su questo dispositivo.</strong> I dati vengono salvati nel browser. Drive si sincronizza all’accesso e con il pulsante Sincronizza. Il backup ZIP include allegati e PDF;');
app = app.replace('Solo su questo PC<br>Dati conservati in locale.', 'Dati su questo dispositivo.<br>Drive solo durante la sincronizzazione.');
app = app.replace('Offline sul PC</span>', 'Archivio locale</span>');
app = app.replace('${renderCategoryManager()}','${window.QuadraLocalFolder.controls()}${renderCategoryManager()}');
app = app.replace('function render(){','function render(){\n queueMicrotask(()=>window.QuadraIphoneBackup.show());');
await writeFile(resolve(output,'app.js'),app);
await writeFile(resolve(output, 'index.html'), html);
await cp(resolve(root, 'online/sw.js'), resolve(output, 'sw.js'));
await cp(resolve(root, 'online/_headers'), resolve(output, '_headers'));
console.log(`PWA statica generata in ${output}`);
