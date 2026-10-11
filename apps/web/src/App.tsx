import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, BookMarked, ChartNoAxesCombined, Settings2, Sparkles, Bell, Check, ArrowRight, ArrowLeft, Search, Volume2, RotateCcw, Sun, Zap, CalendarDays, Flame, CircleHelp, RefreshCw, X, Menu, ChevronRight } from 'lucide-react'
import { api, type Word, type Today, type Preferences, type Summary, type HistoryItem, type Level } from './api'

type Page = 'dashboard' | 'learn' | 'dictionary' | 'progress' | 'settings'
type Notice = { tone: 'success' | 'error'; text: string } | null
type NavigationItem = { id: Page; label: string; icon: typeof BookOpen }

const menuItems: NavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Sparkles },
  { id: 'learn', label: 'Learn', icon: BookOpen },
  { id: 'dictionary', label: 'Dictionary', icon: BookMarked },
  { id: 'progress', label: 'Progress', icon: ChartNoAxesCombined },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

function initials(word: string) {
  return word.slice(0, 1).toUpperCase()
}

function speak(word: string) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(word)
    utterance.lang = 'en-US'
    utterance.rate = 0.8
    window.speechSynthesis.speak(utterance)
  }
}

function Brand({ onHome }: { onHome: () => void }) {
  return <button className="brand" onClick={onHome} aria-label="ContextLex home">
    <span className="brand-mark"><BookOpen size={24} strokeWidth={2.4}/></span>
    <span><strong>ContextLex</strong><small>Make every word count.</small></span>
  </button>
}

function NavButton({ item, active, onClick }: { item: NavigationItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon
  return <button onClick={onClick} className={'nav-button' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}>
    <Icon size={19}/><span>{item.label}</span>{active && <span className="nav-active-dot"/>}
  </button>
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof BookOpen; tone?: string }) {
  return <div className="stat-card">
    <div className={'stat-icon ' + (tone || '')}><Icon size={21}/></div>
    <span className="stat-value">{value}</span>
    <span className="stat-label">{label}</span>
  </div>
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(value))}>
    <span style={{ width: Math.max(0, Math.min(100, value)) + '%' }} />
  </div>
}

function LevelPill({ level }: { level: Level }) {
  return <span className={'level-pill level-' + level.toLowerCase()}>{level}</span>
}

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [today, setToday] = useState<Today | null>(null)
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [words, setWords] = useState<Word[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [query, setQuery] = useState('')
  const [filterLevel, setFilterLevel] = useState('all')
  const [currentCard, setCurrentCard] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [showReminder, setShowReminder] = useState(false)
  const [reminderChecked, setReminderChecked] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [editingPrefs, setEditingPrefs] = useState<Preferences | null>(null)

  const refreshLearning = useCallback(async () => {
    const [plan, totals, records] = await Promise.all([
      api<Today>('/learning/today'),
      api<Summary>('/progress/summary'),
      api<{items: HistoryItem[]}>('/progress/words'),
    ])
    setToday(plan)
    setSummary(totals)
    setHistory(records.items)
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([
      api<Preferences>('/preferences'),
      api<Today>('/learning/today'),
      api<Summary>('/progress/summary'),
      api<{items: HistoryItem[]}>('/progress/words'),
    ]).then(([p, plan, total, records]) => {
      if (!alive) return
      setPrefs(p)
      setEditingPrefs(p)
      setToday(plan)
      setSummary(total)
      setHistory(records.items)
    }).catch(err => {
      if (alive) setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      api<{items: Word[]}>('/words?q=' + encodeURIComponent(query) + '&level=' + encodeURIComponent(filterLevel))
        .then(data => { if (alive) setWords(data.items) })
        .catch(err => { if (alive) setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) }) })
    }, 230)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query, filterLevel])

  useEffect(() => {
    if (loading || reminderChecked || !prefs) return
    let alive = true
    api<{due: boolean}>('/reminders/due').then(data => {
      if (alive && data.due) setShowReminder(true)
    }).catch(() => { /* Reminder is optional: never block learning */ })
      .finally(() => { if (alive) setReminderChecked(true) })
    return () => { alive = false }
  }, [loading, reminderChecked, prefs])

  const setScreen = (next: Page) => {
    setPage(next)
    setMobileNav(false)
    setNotice(null)
    if (next === 'learn') {
      setCurrentCard(0)
      setRevealed(false)
      void refreshLearning().catch(() => undefined)
    }
  }

  const currentWord = today?.words[currentCard] || null
  const percentage = today ? (today.words.length ? today.studied / today.words.length * 100 : 0) : 0

  const markWord = async (status: 'known' | 'needs_practice') => {
    if (!currentWord || !today || working) return
    setWorking(true)
    try {
      const result = await api<Today>('/learning/words/' + encodeURIComponent(currentWord.id) + '/status', {
        method: 'PUT', body: JSON.stringify({ status }),
      })
      setToday(result)
      const [totals, records] = await Promise.all([
        api<Summary>('/progress/summary'),
        api<{items: HistoryItem[]}>('/progress/words'),
      ])
      setSummary(totals)
      setHistory(records.items)
      if (currentCard < result.words.length - 1) {
        setCurrentCard(currentCard + 1)
        setRevealed(false)
      } else if (result.completed) {
        setNotice({ tone: 'success', text: 'You finished today’s vocabulary session. Nice work!' })
      } else {
        const next = result.words.findIndex(w => !w.status)
        setCurrentCard(next >= 0 ? next : 0)
        setRevealed(false)
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setWorking(false)
    }
  }

  const savePreferences = async () => {
    if (!editingPrefs || working) return
    setWorking(true)
    try {
      const { level, daily_goal, timezone, reminder_enabled, reminder_hour } = editingPrefs
      const updated = await api<Preferences>('/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ level, daily_goal, timezone, reminder_enabled, reminder_hour }),
      })
      setPrefs(updated)
      setEditingPrefs(updated)
      await refreshLearning()
      setReminderChecked(false)
      setNotice({ tone: 'success', text: 'Preferences saved. New levels and goals apply to tomorrow’s plan.' })
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setWorking(false)
    }
  }

  const dismissReminder = async () => {
    setShowReminder(false)
    try { await api('/reminders/ack', { method: 'POST' }) }
    catch { /* Popup is dismissed locally even if acknowledgement fails */ }
  }

  const knownToday = useMemo(() => today?.words.filter(w => w.status === 'known').length || 0, [today])

  if (loading) {
    return <div className="loading-view"><div className="loader"/><Brand onHome={() => undefined}/><p>Getting your words ready...</p></div>
  }

  return <div className="app-shell">
    <aside className={'sidebar' + (mobileNav ? ' expanded' : '')}>
      <Brand onHome={() => setScreen('dashboard')}/>
      <p className="nav-label">YOUR SPACE</p>
      <nav aria-label="Main navigation">
        {menuItems.map(item => <NavButton key={item.id} item={item} active={page === item.id} onClick={() => setScreen(item.id)} />)}
      </nav>
      <div className="sidebar-bottom">
        <div className="daily-mini">
          <span className="mini-heading"><Zap size={16}/> Your daily pace</span>
          <strong>{today?.studied || 0} / {today?.words.length || 0} words</strong>
          <ProgressBar value={percentage}/>
          <small>Small steps, big vocabulary.</small>
        </div>
        <div className="demo-identity"><div className="avatar">D</div><div><strong>Demo learner</strong><small>Shared demo workspace</small></div></div>
      </div>
    </aside>

    <div className="mobile-top">
      <Brand onHome={() => setScreen('dashboard')}/>
      <button className="icon-btn" onClick={() => setMobileNav(!mobileNav)} aria-label={mobileNav ? 'Close navigation' : 'Open navigation'}><Menu size={22}/></button>
    </div>

    <main className="main-area">
      <div className="topbar">
        <div className="breadcrumbs"><span>My workspace</span><ChevronRight size={16}/><strong>{menuItems.find(x => x.id === page)?.label}</strong></div>
        <div className="top-actions"><span className="date-pill"><CalendarDays size={16}/>{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="demo-pill">DEMO</span></div>
      </div>

      {notice && <div className={'notice ' + notice.tone} role="status"><span>{notice.text}</span><button className="icon-btn" onClick={() => setNotice(null)} aria-label="Dismiss notice"><X size={17}/></button></div>}

      {page === 'dashboard' && <div className="page-fade">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><Sun size={15}/> BUILD YOUR DAILY HABIT</div>
            <h1>Good words.<br/><em>Great progress.</em></h1>
            <p>Expand the way you express yourself, one thoughtful word at a time. You're right where you need to be.</p>
            <button className="button primary" onClick={() => setScreen('learn')}>Continue learning <ArrowRight size={18}/></button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
            <div className="hero-word-card"><small>WORD OF THE MOMENT</small><strong>Accomplish</strong><span>/əˈkʌmplɪʃ/</span><i>verb · to achieve something</i></div>
            <div className="hero-asterisk">✳</div>
          </div>
        </section>

        <div className="section-heading"><div><span className="overline">YOUR LEARNING PULSE</span><h2>A little progress, every day.</h2></div><span className="subtle-text">Keep your momentum going</span></div>
        <div className="stats-grid">
          <Stat label="Words studied today" value={(today?.studied || 0) + ' / ' + (today?.words.length || 0)} icon={BookOpen} tone="purple"/>
          <Stat label="Words understood today" value={knownToday} icon={Check} tone="mint"/>
          <Stat label="Unique words studied" value={summary?.total_unique_words_studied || 0} icon={ChartNoAxesCombined} tone="peach"/>
          <Stat label="Day streak" value={(summary?.streak || 0) + ' days'} icon={Flame} tone="gold"/>
        </div>

        <div className="dashboard-bottom">
          <section className="panel daily-goal-panel">
            <div className="panel-top"><span className="section-icon"><Zap size={20}/></span><span className="overline">DAILY GOAL</span></div>
            <h3>You're making it happen.</h3>
            <p>{today?.completed ? 'You completed your session today. Come back tomorrow for new words.' : 'Every word learned brings you closer to expressing yourself with confidence.'}</p>
            <div className="goal-progress-head"><strong>{Math.round(percentage)}% completed</strong><span>{today?.studied || 0} of {today?.words.length || 0} words</span></div>
            <ProgressBar value={percentage}/>
            <button className="text-link" onClick={() => setScreen('learn')}>Open today's words <ArrowRight size={16}/></button>
          </section>
          <section className="panel word-peek">
            <div className="panel-top"><span className="section-icon alt"><BookMarked size={20}/></span><span className="overline">YOUR VOCABULARY</span></div>
            <h3>Make words your own.</h3>
            <p>Browse definitions, discover how words fit in real conversations, and grow your personal word bank.</p>
            <div className="example-word"><span className="example-letter">A</span><div><strong>Accomplish</strong><span>To successfully complete a goal.</span></div></div>
            <button className="text-link" onClick={() => setScreen('dictionary')}>Explore dictionary <ArrowRight size={16}/></button>
          </section>
        </div>
      </div>}

      {page === 'learn' && <div className="page-fade">
        <div className="section-heading big"><div><span className="overline">YOUR DAILY WORDS</span><h1>Learn something new.</h1><p>Flip the card, discover its meaning, then decide how well you know it.</p></div><LevelPill level={today?.level || 'B1'}/></div>
        {today && today.words.length ? <div className="learning-layout">
          <div className="learn-main">
            <div className="learn-toolbar"><span>Word {currentCard + 1} of {today.words.length}</span><span>{today.studied} learned today</span></div>
            <ProgressBar value={(currentCard + 1) / today.words.length * 100}/>
            <div className="flashcard">
              <div className="card-topline"><span>VOCABULARY CARD</span><span>{currentWord?.part_of_speech.toUpperCase()}</span></div>
              <div className="card-center">
                <div className="card-word"><h2>{currentWord?.headword}</h2><button className="sound-btn" onClick={() => currentWord && speak(currentWord.headword)} aria-label="Pronounce this word"><Volume2 size={20}/></button></div>
                <LevelPill level={currentWord?.level || 'B1'}/>
                {revealed ? <div className="reveal-content">
                  <div className="definition-label">DEFINITION</div><p className="definition">{currentWord?.definition}</p>
                  <div className="definition-label">IN A REAL SENTENCE</div><blockquote>“{currentWord?.example}”</blockquote>
                  <div className="definition-label">SIMILAR WORDS</div><p className="synonyms">{currentWord?.synonyms.join(' · ')}</p>
                </div> : <div className="word-prompt"><CircleHelp size={25}/><p>Do you know what this word means?</p><span>Think of a sentence you might use it in.</span></div>}
              </div>
              <div className="card-footer"><span>Words grow when you use them.</span><span>{currentCard + 1} / {today.words.length}</span></div>
            </div>
            {!revealed ? <button className="button primary reveal-button" onClick={() => setRevealed(true)}>Reveal meaning <ArrowRight size={18}/></button> :
              <div className="answer-row"><button className="button soft" disabled={working} onClick={() => void markWord('needs_practice')}><RotateCcw size={18}/> Need practice</button><button className="button primary" disabled={working} onClick={() => void markWord('known')}><Check size={18}/> Got it!</button></div>}
            <div className="card-navigation"><button disabled={currentCard === 0} onClick={() => { setCurrentCard(x => x - 1); setRevealed(false) }}><ArrowLeft size={17}/> Previous</button><button disabled={currentCard === today.words.length - 1} onClick={() => { setCurrentCard(x => x + 1); setRevealed(false) }}>Next <ArrowRight size={17}/></button></div>
          </div>
          <aside className="learn-side">
            <div className="panel"><div className="section-icon purple"><BookOpen size={20}/></div><h3>Your daily collection</h3><p>Learn at your own pace. Your words will be here when you return.</p><div className="word-list">
              {today.words.map((word, index) => <button key={word.id} onClick={() => { setCurrentCard(index); setRevealed(false) }} className={'word-list-item' + (index === currentCard ? ' selected' : '')}><span className={'list-number' + (word.status ? ' done' : '')}>{word.status ? <Check size={14}/> : index + 1}</span><span>{word.headword}</span>{index === currentCard && <ChevronRight size={16}/>}</button>)}
            </div></div>
            {today.completed && <div className="congrats">🎉 You've studied every word in today's collection!</div>}
          </aside>
        </div> : <div className="empty-card"><BookOpen size={35}/><h3>No words are available yet</h3><p>Add vocabulary to the selected level to get started.</p></div>}
      </div>}

      {page === 'dictionary' && <div className="page-fade">
        <div className="section-heading big"><div><span className="overline">EXPLORE THE LANGUAGE</span><h1>Your word library.</h1><p>Find a word, understand its meaning, and see it in context.</p></div></div>
        <div className="search-bar"><Search size={20}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search vocabulary... e.g. accomplish" aria-label="Search dictionary"/></div>
        <div className="level-filters">{['all', 'A1', 'A2', 'B1'].map(level => <button key={level} className={filterLevel === level ? 'chip selected' : 'chip'} onClick={() => setFilterLevel(level)}>{level === 'all' ? 'All levels' : level}</button>)}</div>
        <div className="results-count">{words.length} matching {words.length === 1 ? 'word' : 'words'} · Curated starter dictionary</div>
        <div className="dictionary-grid">
          {words.map(word => <article key={word.id} className="word-card"><div className="word-card-top"><span className="letter-avatar">{initials(word.headword)}</span><LevelPill level={word.level}/></div><h3>{word.headword}</h3><span className="part-of-speech">{word.part_of_speech}</span><p>{word.definition}</p><blockquote>“{word.example}”</blockquote><button className="text-link" onClick={() => speak(word.headword)}><Volume2 size={16}/> Pronounce</button></article>)}
        </div>
        {!words.length && <div className="empty-card"><Search size={30}/><h3>No words found</h3><p>Try a different search or choose another level.</p></div>}
      </div>}

      {page === 'progress' && <div className="page-fade">
        <div className="section-heading big"><div><span className="overline">YOUR GROWTH</span><h1>Every word counts.</h1><p>See how far you've come, one small win at a time.</p></div><button className="button secondary" onClick={() => void refreshLearning()}><RefreshCw size={17}/> Refresh</button></div>
        <div className="stats-grid">
          <Stat label="Unique words studied" value={summary?.total_unique_words_studied || 0} icon={BookMarked} tone="mint"/>
          <Stat label="Card reviews recorded" value={summary?.total_card_reviews || 0} icon={BookOpen} tone="purple"/>
          <Stat label="Completed days" value={summary?.days_completed || 0} icon={CalendarDays} tone="peach"/>
          <Stat label="Current streak" value={(summary?.streak || 0) + ' days'} icon={Flame} tone="gold"/>
        </div>
        <section className="panel history-panel"><div className="section-heading"><div><span className="overline">YOUR ACTIVITY</span><h2>Recently studied words</h2></div></div>
          {history.length ? <div className="history-list">{history.map((item, index) => <div className="history-row" key={item.word.id + item.date + index}><span className="letter-avatar">{initials(item.word.headword)}</span><div><strong>{item.word.headword}</strong><small>{item.word.definition}</small></div><span className={'status-tag ' + (item.status === 'known' ? 'status-known' : 'status-practice')}>{item.status === 'known' ? 'Got it' : 'Need practice'}</span><span className="history-date">{item.date}</span></div>)}</div> : <div className="empty-in-panel"><BookOpen size={28}/><p>Nothing here yet. Learn your first word to get started.</p><button className="text-link" onClick={() => setScreen('learn')}>Start learning <ArrowRight size={16}/></button></div>}
        </section>
      </div>}

      {page === 'settings' && editingPrefs && <div className="page-fade">
        <div className="section-heading big"><div><span className="overline">MAKE IT YOUR OWN</span><h1>Learning preferences.</h1><p>Choose a routine that fits your schedule and goals.</p></div></div>
        <div className="settings-grid">
          <section className="panel form-panel"><h3><BookOpen size={21}/> Learning goals</h3><label htmlFor="level">Vocabulary level</label><select id="level" value={editingPrefs.level} onChange={e => setEditingPrefs({ ...editingPrefs, level: e.target.value as Level })}><option value="A1">A1 — Beginner</option><option value="A2">A2 — Elementary</option><option value="B1">B1 — Intermediate</option></select>
            <label htmlFor="daily">New words per day</label><select id="daily" value={editingPrefs.daily_goal} onChange={e => setEditingPrefs({ ...editingPrefs, daily_goal: Number(e.target.value) as Preferences['daily_goal'] })}>{[3,5,10,15].map(n => <option key={n} value={n}>{n} words</option>)}</select>
            <p className="help-text">Changes to your level or daily goal start with tomorrow's plan.</p>
          </section>
          <section className="panel form-panel"><h3><Bell size={21}/> Daily in-app reminder</h3><label className="toggle-row"><span>Remind me to practice</span><input type="checkbox" checked={editingPrefs.reminder_enabled} onChange={e => setEditingPrefs({ ...editingPrefs, reminder_enabled: e.target.checked })}/></label><label htmlFor="reminder-hour">Reminder time</label><select id="reminder-hour" value={editingPrefs.reminder_hour} onChange={e => setEditingPrefs({ ...editingPrefs, reminder_hour: Number(e.target.value) })}>{Array.from({length:24}, (_, i) => <option key={i} value={i}>{new Date(2026, 0, 1, i).toLocaleTimeString(undefined, {hour:'numeric'})}</option>)}</select>
            <label htmlFor="timezone">Timezone (IANA)</label><input id="timezone" value={editingPrefs.timezone} onChange={e => setEditingPrefs({ ...editingPrefs, timezone: e.target.value })} placeholder="America/Chicago"/>
            <button className="text-link" onClick={() => setEditingPrefs({ ...editingPrefs, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>Use my browser timezone <ArrowRight size={16}/></button>
            <p className="help-text">Reminders appear only while the website is open. Push notifications will come later.</p>
          </section>
        </div>
        <div className="settings-actions"><button className="button primary" disabled={working} onClick={() => void savePreferences()}><Check size={18}/>{working ? 'Saving...' : 'Save preferences'}</button></div>
        <div className="demo-warning"><CircleHelp size={20}/><span>This preview uses one shared demo profile. Your settings and progress are visible to other visitors. Accounts and separate user profiles are next on the roadmap.</span></div>
      </div>}
    </main>

    <nav className="bottom-nav" aria-label="Mobile navigation">{menuItems.map(item => {
      const Icon = item.icon
      return <button key={item.id} onClick={() => setScreen(item.id)} className={page === item.id ? 'active' : ''}><Icon size={20}/><span>{item.label}</span></button>
    })}</nav>

    {showReminder && <div className="modal-overlay" role="presentation"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reminder-title"><span className="reminder-icon"><Bell size={27}/></span><span className="overline">A LITTLE REMINDER</span><h2 id="reminder-title">Time for a new word!</h2><p>You've got {today ? today.words.length - today.studied : 0} words to study. A few minutes today can make a big difference tomorrow.</p><div className="modal-actions"><button className="button secondary" onClick={() => void dismissReminder()}>Not now</button><button className="button primary" onClick={() => { void dismissReminder(); setScreen('learn') }}>Let's learn <ArrowRight size={17}/></button></div></div></div>}
  </div>
}

export default App
