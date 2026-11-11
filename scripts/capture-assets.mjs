import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Runtime, demoSettings } from '../src/app/runtime.ts';
import { startServer } from '../src/app/server.ts';
const out=resolve('assets/screenshots');await mkdir(out,{recursive:true});
const state=resolve(`tools/asset-capture-${Date.now()}`);const runtime=await Runtime.create({stateDir:state,settings:demoSettings()});
const id=runtime.submitDemo('shop');await runtime.waitTicket(id);await runtime.waitTicket(runtime.submitDemo('question'));
const server=await startServer(runtime,{port:0});
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});const page=await context.newPage();const screenshots=[];
try{
  const save=async(name)=>{const path=join(out,`${name}.png`);await page.screenshot({path,fullPage:true});screenshots.push({name,path:`screenshots/${name}.png`});};
  await page.goto(server.url);await page.waitForSelector('.mission-card');await page.waitForTimeout(1500);await save('mission-control');
  await page.goto(`${server.url}/#/ticket/${id}`);await page.waitForSelector('.timeline');await save('mission-timeline');
  await page.getByRole('button',{name:'Evidence',exact:true}).click();await page.waitForSelector('[data-testid=evidence-receipt]');await save('verification');
  await page.getByRole('button',{name:'Review delivery',exact:true}).click();await page.waitForSelector('dialog[open]');await page.waitForTimeout(2000);await save('delivery-review');await page.getByTestId('approve-delivery').click();await runtime.waitTicket(id);
  await page.goto(`${server.url}/#/knowledge`);await page.getByLabel('Search project knowledge').fill('checkout total');await page.getByRole('button',{name:'Search',exact:true}).click();await page.waitForSelector('.fact');await save('project-knowledge');
  await page.setViewportSize({width:390,height:844});await page.goto(server.url);await page.waitForSelector('.mission-card');await save('mobile-mission-control');
  await writeFile(resolve('assets/manifest.json'),JSON.stringify({product:'MEGATRON',generatedAt:new Date().toISOString(),source:'Actual running application with a declared scripted provider and executed verification',screenshots,video:'demo/megatron-walkthrough.webm'},null,2));
  console.log(`Captured ${screenshots.length} application screenshots under ${out}`);
}finally{await context.close();await browser.close();await server.close();}
