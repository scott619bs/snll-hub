'use client'

import { useState } from 'react'

const SUPABASE_URL = 'https://iouwkxjthjbhhcmzmqcx.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvdXdreGp0aGpiaGhjbXptcWN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTgwMzYxNywiZXhwIjoyMDg1Mzc5NjE3fQ.nLnqlHK7RbCP3gbxbhJVqcY-Zhep0fRVaNtxyw2muEY'

const ZONES = [
  { key: 'boxscore', icon: '📋', label: 'Box Score', sub: 'AB/R/H/RBI + Pitching lines' },
  { key: 'batting', icon: '🏏', label: 'Batting Standard', sub: 'PA/1B/2B/3B/HR/SB/HBP' },
  { key: 'batting-adv', icon: '📊', label: 'Batting Advanced', sub: 'QAB/BABIP/BA·RISP/PS' },
  { key: 'pitching', icon: '⚾', label: 'Pitching Standard', sub: 'IP/BF/Pitches/H/R/ER' },
  { key: 'fielding', icon: '🧤', label: 'Fielding Standard', sub: 'TC/A/PO/FPCT/E/DP' },
  { key: 'catching', icon: '🥎', label: 'Catching', sub: 'INN/PB/SB/CS%' },
  { key: 'innings', icon: '📍', label: 'Innings Played', sub: 'P/C/1B/2B/3B/SS/LF/CF/RF' },
  { key: 'plays', icon: '📝', label: 'Play by Play', sub: 'Optional' },
]

export default function StatsImport() {
  const [gameDate, setGameDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [teamMode, setTeamMode] = useState('both')
  const [screenshots, setScreenshots] = useState({})
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [progress, setProgress] = useState([])
  const [result, setResult] = useState(null)

  function addScreenshot(key, file) {
    setScreenshots(prev => ({ ...prev, [key]: file }))
  }

  function toBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result.split(',')[1])
      r.onerror = rej
      r.readAsDataURL(file)
    })
  }

  function addProgress(msg, state = 'done') {
    setProgress(prev => [...prev, { msg, state, ts: Date.now() }])
  }

  async function runImport() {
    setStatus('running')
    setProgress([])
    setResult(null)

    try {
      // Build content blocks
      const contentBlocks = []
      for (const [key, file] of Object.entries(screenshots)) {
        const b64 = await toBase64(file)
        const mt = file.type || 'image/png'
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } })
        contentBlocks.push({ type: 'text', text: `[Screenshot: GameChanger "${key}" tab — ${gameDate} vs ${opponent}]` })
      }

      addProgress(`Sending ${Object.keys(screenshots).length} screenshots to Claude Vision...`, 'active')

      const prompt = `Extract baseball stats from these GameChanger screenshots.
Game: ${gameDate} vs ${opponent}
Teams: Myers (our team) and ${opponent}
Mode: ${teamMode === 'both' ? 'Both teams' : teamMode === 'myers' ? 'Myers only' : opponent + ' only'}

Return ONLY valid JSON (no markdown) with this structure:
{
  "batting_stats": [{"team_name":"Myers","player_name":"...","player_number":7,"pa":0,"ab":0,"r":0,"h":0,"singles":0,"doubles":0,"triples":0,"hr":0,"rbi":0,"bb":0,"so":0,"kl":0,"hbp":0,"sac":0,"sf":0,"roe":0,"fc":0,"sb":0,"cs":0,"pik":0,"qab":0,"babip":null,"ba_risp":null,"lob":0,"ps":0,"ps_pa":null,"two_s3":0,"six_plus":0,"gidp":0}],
  "pitching_stats": [{"team_name":"Myers","player_name":"...","player_number":7,"ip":0,"gs":0,"bf":0,"total_pitches":0,"total_balls":0,"total_strikes":0,"h":0,"r":0,"er":0,"bb":0,"so":0,"kl":0,"hbp":0,"lob":0,"wp":0,"baa":null}],
  "fielding_stats": [{"team_name":"Myers","player_name":"...","player_number":7,"tc":0,"assists":0,"po":0,"fpct":null,"errors":0,"dp":0,"inn_caught":0,"pb":0,"sb_allowed":0,"sb_att":0,"cs":0,"cs_pct":null}],
  "innings_played": [{"team_name":"Myers","player_name":"...","player_number":7,"p":0,"c":0,"first_base":0,"second_base":0,"third_base":0,"ss":0,"lf":0,"cf":0,"rf":0,"sf":0}]
}
Skip Team/Totals rows. Use null for missing stats. Return ONLY the JSON.`

      contentBlocks.push({ type: 'text', text: prompt })

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 4096,
          messages: [{ role: 'user', content: contentBlocks }]
        })
      })

      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}))
        throw new Error('Claude API: ' + (e.error?.message || resp.status))
      }

      const aiData = await resp.json()
      let raw = aiData.content.find(b => b.type === 'text')?.text?.trim() || ''
      raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim()

      addProgress('Extraction complete — parsing stats', 'done')

      let extracted
      try { extracted = JSON.parse(raw) }
      catch { const m = raw.match(/\{[\s\S]*\}/); if (m) extracted = JSON.parse(m[0]); else throw new Error('Parse failed') }

      // Get game_uid
      const schedResp = await fetch(`${SUPABASE_URL}/rest/v1/schedule?select=event_uid&event_date=gte.${gameDate}&event_date=lte.${gameDate}`, {
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
      })
      const schedData = await schedResp.json()
      const gameUid = schedData?.[0]?.event_uid || null

      let bCt=0, pCt=0, fCt=0, iCt=0, errors=[]

      // Batting
      addProgress(`Importing ${extracted.batting_stats?.length || 0} batting rows...`, 'active')
      for (const row of (extracted.batting_stats || [])) {
        const r = await sbUpsert('game_stats', { game_uid: gameUid, team_name: row.team_name, player_name: row.player_name, player_number: row.player_number, game_date: gameDate, opponent, ...row, source: 'screenshot' })
        if (r.ok) bCt++; else { const e = await r.json().catch(()=>{}); errors.push('Batting/'+row.player_name+': '+JSON.stringify(e)) }
      }
      addProgress(`${bCt} batting rows saved`)

      // Pitching
      addProgress(`Importing ${extracted.pitching_stats?.length || 0} pitching rows...`, 'active')
      for (const row of (extracted.pitching_stats || [])) {
        const r = await sbUpsert('pitching_stats', { game_uid: gameUid, game_date: gameDate, opponent, ...row, source: 'screenshot' })
        if (r.ok) pCt++; else { const e = await r.json().catch(()=>{}); errors.push('Pitching/'+row.player_name+': '+JSON.stringify(e)) }
      }
      addProgress(`${pCt} pitching rows saved`)

      // Fielding
      addProgress(`Importing ${extracted.fielding_stats?.length || 0} fielding rows...`, 'active')
      for (const row of (extracted.fielding_stats || [])) {
        const r = await sbUpsert('fielding_stats', { game_uid: gameUid, game_date: gameDate, opponent, ...row, source: 'screenshot' })
        if (r.ok) fCt++; else { const e = await r.json().catch(()=>{}); errors.push('Fielding/'+row.player_name+': '+JSON.stringify(e)) }
      }
      addProgress(`${fCt} fielding rows saved`)

      // Innings played
      addProgress('Importing innings played...', 'active')
      const posMap = { p:'P', c:'C', first_base:'1B', second_base:'2B', third_base:'3B', ss:'SS', lf:'LF', cf:'CF', rf:'RF', sf:'SF' }
      for (const row of (extracted.innings_played || [])) {
        for (const [posKey, posLabel] of Object.entries(posMap)) {
          const inn = row[posKey]
          if (inn && inn > 0) {
            const r = await sbUpsert('innings_played', { game_uid: gameUid, team_name: row.team_name, player_name: row.player_name, game_date: gameDate, opponent, position: posLabel, innings: inn })
            if (r.ok) iCt++; else { const e = await r.json().catch(()=>{}); errors.push('Innings/'+row.player_name+'/'+posLabel) }
          }
        }
      }
      addProgress(`${iCt} position rows saved`)

      setResult({ success: true, bCt, pCt, fCt, iCt, errors, extracted })
      setStatus('done')

    } catch (err) {
      setResult({ success: false, error: err.message })
      setStatus('error')
    }
  }

  async function sbUpsert(table, row) {
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

  const canRun = gameDate && opponent && apiKey && Object.keys(screenshots).length > 0 && status !== 'running'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Game Info */}
      <div style={cs.card}>
        <div style={cs.cardHeader}><h3 style={cs.cardTitle}>Game Details</h3></div>
        <div style={cs.cardBody}>
          <div style={cs.row}>
            <div style={cs.field}>
              <label style={cs.label}>Game Date</label>
              <input type="date" value={gameDate} onChange={e => setGameDate(e.target.value)} style={cs.input} />
            </div>
            <div style={cs.field}>
              <label style={cs.label}>Opponent</label>
              <input type="text" value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="e.g. Leon-Padres" list="opp-list" style={cs.input} />
              <datalist id="opp-list">
                {['Leon-Padres','LALL Minors B - 1','Sickmeyer-Green Camo Padres','Francis-Padres','Horner-Padres Minor B','Almada - City Connect'].map(o => <option key={o} value={o} />)}
              </datalist>
            </div>
          </div>
          <div style={{ marginTop: '14px' }}>
            <label style={cs.label}>Import For</label>
            <div style={cs.toggleRow}>
              {['myers','opponent','both'].map(m => (
                <button key={m} onClick={() => setTeamMode(m)} style={{ ...cs.toggle, ...(teamMode === m ? cs.toggleActive : {}) }}>
                  {m === 'myers' ? 'Myers Only' : m === 'opponent' ? 'Opponent Only' : '⭐ Both Teams'}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: '14px' }}>
            <label style={cs.label}>Anthropic API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." style={cs.input} />
          </div>
        </div>
      </div>

      {/* Screenshot Upload */}
      <div style={cs.card}>
        <div style={cs.cardHeader}>
          <h3 style={cs.cardTitle}>Screenshots</h3>
          <span style={cs.tag}>{Object.keys(screenshots).length} LOADED</span>
        </div>
        <div style={cs.cardBody}>
          <div style={cs.zoneGrid}>
            {ZONES.map(z => (
              <label key={z.key} style={{ ...cs.zone, ...(screenshots[z.key] ? cs.zoneActive : {}) }}>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) addScreenshot(z.key, e.target.files[0]) }} />
                <span style={{ fontSize: '20px' }}>{z.icon}</span>
                <span style={{ ...cs.zoneLabel, ...(screenshots[z.key] ? { color: 'var(--success)' } : {}) }}>
                  {screenshots[z.key] ? '✓ ' + screenshots[z.key].name.substring(0,16) : z.label}
                </span>
                <span style={cs.zoneSub}>{z.sub}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Run button */}
      <button onClick={runImport} disabled={!canRun} style={{ ...cs.runBtn, opacity: canRun ? 1 : 0.45, cursor: canRun ? 'pointer' : 'not-allowed' }}>
        {status === 'running' ? '⏳ Processing...' : '🚀 Extract & Import Stats'}
      </button>

      {/* Progress */}
      {progress.length > 0 && (
        <div style={cs.card}>
          <div style={cs.cardHeader}><h3 style={cs.cardTitle}>Progress</h3></div>
          <div style={cs.cardBody}>
            {progress.map((p, i) => (
              <div key={i} style={{ padding: '5px 0', fontFamily: "'DM Mono', monospace", fontSize: '12px', color: p.state === 'active' ? '#2c1505' : '#7a5c3e' }}>
                {p.state === 'active' ? '→' : '✓'} {p.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ ...cs.card, border: `2px solid ${result.success ? 'var(--success)' : 'var(--error)'}` }}>
          <div style={{ ...cs.cardHeader, background: result.success ? '#1e6b2e' : '#a82020' }}>
            <h3 style={cs.cardTitle}>{result.success ? '✅ Import Complete' : '❌ Import Failed'}</h3>
          </div>
          <div style={cs.cardBody}>
            {result.success ? (
              <>
                <div style={cs.statRow}>
                  {[['Batting', result.bCt], ['Pitching', result.pCt], ['Fielding', result.fCt], ['Positions', result.iCt]].map(([l, n]) => (
                    <div key={l} style={cs.statCell}>
                      <div style={cs.statNum}>{n}</div>
                      <div style={cs.statLbl}>{l}</div>
                    </div>
                  ))}
                </div>
                {result.errors?.length > 0 && (
                  <div style={{ marginTop: '12px', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: 'var(--error)' }}>
                    {result.errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
                  </div>
                )}
              </>
            ) : (
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'var(--error)' }}>{result.error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const cs = {
  card: { background: 'white', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(44,21,5,0.06)' },
  cardHeader: { padding: '12px 18px', background: '#2c1505', display: 'flex', alignItems: 'center', gap: '10px' },
  cardTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#f7f0e6' },
  tag: { marginLeft: 'auto', background: 'rgba(200,146,42,0.2)', color: '#c8922a', padding: '2px 7px', borderRadius: '4px', fontFamily: "'DM Mono', monospace", fontSize: '9px', letterSpacing: '0.06em' },
  cardBody: { padding: '18px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' },
  field: { display: 'flex', flexDirection: 'column', gap: '5px' },
  label: { fontFamily: "'DM Mono', monospace", fontSize: '10px', fontWeight: 500, color: '#7a5c3e', textTransform: 'uppercase', letterSpacing: '0.1em' },
  input: { padding: '9px 12px', border: '1.5px solid rgba(44,21,5,0.12)', borderRadius: '7px', fontSize: '14px', fontFamily: "'Barlow', sans-serif", color: '#1a0e06', background: '#f7f0e6', outline: 'none' },
  toggleRow: { display: 'flex', gap: '8px', marginTop: '5px' },
  toggle: { flex: 1, padding: '8px', border: '1.5px solid rgba(44,21,5,0.12)', borderRadius: '7px', background: '#f7f0e6', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#7a5c3e' },
  toggleActive: { background: '#2c1505', color: '#f7f0e6', borderColor: '#2c1505' },
  zoneGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' },
  zone: { border: '1.5px dashed rgba(44,21,5,0.15)', borderRadius: '8px', padding: '14px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', background: '#f7f0e6', textAlign: 'center' },
  zoneActive: { borderColor: 'var(--success)', borderStyle: 'solid', background: '#edf7ee' },
  zoneLabel: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7a3a14' },
  zoneSub: { fontFamily: "'DM Mono', monospace", fontSize: '9px', color: '#7a5c3e' },
  runBtn: { padding: '16px', background: '#2c1505', color: '#f7f0e6', border: 'none', borderRadius: '10px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: '18px', textTransform: 'uppercase', letterSpacing: '0.1em', width: '100%' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(44,21,5,0.08)', borderRadius: '8px', overflow: 'hidden' },
  statCell: { background: 'white', padding: '14px', textAlign: 'center' },
  statNum: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: '28px', color: '#2c1505', lineHeight: 1 },
  statLbl: { fontFamily: "'DM Mono', monospace", fontSize: '9px', color: '#7a5c3e', textTransform: 'uppercase', marginTop: '4px' },
}
