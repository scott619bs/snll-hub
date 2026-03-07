'use client'

import { useState, useEffect } from 'react'
import { createClient, getRole } from '../../lib/supabase'
import StatsImport from './StatsImport'

const TABS = [
  { id: 'home', label: 'Home', icon: '🏠', coachOnly: false },
  { id: 'stats', label: 'Stats Import', icon: '⚾', coachOnly: true },
  { id: 'roster', label: 'Roster', icon: '📋', coachOnly: false },
  { id: 'schedule', label: 'Schedule', icon: '📅', coachOnly: false },
  { id: 'lineup', label: 'Lineup', icon: '📋', coachOnly: true, isLink: '/lineup' },
  { id: 'grades', label: 'Grades', icon: '⭐', coachOnly: true, isLink: '/grades' },
  { id: 'admin', label: 'Admin', icon: '🔐', coachOnly: true, isLink: '/admin' },
]

export default function Dashboard() {
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [activeTab, setActiveTab] = useState('home')
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState([])
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/'; return }
      const r = getRole(user.email)
      if (!r) { supabase.auth.signOut().then(() => { window.location.href = '/?error=unauthorized' }); return }
      setUser(user)
      setRole(r)
      setLoading(false)
      fetchSchedule()
    })
  }, [])

  async function fetchSchedule() {
    const { data } = await supabase
      .from('schedule')
      .select('*')
      .gte('event_date', new Date().toISOString().split('T')[0])
      .order('dtstart', { ascending: true })
      .limit(10)
    if (data) setSchedule(data)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (loading) return (
    <div style={s.loadingPage}>
      <div style={s.loadingSpinner} />
      <p style={s.loadingText}>Loading hub...</p>
    </div>
  )

  const visibleTabs = TABS.filter(t => !t.coachOnly || role === 'coach')

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.headerAccent} />
        <div style={s.headerContent}>
          <div>
            <h1 style={s.headerTitle}>Dark Brown Padres</h1>
            <p style={s.headerSub}>SNLL Minor B · Spring 2026</p>
          </div>
          <div style={s.headerRight}>
            <div style={s.userBadge}>
              <span style={s.rolePill}>{role === 'coach' ? '⚙ Coach' : '👤 Parent'}</span>
              <span style={s.userEmail}>{user?.email}</span>
            </div>
            <button onClick={signOut} style={s.signOutBtn}>Sign Out</button>
          </div>
        </div>
      </header>

      {/* Tab Nav */}
      <nav style={s.nav}>
        {visibleTabs.map(tab => tab.isLink ? (
          <a
            key={tab.id}
            href={tab.isLink}
            style={{...s.navTab, textDecoration:'none'}}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </a>
        ) : (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...s.navTab,
              ...(activeTab === tab.id ? s.navTabActive : {}),
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={s.main}>
        {activeTab === 'home' && <HomeTab role={role} schedule={schedule} setActiveTab={setActiveTab} />}
        {activeTab === 'stats' && role === 'coach' && <StatsImport />}
        {activeTab === 'roster' && <RosterTab />}
        {activeTab === 'schedule' && <ScheduleTab schedule={schedule} />}
      </main>
    </div>
  )
}

function HomeTab({ role, schedule, setActiveTab }) {
  const nextGame = schedule[0]

  return (
    <div style={s.homeGrid}>
      {/* Next game card */}
      <div style={s.card}>
        <div style={s.cardHeader}>
          <h3 style={s.cardTitle}>Next Game</h3>
          <span style={s.cardTag}>UPCOMING</span>
        </div>
        <div style={s.cardBody}>
          {nextGame ? (
            <div>
              <div style={s.gameDate}>
                {new Date(nextGame.dtstart).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <div style={s.gameTitle}>
                {nextGame.is_home_game ? 'vs' : '@'} {nextGame.opponent || nextGame.summary}
              </div>
              <div style={s.gameMeta}>
                {new Date(nextGame.dtstart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                {nextGame.location && ` · ${nextGame.location}`}
              </div>
              <div style={s.homeAwayBadge}>
                {nextGame.is_home_game ? '🏠 Home' : '✈️ Away'}
              </div>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No upcoming games found.</p>
          )}
        </div>
      </div>

      {/* Quick actions for coaches */}
      {role === 'coach' && (
        <div style={s.card}>
          <div style={s.cardHeader}>
            <h3 style={s.cardTitle}>Quick Actions</h3>
            <span style={s.cardTag}>COACH</span>
          </div>
          <div style={s.cardBody}>
            <div style={s.actionGrid}>
              <button onClick={() => setActiveTab('stats')} style={s.actionBtn}>
                <span style={s.actionIcon}>📤</span>
                <span style={s.actionLabel}>Import Game Stats</span>
              </button>
              <button onClick={() => setActiveTab('schedule')} style={s.actionBtn}>
                <span style={s.actionIcon}>📅</span>
                <span style={s.actionLabel}>View Schedule</span>
              </button>
              <button onClick={() => setActiveTab('roster')} style={s.actionBtn}>
                <span style={s.actionIcon}>📋</span>
                <span style={s.actionLabel}>Team Roster</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Season at a glance */}
      <div style={{ ...s.card, gridColumn: role === 'coach' ? 'span 1' : 'span 2' }}>
        <div style={s.cardHeader}>
          <h3 style={s.cardTitle}>Season Schedule</h3>
          <span style={s.cardTag}>{schedule.length} UPCOMING</span>
        </div>
        <div style={s.cardBody}>
          {schedule.slice(0, 5).map((game, i) => (
            <div key={i} style={s.scheduleRow}>
              <div style={s.scheduleDate}>
                {new Date(game.dtstart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div style={s.scheduleInfo}>
                <div style={s.scheduleTitle}>
                  {game.is_home_game ? 'vs' : '@'} {game.opponent || game.summary}
                </div>
                <div style={s.scheduleTime}>
                  {new Date(game.dtstart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
              <div style={{ ...s.scheduleHA, background: game.is_home_game ? '#edf7ee' : '#f7f0e6' }}>
                {game.is_home_game ? 'H' : 'A'}
              </div>
            </div>
          ))}
          {schedule.length > 5 && (
            <button onClick={() => {}} style={s.moreBtn}>
              +{schedule.length - 5} more games →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RosterTab() {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    // Pull from game_stats to get player list
    supabase
      .from('game_stats')
      .select('player_name, player_number')
      .eq('team_name', 'Myers')
      .order('player_number')
      .then(({ data }) => {
        if (data) {
          // Deduplicate
          const seen = new Set()
          const unique = data.filter(p => {
            if (seen.has(p.player_name)) return false
            seen.add(p.player_name)
            return true
          })
          setRoster(unique)
        }
        setLoading(false)
      })
  }, [])

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <h3 style={s.cardTitle}>Team Roster</h3>
        <span style={s.cardTag}>MINOR B</span>
      </div>
      <div style={s.cardBody}>
        {loading ? (
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Loading...</p>
        ) : roster.length > 0 ? (
          <div style={s.rosterGrid}>
            {roster.map((p, i) => (
              <div key={i} style={s.rosterCard}>
                <div style={s.rosterNum}>#{p.player_number ?? '—'}</div>
                <div style={s.rosterName}>{p.player_name}</div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
            No players found yet. Import game stats to populate the roster.
          </p>
        )}
      </div>
    </div>
  )
}

function ScheduleTab({ schedule }) {
  const supabase = createClient()
  const [all, setAll] = useState([])

  useEffect(() => {
    supabase
      .from('schedule')
      .select('*')
      .order('dtstart', { ascending: true })
      .then(({ data }) => { if (data) setAll(data) })
  }, [])

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <h3 style={s.cardTitle}>Full Season Schedule</h3>
        <span style={s.cardTag}>{all.length} GAMES</span>
      </div>
      <div style={s.cardBody}>
        {all.map((game, i) => {
          const isPast = new Date(game.dtstart) < new Date()
          return (
            <div key={i} style={{ ...s.scheduleRow, opacity: isPast ? 0.55 : 1 }}>
              <div style={s.scheduleDate}>
                {new Date(game.dtstart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <div style={s.scheduleInfo}>
                <div style={s.scheduleTitle}>
                  {game.is_home_game ? 'vs' : '@'} {game.opponent || game.summary}
                </div>
                <div style={s.scheduleTime}>
                  {new Date(game.dtstart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {game.location && ` · ${game.location}`}
                </div>
              </div>
              <div style={{ ...s.scheduleHA, background: game.is_home_game ? '#edf7ee' : '#f7f0e6' }}>
                {game.is_home_game ? 'H' : 'A'}
              </div>
              {isPast && <div style={s.pastBadge}>Final</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const s = {
  page: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cream)' },
  loadingPage: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' },
  loadingSpinner: { width: '32px', height: '32px', border: '3px solid rgba(44,21,5,0.1)', borderTop: '3px solid #2c1505', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },
  loadingText: { fontFamily: "'DM Mono', monospace", fontSize: '12px', color: '#7a5c3e', textTransform: 'uppercase', letterSpacing: '0.1em' },
  header: { background: '#2c1505', borderBottom: '3px solid #c8922a', position: 'sticky', top: 0, zIndex: 100 },
  headerAccent: { height: '3px', background: 'linear-gradient(90deg, #c8922a, #f0b830, #c8922a)' },
  headerContent: { padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
  headerTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: '18px', color: '#f7f0e6', textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 },
  headerSub: { fontFamily: "'DM Mono', monospace", fontSize: '10px', color: '#c8922a', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '3px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  userBadge: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' },
  rolePill: { background: 'rgba(200,146,42,0.2)', color: '#c8922a', padding: '2px 8px', borderRadius: '4px', fontFamily: "'DM Mono', monospace", fontSize: '10px', letterSpacing: '0.06em' },
  userEmail: { fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'rgba(247,240,230,0.5)', letterSpacing: '0.04em' },
  signOutBtn: { padding: '6px 14px', background: 'rgba(247,240,230,0.08)', border: '1px solid rgba(247,240,230,0.15)', borderRadius: '6px', color: 'rgba(247,240,230,0.7)', fontFamily: "'Barlow', sans-serif", fontSize: '12px', cursor: 'pointer' },
  nav: { background: 'white', borderBottom: '1px solid var(--border)', display: 'flex', padding: '0 24px', gap: '0', overflowX: 'auto' },
  navTab: { padding: '13px 18px', background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7a5c3e', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', transition: 'color 0.15s', marginBottom: '-1px' },
  navTabActive: { color: '#2c1505', borderBottomColor: '#c8922a' },
  main: { flex: 1, padding: '24px', maxWidth: '900px', width: '100%', margin: '0 auto' },
  homeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' },
  card: { background: 'white', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(44,21,5,0.06)' },
  cardHeader: { padding: '12px 18px', background: '#2c1505', display: 'flex', alignItems: 'center', gap: '10px' },
  cardTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#f7f0e6' },
  cardTag: { marginLeft: 'auto', background: 'rgba(200,146,42,0.2)', color: '#c8922a', padding: '2px 7px', borderRadius: '4px', fontFamily: "'DM Mono', monospace", fontSize: '9px', letterSpacing: '0.06em' },
  cardBody: { padding: '18px' },
  gameDate: { fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#7a5c3e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' },
  gameTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: '22px', color: '#2c1505', marginBottom: '4px' },
  gameMeta: { fontSize: '13px', color: '#7a5c3e', marginBottom: '10px' },
  homeAwayBadge: { display: 'inline-block', padding: '3px 10px', background: '#f7f0e6', border: '1px solid rgba(44,21,5,0.1)', borderRadius: '4px', fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#7a5c3e' },
  actionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' },
  actionBtn: { padding: '16px 8px', background: '#f7f0e6', border: '1.5px solid rgba(44,21,5,0.1)', borderRadius: '10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', transition: 'all 0.15s' },
  actionIcon: { fontSize: '24px' },
  actionLabel: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#2c1505', textAlign: 'center', lineHeight: 1.2 },
  scheduleRow: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' },
  scheduleDate: { fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#7a5c3e', width: '52px', flexShrink: 0 },
  scheduleInfo: { flex: 1 },
  scheduleTitle: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '15px', color: '#2c1505' },
  scheduleTime: { fontFamily: "'DM Mono', monospace", fontSize: '10px', color: '#7a5c3e', marginTop: '2px' },
  scheduleHA: { width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: '12px', color: '#2c1505', flexShrink: 0 },
  pastBadge: { fontFamily: "'DM Mono', monospace", fontSize: '9px', color: '#7a5c3e', background: '#ede4d6', padding: '2px 6px', borderRadius: '4px' },
  moreBtn: { marginTop: '10px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '13px', color: '#c8922a', letterSpacing: '0.06em' },
  rosterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' },
  rosterCard: { background: '#f7f0e6', border: '1px solid rgba(44,21,5,0.08)', borderRadius: '8px', padding: '12px', textAlign: 'center' },
  rosterNum: { fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontSize: '22px', color: '#c8922a', lineHeight: 1 },
  rosterName: { fontFamily: "'Barlow', sans-serif", fontWeight: 600, fontSize: '13px', color: '#2c1505', marginTop: '4px' },
}
