# Avvuchet

A tiny MCP server for **official Italian and EU legal sources**: Normattiva open
data, EUR-Lex, and a small allowlist of institutional sites. One file, no
dependencies, no API keys.

*(English summary: a zero-dependency MCP server that searches Italian/EU official
legal portals and refuses to leave a hard-coded allowlist of institutional hosts.)*

## Perché esiste

Un modello che risponde su normativa senza toccare le fonti ufficiali inventa. Questo
server fa una cosa sola: porta dentro l'agente **metadati e pagine** dai portali
istituzionali, e nient'altro.

- **Allowlist rigida**: le richieste escono solo verso gli host in `OFFICIAL_HOSTS`
  (Normattiva, Gazzetta Ufficiale, EUR-Lex, Garante Privacy, Agenzia delle Entrate,
  INPS, Ispettorato del Lavoro, Registro Imprese, AgID, MIMIT). Redirect fuori
  allowlist → errore.
- **Nessuna chiave, nessun account**: solo API e pagine pubbliche.
- **Nessuna dipendenza**: JSON-RPC 2.0 su stdin/stdout, `server.mjs` è tutto.
- **Limiti dichiarati, non aggiustati a posteriori**: 15 s di timeout, 5 MB per
  risposta, massimo 3 redirect, nessun PDF, nessuno zip.
- **Nessuna certificazione di autenticità o vigenza**: gli strumenti restituiscono
  metadati e link; il testo ufficiale in Gazzetta Ufficiale resta la fonte.

## Strumenti

| Tool | Input | Restituisce |
| ---- | ----- | ----------- |
| `search_italian_law` | `query` (2–300), `limit` (1–10, default 5) | Atti da Normattiva (titolo, data GU, numero GU, codice redazionale, URN) come **metadati**, con l'avvertenza di verificare vigenza e testo |
| `search_eu_law` | `query`, `limit` | URL di ricerca su EUR-Lex (in italiano) e, se il portale li espone senza verifica browser, i risultati con titolo e link |
| `read_official_source` | `url`, `maxChars` (1000–18000, default 12000) | Testo della pagina letta, URL finale, tipo di contenuto, troncamento esplicito |

Ogni risposta include `consultedAt` (ISO) e, quando serve, una nota sul limite
incontrato: meglio «il portale ha chiesto una verifica browser» che un risultato
inventato.

## Installazione

Serve Node 20 o superiore.

```sh
git clone https://github.com/mirkotappini/avvuchet
```

In OpenCode, aggiungi il server in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "Avvuchet": {
      "type": "local",
      "command": ["node", "/percorso/di/avvuchet/server.mjs"],
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Riapri la sessione: i tre strumenti compaiono come `avvuchet_*` (o col nome che dai
alla chiave). Con altri client MCP basta lo stesso comando: è stdio, nient'altro.

## Prova manuale

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.mjs
```

## Limiti noti

- Normattiva restituisce **metadati** dall'API Open Data, non il testo consolidato.
- EUR-Lex a volte richiede una verifica browser: lo strumento lo dichiara e restituisce
  comunque l'URL di ricerca ufficiale.
- `read_official_source` legge HTML e JSON; PDF e archivi sono rifiutati per scelta.
- La allowlist è volutamente corta: aggiungere un host è una modifica al codice, non
  una configurazione.

## Licenza

MIT — vedi [LICENSE](./LICENSE).
