// ─── CONSTANTS ────────────────────────────────────────────────────────────────
export const SUPABASE_URL = 'https://iouwkxjthjbhhcmzmqcx.supabase.co'
export const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvdXdreGp0aGpiaGhjbXptcWN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTgwMzYxNywiZXhwIjoyMDg1Mzc5NjE3fQ.nLnqlHK7RbCP3gbxbhJVqcY-Zhep0fRVaNtxyw2muEY'

// ─── HELPERS ──────────────────────────────────────────────────────────────────
export function num(v) {
  if (v === '' || v === '-' || v == null) return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

export async function sbUpsert(table, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  })
}

export async function sbInsert(table, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  })
}

export async function sbUpdate(table, id, updates) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(updates)
  })
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
export function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return null
  const headers = lines[0].split(',').map(h => h.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',')
    const row = {}
    headers.forEach((h, j) => { row[h] = (vals[j] || '').trim() })
    rows.push(row)
  }
  return { headers, rows }
}

export function filterTotals(rows) {
  return rows.filter(r => {
    const last = (r['Last'] || r['Name'] || r['Player'] || '').toLowerCase()
    return last !== 'totals' && last !== 'glossary' && last !== ''
  })
}

// ─── CSV CLASSIFICATION ───────────────────────────────────────────────────────
export function classifyCSV(headers) {
  const h = headers.map(x => x.toLowerCase())
  if (h.includes('era') && h.includes('avg') && h.includes('tc')) return { type: 'full', confidence: 'high', reason: 'Contains ERA (pitching), AVG (batting), and TC (fielding) — full season export' }
  if (h.includes('pb') && h.includes('sbatt')) return { type: 'catching', confidence: 'high', reason: 'Contains PB and SBATT — catching stats' }
  if (h.includes('tc') && h.includes('po') && h.includes('fpct')) return { type: 'fielding', confidence: 'high', reason: 'Contains TC, PO, FPCT — fielding stats' }
  if (h.includes('era') || (h.includes('bf') && h.includes('#p'))) return { type: 'pitching', confidence: 'high', reason: 'Contains ERA and/or BF + #P — pitching stats' }
  if (h.includes('qab') && h.includes('babip')) return { type: 'batting_adv', confidence: 'high', reason: 'Contains QAB and BABIP — batting advanced' }
  if (h.includes('avg') && h.includes('obp') && h.includes('rbi')) return { type: 'batting', confidence: 'high', reason: 'Contains AVG, OBP, RBI — batting standard' }
  if (h.includes('p') && h.includes('c') && (h.includes('1b') || h.includes('ss'))) return { type: 'innings', confidence: 'medium', reason: 'Contains P, C, positional columns — innings played (ambiguous field names)' }
  if (h.includes('avg') || h.includes('rbi')) return { type: 'batting', confidence: 'medium', reason: 'Contains AVG or RBI but missing some expected columns — assumed batting' }
  return { type: 'unknown', confidence: 'low', reason: 'Could not identify stat type from headers: ' + headers.slice(0, 8).join(', ') }
}

// ─── RATE STAT RECALCULATION ─────────────────────────────────────────────────
export function recalcBatting(c) {
  const ab = c.ab || 0, h = c.h || 0, bb = c.bb || 0, hbp = c.hbp || 0
  const sf = c.sf || 0, so = c.so || 0, hr = c.hr || 0
  const tb = (c.singles || 0) + (c.doubles || 0) * 2 + (c.triples || 0) * 3 + hr * 4
  return {
    ...c,
    avg: ab > 0 ? +(h / ab).toFixed(3) : null,
    obp: (ab + bb + hbp + sf) > 0 ? +((h + bb + hbp) / (ab + bb + hbp + sf)).toFixed(3) : null,
    slg: ab > 0 ? +(tb / ab).toFixed(3) : null,
    babip: (ab - so - hr + sf) > 0 ? +((h - hr) / (ab - so - hr + sf)).toFixed(3) : null,
  }
}

export function recalcPitching(c) {
  const ip = c.ip || 0, er = c.er || 0, bb = c.bb || 0, h = c.h || 0, bf = c.bf || 0, so = c.so || 0
  return {
    ...c,
    era: ip > 0 ? +((er * 9) / ip).toFixed(2) : null,
    whip: ip > 0 ? +((bb + h) / ip).toFixed(3) : null,
    baa: bf > 0 ? +(h / bf).toFixed(3) : null,
    k_per_bf: bf > 0 ? +(so / bf).toFixed(3) : null,
  }
}

// ─── MAP FULL EXPORT ROW ──────────────────────────────────────────────────────
export function mapFullRow(row, gameDate, opponent) {
  const name = `${row['First'] || ''} ${row['Last'] || ''}`.trim()
  const base = {
    player_name: name,
    player_number: row['Number'] ? parseInt(row['Number']) : null,
    game_date: gameDate, opponent, team_name: 'Myers'
  }

  const batting = recalcBatting({
    ...base,
    pa: num(row['PA']), ab: num(row['AB']), h: num(row['H']),
    singles: num(row['1B']), doubles: num(row['2B']), triples: num(row['3B']),
    hr: num(row['HR']), rbi: num(row['RBI']), r: num(row['R']),
    bb: num(row['BB']), so: num(row['SO']), kl: num(row['K-L']),
    hbp: num(row['HBP']), sac: num(row['SAC']), sf: num(row['SF']),
    roe: num(row['ROE']), fc: num(row['FC']), sb: num(row['SB']),
    cs: num(row['CS']), pik: num(row['PIK']), qab: num(row['QAB']),
    ba_risp: num(row['BA/RISP']), lob: num(row['LOB']),
    ps: num(row['PS']), ps_pa: num(row['PS/PA']),
    two_s3: num(row['2S+3']), six_plus: num(row['6+']),
    gidp: num(row['GIDP']), source: 'csv'
  })

  const hasIP = row['IP'] && !['0.0', '-', '0', ''].includes(row['IP'])
  const pitching = hasIP ? recalcPitching({
    ...base,
    ip: num(row['IP']), gs: num(row['GS']), bf: num(row['BF']),
    total_pitches: num(row['#P']), h: num(row['H']),
    r: num(row['R']), er: num(row['ER']), bb: num(row['BB']),
    so: num(row['SO']), kl: num(row['K-L']), hbp: num(row['HBP']),
    lob: num(row['LOB']), wp: num(row['WP']), source: 'csv'
  }) : null

  const fielding = row['TC'] !== undefined ? {
    ...base,
    tc: num(row['TC']), assists: num(row['A']), po: num(row['PO']),
    fpct: num(row['FPCT']), errors: num(row['E']), dp: num(row['DP']),
    inn_caught: num(row['INN']), pb: num(row['PB']),
    sb_allowed: num(row['SB']), sb_att: num(row['SBATT']),
    cs: num(row['CS']), cs_pct: num(row['CS%']), source: 'csv'
  } : null

  const innings = []
  for (const pos of ['P','C','1B','2B','3B','SS','LF','CF','RF','SF']) {
    const val = num(row[pos])
    if (val && val > 0) innings.push({ ...base, position: pos, innings: val })
  }

  return { batting, pitching, fielding, innings }
}

// ─── WRITE CONFIRMED DATA TO PRODUCTION ──────────────────────────────────────
export async function writeToProduction(extracted, gameDate, opponent) {
  const results = { batting: 0, pitching: 0, fielding: 0, innings: 0, errors: [] }

  for (const row of (extracted.batting_stats || [])) {
    const r = await sbUpsert('game_stats', { ...row, game_date: gameDate, opponent })
    if (!r.ok) results.errors.push('batting/' + row.player_name)
    else results.batting++
  }
  for (const row of (extracted.pitching_stats || [])) {
    const r = await sbUpsert('pitching_stats', { ...row, game_date: gameDate, opponent })
    if (!r.ok) results.errors.push('pitching/' + row.player_name)
    else results.pitching++
  }
  for (const row of (extracted.fielding_stats || [])) {
    const r = await sbUpsert('fielding_stats', { ...row, game_date: gameDate, opponent })
    if (!r.ok) results.errors.push('fielding/' + row.player_name)
    else results.fielding++
  }
  for (const row of (extracted.innings_played || [])) {
    const r = await sbUpsert('innings_played', { ...row, game_date: gameDate, opponent })
    if (!r.ok) results.errors.push('innings/' + row.player_name)
    else results.innings++
  }

  return results
}

// ─── AI CLASSIFY VIA SERVER ROUTE ────────────────────────────────────────────
// apiKey param kept for backward compat but ignored — key lives server-side
export async function aiClassify(_apiKey, input, inputType, gameDate, opponent, adminNotes = '', previousAnalysis = null) {
  const prevContext = previousAnalysis ? `
Previous classification attempt:
- Type: ${previousAnalysis.classification}
- Confidence: ${previousAnalysis.confidence}
- Reason: ${previousAnalysis.reason}
- Extracted ${[
    ...(previousAnalysis.batting_stats||[]),
    ...(previousAnalysis.pitching_stats||[]),
    ...(previousAnalysis.fielding_stats||[]),
    ...(previousAnalysis.innings_played||[])
  ].length} rows
Please correct any mistakes from the previous attempt based on the admin notes above.` : ''

  const systemPrompt = `You are a baseball stats classifier for a Little League team management system.
Extract stats from the provided ${inputType === 'image' ? 'GameChanger screenshot' : 'CSV data'}.
Game: ${gameDate} vs ${opponent}
${adminNotes ? `Admin correction notes: ${adminNotes}` : ''}${prevContext}

Return ONLY valid JSON (no markdown) with this exact structure:
{
  "classification": "batting|pitching|fielding|innings|full|catching|unknown",
  "confidence": "high|medium|low",
  "reason": "brief explanation of classification",
  "batting_stats": [],
  "pitching_stats": [],
  "fielding_stats": [],
  "innings_played": []
}

For batting_stats rows include: team_name, player_name, player_number, pa, ab, h, singles, doubles, triples, hr, rbi, r, bb, so, kl, hbp, sac, sf, roe, fc, sb, cs, pik, qab, babip, ba_risp, lob, ps, gidp
For pitching_stats rows include: team_name, player_name, player_number, ip, gs, bf, total_pitches, h, r, er, bb, so, kl, hbp, lob, wp, baa
For fielding_stats rows include: team_name, player_name, player_number, tc, assists, po, fpct, errors, dp, inn_caught, pb, sb_allowed, sb_att, cs, cs_pct
For innings_played rows include: team_name, player_name, player_number, position, innings
Use null for missing values. Skip Totals rows. team_name should be "Myers" for our team.`

  const content = inputType === 'image'
    ? [
        { type: 'image', source: { type: 'base64', media_type: input.mimeType, data: input.data } },
        { type: 'text', text: 'Extract all stats from this GameChanger screenshot.' }
      ]
    : [{ type: 'text', text: `CSV data:\n${input}` }]

  const resp = await fetch('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content }]
    })
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Classify API ' + resp.status)
  }
  const data = await resp.json()
  let raw = data.content.find(b => b.type === 'text')?.text?.trim() || ''
  raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim()
  return JSON.parse(raw)
}
