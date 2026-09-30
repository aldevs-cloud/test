// Supabase → Project Settings → API থেকে এই দুটি মান কপি করে বসান।
// anon / publishable key ব্রাউজারে থাকাই স্বাভাবিক (ডেটা সুরক্ষা করে RLS)।
// ⚠️ কখনো "service_role" key এখানে দেবেন না।
window.APP_CONFIG = {
  SUPABASE_URL: "https://jylwlvbayogsfaprykbi.supabase.co",          // যেমন: https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5bHdsdmJheW9nc2ZhcHJ5a2JpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NTExNzEsImV4cCI6MjEwNjMyNzE3MX0.m0TOp2vyeMD87yFJ0L1GBEAm_A3yy6Q-DHtCByvkSvo" // anon public key (বা sb_publishable_...)
};
