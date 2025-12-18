import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Supabase Bağlantısı
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    // Veritabanından son 50 kaydı çek (Zamana göre tersten)
    const { data, error } = await supabase
      .from('network_stats')
      .select('*')
      .order('time', { ascending: false })
      .limit(50);

    if (error) {
      console.error("Supabase Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Grafik soldan sağa aksın diye veriyi ters çeviriyoruz (Eskiden -> Yeniye)
    return NextResponse.json(data ? data.reverse() : []);

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}