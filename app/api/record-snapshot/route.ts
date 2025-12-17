// app/api/record-snapshot/route.ts
import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { supabase } from '@/lib/supabase';

// Bu fonksiyon sadece gizli bir anahtarla (CRON_SECRET) çalışsın ki herkes tetikleyemesin
// Şimdilik test için public bırakıyoruz.

export async function GET() {
  try {
    console.log("SNAPSHOT: Veri çekme işlemi başladı...");
    const connection = new Connection("https://api.devnet.xandeum.com:8899", "confirmed");

    // 1. Solana'dan Verileri Çek
    const [gossipNodes, voteAccounts, epochInfo] = await Promise.all([
      connection.getClusterNodes(),
      connection.getVoteAccounts(),
      connection.getEpochInfo().catch(() => null)
    ]);

    const currentSlotHeight = epochInfo?.absoluteSlot || 0;

    // 2. Vote Map Oluştur
    const voteMap: Record<string, any> = {};
    [...voteAccounts.current, ...voteAccounts.delinquent].forEach(vote => {
        voteMap[vote.nodePubkey] = vote;
    });

    // 3. Veriyi İşle ve Hazırla
    const snapshots = gossipNodes.map(node => {
        const voteData = voteMap[node.pubkey];
        
        let slotLag = 0;
        let lastVote = 0;
        if (voteData && currentSlotHeight > 0) {
            lastVote = voteData.lastVote;
            slotLag = Math.max(0, currentSlotHeight - lastVote);
        }

        // Health Score (Aynı mantık)
        let healthScore = 100;
        if (slotLag > 100) healthScore -= 10;
        if (slotLag > 500) healthScore -= 30;
        if (!voteData) healthScore = 85; 
        if (!node.gossip) healthScore -= 50;
        healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

        return {
            pubkey: node.pubkey,
            node_name: `Node-${node.pubkey.slice(0, 4)}`, // İstersen Identity Map'i buraya da taşıyabilirsin
            stake: voteData ? voteData.activatedStake : 0,
            health_score: healthScore,
            slot_lag: slotLag,
            is_validator: !!voteData,
            // Skip rate şimdilik RPC'den zor geldiği için null veya simüle geçilebilir
            skip_rate: 0 
        };
    });

    // 4. Supabase'e Toplu Kayıt (Bulk Insert)
    // Hepsini kaydetmek yerine sadece Validatörleri veya ilk 100 node'u kaydedelim (Veritabanı şişmesin)
    const significantNodes = snapshots
        .sort((a, b) => b.stake - a.stake) // En yüksek stake'liler
        .slice(0, 100); // İlk 100

    const { error } = await supabase
        .from('node_snapshots')
        .insert(significantNodes);

    if (error) throw error;

    return NextResponse.json({ success: true, count: significantNodes.length, message: "Snapshot recorded successfully!" });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}