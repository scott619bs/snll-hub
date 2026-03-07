'use client'

import { useState, useEffect } from 'react'
import { createClient, getRole } from '../../lib/supabase'
import { SUPABASE_URL, SERVICE_KEY, sbInsert } from '../../lib/classify'

const POSITIONS = ['P','C','1B','2B','3B','SS','LF','CF','RF']
const OPPONENTS = ['Leon-Padres','LALL Minors B - 1','Sickmeyer-Green Camo Padres','Francis-Padres','Horner-Padres Minor B','Almada - City Connect']

// Field position coordinates on a 300x280 SVG canvas
const FIELD_COORDS = {
  P:  { x: 150, y: 160 },
  C:  { x: 150, y: 240 },
  '1B': { x: 220, y: 130 },
  '2B': { x: 195, y: 95  },
  '3B': { x: 80,  y: 130 },
  SS: { x: 108, y: 95  },
  LF: { x: 55,  y: 45  },
  CF: { x: 150, y: 25  },
  RF: { x: 245, y: 45  },
}

export default function LineupPage() {
  const [user, setUser]         = useState(null)
  const [role, setRole]         = useState(null)
  const [gameDate, setGameDate] = useState('')
  const [opponent, setOpponent] = useState('')
  const [homeAway, setHomeAway] = useState('home')
  const [innings, setInnings]   = useState(4)
  const [allPlayers, setAllPlayers] = useState([])
  const [availability, setAvailability] = useState({}) // name → { available }
  const [lockedPositions, setLockedPositions] = useState({}) // name → pos
  const [poolPlayers, setPoolPlayers] = useState([]) // added per-game: [{name,number}]
  const [poolInput, setPoolInput] = useState({ name: '', number: '' })
  const [lineupPlan, setLineupPlan]   = useState(null)
  const [generating, setGenerating]   = useState(false)
  const [activeInning, setActiveInning] = useState(1)
  const [editMode, setEditMode]         = useState(false)
  const [dragPlayer, setDragPlayer]     = useState(null)
  const [saving, setSaving]             = useState(false)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/'; return }
      setUser(user)
      setRole(getRole(user.email))
      loadPlayers()
    })
  }, [])

  async function loadPlayers() {
    // Permanent team roster — always load from canonical list, NOT game_stats
    // (game_stats only has players who played, misses absent regulars and includes pool players)
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
    setAllPlayers(TEAM_ROSTER)
    const avail = {}
    TEAM_ROSTER.forEach(p => { avail[p.name] = { available: true } })
    setAvailability(avail)
  }

  const activePlayers = [
    ...allPlayers.filter(p => availability[p.name]?.available).map(p => ({ ...p, isPool: false })),
    ...poolPlayers.map(p => ({ ...p, isPool: true }))
  ]

  async function generateLineup() {
    if (!gameDate || !opponent || activePlayers.length < 9) {
      alert(activePlayers.length < 9 ? `Need at least 9 players — currently ${activePlayers.length} available` : 'Set game date and opponent first')
      return
    }
    setGenerating(true)

    try {
      // Load grades and stats
      const [gradesResp, statsResp] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/player_position_grades?select=*`, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }),
        // Note: obp/avg are NOT stored columns — calculate from counting stats
        fetch(`${SUPABASE_URL}/rest/v1/game_stats?team_name=eq.Myers&select=player_name,pa,ab,h,bb,hbp,sf,so,sb`, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } })
      ])
      const gradesData = await gradesResp.json()
      const statsRaw   = await statsResp.json()
      // Guard: if query failed, statsRaw will be an error object not an array
      const statsData  = Array.isArray(statsRaw) ? statsRaw : []

      // Build PCI map per player
      const pciData = {}
      ;(Array.isArray(gradesData) ? gradesData : []).forEach(r => {
        if (!pciData[r.player_name]) pciData[r.player_name] = {}
        pciData[r.player_name][r.position] = r.coach_grade * 20 // simple grade→PCI
      })

      // Aggregate batting stats per player (compute obp/avg from counting stats)
      const battingStats = {}
      statsData.forEach(r => {
        if (!battingStats[r.player_name]) battingStats[r.player_name] = { pa:0, ab:0, h:0, bb:0, hbp:0, sf:0, so:0, sb:0, obp:null, avg:null }
        const b = battingStats[r.player_name]
        b.pa += r.pa || 0; b.ab += r.ab || 0; b.h += r.h || 0
        b.bb += r.bb || 0; b.hbp += r.hbp || 0; b.sf += r.sf || 0
        b.so += r.so || 0; b.sb += r.sb || 0
        if (b.ab > 0) b.avg = +(b.h / b.ab).toFixed(3)
        const denom = b.ab + b.bb + b.hbp + b.sf
        if (denom > 0) b.obp = +((b.h + b.bb + b.hbp) / denom).toFixed(3)
      })

      const resp = await fetch('/api/lineup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          players: activePlayers.map(p => ({ ...p, isPool: p.isPool || false })),
          pciData,
          battingStats,
          innings,
          lockedPositions,
          gameContext: { date: gameDate, opponent, homeAway, innings }
        })
      })

      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error || 'API error') }
      const plan = await resp.json()
      setLineupPlan(plan)
      setActiveInning(1)
    } catch(err) { alert('Generation failed: ' + err.message) }
    setGenerating(false)
  }

  async function savePlan() {
    if (!lineupPlan) return
    setSaving(true)
    await sbInsert('lineup_plans', {
      game_date: gameDate, opponent, home_away: homeAway, innings,
      available_players: activePlayers,
      batting_order: lineupPlan.batting_order,
      inning_assignments: lineupPlan.innings,
      pitching_plan: lineupPlan.pitching_plan,
      ai_reasoning: lineupPlan.overall_reasoning,
      locked_positions: lockedPositions,
      status: 'draft'
    })
    setSaving(false)
    alert('Lineup saved!')
  }

  function moveBatter(from, to) {
    if (!lineupPlan) return
    const order = [...lineupPlan.batting_order]
    const [item] = order.splice(from, 1)
    order.splice(to, 0, item)
    setLineupPlan(prev => ({ ...prev, batting_order: order }))
  }

  function updatePosition(inningIdx, pos, playerName) {
    setLineupPlan(prev => {
      const innings = prev.innings.map((inn, i) => {
        if (i !== inningIdx) return inn
        return { ...inn, assignments: { ...inn.assignments, [pos]: playerName } }
      })
      return { ...prev, innings }
    })
  }

  if (!user) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontFamily:"'DM Mono',monospace",color:'#7a5c3e'}}>Loading...</div>

  const currentInning = lineupPlan?.innings?.[activeInning - 1]

  return (
    <div style={s.page}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-page { page-break-after: always; }
          body { background: white; }
          .print-area { display: block !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <header style={s.header} className="no-print">
        <div style={s.headerAccent} />
        <div style={s.headerContent}>
          <div>
            <h1 style={s.headerTitle}>Lineup Builder</h1>
            <p style={s.headerSub}>Dark Brown Padres · AI Game Planner</p>
          </div>
          <div style={{display:'flex',gap:'10px',alignItems:'center'}}>
            <a href="/grades" style={s.navBtn}>⭐ Grades</a>
            <a href="/dashboard" style={s.navBtn}>← Dashboard</a>
          </div>
        </div>
      </header>

      <main style={s.main}>
        {/* === SETUP PANEL === */}
        <div style={s.card} className="no-print">
          <div style={s.cardHeader}><span style={s.cardTitle}>Game Setup</span></div>
          <div style={{padding:'18px'}}>
            {/* Row 1: game details */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 2fr auto auto',gap:'14px',marginBottom:'14px'}}>
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
                <label style={s.label}>Home/Away</label>
                <div style={s.toggle}>
                  {['home','away'].map(v=><button key={v} onClick={()=>setHomeAway(v)} style={{...s.toggleBtn,...(homeAway===v?s.toggleBtnActive:{})}}>{v==='home'?'🏠':'✈️'} {v}</button>)}
                </div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Innings</label>
                <input type="number" min={3} max={7} value={innings} onChange={e=>setInnings(+e.target.value)} style={{...s.input,width:'70px'}} />
              </div>
            </div>

            {/* Row 2: team player availability */}
            <div style={{marginBottom:'14px'}}>
              <label style={s.label}>Team Availability — mark absent players ❌ ({activePlayers.filter(p=>!p.isPool).length} of {allPlayers.length} available)</label>
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'6px'}}>
                {allPlayers.map(p => {
                  const avail = availability[p.name]
                  return (
                    <button key={p.name}
                      onClick={() => setAvailability(prev => ({...prev,[p.name]:{available:!prev[p.name]?.available}}))}
                      style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',
                        background:avail?.available?'#edf7ee':'#fdf0f0',
                        border:`1.5px solid ${avail?.available?'#1e6b2e':'#a82020'}`,
                        borderRadius:'8px',cursor:'pointer'}}>
                      <span style={{fontSize:'13px'}}>{avail?.available ? '✅' : '❌'}</span>
                      <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',color:'#2c1505'}}>
                        {p.number && <span style={{color:'#c8922a'}}>#{p.number} </span>}
                        {p.name.split(' ').slice(-1)[0]}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Row 2b: pool players for THIS game */}
            <div style={{marginBottom:'14px'}}>
              <label style={s.label}>🟣 Pool Players — add game-day pool players only</label>
              <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'6px',flexWrap:'wrap'}}>
                {poolPlayers.map((p, i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',background:'#f3e5f5',border:'1.5px solid #7b1fa2',borderRadius:'8px'}}>
                    <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',color:'#4a148c'}}>
                      {p.number && <span style={{color:'#7b1fa2'}}>#{p.number} </span>}{p.name}
                    </span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:'9px',background:'#7b1fa2',color:'white',padding:'1px 5px',borderRadius:'3px'}}>POOL</span>
                    <button onClick={() => setPoolPlayers(prev => prev.filter((_,j)=>j!==i))}
                      style={{background:'none',border:'none',cursor:'pointer',color:'#7b1fa2',fontSize:'14px',lineHeight:1,padding:'0 2px'}}>×</button>
                  </div>
                ))}
                <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                  <input value={poolInput.name} onChange={e=>setPoolInput(p=>({...p,name:e.target.value}))}
                    placeholder="Full name" style={{...s.input,padding:'6px 10px',fontSize:'13px',width:'160px'}} />
                  <input value={poolInput.number} onChange={e=>setPoolInput(p=>({...p,number:e.target.value}))}
                    placeholder="#" style={{...s.input,padding:'6px 8px',fontSize:'13px',width:'55px'}} />
                  <button onClick={() => {
                    if (!poolInput.name.trim()) return
                    setPoolPlayers(prev => [...prev, { name: poolInput.name.trim(), number: poolInput.number ? +poolInput.number : null }])
                    setPoolInput({ name:'', number:'' })
                  }} style={{padding:'6px 14px',background:'#7b1fa2',color:'white',border:'none',borderRadius:'7px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',cursor:'pointer'}}>
                    + Add
                  </button>
                </div>
              </div>
            </div>

            {/* Row 3: locks */}
            <div style={{marginBottom:'16px'}}>
              <label style={s.label}>Lock Positions (optional — AI will honor these)</label>
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'6px'}}>
                {activePlayers.map(p => (
                  <div key={p.name} style={{display:'flex',alignItems:'center',gap:'6px'}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#7a5c3e',minWidth:'80px'}}>{p.name.split(' ').slice(-1)[0]}</span>
                    <select value={lockedPositions[p.name] || ''} onChange={e => {
                      const v = e.target.value
                      setLockedPositions(prev => { const n={...prev}; if(v) n[p.name]=v; else delete n[p.name]; return n })
                    }} style={{...s.input,padding:'4px 6px',fontSize:'12px',width:'70px'}}>
                      <option value="">Free</option>
                      {POSITIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={generateLineup} disabled={generating}
              style={{...s.generateBtn, opacity:generating?0.6:1}}>
              {generating ? <><span style={{display:'inline-block',width:'16px',height:'16px',border:'2px solid rgba(247,240,230,0.3)',borderTop:'2px solid #f7f0e6',borderRadius:'50%',animation:'spin 0.7s linear infinite',marginRight:'8px',verticalAlign:'middle'}}></span>Generating...</> : '🤖 Generate AI Lineup'}
            </button>
          </div>
        </div>

        {/* === LINEUP RESULT === */}
        {lineupPlan && (
          <>
            {/* AI Reasoning */}
            <div style={s.card} className="no-print">
              <div style={s.cardHeader}>
                <span style={s.cardTitle}>🤖 AI Game Plan</span>
                <div style={{display:'flex',gap:'8px',marginLeft:'auto'}}>
                  <button onClick={() => setEditMode(v=>!v)} style={{...s.actionBtn, background:editMode?'#c8922a':'rgba(247,240,230,0.1)'}}>
                    {editMode ? '✏️ Editing' : '✏️ Edit'}
                  </button>
                  <button onClick={savePlan} disabled={saving} style={s.actionBtn}>
                    {saving ? '...' : '💾 Save'}
                  </button>
                  <button onClick={() => window.print()} style={s.actionBtn}>🖨️ Print</button>
                </div>
              </div>
              <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:'12px'}}>
                <div style={s.reasoningBox}>
                  <div style={s.reasoningLabel}>Overall Strategy</div>
                  <p style={s.reasoningText}>{lineupPlan.overall_reasoning}</p>
                </div>
                <div style={s.reasoningBox}>
                  <div style={s.reasoningLabel}>⚾ Pitching Plan</div>
                  <p style={s.reasoningText}>{lineupPlan.pitching_plan}</p>
                </div>
                <div style={s.reasoningBox}>
                  <div style={s.reasoningLabel}>📋 Batting Order Reasoning</div>
                  <p style={s.reasoningText}>{lineupPlan.batting_reasoning}</p>
                </div>
                <div style={s.reasoningBox}>
                  <div style={s.reasoningLabel}>✅ Compliance</div>
                  <p style={s.reasoningText}>{lineupPlan.compliance_notes}</p>
                </div>
              </div>
            </div>

            {/* Print-ready card (always rendered, hidden on screen) */}
            <div className="print-page" style={{display:'none'}}>
              <PrintCard lineupPlan={lineupPlan} gameDate={gameDate} opponent={opponent} homeAway={homeAway} innings={innings} allPlayers={allPlayers} />
            </div>

            {/* Batting order + position grid */}
            <div style={{display:'grid',gridTemplateColumns:'240px 1fr',gap:'16px'}} className="no-print">
              {/* Batting order */}
              <div style={s.card}>
                <div style={s.cardHeader}><span style={s.cardTitle}>Batting Order</span></div>
                <div style={{padding:'10px'}}>
                  {lineupPlan.batting_order.map((name, i) => {
                    const p = allPlayers.find(x => x.name === name)
                    const stats = null // could add OBP here later
                    return (
                      <div key={name} style={s.batterRow}>
                        <span style={s.batterNum}>{i+1}</span>
                        <div style={s.batterInfo}>
                          {p?.number && <span style={{color:'#c8922a',fontSize:'11px'}}>#{p.number} </span>}
                          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'15px',color:'#2c1505'}}>
                            {name.split(' ').slice(-1)[0]}, {name.split(' ')[0]}
                          </span>
                          {availability[name]?.isPool && <span style={{background:'#7b1fa2',color:'white',fontSize:'9px',padding:'1px 5px',borderRadius:'3px',marginLeft:'4px',fontFamily:"'DM Mono',monospace"}}>POOL</span>}
                        </div>
                        {editMode && i > 0 && (
                          <button onClick={() => moveBatter(i, i-1)} style={s.moveBtn}>↑</button>
                        )}
                        {editMode && i < lineupPlan.batting_order.length-1 && (
                          <button onClick={() => moveBatter(i, i+1)} style={s.moveBtn}>↓</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Position grid */}
              <div style={s.card}>
                <div style={s.cardHeader}>
                  <span style={s.cardTitle}>Positions by Inning</span>
                  <div style={{display:'flex',gap:'4px',marginLeft:'auto'}}>
                    {lineupPlan.innings.map(inn => (
                      <button key={inn.inning} onClick={() => setActiveInning(inn.inning)}
                        style={{...s.innBtn, ...(activeInning===inn.inning?s.innBtnActive:{})}}>
                        Inn {inn.inning}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{padding:'12px'}}>
                  {/* Changes note */}
                  {currentInning?.changes_from_previous && (
                    <div style={{background:'#fdf6e8',border:'1px solid #c8922a',borderRadius:'7px',padding:'8px 12px',marginBottom:'10px',fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#7a5c3e'}}>
                      <strong style={{color:'#c8922a'}}>Changes: </strong>{currentInning.changes_from_previous}
                    </div>
                  )}
                  {currentInning?.inning_reasoning && (
                    <div style={{background:'#f7f0e6',borderRadius:'7px',padding:'8px 12px',marginBottom:'10px',fontFamily:"'Barlow',sans-serif",fontSize:'13px',color:'#5a3e28',fontStyle:'italic'}}>
                      {currentInning.inning_reasoning}
                    </div>
                  )}
                  {/* Position table */}
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <tbody>
                      {POSITIONS.map(pos => {
                        const playerName = currentInning?.assignments?.[pos] || '—'
                        const p = allPlayers.find(x => x.name === playerName)
                        return (
                          <tr key={pos} style={{background:'white',borderBottom:'1px solid rgba(44,21,5,0.06)'}}>
                            <td style={{padding:'7px 10px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'14px',color:'#c8922a',width:'40px'}}>{pos}</td>
                            <td style={{padding:'7px 10px',fontFamily:"'Barlow',sans-serif",fontSize:'14px',color:'#2c1505',fontWeight:600}}>
                              {p?.number && <span style={{color:'#c8922a',marginRight:'4px'}}>#{p.number}</span>}
                              {playerName}
                            </td>
                            {editMode && (
                              <td style={{padding:'4px 8px',width:'160px'}}>
                                <select value={playerName}
                                  onChange={e => updatePosition(activeInning-1, pos, e.target.value)}
                                  style={{...s.input,padding:'4px 6px',fontSize:'12px',width:'100%'}}>
                                  {activePlayers.map(ap => <option key={ap.name} value={ap.name}>{ap.name}</option>)}
                                </select>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Field Maps */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'16px',marginTop:'0'}} className="no-print">
              {lineupPlan.innings.map(inn => (
                <div key={inn.inning} style={s.card}>
                  <div style={s.cardHeader}><span style={s.cardTitle}>Inning {inn.inning} Field Map</span></div>
                  <div style={{padding:'12px'}}>
                    <FieldMap assignments={inn.assignments} players={allPlayers} />
                    {inn.changes_from_previous && inn.inning > 1 && (
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e',marginTop:'8px',lineHeight:1.4}}>
                        <strong>Changes: </strong>{inn.changes_from_previous}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ─── FIELD MAP SVG ────────────────────────────────────────────────────────────
function FieldMap({ assignments, players }) {
  if (!assignments) return null
  return (
    <svg viewBox="0 0 300 280" style={{width:'100%',height:'auto',background:'#2d5a1b',borderRadius:'8px'}}>
      {/* Outfield arc */}
      <path d="M 20 260 Q 150 10 280 260" fill="none" stroke="#4a8c35" strokeWidth="2"/>
      {/* Infield diamond */}
      <polygon points="150,220 210,160 150,100 90,160" fill="none" stroke="#8fbc5a" strokeWidth="2"/>
      {/* Pitcher mound */}
      <circle cx="150" cy="160" r="8" fill="#8fbc5a"/>
      {/* Home plate */}
      <polygon points="150,240 143,247 143,255 157,255 157,247" fill="white"/>
      {/* Base squares */}
      <rect x="202" y="152" width="16" height="16" fill="white" transform="rotate(45,210,160)"/>
      <rect x="142" y="92" width="16" height="16" fill="white" transform="rotate(45,150,100)"/>
      <rect x="82" y="152" width="16" height="16" fill="white" transform="rotate(45,90,160)"/>
      {/* Players */}
      {Object.entries(FIELD_COORDS).map(([pos, coord]) => {
        const playerName = assignments[pos]
        if (!playerName) return null
        const p = players.find(x => x.name === playerName)
        const displayName = playerName.split(' ').slice(-1)[0]
        const numStr = p?.number ? `#${p.number}` : ''
        return (
          <g key={pos}>
            <circle cx={coord.x} cy={coord.y} r="18" fill="rgba(44,21,5,0.85)" stroke="#c8922a" strokeWidth="1.5"/>
            <text x={coord.x} y={coord.y - 4} textAnchor="middle" fill="#c8922a" fontSize="8" fontFamily="'DM Mono',monospace" fontWeight="bold">{pos}</text>
            <text x={coord.x} y={coord.y + 5} textAnchor="middle" fill="white" fontSize="7.5" fontFamily="sans-serif" fontWeight="bold">{displayName}</text>
            {numStr && <text x={coord.x} y={coord.y + 14} textAnchor="middle" fill="rgba(247,240,230,0.6)" fontSize="6.5" fontFamily="'DM Mono',monospace">{numStr}</text>}
          </g>
        )
      })}
    </svg>
  )
}

// ─── PRINT CARD ───────────────────────────────────────────────────────────────
function PrintCard({ lineupPlan, gameDate, opponent, homeAway, innings, allPlayers = [] }) {
  if (!lineupPlan) return null

  return (
    <div style={{fontFamily:"'Barlow Condensed',sans-serif",padding:'0.15in',width:'100%',background:'white'}}>
      {/* Header */}
      <div style={{background:'#2c1505',color:'#FFD54F',padding:'8px 16px',borderRadius:'8px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
        <div>
          <div style={{fontSize:'22px',fontWeight:900,letterSpacing:'0.5px'}}>⚾ Dark Brown Padres vs {opponent}</div>
          <div style={{fontSize:'11px',color:'#FFECB3'}}>SNLL Minor B · {gameDate} · {homeAway.toUpperCase()} · {innings} Innings</div>
        </div>
      </div>

      {/* Batting order + innings grid side by side */}
      <div style={{display:'grid',gridTemplateColumns:'180px 1fr',gap:'8px',marginBottom:'8px'}}>
        {/* Batting order */}
        <div style={{border:'2px solid #2c1505',borderRadius:'6px',overflow:'hidden'}}>
          <div style={{background:'#2c1505',color:'#FFD54F',padding:'4px 8px',fontSize:'13px',fontWeight:800,textTransform:'uppercase'}}>Batting Order</div>
          {lineupPlan.batting_order.map((name, i) => (
            <div key={i} style={{display:'flex',gap:'8px',padding:'4px 8px',borderBottom:'1px solid #f0e8dc',background:i%2===0?'white':'#fafaf8'}}>
              <span style={{fontWeight:800,color:'#c8922a',minWidth:'16px'}}>{i+1}</span>
              <span style={{fontSize:'14px',fontWeight:700}}>{name}</span>
            </div>
          ))}
        </div>

        {/* Position grid */}
        <div style={{border:'2px solid #2c1505',borderRadius:'6px',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#2c1505'}}>
                <th style={{color:'#FFD54F',padding:'4px 8px',fontSize:'12px',textAlign:'left'}}>POS</th>
                {lineupPlan.innings.map(inn => <th key={inn.inning} style={{color:'#FFD54F',padding:'4px 8px',fontSize:'12px',textAlign:'center'}}>INN {inn.inning}</th>)}
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((pos, ri) => (
                <tr key={pos} style={{background:ri%2===0?'white':'#fafaf8'}}>
                  <td style={{padding:'5px 8px',fontWeight:800,color:'#c8922a',fontSize:'13px'}}>{pos}</td>
                  {lineupPlan.innings.map(inn => (
                    <td key={inn.inning} style={{padding:'5px 8px',fontSize:'13px',fontWeight:600,textAlign:'center'}}>
                      {inn.assignments?.[pos] ? inn.assignments[pos].split(' ').slice(-1)[0] : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field maps row */}
      <div style={{display:'grid',gridTemplateColumns:`repeat(${innings},1fr)`,gap:'6px'}}>
        {lineupPlan.innings.map(inn => (
          <div key={inn.inning} style={{border:'2px solid #2c1505',borderRadius:'6px',overflow:'hidden'}}>
            <div style={{background:'#2c1505',color:'#FFD54F',padding:'3px 8px',fontSize:'11px',fontWeight:800,textTransform:'uppercase'}}>Inning {inn.inning}</div>
            <FieldMap assignments={inn.assignments} players={allPlayers} />
          </div>
        ))}
      </div>

      {/* Notes row */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'6px',marginTop:'6px'}}>
        <div style={{border:'2px solid #5D4037',borderRadius:'6px',padding:'6px 8px'}}>
          <div style={{fontWeight:800,fontSize:'11px',marginBottom:'3px'}}>⚾ Pitching Plan</div>
          <div style={{fontSize:'10px',lineHeight:1.4,color:'#3E2723'}}>{lineupPlan.pitching_plan}</div>
        </div>
        <div style={{border:'2px solid #5D4037',borderRadius:'6px',padding:'6px 8px'}}>
          <div style={{fontWeight:800,fontSize:'11px',marginBottom:'3px'}}>🎯 Strategy</div>
          <div style={{fontSize:'10px',lineHeight:1.4,color:'#3E2723'}}>{lineupPlan.overall_reasoning}</div>
        </div>
        <div style={{border:'2px solid #5D4037',borderRadius:'6px',padding:'6px 8px'}}>
          <div style={{fontWeight:800,fontSize:'11px',marginBottom:'3px'}}>✅ Compliance</div>
          <div style={{fontSize:'10px',lineHeight:1.4,color:'#3E2723'}}>{lineupPlan.compliance_notes}</div>
        </div>
      </div>
    </div>
  )
}

const s = {
  page:{minHeight:'100vh',background:'var(--cream)',display:'flex',flexDirection:'column'},
  header:{background:'#2c1505',borderBottom:'3px solid #c8922a',position:'sticky',top:0,zIndex:100},
  headerAccent:{height:'3px',background:'linear-gradient(90deg,#c8922a,#f0b830,#c8922a)'},
  headerContent:{padding:'12px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'},
  headerTitle:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:'18px',color:'#f7f0e6',textTransform:'uppercase',letterSpacing:'0.05em',lineHeight:1},
  headerSub:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#c8922a',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:'3px'},
  navBtn:{padding:'6px 14px',background:'rgba(247,240,230,0.08)',border:'1px solid rgba(247,240,230,0.15)',borderRadius:'6px',color:'rgba(247,240,230,0.7)',fontFamily:"'Barlow',sans-serif",fontSize:'12px',textDecoration:'none'},
  main:{flex:1,padding:'24px',maxWidth:'1100px',width:'100%',margin:'0 auto',display:'flex',flexDirection:'column',gap:'16px'},
  card:{background:'white',border:'1px solid rgba(44,21,5,0.1)',borderRadius:'12px',overflow:'hidden',boxShadow:'0 2px 12px rgba(44,21,5,0.06)'},
  cardHeader:{padding:'12px 18px',background:'#2c1505',display:'flex',alignItems:'center'},
  cardTitle:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',textTransform:'uppercase',letterSpacing:'0.1em',color:'#f7f0e6'},
  field:{display:'flex',flexDirection:'column',gap:'5px'},
  label:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em'},
  input:{padding:'9px 12px',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontSize:'14px',fontFamily:"'Barlow',sans-serif",color:'#1a0e06',background:'#f7f0e6',outline:'none'},
  toggle:{display:'flex',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',overflow:'hidden'},
  toggleBtn:{flex:1,padding:'9px 10px',background:'#f7f0e6',border:'none',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'12px',cursor:'pointer',color:'#7a5c3e',whiteSpace:'nowrap'},
  toggleBtnActive:{background:'#2c1505',color:'#f7f0e6'},
  generateBtn:{width:'100%',padding:'14px',background:'linear-gradient(135deg,#2c1505,#5a3a1a)',color:'#f7f0e6',border:'2px solid #c8922a',borderRadius:'10px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:'18px',textTransform:'uppercase',letterSpacing:'0.12em',cursor:'pointer'},
  reasoningBox:{background:'#f7f0e6',borderRadius:'8px',padding:'12px 14px'},
  reasoningLabel:{fontFamily:"'DM Mono',monospace",fontSize:'9px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:'5px'},
  reasoningText:{fontFamily:"'Barlow',sans-serif",fontSize:'13px',color:'#2c1505',lineHeight:1.6,margin:0},
  actionBtn:{padding:'6px 14px',background:'rgba(247,240,230,0.1)',border:'1px solid rgba(247,240,230,0.2)',borderRadius:'6px',color:'rgba(247,240,230,0.8)',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',textTransform:'uppercase',cursor:'pointer',letterSpacing:'0.06em'},
  batterRow:{display:'flex',alignItems:'center',gap:'8px',padding:'7px 8px',borderBottom:'1px solid rgba(44,21,5,0.06)'},
  batterNum:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:'18px',color:'#c8922a',minWidth:'22px',textAlign:'center'},
  batterInfo:{flex:1},
  moveBtn:{background:'none',border:'1px solid rgba(44,21,5,0.12)',borderRadius:'4px',cursor:'pointer',fontSize:'12px',padding:'2px 6px',color:'#7a5c3e'},
  innBtn:{padding:'5px 10px',background:'rgba(247,240,230,0.1)',border:'1px solid rgba(247,240,230,0.15)',borderRadius:'5px',color:'rgba(247,240,230,0.6)',fontFamily:"'DM Mono',monospace",fontSize:'11px',cursor:'pointer'},
  innBtnActive:{background:'#c8922a',color:'#2c1505',border:'1px solid #c8922a',fontWeight:700},
}
