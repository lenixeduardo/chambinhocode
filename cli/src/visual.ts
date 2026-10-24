import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

export type VisualIssue = {severity:'high'|'medium'|'low'; message:string};
export type VisualReport = {url:string; output:string; screenshots:string[]; issues:VisualIssue[]; metrics:Record<string,unknown>};
const require = createRequire(import.meta.url);

export function resolveVisualTarget(root:string, target:string):string {
  if (/^https?:\/\//i.test(target)) {
    const url = new URL(target);
    if (url.username || url.password) throw new Error('URLs com credenciais não são permitidas.');
    return url.href;
  }
  const absolute = path.resolve(root,target);
  const relative = path.relative(root,absolute);
  if (relative.startsWith('..'+path.sep) || relative==='..' || path.isAbsolute(relative)) throw new Error('Arquivo fora do workspace.');
  if (!/\.html?$/i.test(absolute)) throw new Error('Informe um arquivo .html ou uma URL http(s).');
  return pathToFileURL(absolute).href;
}

export async function auditVisual(root:string, target:string, outputDir=path.join(root,'.chambinho','visual')):Promise<VisualReport> {
  const url=resolveVisualTarget(root,target);
  // The browser package is loaded only when visual auditing is invoked.
  let playwright: any;
  try { playwright=require('playwright'); }
  catch { throw new Error('Playwright não instalado. Na pasta cli execute: npm install && npx playwright install chromium'); }
  await fs.mkdir(outputDir,{recursive:true});
  const browser=await playwright.chromium.launch({headless:true});
  const screenshots:string[]=[];
  const issues:VisualIssue[]=[];
  const metrics:Record<string,unknown>={};
  try {
    for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]] as const){
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
      try {
        const page=await context.newPage();
        const errors:string[]=[];
        page.on('pageerror',(error:Error)=>errors.push(error.message.slice(0,200)));
        const response=await page.goto(url,{waitUntil:'load',timeout:20000});
        await page.evaluate(()=>document.fonts.ready);
        const data=await page.evaluate(()=>{
          const body=document.body;
          const nodes=Array.from(document.querySelectorAll('body *'));
          const visible=nodes.filter(el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';});
          const brokenImages=Array.from(document.images).filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.currentSrc||img.src).slice(0,12);
          const horizontalOverflow=document.documentElement.scrollWidth>innerWidth+2;
          const headings=Array.from(document.querySelectorAll('h1')).map(h=>h.textContent?.trim().slice(0,120));
          const fontFamilies=[...new Set(visible.slice(0,150).map(el=>getComputedStyle(el).fontFamily))].slice(0,12);
          const buttons=Array.from(document.querySelectorAll('button,a,input')).filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;});
          const tinyTargets=buttons.filter(el=>{const r=el.getBoundingClientRect();return r.width<24||r.height<24;}).length;
          return {title:document.title,h1:headings,visibleElements:visible.length,brokenImages,horizontalOverflow,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,fontFamilies,interactiveElements:buttons.length,tinyTargets,bodyText:(body.innerText||'').slice(0,1000)};
        });
        const file=path.join(outputDir,`${name}.png`);
        await page.screenshot({path:file,fullPage:true,animations:'disabled'});
        screenshots.push(file);
        metrics[name]={...data,httpStatus:response?.status()??null,jsErrors:errors};
        if(response && response.status()>=400) issues.push({severity:'high',message:`${name}: HTTP ${response.status()}`});
        if(data.horizontalOverflow) issues.push({severity:'high',message:`${name}: overflow horizontal (${data.scrollWidth}px em ${width}px)`});
        if(data.brokenImages.length) issues.push({severity:'high',message:`${name}: ${data.brokenImages.length} imagens não carregaram`});
        if(errors.length) issues.push({severity:'medium',message:`${name}: ${errors.length} erros JavaScript`});
        if(!data.h1.length) issues.push({severity:'medium',message:`${name}: nenhum H1 encontrado`});
        if(name==='mobile' && data.tinyTargets) issues.push({severity:'low',message:`mobile: ${data.tinyTargets} alvos interativos menores que 24px`});
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  const report:VisualReport={url,output:outputDir,screenshots,issues,metrics};
  await fs.writeFile(path.join(outputDir,'report.json'),JSON.stringify(report,null,2),'utf8');
  return report;
}
