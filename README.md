# eSocial Doméstico — Job de Automação (Node.js)

Automação headless para fechar a folha de pagamento e gerar a guia DAE do eSocial Doméstico, com notificações via e-mail e WhatsApp.

## Pré-requisitos

- Node.js 20+
- Ubuntu 20.04+ (ou qualquer Linux)
- Conta gov.br com nível prata ou ouro
- Acesso SMTP (ex: Gmail App Password)
- WhatsApp pessoal para parear

## Instalação

```bash
git clone <repo>
cd esocial-job
npm install
npm run setup        # instala Chromium para Playwright
cp .env.example .env
# Edite .env com suas credenciais
```

## Configuração (.env)

| Variável | Descrição |
|---|---|
| `GOVBR_CPF` | CPF do empregador (sem pontos/traços) |
| `GOVBR_SENHA` | Senha da conta gov.br |
| `SMTP_HOST` | Servidor SMTP (ex: `smtp.gmail.com`) |
| `SMTP_PORT` | Porta SMTP (`465` para SSL, `587` para TLS) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP / App Password |
| `EMAIL_TO` | E-mail de destino das notificações |
| `WHATSAPP_NUMBER` | Número WhatsApp com DDI (ex: `+5511999999999`) |
| `JOB_DIA_FECHAMENTO` | Dia do mês para execução automática (ex: `7`) |
| `COMPETENCIA_MES` | Mês da competência a processar (ex: `05`) |
| `COMPETENCIA_ANO` | Ano da competência a processar (ex: `2024`) |
| `LOG_LEVEL` | Nível de log (`info`, `warn`, `error`) |
| `LOG_DIR` | Diretório dos logs (padrão: `./logs`) |

## Uso

### Primeira execução (parear WhatsApp)

```bash
npm start
```

Escaneie o QR code exibido no terminal com o WhatsApp do celular.

### Execução manual / imediata

```bash
node index.js --run-now
```

### Execução agendada (cron)

```bash
npm start
```

O job executa automaticamente no dia `JOB_DIA_FECHAMENTO` às 06:00.

### Deploy com PM2 (produção)

```bash
npm install -g pm2
pm2 start npm --name esocial-job -- start
pm2 startup
pm2 save
pm2 logs esocial-job
```

## Estrutura

```
esocial-job/
├── src/
│   ├── auth/govbr.js           # Login gov.br via Playwright
│   ├── esocial/
│   │   ├── client.js           # Axios client autenticado
│   │   ├── folha.js            # Fechar folha
│   │   └── guia.js             # Gerar e baixar DAE PDF
│   ├── notifications/
│   │   ├── email.js            # Notificações SMTP
│   │   └── whatsapp.js         # Notificações WhatsApp
│   ├── jobs/monthly.js         # Orquestração + cron
│   └── utils/logger.js         # Winston logger
├── config/empregadores.json    # (opcional) config multi-empregador
├── logs/                       # Logs diários rotativos
├── output/guias/               # PDFs das guias DAE
├── .env.example
└── index.js                    # Entry point
```

## Fluxo do Job

1. Autenticação no portal eSocial via gov.br (Playwright headless)
2. Verificação do status da competência
3. Encerramento da folha (se ainda aberta)
4. Geração e download do PDF da guia DAE
5. Envio de notificações por e-mail (com PDF em anexo) e WhatsApp
6. Registro de logs em arquivo rotativo diário

Em caso de falha em qualquer etapa, notificações de erro são enviadas por ambos os canais.

## Troubleshooting

- **Sessão gov.br expirando:** reautenticação automática implementada.
- **WhatsApp desconectando:** mantenha o celular conectado; o job reconecta automaticamente ou solicita novo QR.
- **Playwright sem display (VPS headless):** sempre roda em modo headless; se necessário: `xvfb-run -a npm start`.
- **Mudanças de layout do eSocial:** adapte seletores CSS em `src/auth/govbr.js`.
- **Endpoints HTTP alterados:** verifique logs e inspecione o portal para atualizar URLs em `src/esocial/`.
