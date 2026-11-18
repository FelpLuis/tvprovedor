# Instalação no servidor (LXC UPT-UBUNTU01)

Este guia instala o UpDown Digital **ao lado** dos serviços que já existem no servidor,
sem substituí-los. Ele foi escrito com base no diagnóstico do servidor:

| Item | Situação encontrada | Decisão |
|---|---|---|
| Sistema | Ubuntu 22.04.5 LTS em LXC (Proxmox), 4 vCPU, 8 GB RAM | Não atualizar o sistema |
| Python | 3.10.12 | Dependências travadas para 3.10 (`backend/requirements.txt`) |
| Proxy | Caddy ativo nas portas 80/443 | **Usar o Caddy existente**, sem instalar Nginx |
| Banco | PostgreSQL ativo nas portas 5432 e 5433 | **Banco e usuário exclusivos** em um dos clusters existentes |
| Porta da aplicação | 8095 livre no diagnóstico | API em `127.0.0.1:8095` (confirmar antes) |
| Disco | ~17 GB livres | Acompanhar o uso das mídias (painel → Configurações) |
| Swap | quase esgotada | O serviço usa ~100–150 MB; monitorar memória |

> **Regra geral:** cada etapa diz o que muda no servidor. Nada aqui reinicia o servidor,
> atualiza pacotes existentes, altera bancos de outros sistemas ou sobrescreve o Caddyfile.
> Execute uma etapa por vez e confira o resultado antes de seguir.

Layout final:

```
/opt/updown-digital/
├── app/        # clone do repositório (código)
├── venv/       # ambiente virtual Python
├── storage/    # mídias, miniaturas e temporários (fora do código)
└── .env        # configuração e segredos (chmod 640)
/var/backups/updown-digital/   # backups
```

## 0. Diagnóstico (somente leitura)

Impacto: nenhum.

```bash
ss -lntp '( sport = :8095 )'
```

```bash
pg_lsclusters
```

```bash
python3 -c 'import venv, ensurepip' && echo venv-ok
```

```bash
grep -n "tv.updown.com.br" /etc/caddy/Caddyfile; grep -n "^import" /etc/caddy/Caddyfile
```

Depois do passo 2 você também pode rodar `scripts/check_environment.sh`, que reúne tudo isso.

Se a porta 8095 estiver ocupada, escolha outra livre e troque nos passos 7 e 8 e no bloco do Caddy.

## 1. Usuário de sistema e diretórios

Impacto: cria o usuário `updown-digital` (sem login) e o diretório `/opt/updown-digital`.

```bash
sudo useradd --system --home /opt/updown-digital --shell /usr/sbin/nologin updown-digital
```

```bash
sudo install -d -o updown-digital -g updown-digital -m 0750 /opt/updown-digital /opt/updown-digital/storage
```

## 2. Código

Impacto: clona o repositório em `/opt/updown-digital/app`. Repositório privado: use uma
deploy key somente leitura ou um token com acesso apenas a este repositório.

```bash
sudo -u updown-digital git clone https://github.com/FelpLuis/tvprovedor.git /opt/updown-digital/app
```

```bash
sudo -u updown-digital git -C /opt/updown-digital/app checkout main
```

## 3. Ambiente Python

Impacto: cria `/opt/updown-digital/venv` e instala as dependências só nele.

Se o diagnóstico mostrou que o `venv` está ausente, é preciso instalar **um** pacote novo
(não atualiza nenhum pacote existente). Peça autorização antes:

```bash
sudo apt-get install --no-upgrade python3.10-venv
```

```bash
sudo -u updown-digital python3 -m venv /opt/updown-digital/venv
```

```bash
sudo -u updown-digital /opt/updown-digital/venv/bin/pip install --upgrade pip
```

```bash
sudo -u updown-digital /opt/updown-digital/venv/bin/pip install -r /opt/updown-digital/app/backend/requirements.txt
```

Opcional (recomendado): `ffmpeg` para miniaturas, duração e verificação de codecs dos vídeos. Sem ele
o upload funciona, mas os vídeos aparecem sem miniatura e sem duração. Também é um pacote novo:

```bash
sudo apt-get install --no-upgrade ffmpeg
```

## 4. Banco de dados exclusivo

Impacto: cria **um usuário e um banco novos**. Nenhum banco existente é tocado
(não usar `evolution_db` nem bancos de outros sistemas).

Escolha o cluster com `pg_lsclusters`. Prefira o cluster que já possui rotina de backup e
monitoramento; use a porta dele (`5432` ou `5433`) em todos os comandos abaixo e no `.env`.

Gere uma senha forte:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(24))'
```

Crie o usuário (será pedida a senha gerada) e o banco, trocando `5432` pela porta escolhida:

```bash
sudo -u postgres createuser -p 5432 --pwprompt --no-createdb --no-createrole --no-superuser updown_digital
```

```bash
sudo -u postgres createdb -p 5432 --owner updown_digital --encoding UTF8 --template template0 updown_digital
```

```bash
sudo -u postgres psql -p 5432 -c "REVOKE ALL ON DATABASE updown_digital FROM PUBLIC;"
```

Teste a conexão:

```bash
psql "postgresql://updown_digital@127.0.0.1:5432/updown_digital" -c "select current_user, version();"
```

Se der erro de autenticação, verifique se o `pg_hba.conf` daquele cluster permite `scram-sha-256`
para `127.0.0.1`. Alterar o `pg_hba.conf` afeta o cluster inteiro: faça backup e peça autorização.

## 5. Configuração (.env)

Impacto: cria `/opt/updown-digital/.env` com os segredos.

```bash
sudo install -m 0640 -o root -g updown-digital /opt/updown-digital/app/.env.example /opt/updown-digital/.env
```

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

```bash
sudo nano /opt/updown-digital/.env
```

Preencha `UDS_SECRET_KEY` com o valor gerado e `UDS_DATABASE_URL` com a senha e a porta do passo 4.
Em produção a aplicação **não inicia** com chave fraca ou com SQLite.

## 6. Migrações e usuário administrador

Impacto: cria as tabelas no banco `updown_digital`.

```bash
cd /opt/updown-digital/app/backend && sudo -u updown-digital bash -c 'set -a; . /opt/updown-digital/.env; set +a; /opt/updown-digital/venv/bin/alembic upgrade head'
```

```bash
cd /opt/updown-digital/app/backend && sudo -u updown-digital bash -c 'set -a; . /opt/updown-digital/.env; set +a; /opt/updown-digital/venv/bin/python -m app.cli create-admin --username admin --email ti@updown.com.br'
```

Grupos sugeridos (NOC, Administrativo, Comercial, Recepção, Financeiro, Operações):

```bash
cd /opt/updown-digital/app/backend && sudo -u updown-digital bash -c 'set -a; . /opt/updown-digital/.env; set +a; /opt/updown-digital/venv/bin/python -m app.cli seed-groups'
```

## 7. Teste manual (antes de criar o serviço)

Impacto: processo temporário em `127.0.0.1:8095`; encerre com Ctrl+C.

```bash
cd /opt/updown-digital/app/backend && sudo -u updown-digital bash -c 'set -a; . /opt/updown-digital/.env; set +a; /opt/updown-digital/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8095'
```

Em outro terminal:

```bash
curl -s http://127.0.0.1:8095/api/health
```

Esperado: `{"status":"ok","version":"0.1.0"}`.

## 8. Serviço systemd

Impacto: adiciona **um** serviço novo (`updown-digital`), iniciado no boot.

```bash
sudo cp /opt/updown-digital/app/deploy/updown-digital.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl enable --now updown-digital
```

```bash
systemctl status updown-digital --no-pager
```

Logs:

```bash
journalctl -u updown-digital -f
```

## 9. Publicação no Caddy existente

Impacto: adiciona o site `tv.updown.com.br` ao Caddy. O `reload` aplica a configuração sem
derrubar os outros sites. **Não sobrescreva o Caddyfile.**

Backup:

```bash
sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
```

Acrescente o bloco ao final do arquivo:

```bash
sudo tee -a /etc/caddy/Caddyfile < /opt/updown-digital/app/deploy/Caddyfile.tv.updown.com.br
```

Valide **antes** de aplicar:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

```bash
sudo systemctl reload caddy
```

Se a validação falhar, restaure o backup (`sudo cp /etc/caddy/Caddyfile.bak-... /etc/caddy/Caddyfile`)
e não recarregue. Se o Caddyfile atual usa `import` de uma pasta, prefira colocar o bloco em um
arquivo próprio nessa pasta.

Verificação externa:

```bash
curl -sI https://tv.updown.com.br/ | head -5
```

## 10. Backups

Impacto: cria `/var/backups/updown-digital` e uma entrada no cron do root.

Teste manual:

```bash
sudo /opt/updown-digital/app/scripts/backup.sh
```

Agendamento diário às 02:30 (mantém 14 dias):

```bash
echo '30 2 * * * root /opt/updown-digital/app/scripts/backup.sh >> /var/log/updown-digital-backup.log 2>&1' | sudo tee /etc/cron.d/updown-digital-backup
```

Restauração (pede confirmação e para o serviço durante o processo):

```bash
sudo /opt/updown-digital/app/scripts/restore.sh /var/backups/updown-digital/db-AAAAMMDD-HHMMSS.dump /var/backups/updown-digital/storage-AAAAMMDD-HHMMSS.tar.gz
```

Copie os backups para fora do servidor (outro storage do Proxmox, NAS etc.).

## 11. Atualizações

Faz backup, `git pull` (fast-forward), instala dependências, aplica migrações, reinicia e testa:

```bash
sudo /opt/updown-digital/app/scripts/update.sh main
```

Se a verificação falhar, o script mostra os comandos para voltar à versão anterior.

## 12. Primeira TV

1. Na TV, abra `https://tv.updown.com.br/player` (ver [TVS_ANDROID.md](TVS_ANDROID.md)).
2. No painel, **TVs → Ativar TV**, informe o código exibido, o nome, o grupo e o perfil.
3. Para TVs de mídia, envie arquivos em **Mídias**, monte uma **Playlist** e vincule à TV.
