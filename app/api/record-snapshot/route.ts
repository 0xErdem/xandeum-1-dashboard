import { createClient } from '@supabase/supabase-js';
import { Connection } from '@solana/web3.js';
import { NextResponse } from 'next/server';

// 1. Supabase Bağlantısı
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// 2. Solana Bağlantısı
const RPC_ENDPOINT = "https://api.devnet.xandeum.com:8899";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

export async function GET() {
  try {
    // --- GERÇEK VERİ TOPLAMA ---
    const [epochInfo, voteAccounts, perfSamples] = await Promise.all([
      connection.getEpochInfo(),
      connection.getVoteAccounts(),
      connection.getRecentPerformanceSamples(1),
    ]);

    // 1. Toplam Aktif Stake
    const current = voteAccounts.current.reduce((acc, v) => acc + v.activatedStake, 0);
    const delinquent = voteAccounts.delinquent.reduce((acc, v) => acc + v.activatedStake, 0);
    const totalStake = current + delinquent;

    // 2. Gerçek TPS (Son örneklemden)
    const tps = perfSamples[0]?.numTransactions 
      ? perfSamples[0].numTransactions / perfSamples[0].samplePeriodSecs 
      : 0;

    // 3. Node Sayısı
    const activeValidators = voteAccounts.current.length;

    // --- SUPABASE'E KAYIT ---
    const { data, error } = await supabase
      .from('network_stats') // Tablo adın farklıysa burayı güncelle
      .insert([
        { 
          time: new Date().toISOString(), 
          stake: (totalStake / 1000000000), // SOL cinsinden
          tps: tps,
          node_count: activeValidators,
          epoch: epochInfo.epoch
        }
      ])
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, saved_data: data });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}