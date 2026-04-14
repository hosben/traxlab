import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://rcwuvuggdfyqxyxggeao.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjd3V2dWdnZGZ5cXh5eGdnZWFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxOTQwMjIsImV4cCI6MjA5MTc3MDAyMn0.6VIqY1sdl6sCznwVDWVqd6s8eE7mhCUYYT0I3lWCqwg'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
