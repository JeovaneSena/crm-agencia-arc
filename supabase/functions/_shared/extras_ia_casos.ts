import { rpc } from './db.ts'
export async function instrucoesAprovadas(): Promise<string> {return ''}

export async function vigiarCasos(): Promise<void> {await rpc('assistente_casos_vigiar',{})}
