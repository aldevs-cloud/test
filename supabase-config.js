// Supabase → Project Settings → API থেকে এই দুটি মান কপি করে বসান।
// anon / publishable key ব্রাউজারে থাকাই স্বাভাবিক (ডেটা সুরক্ষা করে RLS)।
// ⚠️ কখনো "service_role" key এখানে দেবেন না।
window.APP_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",          // যেমন: https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY" // anon public key (বা sb_publishable_...)
};
