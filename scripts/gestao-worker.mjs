// Agendar apenas na instalação derivada, com segredos próprios.
const url=(process.env.SUPABASE_URL??'').replace(/\/+$/,'')
const segredo=process.env.GESTAO_SEGREDO??''
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||segredo.length<24){console.error('Defina SUPABASE_URL e GESTAO_SEGREDO (24+ caracteres).');process.exit(2)}
try{const r=await fetch(`${url}/functions/v1/gestao/processar`,{method:'POST',headers:{Authorization:`Bearer ${segredo}`},signal:AbortSignal.timeout(120000)});const d=await r.json();if(!r.ok||!d.ok||d.falhas)throw Error('A execução precisa de revisão. Confira a Central e as regras.');console.log(`Gestão: ${d.eventos} eventos; ${d.enviados} saídas confirmadas.`)}catch(e){console.error(e.message);process.exit(1)}
