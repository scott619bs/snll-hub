'use client'

import { useState, useEffect } from 'react'
import { createClient, getRole } from '../../lib/supabase'
import { aiClassify, writeToProduction, sbUpdate, SUPABASE_URL, SERVICE_KEY } from '../../lib/classify'

const STATUS_COLORS = { pending: '#c8922a', confirmed: '#1e6b2e', rejected: '#a82020' }
const STATUS_BG = { pending: '#fdf6e8', confirmed: '#edf7ee', rejected: '#fdf0f0' }

export default function AdminPage() {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/'; return }
      const r = getRole(user.email)
      if (r !== 'coach') { window.location.href = '/dashboard'; return }
      setUser(user)
      setRole(r)
      fetchItems()
    })
  }, [])

  async function fetchItems(statusFilter = 'pending') {
    setLoading(true)
    const url = `${SUPABASE_URL}/rest/v1/import_staging?order=created_at.desc&limit=50${statusFilter !== 'all' ? `&status=eq.${statusFilter}` : ''}`
    const resp = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } })
    const data = await resp.json()
    setItems(data || [])
    setLoading(false)
  }

  function handleFilterChange(f) {
    setFilter(f)
    fetchItems(f)
  }

  if (loading && !user) return (
    <div style={s.loadingPage}>
      <div style={s.spinner} />
      <p style={s.loadingText}>Loading admin...</p>
    </div>
  )

  const pending = items.filter(i => i.status === 'pending').length

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.headerAccent} />
        <div style={s.headerContent}>
          <div>
            <h1 style={s.headerTitle}>Admin — Import Review</h1>
            <p style={s.headerSub}>Dark Brown Padres · Stats Staging Queue</p>
          </div>
          <div style={s.headerRight}>
            <a href="/dashboard" style={s.backBtn}>← Dashboard</a>
          </div>
        </div>
      </header>

      <main style={s.main}>
        {/* Filter tabs */}
        <div style={s.filterRow}>
          {['pending','confirmed','rejected','all'].map(f => (
            <button key={f} onClick={() => handleFilterChange(f)} style={{...s.filterBtn, ...(filter===f?s.filterBtnActive:{})}}>
              {f.charAt(0).toUpperCase()+f.slice(1)}
              {f === 'pending' && pending > 0 && <span style={s.badge}>{pending}</span>}
            </button>
          ))}
          <button onClick={() => fetchItems(filter)} style={s.refreshBtn}>↻ Refresh</button>
        </div>

        {loading ? (
          <div style={{textAlign:'center',padding:'40px',color:'#7a5c3e',fontFamily:"'DM Mono',monospace",fontSize:'12px'}}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={s.emptyState}>
            <div style={{fontSize:'40px',marginBottom:'12px'}}>✅</div>
            <p style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'18px',color:'#2c1505'}}>
              {filter === 'pending' ? 'No items pending review' : `No ${filter} items`}
            </p>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
            {items.map(item => (
              <StagingCard
                key={item.id}
                item={item}
                onUpdate={() => fetchItems(filter)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function StagingCard({ item, onUpdate }) {
  const [expanded, setExpanded] = useState(item.status === 'pending')
  const [message, setMessage] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [working, setWorking] = useState(false)
  const [localItem, setLocalItem] = useState(item)
  const [reanalyzed, setReanalyzed] = useState(false)

  const ex = localItem.extracted_json || {}
  const totalRows = [
    ...(ex.batting_stats||[]),
    ...(ex.pitching_stats||[]),
    ...(ex.fielding_stats||[]),
    ...(ex.innings_played||[])
  ].length

  async function handleReanalyze() {
    if (!apiKey) { alert('Enter API key first'); return }
    setWorking(true)
    try {
      const isImage = localItem.source_type === 'image'
      const input = isImage
        ? { data: localItem.raw_input, mimeType: localItem.image_mime_type }
        : localItem.raw_input

      const result = await aiClassify(
        apiKey, input, localItem.source_type,
        localItem.game_date, localItem.opponent, message
      )

      // Append to review history
      const history = [...(localItem.review_history || []), {
        ts: new Date().toISOString(),
        note: message,
        previous_classification: localItem.classification,
        new_classification: result.classification,
        new_confidence: result.confidence,
      }]

      await sbUpdate('import_staging', localItem.id, {
        classification: result.classification,
        confidence: result.confidence,
        classification_reason: result.reason,
        extracted_json: result,
        review_history: history,
        updated_at: new Date().toISOString(),
      })

      setLocalItem(prev => ({
        ...prev,
        classification: result.classification,
        confidence: result.confidence,
        classification_reason: result.reason,
        extracted_json: result,
        review_history: history,
      }))
      setMessage('')
      setReanalyzed(true)
    } catch(err) { alert('Re-analyze error: ' + err.message) }
    setWorking(false)
  }

  async function handleConfirm() {
    setWorking(true)
    try {
      const results = await writeToProduction(
        localItem.extracted_json,
        localItem.game_date,
        localItem.opponent
      )

      await sbUpdate('import_staging', localItem.id, {
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        admin_notes: message || localItem.admin_notes,
        updated_at: new Date().toISOString(),
      })

      setLocalItem(prev => ({...prev, status: 'confirmed'}))
      onUpdate()
    } catch(err) { alert('Confirm error: ' + err.message) }
    setWorking(false)
  }

  async function handleReject() {
    setWorking(true)
    await sbUpdate('import_staging', localItem.id, {
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      admin_notes: message || 'Rejected by admin',
      updated_at: new Date().toISOString(),
    })
    setLocalItem(prev => ({...prev, status: 'rejected'}))
    onUpdate()
    setWorking(false)
  }

  const conf = localItem.confidence
  const confColor = { high: '#1e6b2e', medium: '#8a6000', low: '#a82020' }[conf] || '#7a5c3e'

  return (
    <div style={{...s.card, borderLeft: `4px solid ${STATUS_COLORS[localItem.status]}`}}>
      {/* Card header */}
      <div style={s.cardTop} onClick={() => setExpanded(v => !v)}>
        <div style={{display:'flex',alignItems:'center',gap:'12px',flex:1,flexWrap:'wrap'}}>
          <span style={{...s.statusPill, background: STATUS_BG[localItem.status], color: STATUS_COLORS[localItem.status]}}>
            {localItem.status.toUpperCase()}
          </span>
          <span style={s.classLabel}>{localItem.classification?.toUpperCase() || 'UNKNOWN'}</span>
          <span style={{...s.confLabel, color: confColor}}>
            {conf?.toUpperCase()} CONFIDENCE
          </span>
          <span style={s.metaLabel}>
            {localItem.source_type === 'image' ? '📸 Image' : '📋 CSV'} · {localItem.game_date} vs {localItem.opponent} · {totalRows} rows
          </span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <span style={s.ts}>{new Date(localItem.created_at).toLocaleString()}</span>
          <span style={{color:'#7a5c3e',fontSize:'18px'}}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={s.cardBody}>
          {/* Classification reason */}
          <div style={s.reasonBox}>
            <span style={s.reasonLabel}>Classification Reason</span>
            <p style={s.reasonText}>{localItem.classification_reason}</p>
          </div>

          {/* Data preview */}
          <PreviewSection extracted={localItem.extracted_json} />

          {/* Review history */}
          {(localItem.review_history || []).length > 0 && (
            <div style={s.historyBox}>
              <div style={s.sectionLabel}>Review History</div>
              {localItem.review_history.map((h, i) => (
                <div key={i} style={s.historyRow}>
                  <span style={s.historyTs}>{new Date(h.ts).toLocaleTimeString()}</span>
                  <span style={s.historyText}>
                    {h.previous_classification} → {h.new_classification} ({h.new_confidence})
                    {h.note && ` · "${h.note}"`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Admin actions (only for pending) */}
          {localItem.status === 'pending' && (
            <div style={s.actionBox}>
              <div style={s.sectionLabel}>Admin Review</div>

              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                <div>
                  <label style={s.label}>Correction Notes (optional — sent to AI on re-analyze)</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="e.g. 'This is pitching data for the opponent team, not Myers' or 'The player numbers are wrong'"
                    rows={3}
                    style={s.msgTextarea}
                  />
                </div>

                <div>
                  <label style={s.label}>Anthropic API Key (required for re-analyze)</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    style={s.inputSmall}
                  />
                </div>

                <div style={s.btnRow}>
                  <button onClick={handleReanalyze} disabled={working || !apiKey} style={{...s.btnSecondary, opacity:(!apiKey||working)?0.4:1}}>
                    {working ? '...' : '🔄 Re-analyze'}
                  </button>
                  <button onClick={handleConfirm} disabled={working} style={{...s.btnConfirm, opacity:working?0.4:1}}>
                    {working ? '...' : '✓ Confirm & Write to DB'}
                  </button>
                  <button onClick={handleReject} disabled={working} style={{...s.btnReject, opacity:working?0.4:1}}>
                    {working ? '...' : '✕ Reject'}
                  </button>
                </div>

                {reanalyzed && (
                  <div style={{background:'#edf7ee',border:'1px solid #1e6b2e',borderRadius:'7px',padding:'10px 14px',fontFamily:"'DM Mono',monospace",fontSize:'12px',color:'#1e6b2e'}}>
                    ✓ Re-analyzed — review the updated data above, then confirm or reject.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PreviewSection({ extracted }) {
  if (!extracted) return null
  const sections = [
    { key: 'batting_stats', label: 'Batting', cols: ['player_name','pa','ab','h','rbi','bb','so','sb'] },
    { key: 'pitching_stats', label: 'Pitching', cols: ['player_name','ip','bf','total_pitches','h','r','er','bb','so'] },
    { key: 'fielding_stats', label: 'Fielding', cols: ['player_name','tc','assists','po','errors','fpct'] },
    { key: 'innings_played', label: 'Innings Played', cols: ['player_name','position','innings'] },
  ]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {sections.map(sec => {
        const rows = extracted[sec.key] || []
        if (rows.length === 0) return null
        return (
          <div key={sec.key}>
            <div style={s.sectionLabel}>{sec.label} ({rows.length} rows)</div>
            <div style={{overflowX:'auto'}}>
              <table style={s.table}>
                <thead>
                  <tr>{sec.cols.map(c => <th key={c} style={s.th}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} style={{background: i%2===0?'white':'#fafaf8'}}>
                      {sec.cols.map(c => <td key={c} style={s.td}>{row[c] ?? '—'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const s = {
  page:{minHeight:'100vh',background:'var(--cream)',display:'flex',flexDirection:'column'},
  loadingPage:{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'16px'},
  spinner:{width:'32px',height:'32px',border:'3px solid rgba(44,21,5,0.1)',borderTop:'3px solid #2c1505',borderRadius:'50%',animation:'spin 0.7s linear infinite'},
  loadingText:{fontFamily:"'DM Mono',monospace",fontSize:'12px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em'},
  header:{background:'#2c1505',borderBottom:'3px solid #c8922a',position:'sticky',top:0,zIndex:100},
  headerAccent:{height:'3px',background:'linear-gradient(90deg,#c8922a,#f0b830,#c8922a)'},
  headerContent:{padding:'12px 24px',display:'flex',alignItems:'center',justifyContent:'space-between'},
  headerTitle:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:900,fontSize:'18px',color:'#f7f0e6',textTransform:'uppercase',letterSpacing:'0.05em',lineHeight:1},
  headerSub:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#c8922a',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:'3px'},
  headerRight:{display:'flex',gap:'12px'},
  backBtn:{padding:'6px 14px',background:'rgba(247,240,230,0.08)',border:'1px solid rgba(247,240,230,0.15)',borderRadius:'6px',color:'rgba(247,240,230,0.7)',fontFamily:"'Barlow',sans-serif",fontSize:'12px',textDecoration:'none'},
  main:{flex:1,padding:'24px',maxWidth:'1000px',width:'100%',margin:'0 auto'},
  filterRow:{display:'flex',gap:'8px',marginBottom:'20px',alignItems:'center',flexWrap:'wrap'},
  filterBtn:{padding:'7px 16px',background:'white',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'13px',textTransform:'uppercase',letterSpacing:'0.06em',color:'#7a5c3e',cursor:'pointer',display:'flex',alignItems:'center',gap:'6px'},
  filterBtnActive:{background:'#2c1505',color:'#f7f0e6',borderColor:'#2c1505'},
  refreshBtn:{marginLeft:'auto',padding:'7px 14px',background:'none',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontFamily:"'DM Mono',monospace",fontSize:'12px',color:'#7a5c3e',cursor:'pointer'},
  badge:{background:'#c8922a',color:'white',borderRadius:'10px',padding:'1px 6px',fontSize:'10px',fontFamily:"'DM Mono',monospace"},
  emptyState:{textAlign:'center',padding:'60px 20px',color:'#7a5c3e'},
  card:{background:'white',border:'1px solid rgba(44,21,5,0.1)',borderRadius:'12px',overflow:'hidden',boxShadow:'0 2px 12px rgba(44,21,5,0.06)'},
  cardTop:{padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',gap:'12px',background:'white'},
  cardBody:{padding:'18px',borderTop:'1px solid rgba(44,21,5,0.08)',display:'flex',flexDirection:'column',gap:'16px'},
  statusPill:{padding:'3px 9px',borderRadius:'5px',fontFamily:"'DM Mono',monospace",fontSize:'10px',fontWeight:500,letterSpacing:'0.06em'},
  classLabel:{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'15px',color:'#2c1505',letterSpacing:'0.04em'},
  confLabel:{fontFamily:"'DM Mono',monospace",fontSize:'10px',letterSpacing:'0.06em'},
  metaLabel:{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#7a5c3e'},
  ts:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#aaa'},
  reasonBox:{background:'#f7f0e6',borderRadius:'8px',padding:'12px 14px'},
  reasonLabel:{fontFamily:"'DM Mono',monospace",fontSize:'9px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em',display:'block',marginBottom:'5px'},
  reasonText:{fontFamily:"'Barlow',sans-serif",fontSize:'13px',color:'#2c1505',lineHeight:1.5,margin:0},
  sectionLabel:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:'8px'},
  table:{width:'100%',borderCollapse:'collapse',fontSize:'12px',fontFamily:"'DM Mono',monospace"},
  th:{padding:'6px 10px',background:'#2c1505',color:'#c8922a',textAlign:'left',fontSize:'10px',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'},
  td:{padding:'6px 10px',borderBottom:'1px solid rgba(44,21,5,0.06)',whiteSpace:'nowrap',color:'#2c1505'},
  historyBox:{background:'#f7f0e6',borderRadius:'8px',padding:'12px 14px'},
  historyRow:{display:'flex',gap:'10px',marginTop:'6px'},
  historyTs:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#aaa',flexShrink:0},
  historyText:{fontFamily:"'DM Mono',monospace",fontSize:'11px',color:'#2c1505'},
  actionBox:{borderTop:'2px solid rgba(44,21,5,0.08)',paddingTop:'16px'},
  label:{fontFamily:"'DM Mono',monospace",fontSize:'10px',color:'#7a5c3e',textTransform:'uppercase',letterSpacing:'0.1em',display:'block',marginBottom:'5px'},
  msgTextarea:{width:'100%',padding:'10px 12px',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontSize:'13px',fontFamily:"'Barlow',sans-serif",color:'#1a0e06',background:'#f7f0e6',outline:'none',resize:'vertical',lineHeight:1.4},
  inputSmall:{width:'100%',padding:'8px 12px',border:'1.5px solid rgba(44,21,5,0.12)',borderRadius:'7px',fontSize:'13px',fontFamily:"'Barlow',sans-serif",color:'#1a0e06',background:'#f7f0e6',outline:'none'},
  btnRow:{display:'flex',gap:'10px',flexWrap:'wrap'},
  btnSecondary:{flex:1,padding:'11px',background:'#f7f0e6',border:'1.5px solid rgba(44,21,5,0.15)',borderRadius:'8px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'14px',textTransform:'uppercase',letterSpacing:'0.06em',color:'#2c1505',cursor:'pointer'},
  btnConfirm:{flex:2,padding:'11px',background:'#1e6b2e',border:'none',borderRadius:'8px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:'14px',textTransform:'uppercase',letterSpacing:'0.08em',color:'white',cursor:'pointer'},
  btnReject:{flex:1,padding:'11px',background:'#a82020',border:'none',borderRadius:'8px',fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:'14px',textTransform:'uppercase',letterSpacing:'0.06em',color:'white',cursor:'pointer'},
}
