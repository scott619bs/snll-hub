'use client'

import { useState, useEffect } from 'react'
import { createClient, getRole } from '../../lib/supabase'
import { SUPABASE_URL, SERVICE_KEY } from '../../lib/classify'

const POSITIONS = ['P','C','1B','2B','3B','SS','LF','CF','RF']
const POS_LABELS = { P:'Pitcher', C:'Catcher', '1B':'First', '2B':'Second', '3B':'Third', SS:'Short', LF:'Left', CF:'Center', RF:'Right' }
const POS_COLORS = { P:'#ffccbc', C:'#bbdefb', '1B':'#dcedc8', '2B':'#dcedc8', '3B':'#dcedc8', SS:'#dcedc8', LF:'#f3e5f5', CF:'#f3e5f5', RF:'#f3e5f5' }

const STAR_LABELS = { 1:'🔴 Needs Work', 2:'🟡 Learning', 3:'🟢 Capable', 4:'🔵 Strong', 5:'⭐ Elite' }

export default function GradesPage() {
  const [user, setUser]       = useState(null)
  const [role, setRole]       = useState(null)
  const [players, setPlayers] = useState([])
  const [grades, setGrades]   = useState({}) // { "Name:POS": { grade, notes } }
  const [pci, setPci]         = useState({}) // { "Name:POS": pci_value }
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [activePlayer, setActivePlayer] = useState(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/'; return }
      setUser(user)
      setRole(getRole(user.email))
      loadData()
    })
  }, [])

  async function loadData() {
    // Always use permanent team roster — never game_stats (which misses absent players)
    const TEAM_ROSTER = [
      { name: 'Joey Heckman',     number: 23 },
      { name: 'Cristiano Afram',  number: 7  },
      { name: 'Matthew Barragan', number: 10 },
      { name: 'Ace Escobar',      number: 4  },
      { name: 'Preston Hale',     number: 21 },
      { name: 'Everett DeHaan',   number: 9  },
      { name: 'Scotty J Myers',   number: 13 },
      { name: 'Luca Bloemker',    number: null },
      { name: 'Avery Benton',     number: null },
      { name: 'Trevor Snoddy',    number: null },
    ]
    setPlayers(TEAM_ROSTER)

    // Load existing grades
    const gradesResp = await fetch(`${SUPABASE_URL}/rest/v1/player_position_grades?select=*`, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    })
    const gradesData = await gradesResp.json()
    const gradesMap = {}
    ;(gradesData || []).forEach(r => {
      gradesMap[`${r.player_name}:${r.position}`] = { grade: r.coach_grade, notes: r.notes || '', number: r.player_number }
    })
    setGrades(gradesMap)

    // Load PCI
    const pciResp = await fetch(`${SUPABASE_URL}/rest/v1/player_pci?select=*`, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }
    })
    const pciData = await pciResp.json()
    const pciMap = {}
    ;(pciData || []).forEach(r => { pciMap[`${r.player_name}:${r.position}`] = r.pci })
    setPci(pciMap)
  }

  function getGrade(playerName, pos) {
    return grades[`${playerName}:${pos}`]?.grade || 3
  }

  function setGrade(playerName, number, pos, grade) {
    setGrades(prev => ({
      ...prev,
      [`${playerName}:${pos}`]: { ...prev[`${playerName}:${pos}`], grade, number }
    }))
  }

  function getNotes(playerName, pos) {
    return grades[`${playerName}:${pos}`]?.notes || ''
  }

  function setNotes(playerName, number, pos, notes) {
    setGrades(prev => ({
      ...prev,
      [`${playerName}:${pos}`]: { ...prev[`${playerName}:${pos}`], notes, number }
    }))
  }

  function getPCI(playerName, pos) {
    return pci[`${playerName}:${pos}`] ?? null
  }

  async function saveGrades() {
    setSaving(true)
    const rows = []
    players.forEach(p => {
      POSITIONS.forEach(pos => {
        const key = `${p.name}:${pos}`
        const g = grades[key]
        if (g?.grade) {
          rows.push({ player_name: p.name, player_number: p.number, position: pos, coach_grade: g.grade, notes: g.notes || '', updated_at: new Date().toISOString() })
        }
      })
    })

    await fetch(`${SUPABASE_URL}/rest/v1/player_position_grades`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (!user) return <div style={s.loading}>Loading...</div>

  const ap = activePlayer ? players.find(p => p.name === activePlayer) : null

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerAccent} />
        <div style={s.headerContent}>
          <div>
            <h1 style={s.headerTitle}>Player Evaluations</h1>
            <p style={s.headerSub}>Dark Brown Padres · Position Capability Index</p>
          </div>
          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <a href="/lineup" style={s.navBtn}>📋 Lineup Builder</a>
            <a href="/dashboard" style={s.navBtn}>← Dashboard</a>
          </div>
        </div>
      </header>

      <main style={s.main}>
        {/* Legend */}
        <div style={s.legendRow}>
          {Object.entries(STAR_LABELS).map(([n, label]) => (
            <div key={n} style={s.legendItem}>
              <div style={{display:'flex',gap:'2px'}}>{Array.from({length:5},(_,i)=><span key={i} style={{fontSize:'12px',opacity:i<+n?1:0.2}}>★</span>)}</div>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e'}}>{label}</span>
            </div>
          ))}
          <div style={{marginLeft:'auto',fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#aaa'}}>
            PCI = position capability index (auto-computed from stats + grade)
          </div>
        </div>

        {/* Player selector */}
        <div style={s.playerTabs}>
          {players.map(p => (
            <button key={p.name} onClick={() => setActivePlayer(activePlayer === p.name ? null : p.name)}
              style={{...s.playerTab, ...(activePlayer === p.name ? s.playerTabActive : {})}}>
              {p.number && <span style={{fontSize:'10px',opacity:0.7}}>#{p.number} </span>}
              {p.name.split(' ').slice(-1)[0]}
            </button>
          ))}
        </div>

        {/* Detail panel for selected player */}
        {ap && (
          <div style={s.detailPanel}>
            <div style={s.detailHeader}>
              <span style={s.detailName}>{ap.number && `#${ap.number} `}{ap.name}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#c8922a'}}>Click a position to edit grade & notes</span>
            </div>
            <div style={s.posGrid}>
              {POSITIONS.map(pos => {
                const grade = getGrade(ap.name, pos)
                const pciVal = getPCI(ap.name, pos)
                return (
                  <div key={pos} style={{...s.posCard, background: POS_COLORS[pos]}}>
                    <div style={s.posLabel}>{POS_LABELS[pos]}</div>
                    <div style={s.posCode}>{pos}</div>
                    {/* Star rating */}
                    <div style={s.starRow}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} onClick={() => setGrade(ap.name, ap.number, pos, n)}
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',padding:'2px',opacity:n<=grade?1:0.2,transition:'all 0.1s'}}>
                          ★
                        </button>
                      ))}
                    </div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e',textAlign:'center',marginTop:'2px'}}>
                      {STAR_LABELS[grade]}
                    </div>
                    {pciVal !== null && (
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:'9px',color:'#aaa',textAlign:'center',marginTop:'4px'}}>
                        PCI: {pciVal}
                      </div>
                    )}
                    <textarea
                      value={getNotes(ap.name, pos)}
                      onChange={e => setNotes(ap.name, ap.number, pos, e.target.value)}
                      placeholder="Notes..."
                      rows={2}
                      style={s.notesInput}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Full grid overview */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Position Grade Matrix</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'rgba(247,240,230,0.5)'}}>Click a cell to edit</span>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  <th style={s.th}>Player</th>
                  {POSITIONS.map(pos => <th key={pos} style={{...s.th,background:POS_COLORS[pos],color:'#2c1505',minWidth:'70px'}}>{pos}</th>)}
                </tr>
              </thead>
              <tbody>
                {players.map((p, ri) => (
                  <tr key={p.name} style={{background:ri%2===0?'white':'#fafaf8'}}>
                    <td style={s.playerCell} onClick={() => setActivePlayer(p.name)}>
                      {p.number && <span style={{color:'#c8922a',marginRight:'4px'}}>#{p.number}</span>}
                      {p.name}
                    </td>
                    {POSITIONS.map(pos => {
                      const grade = getGrade(p.name, pos)
                      const pciVal = getPCI(p.name, pos)
                      return (
                        <td key={pos} style={s.gradeCell} onClick={() => setActivePlayer(p.name)}>
                          <div style={{display:'flex',gap:'1px',justifyContent:'center'}}>
                            {[1,2,3,4,5].map(n => <span key={n} style={{fontSize:'10px',opacity:n<=grade?1:0.15}}>★</span>)}
                          </div>
                          {pciVal !== null && <div style={{fontFamily:"'DM Mono',monospace",fontSize:'9px',color:'#aaa',textAlign:'center'}}>{pciVal}</div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Save button */}
        {role === 'coach' && (
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:'16px'}}>
            {saved && <span style={{fontFamily:"'DM Mono',monospace",fontSize:'12px',color:'#1e6b2e',marginRight:'12px',alignSelf:'center'}}>✓ Saved</span>}
            <button onClick={saveGrades} disabled={saving}
              style={{...s.saveBtn,opacity:saving?0.5:1}}>
              {saving ? 'Saving...' : '💾 Save All Grades'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

const s = {
  page:{minHeight:'100vh',background:'var(--cream)',display:'flex',flexDirection:'column'},
  loading:{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:"'DM Mono',monospace",color:'#7a5c3e'},
  header:{background:'#2c1505',borderBottom:'3px solid #c8922a',position:'sticky',top:0,zIndex:100},
  headerAccent:{height:'3px',background:'linear-gradient(90deg,#c8922a,#f0b830,#c8922a)'},
  headerContent:{padding:'12px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'},
  headerTitle:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:'18px',color:'#f7f0e6',textTransform:'uppercase',letterSpacing:'0.05em',lineHeight:1},
  headerSub:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#c8922a',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:'3px'},
  navBtn:{padding:'6px 14px',background:'rgba(247,240,230,0.08)',border:'1px solid rgba(247,240,230,0.15)',borderRadius:'6px',color:'rgba(247,240,230,0.7)',fontFamily:"'Barlow',sans-serif",fontSize:'12px',textDecoration:'none'},
  main:{flex:1,padding:'24px',maxWidth:'1100px',width:'100%',margin:'0 auto'},
  legendRow:{display:'flex',gap:'16px',alignItems:'center',marginBottom:'16px',flexWrap:'wrap',padding:'10px 16px',background:'white',borderRadius:'10px',border:'1px solid rgba(44,21,5,0.08)'},
  legendItem:{display:'flex',flexDirection:'column',alignItems:'center',gap:'2px'},
  playerTabs:{display:'flex',gap:'6px',flexWrap:'wrap',marginBottom:'16px'},
  playerTab:{padding:'6px 14px',background:'white',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'20px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer',color:'#7a5c3e',letterSpacing:'0.04em'},
  playerTabActive:{background:'#2c1505',color:'#f7f0e6',borderColor:'#2c1505'},
  detailPanel:{background:'white',border:'1px solid rgba(44,21,5,0.1)',borderRadius:'12px',overflow:'hidden',marginBottom:'16px',boxShadow:'0 2px 12px rgba(44,21,5,0.06)'},
  detailHeader:{padding:'12px 18px',background:'#2c1505',display:'flex',alignItems:'center',justifyContent:'space-between'},
  detailName:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'18px',color:'#f7f0e6',letterSpacing:'0.04em'},
  posGrid:{display:'grid',gridTemplateColumns:'repeat(9,1fr)',gap:'8px',padding:'16px'},
  posCard:{borderRadius:'10px',padding:'10px 6px',display:'flex',flexDirection:'column',alignItems:'center',gap:'4px'},
  posLabel:{fontFamily:"'DM Mono',monospace",fontSize:'9px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.08em'},
  posCode:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:'22px',color:'#2c1505'},
  starRow:{display:'flex',gap:'0'},
  notesInput:{width:'100%',marginTop:'6px',padding:'4px 6px',border:'1px solid rgba(44,21,5,0.12)',borderRadius:'5px',fontSize:'10px',fontFamily:"'DM Mono',monospace",background:'rgba(255,255,255,0.6)',outline:'none',resize:'none',color:'#2c1505'},
  card:{background:'white',border:'1px solid rgba(44,21,5,0.1)',borderRadius:'12px',overflow:'hidden',boxShadow:'0 2px 12px rgba(44,21,5,0.06)'},
  cardHeader:{padding:'12px 18px',background:'#2c1505',display:'flex',alignItems:'center',justifyContent:'space-between'},
  cardTitle:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',textTransform:'uppercase',letterSpacing:'0.1em',color:'#f7f0e6'},
  th:{padding:'8px 6px',background:'#2c1505',color:'#c8922a',textAlign:'center',fontSize:'11px',fontFamily:"'DM Mono',monospace",letterSpacing:'0.05em',fontWeight:600,whiteSpace:'nowrap'},
  playerCell:{padding:'8px 12px',fontFamily:"'Barlow',sans-serif",fontSize:'13px',color:'#2c1505',fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',borderBottom:'1px solid rgba(44,21,5,0.06)'},
  gradeCell:{padding:'6px 4px',textAlign:'center',cursor:'pointer',borderBottom:'1px solid rgba(44,21,5,0.06)',verticalAlign:'middle'},
  saveBtn:{padding:'12px 28px',background:'#2c1505',color:'#f7f0e6',border:'none',borderRadius:'9px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'16px',textTransform:'uppercase',letterSpacing:'0.08em',cursor:'pointer'},
}
