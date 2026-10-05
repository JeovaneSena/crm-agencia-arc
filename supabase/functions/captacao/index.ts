import { rpc } from '../_shared/db.ts'
import { atenderCaptacao } from '../_shared/captacao.ts'

// Integração servidor a servidor; sem CORS nem segredo exposto no site público.
Deno.serve(req => atenderCaptacao(req, rpc))
