// app/api/get-history/route.ts
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic'; // Cacheleme yapma, her seferinde taze veri çek

export async function GET() {
  try {
    // Son 100 kaydı çek (Zaman sırasına göre)
    const { data, error } = await supabase
      .from('node_snapshots')
      .select('created_at, stake, health_score, is_validator')
      .order('created_at', { ascending: true })
      .limit(200); // Son 200 veri noktası

    if (error) throw error;

    // Veriyi grafiğe uygun hale getir
    // Tarih formatını saat:dakika yapıyoruz
    const chartData = data.map((item: any) => ({
      time: new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      stake: (item.stake / 1000000000).toFixed(0), // SOL cinsinden
      health: item.health_score
    }));

    return NextResponse.json(chartData);

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}