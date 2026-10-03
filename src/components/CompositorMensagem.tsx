import { useEffect, useRef, type ReactNode } from 'react'
import { LoaderCircle, Send } from 'lucide-react'

interface Props {
  texto: string
  onTexto: (texto: string) => void
  onEnviar: () => void
  enviando?: boolean
  desabilitado?: boolean
  placeholder?: string
  ariaLabel?: string
  maxLength?: number
  /** Botões à esquerda da caixa (ex.: respostas rápidas). */
  antes?: ReactNode
  /** Deixa enviar com a caixa vazia (ex.: há um anexo escolhido). */
  permitirVazio?: boolean
}

export default function CompositorMensagem({
  texto,
  onTexto,
  onEnviar,
  enviando = false,
  desabilitado = false,
  placeholder = 'Digite uma mensagem',
  ariaLabel = 'Mensagem para o contato',
  maxLength,
  antes,
  permitirVazio = false,
}: Props) {
  const campo = useRef<HTMLTextAreaElement | null>(null)
  const podeEnviar = !desabilitado && !enviando && (permitirVazio || !!texto.trim())

  useEffect(() => {
    const elemento = campo.current
    if (!elemento) return
    elemento.style.height = 'auto'
    elemento.style.height = `${Math.min(elemento.scrollHeight, 120)}px`
  }, [texto])

  useEffect(() => {
    if (!enviando && !desabilitado && !texto) campo.current?.focus()
  }, [desabilitado, enviando, texto])

  return (
    <div className="message-composer">
      {antes}
      <textarea
        ref={campo}
        className="message-composer-input"
        aria-label={ariaLabel}
        value={texto}
        onChange={(evento) => onTexto(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter' && !evento.shiftKey && !evento.nativeEvent.isComposing) {
            evento.preventDefault()
            if (podeEnviar) onEnviar()
          }
        }}
        rows={1}
        maxLength={maxLength}
        disabled={desabilitado || enviando}
        placeholder={placeholder}
      />
      <button
        className="message-composer-send"
        type="button"
        onClick={onEnviar}
        disabled={!podeEnviar}
        aria-label={enviando ? 'Enviando mensagem' : 'Enviar mensagem'}
        title={enviando ? 'Enviando…' : 'Enviar mensagem'}
      >
        {enviando ? <LoaderCircle className="message-composer-spinner" size={17} /> : <Send size={17} />}
      </button>
    </div>
  )
}
