BEGIN;
-- Ponto reservado para o modelo inicial das instalações derivadas. Na base
-- genérica não altera configuração. O gerador substitui este arquivo por uma
-- versão com os rótulos do nicho escolhido, preservando a mesma identidade.
INSERT INTO crm_base_private.schema_migrations(version) VALUES('0032_modelo_inicial');
NOTIFY pgrst,'reload schema';
COMMIT;
