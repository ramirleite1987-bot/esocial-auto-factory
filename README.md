# eSocial Auto Factory

Automatizacao do fechamento mensal de folha de pagamento e geracao de guias DAE no eSocial Domestico.

## O que faz

- Autentica automaticamente no portal gov.br via browser headless (Playwright)
- Encerra a folha de pagamento do mes anterior
- Gera a guia DAE (Documento de Arrecadacao) e baixa o PDF
- Envia notificacoes de sucesso/erro por e-mail (SMTP) e WhatsApp
- Executa via cron job agendado (padrao: dia 7 de cada mes as 08:00 BRT)
- Retry automatico com backoff exponencial em caso de falhas transientes

## Arquitetura

```
index.js                    # Entry point, validacao de env, cron setup
src/
  auth/govbr.js             # Autenticacao gov.br via Playwright
  esocial/
    client.js               # HTTP client Axios com re-auth automatica
    folha.js                # Operacoes de folha de pagamento
    guia.js                 # Geracao e download de guias DAE
  jobs/monthly.js           # Orquestrador do job mensal com lock e retry
  notifications/
    email.js                # Notificacoes via SMTP/Nodemailer
    whatsapp.js             # Notificacoes via WhatsApp Web
    slack.js                # Notificacoes via Slack incoming webhook
  utils/
    logger.js               # Logger Winston com rotacao diaria
    competencia.js          # Calculo automatico de competencia
  health.js                 # Health check HTTP endpoint
```

## Pre-requisitos

- Node.js >= 18
- Conta gov.br com acesso ao eSocial Domestico
- (Opcional) Conta Gmail com App Password para notificacoes por e-mail
- (Opcional) WhatsApp vinculado para notificacoes

## Instalacao

```bash
# Clonar o repositorio
git clone <repo-url>
cd esocial-auto-factory

# Instalar dependencias
npm install

# Instalar Chromium para o Playwright
npm run setup

# Copiar e configurar variaveis de ambiente
cp .env.example .env
# Editar .env com suas credenciais
```

## Configuracao

Copie `.env.example` para `.env` e configure:

### Obrigatorio

| Variavel | Descricao |
|----------|-----------|
| `GOVBR_CPF` | CPF para autenticacao no gov.br |
| `GOVBR_SENHA` | Senha do gov.br |

### API eSocial

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `ESOCIAL_BASE_URL` | `https://login.esocial.gov.br` | URL base da API |
| `ESOCIAL_TIMEOUT` | `30000` | Timeout HTTP em ms |

### Notificacoes por E-mail (opcional)

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `SMTP_HOST` | `smtp.gmail.com` | Servidor SMTP |
| `SMTP_PORT` | `587` | Porta SMTP |
| `SMTP_USER` | - | Usuario SMTP |
| `SMTP_PASS` | - | Senha SMTP (App Password para Gmail) |
| `EMAIL_TO` | - | E-mail destinatario |

### Notificacoes WhatsApp (opcional)

| Variavel | Descricao |
|----------|-----------|
| `WHATSAPP_NUMBER` | Numero no formato internacional (ex: 5511999999999) |

Na primeira execucao, um QR code sera exibido no terminal para vincular o WhatsApp.

### Notificacoes Slack (opcional)

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `SLACK_WEBHOOK_URL` | - | URL de incoming webhook do Slack. Se ausente, Slack e desativado. |
| `SLACK_TIMEOUT_MS` | `5000` | Timeout HTTP em ms para o POST do webhook |

Quando configurado, mensagens de sucesso (com periodo + caminho do PDF) e de erro (com message do erro) sao enviadas para o canal vinculado ao webhook.

### Agendamento

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `JOB_DIA_FECHAMENTO` | `7` | Dia do mes para executar |
| `CRON_SCHEDULE` | - | Expressao cron customizada (sobrepoe JOB_DIA_FECHAMENTO) |
| `JOB_MAX_RETRIES` | `3` | Tentativas maximas por operacao |

### Competencia

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `COMPETENCIA_MES` | `auto` | Mes (1-12) ou 'auto' (mes anterior) |
| `COMPETENCIA_ANO` | `auto` | Ano ou 'auto' |

### Logging e Monitoramento

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `LOG_LEVEL` | `info` | Nivel de log (debug, info, warn, error) |
| `LOG_DIR` | `./logs` | Diretorio dos logs |
| `HEALTH_ENABLED` | `false` | Ativar endpoint HTTP /health |
| `HEALTH_PORT` | `3000` | Porta do health check |

## Uso

```bash
# Executar com cron agendado (producao)
npm start

# Executar imediatamente (teste manual)
npm run run-now

# Executar em modo debug
npm run dev

# Rodar testes
npm test

# Rodar linter
npm run lint
```

## Health Check

Quando `HEALTH_ENABLED=true`, um endpoint HTTP fica disponivel:

```bash
curl http://localhost:3000/health
```

Retorna:
```json
{
  "status": "ok",
  "uptime": 3600,
  "nodeVersion": "v20.0.0",
  "lastJobRun": "2025-03-07T08:00:00.000Z",
  "lastJobStatus": "success",
  "timestamp": "2025-03-07T12:00:00.000Z"
}
```

## Fluxo do Job Mensal

1. Adquire lock file (previne execucoes concorrentes)
2. Autentica no gov.br (reusa sessao persistida quando valida)
3. Calcula a competencia alvo (mes anterior)
4. Lista folhas abertas e verifica status da competencia
5. Encerra a folha de pagamento (trata "ja encerrada" gracefully)
6. Gera guia DAE e baixa o PDF
7. Envia notificacoes de sucesso (e-mail + WhatsApp)
8. Em caso de erro, envia notificacoes de falha
9. Libera o lock file

Todas as operacoes de API possuem retry automatico com backoff exponencial.

## Estrutura de Arquivos Gerados

```
logs/
  app-2025-03-07.log       # Logs diarios (retencao 30 dias)
output/
  guias/
    DAE-03-2025.pdf         # Guias DAE geradas
session.json                # Sessao gov.br persistida (gitignored)
.wwebjs_auth/               # Sessao WhatsApp (gitignored)
```

## Testes

```bash
# Rodar todos os testes com cobertura
npm test

# Rodar testes em modo watch
npm run test:watch
```

## Licenca

Privado - Uso interno.
