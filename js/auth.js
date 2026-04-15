import { supabase } from './supabase.js'

// --- State ---
let currentMode = 'login' // 'login' | 'signup'

// --- DOM refs (resolved after DOMContentLoaded) ---
let form, emailInput, passwordInput, submitBtn, toggleLink, toggleText, errorMsg, modeTitle

export function initAuth() {
  form        = document.getElementById('auth-form')
  emailInput  = document.getElementById('auth-email')
  passwordInput = document.getElementById('auth-password')
  submitBtn   = document.getElementById('auth-submit')
  toggleLink  = document.getElementById('auth-toggle-link')
  toggleText  = document.getElementById('auth-toggle-text')
  errorMsg    = document.getElementById('auth-error')
  modeTitle   = document.getElementById('auth-mode-title')

  form.addEventListener('submit', handleSubmit)
  toggleLink.addEventListener('click', toggleMode)

  // Check if already logged in
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) onAuthSuccess(session)
  })

  // Listen for auth state changes
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) onAuthSuccess(session)
  })
}

async function handleSubmit(e) {
  e.preventDefault()
  clearError()

  const email    = emailInput.value.trim()
  const password = passwordInput.value

  if (!email || !password) {
    showError('Fill in all fields.')
    return
  }

  setLoading(true)

  let result
  if (currentMode === 'login') {
    result = await supabase.auth.signInWithPassword({ email, password })
  } else {
    result = await supabase.auth.signUp({ email, password })
  }

  setLoading(false)

  if (result.error) {
    showError(result.error.message)
    return
  }

  if (currentMode === 'signup' && !result.data.session) {
    // Email confirmation required
    showError('Check your email to confirm your account.', 'info')
  }
}

function toggleMode(e) {
  e.preventDefault()
  currentMode = currentMode === 'login' ? 'signup' : 'login'
  clearError()

  if (currentMode === 'login') {
    modeTitle.textContent  = 'Sign in'
    submitBtn.textContent  = 'Sign in'
    toggleText.textContent = "Don't have an account? "
    toggleLink.textContent = 'Sign up'
  } else {
    modeTitle.textContent  = 'Create account'
    submitBtn.textContent  = 'Create account'
    toggleText.textContent = 'Already have an account? '
    toggleLink.textContent = 'Sign in'
  }
}

function onAuthSuccess(session) {
  document.getElementById('auth-screen').classList.add('hidden')
  document.getElementById('app-screen').classList.remove('hidden')
  const email = session.user.email
  document.getElementById('user-email').textContent = email
  const avatarEl = document.getElementById('user-avatar')
  if (avatarEl) avatarEl.textContent = email.charAt(0).toUpperCase()

  if (typeof window.__onAppReady === 'function') {
    window.__onAppReady()
    window.__onAppReady = null // run once
  }
}

export async function signOut() {
  await supabase.auth.signOut()
  document.getElementById('app-screen').classList.add('hidden')
  document.getElementById('auth-screen').classList.remove('hidden')
  form.reset()
  clearError()
  // Reset to login mode
  if (currentMode !== 'login') toggleMode({ preventDefault: () => {} })
}

function showError(msg, type = 'error') {
  errorMsg.textContent = msg
  errorMsg.className   = `auth-message ${type}`
}

function clearError() {
  errorMsg.textContent = ''
  errorMsg.className   = 'auth-message'
}

function setLoading(loading) {
  submitBtn.disabled     = loading
  submitBtn.textContent  = loading
    ? 'Loading…'
    : currentMode === 'login' ? 'Sign in' : 'Create account'
}
