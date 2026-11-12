import { test, expect } from '@playwright/test';
import { inspectBrowser } from '../../src/agent/browser.ts';
import { temporary } from '../helpers.ts';
test('review real evidence and approve an actual immutable delivery',async({page,request})=>{
  const created=await request.post('/api/demo',{data:{scenario:'shop'}});const {ticketId}=await created.json();
  await expect.poll(async()=> (await (await request.get(`/api/tickets/${ticketId}`)).json()).stage,{timeout:120000,intervals:[2000]}).toBe('needs-you');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`/#/ticket/${ticketId}`);await expect(page.getByRole('heading',{name:'Fix percentage discounts in checkout'})).toBeVisible();
  await page.getByRole('button',{name:'Evidence',exact:true}).click();await expect(page.getByTestId('evidence-receipt')).toContainText('pass');
  await page.getByRole('button',{name:'Changes',exact:true}).click();await expect(page.locator('#main pre').first()).toContainText('discountPercent / 100');
  await page.getByRole('button',{name:'Review delivery',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Deliver this verified change?');
  await page.getByTestId('approve-delivery').click();
  await expect.poll(async()=> (await (await request.get(`/api/tickets/${ticketId}`)).json()).ended?.outcome,{timeout:90000,intervals:[1000]}).toBe('delivered');
  const final=await (await request.get(`/api/tickets/${ticketId}`)).json();expect(final.delivery.fingerprint).toBe(final.verifiedFingerprint);expect(final.delivery.manifest).toContain('src/cart.js');expect(errors).toEqual([]);
});
test('a structured answer resumes backend contract work',async({page,request})=>{
  const {ticketId}=await (await request.post('/api/demo',{data:{scenario:'question'}})).json();
  await expect.poll(async()=>{try{return(await(await request.get(`/api/tickets/${ticketId}`)).json()).attention?.question}catch{return undefined}},{timeout:90000,intervals:[2000]}).toContain('v2 cents');
  await page.goto(`/#/ticket/${ticketId}`);await page.getByRole('button',{name:'Answer question',exact:true}).click();await page.getByLabel('Your message').fill('Use the v2 cents contract.');await page.getByRole('button',{name:'Send answer',exact:true}).click();
  await expect.poll(async()=>{try{return(await(await request.get(`/api/tickets/${ticketId}`)).json()).verifiedFingerprint}catch{return undefined}},{timeout:180000,intervals:[2000]}).toBeTruthy();
});
test('keyboard navigation, mobile layout, and sourced knowledge search work',async({page})=>{
  await page.goto('/');await page.keyboard.press('Control+k');await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('Command palette').fill('Knowledge');await page.locator('.palette-list').getByRole('link',{name:'Knowledge',exact:true}).click();
  await page.getByLabel('Search project knowledge').fill('total');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(page.locator('.fact').first()).toBeVisible();await expect(page.locator('.fact .source').first()).toContainText('/');
  await page.waitForResponse(r=>r.url().endsWith('/api/overview'));await page.waitForResponse(r=>r.url().endsWith('/api/overview'));await expect(page.locator('.fact').first()).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.goto('/#/overview');await expect(page.getByRole('heading',{name:'Less oversight. More outcomes.'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Toggle color theme'}).click();await expect(page.locator('body')).toHaveClass(/dark/);
  await page.getByRole('button',{name:'Toggle color theme'}).click();await expect(page.locator('body')).not.toHaveClass(/dark/);
});
test('all workbench screens render without script errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const route of ['work','knowledge','workflows','models','benchmarks','integrations','settings']){await page.goto(`/#/${route}`);await expect(page.locator('#main h1')).toBeVisible();}
  expect(errors).toEqual([]);
});
test('browser-triggered benchmark produces measured scorecards',async({page,request})=>{
  await page.goto('/#/benchmarks');await expect(page.getByRole('button',{name:'Run benchmark',exact:true})).toBeVisible();
  const created=await request.post('/api/benchmarks',{data:{cases:['pagination-boundaries']}});const {id}=await created.json();
  await expect.poll(async()=>{try{const list=await(await request.get('/api/benchmarks')).json();const row=list.find((r:any)=>r.id===id);return row&&row.status!=='running'?row.expectedOutcomesPassed:undefined}catch{return undefined}},{timeout:150000,intervals:[3000]}).toBe(1);
  await page.reload();await expect(page.locator('#main')).toContainText('1 / 1 verified deliveries');await expect(page.locator('#main')).toContainText('Five real regression fixes and one adversarial completion claim');
});
test('native worker browser investigation captures real local-app evidence',async()=>{const temp=await temporary();try{const inspected=await inspectBrowser(temp.dir,'http://127.0.0.1:3093');expect(inspected.title).toContain('MEGATRON');expect(inspected.screenshot).toContain('inspection.png');expect(inspected.errors).toEqual([]);}finally{await temp.dispose();}});
