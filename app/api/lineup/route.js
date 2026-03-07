import { NextResponse } from 'next/server'

const SYSTEM_PROMPT = `You are Coach Myers' AI assistant — a seasoned, competitive Little League Minor B coach who deeply understands player development. You balance winning with mandatory development rules. You are direct, confident, and always explain your reasoning so the coach can learn and disagree intelligently.

Your lineup philosophy:
- OBP and contact rate drive batting order (lead off: highest OBP + speed; 3-4: best contact + RBI capacity; bottom: developing players protected by strong batters)
- Continuos batting order — every player bats every inning
- Exactly 9 players on the field each inning
- Pool players bat last, never pitch
- Maximum 1 position change per player between innings (low movement)
- Every player gets both infield and outfield time across the game
- Multiple players can catch (Matthew Barragan, Preston Hale, Trevor Snoddy, Ace Escobar) — rotate to limit any one player to max 2 innings behind the plate per game
- Ace Escobar is a pitcher/catcher hybrid — can and should pitch 1 inning when available
- Pitchers rotate every 1-2 innings, max 50 pitches/day

Position fitness scoring (use the PCI data provided):
- Assign best available player to each position each inning
- Respect locked positions absolutely
- Balance development with competition — don't always give weakest players least important positions

Always return ONLY valid JSON matching the exact schema provided. No markdown, no explanation outside the JSON.`

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

  try {
    const body = await request.json()
    const { players, pciData, battingStats, innings = 4, lockedPositions = {}, gameContext } = body

    const prompt = buildPrompt(players, pciData, battingStats, innings, lockedPositions, gameContext)

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    const data = await resp.json()
    if (!resp.ok) return NextResponse.json({ error: data.error?.message || 'Claude API error' }, { status: resp.status })

    let raw = data.content.find(b => b.type === 'text')?.text?.trim() || ''
    raw = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim()
    const result = JSON.parse(raw)
    return NextResponse.json(result)

  } catch(err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildPrompt(players, pciData, battingStats, innings, lockedPositions, gameContext) {
  const POSITIONS = ['P','C','1B','2B','3B','SS','LF','CF','RF']
  
  // Build player summary
  const playerSummary = players.map(p => {
    const stats = battingStats[p.name] || {}
    const pci = pciData[p.name] || {}
    return {
      name: p.name,
      number: p.number,
      isPool: p.isPool || false,
      locked: lockedPositions[p.name] || null,
      batting: {
        obp: stats.obp || null,
        avg: stats.avg || null,
        contact_pct: stats.ab && stats.so ? +((stats.ab - stats.so) / stats.ab * 100).toFixed(1) : null,
        sb: stats.sb || 0,
        pa: stats.pa || 0,
      },
      positionPCI: POSITIONS.reduce((acc, pos) => {
        acc[pos] = pci[pos] || 50 // default 50 if no data yet
        return acc
      }, {})
    }
  })

  const schema = {
    batting_order: ['array of player names in batting order, 1 through N'],
    batting_reasoning: 'single paragraph explaining key batting order decisions',
    innings: Array.from({length: innings}, (_, i) => ({
      inning: i + 1,
      assignments: { P: 'player name', C: 'player name', '1B': 'player name', '2B': 'player name', '3B': 'player name', SS: 'player name', LF: 'player name', CF: 'player name', RF: 'player name' },
      changes_from_previous: 'comma-separated list of changes, or "Initial lineup" for inning 1',
      inning_reasoning: 'one sentence on key decisions for this inning'
    })),
    pitching_plan: 'paragraph detailing pitcher rotation with estimated pitch counts',
    compliance_notes: 'bullet list confirming: all players play all innings, infield/outfield balance, pitch count limits',
    overall_reasoning: 'one paragraph summary of the overall game plan strategy'
  }

  return `Generate a complete lineup plan for this game.

GAME CONTEXT:
${JSON.stringify(gameContext, null, 2)}

AVAILABLE PLAYERS (${players.length} total):
${JSON.stringify(playerSummary, null, 2)}

LOCKED POSITIONS (must be honored):
${JSON.stringify(lockedPositions)}

INNINGS TO PLAN: ${innings}

Return ONLY this JSON schema (no markdown):
${JSON.stringify(schema, null, 2)}`
}
