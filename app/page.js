'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | sent | error
  const [errorMsg, setErrorMsg] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('loading')
    setErrorMsg('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMsg(error.message)
    } else {
      setStatus('sent')
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.background} />

      <div style={styles.card}>
        <div style={styles.cardAccent} />

        <div style={styles.cardBody}>
          <div style={styles.logo}>
            <div style={styles.logoCircle}>DBP</div>
          </div>

          <h1 style={styles.title}>Dark Brown Padres</h1>
          <p style={styles.subtitle}>SNLL Minor B · Spring 2026 · Team Hub</p>

          {status !== 'sent' ? (
            <form onSubmit={handleLogin} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  style={styles.input}
                  autoFocus
                />
              </div>

              {status === 'error' && (
                <div style={styles.errorBox}>{errorMsg}</div>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || !email.trim()}
                style={{
                  ...styles.button,
                  opacity: (status === 'loading' || !email.trim()) ? 0.5 : 1,
                  cursor: (status === 'loading' || !email.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {status === 'loading' ? 'Sending…' : 'Send Login Link →'}
              </button>

              <p style={styles.hint}>
                We'll email you a magic link — no password needed.
                Tap the link to sign in instantly.
              </p>
            </form>
          ) : (
            <div style={styles.sentBox}>
              <div style={styles.sentIcon}>📬</div>
              <h2 style={styles.sentTitle}>Check your email</h2>
              <p style={styles.sentText}>
                We sent a login link to <strong>{email}</strong>.
                Tap it to access the hub.
              </p>
              <p style={styles.sentSub}>
                Link expires in 60 minutes. Check spam if you don't see it.
              </p>
              <button
                onClick={() => { setStatus('idle'); setEmail('') }}
                style={styles.resetBtn}
              >
                Use a different email
              </button>
            </div>
          )}
        </div>
      </div>

      <p style={styles.footer}>
        SNLL Minor B · Santee, CA · Coaches only access for stats import
      </p>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    position: 'relative',
  },
  background: {
    position: 'fixed',
    inset: 0,
    backgroundImage: `
      radial-gradient(circle at 20% 80%, rgba(200,146,42,0.08) 0%, transparent 50%),
      radial-gradient(circle at 80% 20%, rgba(44,21,5,0.06) 0%, transparent 50%)
    `,
    pointerEvents: 'none',
    zIndex: 0,
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 8px 40px rgba(44,21,5,0.14)',
    width: '100%',
    maxWidth: '420px',
    overflow: 'hidden',
    position: 'relative',
    zIndex: 1,
  },
  cardAccent: {
    height: '5px',
    background: 'linear-gradient(90deg, #2c1505 0%, #c8922a 50%, #f0b830 100%)',
  },
  cardBody: {
    padding: '36px 32px 32px',
  },
  logo: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  logoCircle: {
    width: '60px',
    height: '60px',
    background: '#2c1505',
    border: '2px solid #c8922a',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 900,
    fontSize: '18px',
    color: '#c8922a',
    letterSpacing: '0.05em',
  },
  title: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 900,
    fontSize: '26px',
    color: '#2c1505',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    lineHeight: 1,
    marginBottom: '6px',
  },
  subtitle: {
    fontFamily: "'DM Mono', monospace",
    fontSize: '10px',
    color: '#7a5c3e',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  label: {
    fontFamily: "'DM Mono', monospace",
    fontSize: '10px',
    fontWeight: 500,
    color: '#7a5c3e',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  input: {
    padding: '11px 14px',
    border: '1.5px solid rgba(44,21,5,0.15)',
    borderRadius: '8px',
    fontSize: '15px',
    fontFamily: "'Barlow', sans-serif",
    color: '#1a0e06',
    background: '#f7f0e6',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  errorBox: {
    background: '#fdf0f0',
    border: '1px solid #a82020',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    color: '#a82020',
    fontFamily: "'DM Mono', monospace",
  },
  button: {
    padding: '14px',
    background: '#2c1505',
    color: '#f7f0e6',
    border: 'none',
    borderRadius: '9px',
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 800,
    fontSize: '17px',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    transition: 'background 0.15s, transform 0.1s',
  },
  hint: {
    fontSize: '12px',
    color: '#7a5c3e',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  sentBox: {
    textAlign: 'center',
    padding: '8px 0',
  },
  sentIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  sentTitle: {
    fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 800,
    fontSize: '22px',
    color: '#2c1505',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '10px',
  },
  sentText: {
    fontSize: '14px',
    color: '#1a0e06',
    lineHeight: 1.6,
    marginBottom: '8px',
  },
  sentSub: {
    fontSize: '12px',
    color: '#7a5c3e',
    fontFamily: "'DM Mono', monospace",
    marginBottom: '20px',
  },
  resetBtn: {
    background: 'none',
    border: '1.5px solid rgba(44,21,5,0.2)',
    borderRadius: '7px',
    padding: '8px 16px',
    fontSize: '13px',
    color: '#7a5c3e',
    cursor: 'pointer',
    fontFamily: "'Barlow', sans-serif",
  },
  footer: {
    marginTop: '24px',
    fontFamily: "'DM Mono', monospace",
    fontSize: '10px',
    color: '#7a5c3e',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    position: 'relative',
    zIndex: 1,
  },
}
