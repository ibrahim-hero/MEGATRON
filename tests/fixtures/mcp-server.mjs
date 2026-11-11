import readline from 'node:readline';
for await(const line of readline.createInterface({input:process.stdin})){
  const m=JSON.parse(line);if(m.id===undefined)continue;let result;
  if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
  if(m.method==='tools/list')result={tools:[{name:'echo',description:'Echo a message',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message']}}]};
  if(m.method==='tools/call')result={content:[{type:'text',text:m.params.arguments.message}]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
}
