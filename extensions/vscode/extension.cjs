const vscode = require('vscode');
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function activate(context) {
  const changed = new vscode.EventEmitter();
  const url = () => vscode.workspace.getConfiguration('megatron').get('url');
  const api = async (path, data) => {
    const token = await context.secrets.get('serverToken');
    const response = await fetch(`${url()}/api/${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : {'content-type':'application/json'}), ...(token ? {authorization:`Bearer ${token}`} : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`); return value;
  };
  const tree = {
    onDidChangeTreeData: changed.event,
    getTreeItem: t => {
      const item = new vscode.TreeItem(t.title, vscode.TreeItemCollapsibleState.None);
      item.description = t.ended?.outcome ?? t.stage; item.tooltip = `${t.repository} · ${t.id}`;
      item.contextValue = t.approvals?.some(a => a.status === 'pending') ? 'pendingApproval' : 'mission';
      item.command = {command:'megatron.review',title:'Review mission',arguments:[t]}; return item;
    },
    getChildren: async () => { try { return await api('tickets'); } catch (e) { vscode.window.showErrorMessage(`MEGATRON: ${e.message}`); return []; } },
  };
  const safe = fn => async (...args) => { try { return await fn(...args); } catch (e) { vscode.window.showErrorMessage(`MEGATRON: ${e.message}`); } };
  context.subscriptions.push(vscode.window.registerTreeDataProvider('megatron.missions',tree), changed);
  context.subscriptions.push(vscode.commands.registerCommand('megatron.refresh',()=>changed.fire()));
  context.subscriptions.push(vscode.commands.registerCommand('megatron.openConsole',()=>vscode.env.openExternal(vscode.Uri.parse(url()))));
  context.subscriptions.push(vscode.commands.registerCommand('megatron.connect',safe(async()=>{const token=await vscode.window.showInputBox({prompt:'MEGATRON server token',password:true});if(token!==undefined)await context.secrets.store('serverToken',token);changed.fire();})));
  context.subscriptions.push(vscode.commands.registerCommand('megatron.newMission',safe(async()=>{const settings=await api('settings');const repository=await vscode.window.showQuickPick(Object.keys(settings.value.repositories),{placeHolder:'Choose repository scope'});if(!repository)return;const request=await vscode.window.showInputBox({prompt:'Describe the outcome and acceptance criteria'});if(!request)return;await api('run',{repository,request});changed.fire();})));
  context.subscriptions.push(vscode.commands.registerCommand('megatron.review',safe(async t=>{if(!t)return;const diff=await api(`tickets/${t.id}/diff`);const panel=vscode.window.createWebviewPanel('megatron.review',t.title,vscode.ViewColumn.One,{enableScripts:false});panel.webview.html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:14px system-ui;padding:24px;color:var(--vscode-editor-foreground)}pre{white-space:pre-wrap;padding:18px;background:var(--vscode-textCodeBlock-background)}h1{font-size:24px}</style></head><body><h1>${escape(t.title)}</h1><p>${escape(t.stage)} · ${escape(t.repository)} · ${t.verifiedFingerprint?'Executed evidence passed':'Verification pending'}</p><p>Use the mission’s Approve Delivery command after reviewing these changes.</p>${diff.changes.map(c=>`<h2>${escape(c.path)}</h2><pre>${escape(c.after)}</pre><details><summary>Before</summary><pre>${escape(c.before)}</pre></details>`).join('')}</body></html>`;})));
  context.subscriptions.push(vscode.commands.registerCommand('megatron.approve',safe(async t=>{if(!t)return;const confirmation=await vscode.window.showWarningMessage('Approve creation of this verified patch bundle?',{modal:true},'Approve delivery');if(confirmation==='Approve delivery'){await api(`tickets/${t.id}/approve`,{});changed.fire();}})));
  const timer=setInterval(()=>changed.fire(),10000);context.subscriptions.push({dispose:()=>clearInterval(timer)});
}
module.exports={activate};
