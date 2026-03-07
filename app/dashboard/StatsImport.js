'use client'

import { useState } from 'react'

const SUPABASE_URL = 'https://iouwkxjthjbhhcmzmqcx.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvdXdreGp0aGpiaGhjbXptcWN4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTgwMzYxNywiZXhwIjoyMDg1Mzc5NjE3fQ.nLnqlHK7RbCP3gbxbhJVqcY-Zhep0fRVaNtxyw2muEY'

const SCREENSHOT_ZONES = [
  { key: 'boxscore', icon: '📋', label: 'Box Score' },
  { key: 'batting', icon: '🏏', label: 'Batting Standard' },
  { key: 'batting-adv', icon: '📊', label: 'Batting Advanced' },
  { key: 'pitching', icon: '⚾', label: 'Pitching Standard' },
  { key: 'fielding', icon: '🧤', label: 'Fielding Standard' },
  { key: 'catching', icon: '🥎', label: 'Catching' },
  { key: 'innings', icon: '📍', label: 'Innings Played' },
  { key: 'plays', icon: '📝', label: 'Play by Play' },
]

function parseCSV(text) {
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

function num(v) {
  if (v === '' || v === '-' || v == null) return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function classify(headers) {
  const h = headers.map(x => x.toLowerCase())
  if (h.includes('era') && h.includes('avg') && h.includes('tc')) return 'full'
  if (h.includes('pb') && h.includes('sbatt')) return 'catching'
  if (h.includes('tc') && h.includes('po') && h.includes('fpct')) return 'fielding'
  if (h.includes('era') || h.includes('bf') || h.includes('#p') || h.includes('whip')) return 'pitching'
  if (h.includes('qab') || h.includes('babip') || h.includes('ba/risp')) return 'batting_adv'
  if (h.includes('avg') || h.includes('obp') || h.includes('rbi')) return 'batting'
  if (h.includes('p') && h.includes('c') && (h.includes('1b') || h.includes('ss'))) return 'innings'
  return 'unknown'
}

function mapFullRow(row, gameDate, opponent) {
  const name = `${row['First'] || ''} ${row['Last'] || ''}`.trim()
  const base = { player_name: name, player_number: row['Number'] ? parseInt(row['Number']) : null, game_date: gameDate, opponent, team_name: 'Myers' }

  const batting = { ...base, pa: num(row['PA']), ab: num(row['AB']), h: num(row['H']), singles: num(row['1B']), doubles: num(row['2B']), triples: num(row['3B']), hr: num(row['HR']), rbi: num(row['RBI']), r: num(row['R']), bb: num(row['BB']), so: num(row['SO']), kl: num(row['K-L']), hbp: num(row['HBP']), sac: num(row['SAC']), sf: num(row['SF']), roe: num(row['ROE']), fc: num(row['FC']), sb: num(row['SB']), cs: num(row['CS']), pik: num(row['PIK']), qab: num(row['QAB']), babip: num(row['BABIP']), ba_risp: num(row['BA/RISP']), lob: num(row['LOB']), ps: num(row['PS']), ps_pa: num(row['PS/PA']), two_s3: num(row['2S+3']), six_plus: num(row['6+']), gidp: num(row['GIDP']), source: 'csv' }

  const hasIP = row['IP'] && row['IP'] !== '0.0' && row['IP'] !== '-' && row['IP'] !== '0'
  const pitching = hasIP ? { ...base, ip: num(row['IP']), gs: num(row['GS']), bf: num(row['BF']), total_pitches: num(row['#P']), h: num(row['H']), r: num(row['R']), er: num(row['ER']), bb: num(row['BB']), so: num(row['SO']), kl: num(row['K-L']), hbp: num(row['HBP']), lob: num(row['LOB']), wp: num(row['WP']), baa: num(row['BAA']), source: 'csv' } : null

  const fielding = row['TC'] !== undefined ? { ...base, tc: num(row['TC']), assists: num(row['A']), po: num(row['PO']), fpct: num(row['FPCT']), errors: num(row['E']), dp: num(row['DP']), inn_caught: num(row['INN']), pb: num(row['PB']), source: 'csv' } : null

  const posMap = { P: 'P', C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'LF', CF: 'CF', RF: 'RF', SF: 'SF' }
  const innings = []
  for (const [col, pos] of Object.entries(posMap)) {
    const val = num(row[col])
    if (val && val > 0) innings.push({ ...base, position: pos, innings: val })
  }

  return { batting, pitching, fielding, innings }
}

async function sbUpsert(table, row) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  })
}

export default function StatsImport() {
  const [mode, setMode] = useState('paste')
  const [gameDate, setGameDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [screenshots, setScreenshots] = useState({})
  const [log, setLog] = useState([])
  const [sending, setSending] = useState(false)

  function addLog(msg, type = 'ok') {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }])
  }

  async function handleSend() {
    if (!pasteText.trim() || !gameDate || !opponent) return
    setSending(true)
    try {
      const parsed = parseCSV(pasteText)
      if (!parsed) { addLog('Could not parse — check the data', 'error'); setSending(false); return }

      const type = classify(parsed.headers)
      addLog(`Detected: ${type.toUpperCase()} · ${parsed.rows.length} rows`, 'info')

      const rows = parsed.rows.filter(r => {
        const last = (r['Last'] || r['Name'] || r['Player'] || '').toLowerCase()
        return last !== 'totals' && last !== 'glossary' && last !== ''
      })

      let b=0, p=0, f=0, i=0, e=0

      if (type === 'full') {
        for (const row of rows) {
          const m = mapFullRow(row, gameDate, opponent)
          if (m.batting.pa !== null) { const r = await sbUpsert('game_stats', m.batting); r.ok ? b++ : e++ }
          if (m.pitching) { const r = await sbUpsert('pitching_stats', m.pitching); r.ok ? p++ : e++ }
          if (m.fielding) { const r = await sbUpsert('fielding_stats', m.fielding); r.ok ? f++ : e++ }
          for (const inn of m.innings) { const r = await sbUpsert('innings_played', inn); r.ok ? i++ : e++ }
        }
        if (b) addLog(`✓ Batting: ${b} rows`, 'ok')
        if (p) addLog(`✓ Pitching: ${p} rows`, 'ok')
        if (f) addLog(`✓ Fielding: ${f} rows`, 'ok')
        if (i) addLog(`✓ Innings: ${i} position rows`, 'ok')

      } else if (type === 'batting' || type === 'batting_adv') {
        for (const row of rows) {
          const name = `${row['First']||''} ${row['Last']||''}`.trim() || row['Name'] || row['Player'] || ''
          const mapped = { player_name: name, player_number: row['Number'] ? parseInt(row['Number']) : null, game_date: gameDate, opponent, team_name: 'Myers', pa: num(row['PA']), ab: num(row['AB']), h: num(row['H']), singles: num(row['1B']), doubles: num(row['2B']), triples: num(row['3B']), hr: num(row['HR']), rbi: num(row['RBI']), r: num(row['R']), bb: num(row['BB']), so: num(row['SO']), kl: num(row['K-L']), hbp: num(row['HBP']), sac: num(row['SAC']), sf: num(row['SF']), roe: num(row['ROE']), fc: num(row['FC']), sb: num(row['SB']), cs: num(row['CS']), pik: num(row['PIK']), qab: num(row['QAB']), babip: num(row['BABIP']), ba_risp: num(row['BA/RISP']), ps: num(row['PS']), source: 'csv' }
          const r = await sbUpsert('game_stats', mapped); r.ok ? b++ : e++
        }
        addLog(`✓ Batting: ${b} rows`, 'ok')

      } else if (type === 'pitching') {
        for (const row of rows) {
          const name = `${row['First']||''} ${row['Last']||''}`.trim() || row['Name'] || row['Player'] || ''
          const mapped = { player_name: name, player_number: row['Number'] ? parseInt(row['Number']) : null, game_date: gameDate, opponent, team_name: 'Myers', ip: num(row['IP']), bf: num(row['BF']), total_pitches: num(row['#P']), h: num(row['H']), r: num(row['R']), er: num(row['ER']), bb: num(row['BB']), so: num(row['SO']), kl: num(row['K-L']), hbp: num(row['HBP']), wp: num(row['WP']), baa: num(row['BAA']), source: 'csv' }
          const r = await sbUpsert('pitching_stats', mapped); r.ok ? p++ : e++
        }
        addLog(`✓ Pitching: ${p} rows`, 'ok')

      } else if (type === 'fielding' || type === 'catching') {
        for (const row of rows) {
          const name = `${row['First']||''} ${row['Last']||''}`.trim() || row['Name'] || row['Player'] || ''
          const mapped = { player_name: name, player_number: row['Number'] ? parseInt(row['Number']) : null, game_date: gameDate, opponent, team_name: 'Myers', tc: num(row['TC']), assists: num(row['A']), po: num(row['PO']), fpct: num(row['FPCT']), errors: num(row['E']), dp: num(row['DP']), inn_caught: num(row['INN']), pb: num(row['PB']), sb_allowed: num(row['SB']), sb_att: num(row['SBATT']), cs: num(row['CS']), cs_pct: num(row['CS%']), source: 'csv' }
          const r = await sbUpsert('fielding_stats', mapped); r.ok ? f++ : e++
        }
        addLog(`✓ Fielding: ${f} rows`, 'ok')

      } else if (type === 'innings') {
        for (const row of rows) {
          const name = `${row['First']||''} ${row['Last']||''}`.trim() || row['Name'] || row['Player'] || ''
          const base = { player_name: name, player_number: row['Number'] ? parseInt(row['Number']) : null, game_date: gameDate, opponent, team_name: 'Myers' }
          for (const pos of ['P','C','1B','2B','3B','SS','LF','CF','RF','SF']) {
            const val = num(row[pos]); if (val && val > 0) { const r = await sbUpsert('innings_played', {...base, position: pos, innings: val}); r.ok ? i++ : e++ }
          }
        }
        addLog(`✓ Innings: ${i} position rows`, 'ok')

      } else {
        addLog('Unknown format — could not classify', 'error')
        setSending(false); return
      }

      if (e > 0) addLog(`⚠ ${e} rows had errors`, 'warn')
      addLog('Done — paste the next tab →', 'next')
      setPasteText('')

    } catch(err) { addLog('Error: ' + err.message, 'error') }
    setSending(false)
  }

  async function runScreenshotImport() {
    if (!gameDate || !opponent || !apiKey || Object.keys(screenshots).length === 0) return
    setSending(true)
    addLog(`Sending ${Object.keys(screenshots).length} screenshots to Claude Vision...`, 'info')
    try {
      const contentBlocks = []
      for (const [key, file] of Object.entries(screenshots)) {
        const b64 = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=rej; r.readAsDataURL(file) })
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: file.type||'image/png', data: b64 } })
        contentBlocks.push({ type: 'text', text: `[Screenshot: "${key}" tab]` })
      }
      contentBlocks.push({ type: 'text', text: `Extract all stats from these GameChanger screenshots for ${gameDate} vs ${opponent}. Return ONLY JSON (no markdown) with keys: batting_stats, pitching_stats, fielding_stats, innings_played. Use null for missing values. Skip totals rows.` })
      const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 4096, messages: [{ role: 'user', content: contentBlocks }] }) })
      if (!resp.ok) throw new Error('API ' + resp.status)
      const ai = await resp.json()
      let raw = ai.content.find(b=>b.type==='text')?.text?.trim()||''
      raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim()
      const ex = JSON.parse(raw)
      let b=0,p=0,f=0,i=0
      for (const row of (ex.batting_stats||[])) { const r = await sbUpsert('game_stats',{...row,game_date:gameDate,opponent,source:'screenshot'}); if(r.ok) b++ }
      for (const row of (ex.pitching_stats||[])) { const r = await sbUpsert('pitching_stats',{...row,game_date:gameDate,opponent,source:'screenshot'}); if(r.ok) p++ }
      for (const row of (ex.fielding_stats||[])) { const r = await sbUpsert('fielding_stats',{...row,game_date:gameDate,opponent,source:'screenshot'}); if(r.ok) f++ }
      for (const row of (ex.innings_played||[])) {
        for (const pos of ['P','C','1B','2B','3B','SS','LF','CF','RF','SF']) {
          const val = row[pos.toLowerCase()]||row[pos]; if(val&&val>0) { const r = await sbUpsert('innings_played',{player_name:row.player_name,player_number:row.player_number,team_name:row.team_name||'Myers',game_date:gameDate,opponent,position:pos,innings:val}); if(r.ok) i++ }
        }
      }
      addLog(`✓ B:${b} P:${p} F:${f} I:${i}`, 'ok')
    } catch(err) { addLog('Error: '+err.message, 'error') }
    setSending(false)
  }

  const logColor = { ok:'#1e6b2e', error:'#a82020', warn:'#8a6000', info:'#2c1505', next:'#c8922a' }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

      <div style={cs.card}>
        <div style={cs.cardHeader}><h3 style={cs.cardTitle}>Game Details</h3></div>
        <div style={cs.cardBody}>
          <div style={cs.row}>
            <div style={cs.field}>
              <label style={cs.label}>Game Date</label>
              <input type="date" value={gameDate} onChange={e=>setGameDate(e.target.value)} style={cs.input} />
            </div>
            <div style={cs.field}>
              <label style={cs.label}>Opponent</label>
              <input type="text" value={opponent} onChange={e=>setOpponent(e.target.value)} placeholder="e.g. Leon-Padres" list="opp-list" style={cs.input} />
              <datalist id="opp-list">
                {['Leon-Padres','LALL Minors B - 1','Sickmeyer-Green Camo Padres','Francis-Padres','Horner-Padres Minor B','Almada - City Connect'].map(o=><option key={o} value={o}/>)}
              </datalist>
            </div>
          </div>
        </div>
      </div>

      <div style={cs.modeRow}>
        <button onClick={()=>setMode('paste')} style={{...cs.modeBtn,...(mode==='paste'?cs.modeBtnActive:{})}}>📋 Paste CSV</button>
        <button onClick={()=>setMode('screenshot')} style={{...cs.modeBtn,...(mode==='screenshot'?cs.modeBtnActive:{})}}>📸 Screenshots</button>
      </div>

      {mode==='paste' && (
        <div style={cs.card}>
          <div style={cs.cardHeader}>
            <h3 style={cs.cardTitle}>Paste Export Data</h3>
            <span style={cs.tag}>AUTO-CLASSIFY</span>
          </div>
          <div style={cs.cardBody}>
            <p style={cs.hint}>GC app → any stats tab → Export → Copy CSV → paste below → Send. Repeat for each tab.</p>
            <textarea value={pasteText} onChange={e=>setPasteText(e.target.value)} placeholder="Paste CSV here..." style={cs.textarea} rows={7} />
            <button onClick={handleSend} disabled={sending||!pasteText.trim()||!gameDate||!opponent} style={{...cs.sendBtn, opacity:(sending||!pasteText.trim()||!gameDate||!opponent)?0.4:1, cursor:(sending||!pasteText.trim()||!gameDate||!opponent)?'not-allowed':'pointer'}}>
              {sending ? 'Importing...' : 'Send →'}
            </button>
          </div>
        </div>
      )}

      {mode==='screenshot' && (
        <div style={cs.card}>
          <div style={cs.cardHeader}>
            <h3 style={cs.cardTitle}>Screenshot Import</h3>
            <span style={cs.tag}>{Object.keys(screenshots).length} LOADED</span>
          </div>
          <div style={cs.cardBody}>
            <div style={{marginBottom:'14px'}}>
              <label style={cs.label}>Anthropic API Key</label>
              <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="sk-ant-..." style={cs.input} />
            </div>
            <div style={cs.zoneGrid}>
              {SCREENSHOT_ZONES.map(z=>(
                <label key={z.key} style={{...cs.zone,...(screenshots[z.key]?cs.zoneActive:{})}}>
                  <input type="file" accept="image/*" style={{display:'none'}} onChange={e=>{if(e.target.files[0]) setScreenshots(prev=>({...prev,[z.key]:e.target.files[0]}))}} />
                  <span>{z.icon}</span>
                  <span style={{...cs.zoneLabel,...(screenshots[z.key]?{color:'var(--success)'}:{})}}>{screenshots[z.key]?'✓ Loaded':z.label}</span>
                </label>
              ))}
            </div>
            <button onClick={runScreenshotImport} disabled={sending||!apiKey||Object.keys(screenshots).length===0||!gameDate||!opponent} style={{...cs.sendBtn,marginTop:'14px',opacity:(sending||!apiKey||Object.keys(screenshots).length===0||!gameDate||!opponent)?0.4:1}}>
              {sending?'Processing...':'🚀 Extract & Import'}
            </button>
          </div>
        </div>
      )}

      {log.length>0 && (
        <div style={cs.card}>
          <div style={cs.cardHeader}>
            <h3 style={cs.cardTitle}>Import Log</h3>
            <button onClick={()=>setLog([])} style={cs.clearBtn}>Clear</button>
          </div>
          <div style={{...cs.cardBody,display:'flex',flexDirection:'column',gap:'4px'}}>
            {log.map((entry,i)=>(
              <div key={i} style={{fontFamily:"'DM Mono', monospace",fontSize:'12px',color:logColor[entry.type]||'#2c1505',display:'flex',gap:'10px'}}>
                <span style={{color:'#aaa',flexShrink:0}}>{entry.ts}</span>
                <span>{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const cs = {
  card:{background:'white',border:'1px solid var(--border)',borderRadius:'12px',overflow:'hidden',boxShadow:'0 2px 12px rgba(44,21,5,0.06)'},
  cardHeader:{padding:'12px 18px',background:'#2c1505',display:'flex',alignItems:'center',gap:'10px'},
  cardTitle:{fontFamily:"'Barlow Condensed', sans-serif",fontWeight:700,fontSize:'13px',textTransform:'uppercase',letterSpacing:'0.1em',color:'#f7f0e6'},
  tag:{marginLeft:'auto',background:'rgba(200,146,42,0.2)',color:'#c8922a',padding:'2px 7px',borderRadius:'4px',fontFamily:"'DM Mono', monospace",fontSize:'9px',letterSpacing:'0.06em'},
  clearBtn:{marginLeft:'auto',background:'rgba(247,240,230,0.1)',border:'1px solid rgba(247,240,230,0.2)',borderRadius:'4px',color:'rgba(247,240,230,0.6)',fontFamily:"'DM Mono', monospace",fontSize:'10px',padding:'2px 8px',cursor:'pointer'},
  cardBody:{padding:'18px'},
  row:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'},
  field:{display:'flex',flexDirection:'column',gap:'5px'},
  label:{fontFamily:"'DM Mono', monospace",fontSize:'10px',fontWeight:500,color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em'},
  input:{padding:'9px 12px',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontSize:'14px',fontFamily:"'Barlow', sans-serif",color:'#1a0e06',background:'#f7f0e6',outline:'none'},
  hint:{fontSize:'12px',color:'#7a5c3e',marginBottom:'12px',lineHeight:1.5,fontFamily:"'DM Mono', monospace"},
  textarea:{width:'100%',padding:'10px 12px',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontSize:'12px',fontFamily:"'DM Mono', monospace",color:'#1a0e06',background:'#f7f0e6',outline:'none',resize:'vertical',lineHeight:1.4},
  sendBtn:{marginTop:'10px',width:'100%',padding:'13px',background:'#2c1505',color:'#f7f0e6',border:'none',borderRadius:'9px',fontFamily:"'Barlow Condensed', sans-serif",fontWeight:800,fontSize:'17px',textTransform:'uppercase',letterSpacing:'0.1em'},
  modeRow:{display:'flex',gap:'10px'},
  modeBtn:{flex:1,padding:'11px',background:'white',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'9px',fontFamily:"'Barlow Condensed', sans-serif",fontWeight:700,fontSize:'14px',textTransform:'uppercase',letterSpacing:'0.08em',color:'#7a5c3e',cursor:'pointer'},
  modeBtnActive:{background:'#2c1505',color:'#f7f0e6',borderColor:'#2c1505'},
  zoneGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))',gap:'8px'},
  zone:{border:'1.5px dashed rgba(44,21,5,0.15)',borderRadius:'8px',padding:'12px 8px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:'4px',background:'#f7f0e6',textAlign:'center'},
  zoneActive:{borderColor:'var(--success)',borderStyle:'solid',background:'#edf7ee'},
  zoneLabel:{fontFamily:"'Barlow Condensed', sans-serif",fontWeight:700,fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.06em',color:'#7a3a14'},
}
