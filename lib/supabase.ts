import { createClient } from '@supabase/supabase-js';

// process.env ile .env.local dosyasındaki değerleri okuyoruz
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// URL veya Key yoksa hata fırlat (Debug için)
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase URL veya Anon Key bulunamadı. .env.local dosyasını kontrol et.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);