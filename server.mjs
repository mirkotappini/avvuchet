#!/usr/bin/env node
// Avvuchet: minimal stdio MCP server for Italian and EU official legal sources.
// No MCP SDK, no dependencies: JSON-RPC 2.0 over stdin/stdout.
// Network access is restricted to the official institutional hosts in OFFICIAL_HOSTS.

const OFFICIAL_HOSTS = new Set([
  'api.normattiva.it', 'dati.normattiva.it', 'www.normattiva.it', 'www.gazzettaufficiale.it',
  'eur-lex.europa.eu', 'www.garanteprivacy.it', 'garanteprivacy.it',
  'www.agenziaentrate.gov.it', 'agenziaentrate.gov.it', 'www.inps.it', 'inps.it',
  'www.ispettorato.gov.it', 'www.registroimprese.it', 'www.agid.gov.it', 'www.mimit.gov.it',
]);
const MAX_BODY = 5_000_000;

const tools = [
  { name: 'search_italian_law', description: 'Cerca atti italiani tramite l’API Open Data ufficiale di Normattiva. Restituisce metadati e collegamenti, non certifica autenticità o vigenza; verificare il testo ufficiale in Gazzetta Ufficiale quando necessario.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] } },
  { name: 'search_eu_law', description: 'Interroga la pagina di ricerca ufficiale EUR-Lex in italiano. Restituisce l’URL della ricerca e, se il portale consente l’estrazione automatica, alcuni risultati; altrimenti dichiara il limite.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 300 }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] } },
  { name: 'read_official_source', description: 'Legge una pagina HTML da un dominio istituzionale autorizzato e ne restituisce testo e URL finale. Non segue redirect verso host non autorizzati; non legge PDF.', inputSchema: { type: 'object', properties: { url: { type: 'string', maxLength: 2000 }, maxChars: { type: 'integer', minimum: 1000, maximum: 18000 } }, required: ['url'] } },
];

function text(s) { return { content: [{ type: 'text', text: String(s) }] }; }
function fail(s) { return { isError: true, ...text(s) }; }
async function fetchLimited(url, init = {}) {
  let u = new URL(url);
  if (u.protocol !== 'https:' || !OFFICIAL_HOSTS.has(u.hostname)) throw new Error('Host non presente nella allowlist di fonti istituzionali.');
  let res;
  for (let hops = 0; hops <= 3; hops++) {
    res = await fetch(u, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Avvuchet/1.0 (official-source research)', accept: 'application/json,text/html,text/plain,*/*', ...init.headers } });
    if (!(res.status >= 300 && res.status < 400)) break;
    const location = res.headers.get('location');
    if (!location || hops === 3) throw new Error('La fonte ha superato il limite di redirect.');
    u = new URL(location, u);
    if (u.protocol !== 'https:' || !OFFICIAL_HOSTS.has(u.hostname)) throw new Error('Redirect verso un host non presente nella allowlist di fonti istituzionali.');
  }
  if (!res.ok) throw new Error(`La fonte ha restituito HTTP ${res.status}.`);
  const type = res.headers.get('content-type') || '';
  if (type.includes('pdf') || type.includes('zip') || type.includes('octet-stream')) throw new Error('La risposta non è HTML o JSON leggibile da questo strumento.');
  const raw = await res.arrayBuffer();
  if (raw.byteLength > MAX_BODY) throw new Error('Risposta oltre il limite di dimensione.');
  return { url: res.url || u.href, type, body: new TextDecoder().decode(raw) };
}
function htmlText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim();
}
async function italianSearch({ query, limit = 5 }) {
  const { body } = await fetchLimited('https://api.normattiva.it/t/normattiva.api/bff-opendata/v1/api/v1/ricerca/semplice', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dati.normattiva.it' }, body: JSON.stringify({ testoRicerca: query.trim(), orderType: 'recente', paginazione: { paginaCorrente: 1, numeroElementiPerPagina: Math.min(limit, 10) } }) });
  const data = JSON.parse(body);
  const acts = data.listaAtti || data.risultati || [];
  if (!acts.length) return text(`Normattiva non ha restituito risultati per: ${query}. Consultazione ${new Date().toISOString()}. Non dedurre che non esista normativa pertinente.`);
  const items = acts.slice(0, limit).map(a => ({ title: a.descrizioneAtto || a.titoloAtto, publicationDate: a.dataGU || a.dataGUStr, gazetteNumber: a.numeroGU, editorialCode: a.codiceRedazionale, identifier: a.urn || a.codiceRedazionale }));
  return text(JSON.stringify({ source: 'Normattiva Open Data API (metadati)', consultedAt: new Date().toISOString(), query, caveat: 'Questi sono metadati restituiti dall’API, non il testo della norma. Verifica la pertinenza del risultato, la versione/vigenza in Normattiva e il testo ufficiale in Gazzetta Ufficiale (in caso di difformità prevale quest’ultima). Non dedurre che i primi risultati siano pertinenti solo dall’ordine.', results: items }, null, 2));
}
async function euSearch({ query, limit = 5 }) {
  const url = new URL('https://eur-lex.europa.eu/search.html');
  url.searchParams.set('scope', 'EURLEX'); url.searchParams.set('text', query.trim()); url.searchParams.set('type', 'quick'); url.searchParams.set('lang', 'it');
  const { body, url: finalUrl } = await fetchLimited(url.href);
  const results = [];
  const rx = /<a\b[^>]*href="([^"]*(?:legal-content|eli\/reg|eli\/dir|eli\/dec)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(body)) && results.length < limit) {
    const href = m[1].replace(/&amp;/g, '&');
    const target = new URL(href, finalUrl);
    if (target.hostname !== 'eur-lex.europa.eu') continue;
    const title = htmlText(m[2]); if (title.length < 8) continue;
    if (!results.some(x => x.url === target.href)) results.push({ title: title.slice(0, 500), url: target.href });
  }
  if (!results.length) return text(JSON.stringify({ source: 'EUR-Lex', searchUrl: finalUrl, consultedAt: new Date().toISOString(), note: 'Non è stato possibile estrarre risultati dal portale. Aprire il collegamento ufficiale e verificare manualmente.' }));
  return text(JSON.stringify({ source: 'EUR-Lex', searchUrl: finalUrl, consultedAt: new Date().toISOString(), results }, null, 2));
}
async function readSource({ url, maxChars = 12000 }) {
  const { url: finalUrl, type, body } = await fetchLimited(url);
  if (/javascript is disabled|verify that you.?re not a robot|captcha/i.test(body)) return text(JSON.stringify({ source: 'EUR-Lex', searchUrl: finalUrl, consultedAt: new Date().toISOString(), note: 'EUR-Lex ha richiesto una verifica browser e non ha consentito il recupero automatico. Aprire il collegamento di ricerca ufficiale; nessun risultato va inferito da questo blocco.' }, null, 2));
  const result = type.includes('html') ? htmlText(body) : body;
  return text(JSON.stringify({ url: finalUrl, contentType: type, consultedAt: new Date().toISOString(), text: result.slice(0, maxChars), truncated: result.length > maxChars }, null, 2));
}

async function invoke(name, args) {
  switch (name) {
    case 'search_italian_law': return italianSearch(args);
    case 'search_eu_law': return euSearch(args);
    case 'read_official_source': return readSource(args);
    default: return fail(`Tool sconosciuto: ${name}`);
  }
}

async function handle(m) {
  if (!m || typeof m !== 'object') return null;
  if (m.method === 'notifications/initialized' || m.method?.startsWith('notifications/')) return null;
  if (m.method === 'initialize') return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'avvuchet', version: '1.0.0' } } };
  if (m.method === 'ping') return { jsonrpc: '2.0', id: m.id, result: {} };
  if (m.method === 'tools/list') return { jsonrpc: '2.0', id: m.id, result: { tools } };
  if (m.method === 'tools/call') {
    try { return { jsonrpc: '2.0', id: m.id, result: await invoke(m.params?.name, m.params?.arguments || {}) }; }
    catch (e) { return { jsonrpc: '2.0', id: m.id, result: fail(e?.message || 'Errore strumento') }; }
  }
  if (m.id !== undefined) return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Metodo non supportato: ${m.method}` } };
  return null;
}

let carry = '';
for await (const chunk of process.stdin) {
  carry += chunk.toString('utf8');
  if (carry.length > 2_000_000) { carry = ''; continue; }
  let nl;
  while ((nl = carry.indexOf('\n')) >= 0) {
    const line = carry.slice(0, nl).trim(); carry = carry.slice(nl + 1);
    if (!line) continue;
    let response;
    try { response = await handle(JSON.parse(line)); }
    catch (e) { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }; }
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  }
}
