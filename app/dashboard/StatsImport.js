'use client'

import { useState, useRef, useCallback } from 'react'
import { parseCSV, classifyCSV, filterTotals, mapFullRow, aiClassify, sbInsert, SUPABASE_URL, SERVICE_KEY } from '../../lib/classify'

const LOCATIONS = ['Rio Seco Minors Field 1','Rio Seco Minors Field 2','Rio Seco Majors Field 1','Chet Harritt Park - Minors','Lindo Lake Park','LALL Field 1','LALL Field 2']
const OPPONENTS = ['Leon-Padres','LALL Minors B - 1','Sickmeyer-Green Camo Padres','Francis-Padres','Horner-Padres Minor B','Almada - City Connect']

export default function StatsImport() {
  const [gameDate, setGameDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [homeAway, setHomeAway] = useState('home')
  const [gameTime, setGameTime] = useState('')
  const [location, setLocation] = useState('')
  const [umpire, setUmpire] = useState('')
  const [inputVal, setInputVal] = useState('')
  const [log, setLog] = useState([])
  const [sending, setSending] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef(null)

  function addLog(msg, type = 'ok') {
    setLog(prev => [...prev, { msg, type, ts: new Date().toLocaleTimeString() }])
  }

  async function stageInput(rawInput, inputType, mimeType = null) {
    if (!gameDate || !opponent) { addLog('Set game date and opponent first', 'error'); return }
    setSending(true)

    try {
      let classification, confidence, reason, extracted, previewRows

      if (inputType === 'csv') {
        const parsed = parseCSV(rawInput)
        if (!parsed) { addLog('Could not parse CSV', 'error'); setSending(false); return }
        const cls = classifyCSV(parsed.headers)
        classification = cls.type
        confidence = cls.confidence
        reason = cls.reason
        const rows = filterTotals(parsed.rows)
        extracted = buildExtractedFromCSV(rows, classification, parsed.headers)
        previewRows = rows.slice(0, 3)
        addLog(`CSV detected: ${classification.toUpperCase()} (${confidence} confidence)`, 'info')
      } else if (inputType === 'image') {
        addLog('Sending image to Claude Vision...', 'info')
        const result = await aiClassify(null, { data: rawInput, mimeType }, 'image', gameDate, opponent)
        classification = result.classification
        confidence = result.confidence
        reason = result.reason
        extracted = result
        previewRows = [
          ...(result.batting_stats || []).slice(0, 2),
          ...(result.pitching_stats || []).slice(0, 1),
        ]
        addLog(`Image classified: ${classification.toUpperCase()} (${confidence} confidence)`, 'info')
      }

      const stagingRow = {
        game_date: gameDate,
        opponent,
        home_away: homeAway,
        game_time: gameTime || null,
        location: location || null,
        umpire: umpire || null,
        source_type: inputType,
        raw_input: inputType === 'csv' ? rawInput : '[base64 image]',
        image_mime_type: mimeType,
        classification,
        confidence,
        classification_reason: reason,
        extracted_json: extracted,
        preview_rows: previewRows,
        status: 'pending',
        review_history: []
      }

      const r = await sbInsert('import_staging', stagingRow)
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error('Staging insert failed: ' + JSON.stringify(err))
      }

      addLog(`✓ Staged for review — check Admin panel to confirm`, 'ok')
      addLog('Ready for next paste →', 'next')
      setInputVal('')

    } catch(err) {
      addLog('Error: ' + err.message, 'error')
    }
    setSending(false)
  }

  function buildExtractedFromCSV(rows, type, headers) {
    const base = (row) => ({
      team_name: 'Myers',
      player_name: `${row['First']||''} ${row['Last']||''}`.trim() || row['Name'] || row['Player'] || '',
      player_number: row['Number'] ? parseInt(row['Number']) : null,
    })
    const n = (v) => { if(!v||v==='-') return null; const x=parseFloat(v); return isNaN(x)?null:x }

    if (type === 'full') {
      const batting_stats=[], pitching_stats=[], fielding_stats=[], innings_played=[]
      for (const row of rows) {
        const m = mapFullRow(row, null, null)
        if (m.batting.pa !== null) batting_stats.push({...m.batting, team_name:'Myers'})
        if (m.pitching) pitching_stats.push({...m.pitching, team_name:'Myers'})
        if (m.fielding) fielding_stats.push({...m.fielding, team_name:'Myers'})
        innings_played.push(...m.innings.map(i=>({...i, team_name:'Myers'})))
      }
      return { batting_stats, pitching_stats, fielding_stats, innings_played }
    }
    if (type === 'batting' || type === 'batting_adv') {
      return { batting_stats: rows.map(row => ({ ...base(row), pa:n(row['PA']), ab:n(row['AB']), h:n(row['H']), singles:n(row['1B']), doubles:n(row['2B']), triples:n(row['3B']), hr:n(row['HR']), rbi:n(row['RBI']), r:n(row['R']), bb:n(row['BB']), so:n(row['SO']), kl:n(row['K-L']), hbp:n(row['HBP']), sb:n(row['SB']), cs:n(row['CS']), qab:n(row['QAB']), ps:n(row['PS']) })), pitching_stats:[], fielding_stats:[], innings_played:[] }
    }
    if (type === 'pitching') {
      return { batting_stats:[], pitching_stats: rows.map(row => ({ ...base(row), ip:n(row['IP']), bf:n(row['BF']), total_pitches:n(row['#P']), h:n(row['H']), r:n(row['R']), er:n(row['ER']), bb:n(row['BB']), so:n(row['SO']), wp:n(row['WP']) })), fielding_stats:[], innings_played:[] }
    }
    if (type === 'fielding' || type === 'catching') {
      return { batting_stats:[], pitching_stats:[], fielding_stats: rows.map(row => ({ ...base(row), tc:n(row['TC']), assists:n(row['A']), po:n(row['PO']), fpct:n(row['FPCT']), errors:n(row['E']), dp:n(row['DP']), inn_caught:n(row['INN']), pb:n(row['PB']) })), innings_played:[] }
    }
    if (type === 'innings') {
      const innings_played = []
      for (const row of rows) {
        for (const pos of ['P','C','1B','2B','3B','SS','LF','CF','RF','SF']) {
          const val = n(row[pos]); if(val&&val>0) innings_played.push({...base(row), position:pos, innings:val})
        }
      }
      return { batting_stats:[], pitching_stats:[], fielding_stats:[], innings_played }
    }
    return { batting_stats:[], pitching_stats:[], fielding_stats:[], innings_played:[] }
  }

  async function handleSend() {
    if (!inputVal.trim()) return
    await stageInput(inputVal.trim(), 'csv')
  }

  const handlePaste = useCallback(async (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        const reader = new FileReader()
        reader.onload = async (ev) => {
          const b64 = ev.target.result.split(',')[1]
          setInputVal('[Image pasted — sending to Vision...]')
          await stageInput(b64, 'image', item.type)
          setInputVal('')
        }
        reader.readAsDataURL(file)
        return
      }
    }
  }, [gameDate, opponent])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const b64 = ev.target.result.split(',')[1]
        setInputVal('[Image dropped — sending to Vision...]')
        await stageInput(b64, 'image', file.type)
        setInputVal('')
      }
      reader.readAsDataURL(file)
    } else {
      const text = await file.text()
      setInputVal(text)
    }
  }, [gameDate, opponent])

  const logColor = { ok:'#1e6b2e', error:'#a82020', warn:'#8a6000', info:'#2c1505', next:'#c8922a' }
  const canSend = !sending && inputVal.trim() && gameDate && opponent && !inputVal.startsWith('[Image')

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>

      {/* Game Details */}
      <div style={s.card}>
        <div style={s.header}><h3 style={s.title}>Game Details</h3></div>
        <div style={s.body}>
          {/* Row 1: Date, Opponent, Home/Away */}
          <div style={{...s.row, gridTemplateColumns:'1fr 1fr auto', marginBottom:'12px'}}>
            <div style={s.field}>
              <label style={s.label}>Game Date</label>
              <input type="date" value={gameDate} onChange={e=>setGameDate(e.target.value)} style={s.input} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Opponent</label>
              <input type="text" value={opponent} onChange={e=>setOpponent(e.target.value)} placeholder="e.g. Leon-Padres" list="opp-list" style={s.input} />
              <datalist id="opp-list">{OPPONENTS.map(o=><option key={o} value={o}/>)}</datalist>
            </div>
            <div style={s.field}>
              <label style={s.label}>Home / Away</label>
              <div style={s.toggle}>
                {['home','away'].map(v => (
                  <button key={v} onClick={()=>setHomeAway(v)}
                    style={{...s.toggleBtn, ...(homeAway===v ? s.toggleBtnActive : {})}}>
                    {v === 'home' ? '🏠 Home' : '✈️ Away'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Row 2: Time, Location, Umpire */}
          <div style={{...s.row, gridTemplateColumns:'1fr 2fr 1fr'}}>
            <div style={s.field}>
              <label style={s.label}>Game Time</label>
              <input type="time" value={gameTime} onChange={e=>setGameTime(e.target.value)} style={s.input} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Location</label>
              <input type="text" value={location} onChange={e=>setLocation(e.target.value)} placeholder="Field name" list="loc-list" style={s.input} />
              <datalist id="loc-list">{LOCATIONS.map(l=><option key={l} value={l}/>)}</datalist>
            </div>
            <div style={s.field}>
              <label style={s.label}>Umpire</label>
              <input type="text" value={umpire} onChange={e=>setUmpire(e.target.value)} placeholder="Umpire name" style={s.input} />
            </div>
          </div>
        </div>
      </div>

      {/* Paste Input */}
      <div style={s.card}>
        <div style={s.header}>
          <h3 style={s.title}>Paste Stats</h3>
          <span style={s.tag}>CSV OR IMAGE</span>
        </div>
        <div style={s.body}>
          <p style={s.hint}>
            <strong>CSV:</strong> GC app → any stats tab → Export → Copy CSV → paste below<br/>
            <strong>Image:</strong> Copy a screenshot → Ctrl+V directly in the box, or drag & drop an image file
          </p>
          <div
            onDragOver={e=>{e.preventDefault();setDragOver(true)}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={handleDrop}
            style={{ position:'relative' }}
          >
            <textarea
              ref={textareaRef}
              value={inputVal}
              onChange={e=>setInputVal(e.target.value)}
              onPaste={handlePaste}
              placeholder="Paste CSV data or Ctrl+V a screenshot here... You can also drag & drop an image file."
              rows={7}
              style={{
                ...s.textarea,
                borderColor: dragOver ? '#c8922a' : undefined,
                borderStyle: dragOver ? 'solid' : undefined,
                background: dragOver ? '#fdf6e8' : undefined,
              }}
            />
            {dragOver && <div style={s.dropOverlay}>Drop image here</div>}
          </div>
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{...s.sendBtn, opacity:canSend?1:0.4, cursor:canSend?'pointer':'not-allowed'}}
          >
            {sending ? 'Staging...' : 'Send for Review →'}
          </button>
          <p style={{...s.hint, marginTop:'8px', marginBottom:0}}>
            ⚠ Data is staged for admin review — nothing writes to the database until you confirm in the <strong>Admin</strong> panel.
          </p>
        </div>
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={s.card}>
          <div style={s.header}>
            <h3 style={s.title}>Import Log</h3>
            <button onClick={()=>setLog([])} style={s.clearBtn}>Clear</button>
          </div>
          <div style={{...s.body, gap:'4px', display:'flex', flexDirection:'column'}}>
            {log.map((entry,i)=>(
              <div key={i} style={{fontFamily:"'DM Mono',monospace",fontSize:'12px',color:logColor[entry.type]||'#2c1505',display:'flex',gap:'10px'}}>
                <span style={{color:'#bbb',flexShrink:0}}>{entry.ts}</span>
                <span>{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  card:{background:'white',border:'1px solid rgba(44,21,5,0.1)',borderRadius:'12px',overflow:'hidden',boxShadow:'0 2px 12px rgba(44,21,5,0.06)'},
  header:{padding:'12px 18px',background:'#2c1505',display:'flex',alignItems:'center',gap:'10px'},
  title:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',textTransform:'uppercase',letterSpacing:'0.1em',color:'#f7f0e6'},
  tag:{marginLeft:'auto',background:'rgba(200,146,42,0.2)',color:'#c8922a',padding:'2px 7px',borderRadius:'4px',fontFamily:"'DM Mono',monospace",fontSize:'9px',letterSpacing:'0.06em'},
  clearBtn:{marginLeft:'auto',background:'rgba(247,240,230,0.1)',border:'1px solid rgba(247,240,230,0.2)',borderRadius:'4px',color:'rgba(247,240,230,0.6)',fontFamily:"'DM Mono',monospace",fontSize:'10px',padding:'2px 8px',cursor:'pointer'},
  body:{padding:'18px'},
  row:{display:'grid',gap:'14px'},
  field:{display:'flex',flexDirection:'column',gap:'5px'},
  label:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em'},
  input:{padding:'9px 12px',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontSize:'14px',fontFamily:"'Barlow',sans-serif",color:'#1a0e06',background:'#f7f0e6',outline:'none'},
  toggle:{display:'flex',gap:'0',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',overflow:'hidden'},
  toggleBtn:{flex:1,padding:'9px 10px',background:'#f7f0e6',border:'none',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'12px',cursor:'pointer',color:'#7a5c3e',whiteSpace:'nowrap'},
  toggleBtnActive:{background:'#2c1505',color:'#f7f0e6'},
  hint:{fontSize:'12px',color:'#7a5c3e',marginBottom:'12px',lineHeight:1.6,fontFamily:"'DM Mono',monospace"},
  textarea:{width:'100%',padding:'12px',border:'1.5px dashed rgba(44,21,5,0.2)',borderRadius:'9px',fontSize:'12px',fontFamily:"'DM Mono',monospace",color:'#1a0e06',background:'#f7f0e6',outline:'none',resize:'vertical',lineHeight:1.4,transition:'all 0.15s'},
  dropOverlay:{position:'absolute',inset:0,background:'rgba(200,146,42,0.12)',border:'2px solid #c8922a',borderRadius:'9px',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'18px',color:'#c8922a',pointerEvents:'none'},
  sendBtn:{marginTop:'10px',width:'100%',padding:'13px',background:'#2c1505',color:'#f7f0e6',border:'none',borderRadius:'9px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'17px',textTransform:'uppercase',letterSpacing:'0.1em'},
}
