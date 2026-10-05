import { rpc } from './db.ts'
export async function instrucoesAprovadas(): Promise<string> {return (await rpc<{conteudo:string}>('assistente_melhoria_base',{})).conteudo}

export async function vigiarCasos(): Promise<void> {}
