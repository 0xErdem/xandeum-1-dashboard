'use client';

// ============================================================================
// 1. IMPORTS
// ============================================================================
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Connection } from '@solana/web3.js';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { 
    Activity, X, MapPin, Wifi, Shield, Database, LayoutDashboard, 
    Globe as GlobeIcon, Search, ArrowUpRight, Eye, EyeOff, 
    AlertCircle, HeartPulse, TrendingUp, DollarSign, 
    BrainCircuit, Terminal as TerminalIcon, HardDrive, History, 
    Cpu, Layers
} from 'lucide-react';

import { 
    ResponsiveContainer, Tooltip, BarChart, Bar, AreaChart, Area, YAxis
} from 'recharts';

// Harita (SSR Kapalı)
const GlobeViz = dynamic(() => import('../components/GlobeViz'), { 
    ssr: false,
    loading: () => <div className="absolute inset-0 flex items-center justify-center text-cyan-500 font-mono animate-pulse">SYSTEM INITIALIZING...</div>
});

// ============================================================================
// 2. CONFIG
// ============================================================================
const CACHE_KEY = 'xandeum_v3_data';
const RPC_ENDPOINT = "https://api.devnet.xandeum.com:8899";

const IDENTITY_MAP: Record<string, string> = {
    "K72M": "Foundation #1",
    "F43y": "Tokyo Core",
    "7BQz": "Genesis Val",
    "9Lfp": "US Relay",
    "59sD": "EU Cluster",
};

// Node Veri Tipi
interface NodeData {
    pubkey: string;
    gossip: string | null;
    version: string;
    isValidator: boolean;
    stake: string;
    rawStake: number;
    commission: number;
    slotLag: number;
    skipRate: string;
    skipRateNum: number;
    healthScore: number;
    apy: string;
    name: string;
    avatarColor: string;
    lat: number;
    lng: number;
    city: string | null;
    country: string | null;
    isp: string | null;
}

// ============================================================================
// 3. LOGIC & HELPERS
// ============================================================================

function resolveIdentity(pubkey: string): string {
    const prefix = pubkey.slice(0, 4);
    return IDENTITY_MAP[prefix] || `Node-${prefix.toUpperCase()}`;
}

function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function calculateHealthScore(node: { slotLag: number, skipRateNum: number, gossip: string | null }, isVote: boolean): number {
    let score = 100;
    if (node.slotLag > 10) score -= Math.min(40, (node.slotLag - 10));
    if (node.skipRateNum > 5) score -= (node.skipRateNum * 2);
    if (!isVote) score -= 20;
    if (!node.gossip) score -= 50;
    return Math.max(0, Math.min(100, Math.floor(score)));
}

// ============================================================================
// 4. MAIN PAGE COMPONENT
// ============================================================================

export default function Home() {
    const { publicKey } = useWallet();

    // -- STATE --
    const [viewMode, setViewMode] = useState<'simple' | 'advanced'>('simple');
    const [allNodes, setAllNodes] = useState<NodeData[]>([]);
    
    // Seçili Node (Hem Simple hem Advanced için)
    const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
    
    // Arayüz Kontrolleri
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [uiVisible, setUiVisible] = useState(true);

    // Metrikler
    const [metrics, setMetrics] = useState({ totalStake: 0, nakamoto: 0, currentSlot: 0, epoch: 0 });
    const [logs, setLogs] = useState<string[]>([]);
    const [latencyHistory, setLatencyHistory] = useState<any[]>([]);
    
    // SUPABASE VERİSİ
    const [dbHistory, setDbHistory] = useState<any[]>([]);

    const processingRef = useRef(false);

    // -- LOGGING --
    const addLog = useCallback((msg: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') => {
        const time = new Date().toLocaleTimeString([], {hour12: false});
        setLogs(prev => [`[${type.toUpperCase()}] ${msg} (${time})`, ...prev].slice(0, 50));
    }, []);

    // --- 1. SUPABASE FETCH ---
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/get-history');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        setDbHistory(data);
                        // İlk seferde log bas
                        if (dbHistory.length === 0) addLog("Supabase history sync active.", "success");
                    }
                }
            } catch (e) {
                console.warn("History fetch skipped.");
            }
        };
        fetchHistory();
        const interval = setInterval(fetchHistory, 60000); // 1 dakikada bir güncelle
        return () => clearInterval(interval);
    }, [addLog, dbHistory.length]);

    // --- 2. RPC DATA LOOP ---
    useEffect(() => {
        const initSystem = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            try {
                addLog("Connecting to Solana RPC...", "info");
                const connection = new Connection(RPC_ENDPOINT, "confirmed");

                const [gossipNodes, voteAccounts, blockProduction, epoch] = await Promise.all([
                    connection.getClusterNodes(),
                    connection.getVoteAccounts(),
                    connection.getBlockProduction().catch(() => null),
                    connection.getEpochInfo().catch(() => null)
                ]);

                // Metrics Update
                const currentSlotHeight = epoch?.absoluteSlot || 0;
                setMetrics(prev => ({ ...prev, epoch: epoch?.epoch || 0, currentSlot: currentSlotHeight }));

                // Data Mapping
                const voteMap: Record<string, any> = {};
                const productionMap: Record<string, any> = {};
                const validatorsList: any[] = [];
                let calcStake = 0;

                [...voteAccounts.current, ...voteAccounts.delinquent].forEach(vote => {
                    voteMap[vote.nodePubkey] = vote;
                    calcStake += vote.activatedStake;
                    validatorsList.push({ ...vote, stake: vote.activatedStake });
                });

                if (blockProduction?.value?.byIdentity) {
                    Object.entries(blockProduction.value.byIdentity).forEach(([key, val]) => {
                        productionMap[key] = val;
                    });
                }

                // Nakamoto
                validatorsList.sort((a, b) => b.stake - a.stake);
                let accStake = 0;
                let nkIndex = 0;
                const threshold = calcStake * 0.3333;
                for (const val of validatorsList) {
                    accStake += val.stake;
                    nkIndex++;
                    if (accStake >= threshold) break;
                }
                setMetrics(prev => ({ ...prev, totalStake: calcStake, nakamoto: nkIndex || 1 }));

                // Node Processing
                let baseNodes: NodeData[] = gossipNodes.map(node => {
                    const voteData = voteMap[node.pubkey];
                    const prodData = productionMap[node.pubkey];
                    
                    let slotLag = 0;
                    if (voteData && currentSlotHeight > 0) slotLag = Math.max(0, currentSlotHeight - voteData.lastVote);

                    let skipRateVal = 0;
                    if (prodData && prodData.leaderSlots > 0) {
                        skipRateVal = ((prodData.leaderSlots - prodData.blocksProduced) / prodData.leaderSlots) * 100;
                    }

                    const healthScore = calculateHealthScore({ slotLag, skipRateNum: skipRateVal, gossip: node.gossip }, !!voteData);
                    const commission = voteData ? voteData.commission : 0;
                    const apy = voteData ? (7.5 * (healthScore / 100) * ((100 - commission) / 100)).toFixed(2) : "0.00";

                    return {
                        pubkey: node.pubkey,
                        gossip: node.gossip || null,
                        version: node.version || 'Unknown',
                        isValidator: !!voteData,
                        stake: voteData ? (voteData.activatedStake / 1000000000).toFixed(0) : "0",
                        rawStake: voteData ? voteData.activatedStake : 0,
                        commission,
                        slotLag,
                        skipRate: skipRateVal.toFixed(1) + "%",
                        skipRateNum: skipRateVal,
                        healthScore,
                        apy,
                        name: resolveIdentity(node.pubkey),
                        avatarColor: stringToColor(node.pubkey),
                        lat: 0, lng: 0, city: null, country: null, isp: null
                    };
                });

                baseNodes.sort((a, b) => b.rawStake - a.rawStake);
                setAllNodes(baseNodes);
                addLog(`Found ${baseNodes.length} nodes via Gossip.`, "success");

                // --- 3. GEO LOCATION (IPWHO.IS) ---
                const cachedData = localStorage.getItem(CACHE_KEY);
                const cache = cachedData ? JSON.parse(cachedData) : {};
                let needsCacheUpdate = false;
                const updatedNodes = [...baseNodes];

                const processGeo = async () => {
                    for (let i = 0; i < updatedNodes.length; i++) {
                        const node = updatedNodes[i];
                        if (!node.gossip) continue;
                        const ip = node.gossip.split(':')[0];
                        if (ip.startsWith('127.') || ip.startsWith('10.')) continue;

                        if (cache[ip]) {
                            updatedNodes[i] = { ...node, ...cache[ip] };
                            if (i % 20 === 0) setAllNodes([...updatedNodes]);
                            continue;
                        }

                        try {
                            // Hızlı veri çekimi (100ms)
                            await new Promise(r => setTimeout(r, 100)); 
                            const res = await fetch(`https://ipwho.is/${ip}`);
                            const geo = await res.json();
                            if (geo.success) {
                                const geoData = { lat: geo.latitude, lng: geo.longitude, city: geo.city, country: geo.country, isp: geo.connection?.isp };
                                cache[ip] = geoData;
                                updatedNodes[i] = { ...node, ...geoData };
                                needsCacheUpdate = true;
                                if (i % 5 === 0) setAllNodes([...updatedNodes]);
                            }
                        } catch (e) { /* ignore */ }
                    }
                    if (needsCacheUpdate) localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
                    setAllNodes([...updatedNodes]);
                };
                processGeo();

            } catch (e: any) {
                console.error(e);
                addLog(`RPC Error: ${e.message}`, "error");
            }
        };

        initSystem();

        const interval = setInterval(() => {
            setLatencyHistory(prev => [...prev.slice(-40), { time: Date.now(), latency: Math.floor(40 + Math.random() * 30) }]);
            setMetrics(prev => ({ ...prev, currentSlot: prev.currentSlot + 1 }));
        }, 1000);

        return () => clearInterval(interval);
    }, [addLog]);

    // Data Filtreleme
    const displayNodes = useMemo(() => {
        if (!searchTerm) return allNodes;
        const lower = searchTerm.toLowerCase();
        return allNodes.filter(n => n.name.toLowerCase().includes(lower) || n.pubkey.toLowerCase().includes(lower) || n.city?.toLowerCase().includes(lower));
    }, [allNodes, searchTerm]);

    const anomalies = useMemo(() => allNodes.filter(n => n.healthScore < 60), [allNodes]);
    
    // ========================================================================
    // RENDER UI
    // ========================================================================
    return (
        <main className="relative w-full h-screen bg-[#02040a] overflow-hidden text-white font-sans selection:bg-cyan-500/30">
            
            {/* HARİTA ARKA PLANI */}
            <div className={`absolute inset-0 z-0 transition-all duration-700 ${viewMode === 'advanced' ? 'opacity-20 blur-sm scale-105' : 'opacity-100'}`}>
                <GlobeViz 
                    nodes={allNodes.filter(n => n.lat !== 0)} 
                    onNodeClick={(node: any) => {
                        setSelectedNode(node);
                        setUiVisible(true);
                    }} 
                />
            </div>

            {/* ÜST BAR (HEADER) */}
            <div className={`absolute top-0 left-0 w-full p-6 z-50 flex justify-between items-start transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}>
                <div className="flex flex-col gap-4">
                    <h1 className="text-5xl font-black tracking-tighter text-white drop-shadow-2xl flex items-center gap-2 select-none">
                        XANDEUM<span className="text-cyan-400">.OS</span>
                    </h1>
                    <div className="flex bg-white/5 rounded-xl p-1 border border-white/10 backdrop-blur-md w-fit shadow-xl pointer-events-auto">
                        <TabButton active={viewMode === 'simple'} onClick={() => setViewMode('simple')} icon={<GlobeIcon size={14}/>} label="LIVE MAP" />
                        <TabButton active={viewMode === 'advanced'} onClick={() => setViewMode('advanced')} icon={<LayoutDashboard size={14}/>} label="SYSTEM CORE" />
                    </div>
                </div>
                
                <div className="flex gap-4 items-center">
                    <div className="hidden md:flex gap-4">
                        <MetricBox label="EPOCH" value={metrics.epoch} sub={metrics.currentSlot.toLocaleString()} />
                        <MetricBox label="STAKE" value={(metrics.totalStake / 1000000000).toFixed(0) + "M"} sub="SOL" color="text-green-400" />
                    </div>
                    <WalletMultiButton className="!bg-cyan-500/10 !backdrop-blur-xl !border !border-cyan-500/30 !text-cyan-300 !font-bold !h-[50px] !rounded-xl hover:!bg-cyan-500/20 pointer-events-auto" />
                </div>
            </div>

            {/* GİZLEME BUTONU */}
            <button onClick={() => setUiVisible(!uiVisible)} className="absolute bottom-6 right-6 z-50 p-3 bg-black/50 hover:bg-white/10 rounded-full border border-white/10 text-cyan-400 transition pointer-events-auto">
                {uiVisible ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>

            {/* --- SIMPLE MOD: SAĞ LİSTE PANELİ --- */}
            {viewMode === 'simple' && uiVisible && (
                <div className="absolute top-40 right-6 bottom-6 w-80 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col overflow-hidden z-40 pointer-events-auto shadow-2xl animate-in slide-in-from-right-10">
                    <div className="p-4 border-b border-white/10 bg-white/5">
                        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                            <Activity size={14} /> Live Node Feed
                        </h3>
                        <div className="text-[10px] text-gray-500 mt-1">{allNodes.length} active nodes</div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                        {allNodes.length === 0 ? (
                            <div className="text-center text-gray-500 text-xs py-10">Scanning Network...</div>
                        ) : (
                            allNodes.map((node, i) => (
                                <div 
                                    key={node.pubkey} 
                                    onClick={() => setSelectedNode(node)}
                                    className={`p-3 rounded-xl border transition cursor-pointer flex items-center gap-3 ${selectedNode?.pubkey === node.pubkey ? 'bg-cyan-900/20 border-cyan-500/50' : 'bg-white/5 border-transparent hover:bg-white/10'}`}
                                >
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[10px] text-black shrink-0" style={{backgroundColor: node.avatarColor}}>
                                        {node.name.substring(0,2)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-white truncate">{node.city || node.name}</div>
                                        <div className="text-[10px] text-gray-400 truncate font-mono">{node.pubkey.substring(0,12)}...</div>
                                    </div>
                                    <div className="text-[10px] font-bold text-green-400">{node.healthScore}%</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* --- DETAY PANELİ (HER İKİ MODDA DA ÇIKAR) --- */}
            {selectedNode && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-[#0c0c0c] border border-white/20 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden pointer-events-auto">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Shield size={18} className="text-cyan-500"/> INSPECTOR</h2>
                            <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-white"><X size={20}/></button>
                        </div>
                        <div className="p-6 grid grid-cols-2 gap-4">
                            <div className="col-span-2 flex items-center gap-4 mb-2">
                                <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-black text-black shadow-lg" style={{backgroundColor: selectedNode.avatarColor}}>
                                    {selectedNode.name.substring(0,2)}
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-white">{selectedNode.city || 'Unknown Location'}</div>
                                    <div className="text-xs font-mono text-cyan-400 truncate w-48">{selectedNode.pubkey}</div>
                                </div>
                            </div>
                            <DetailItem label="ISP" value={selectedNode.isp} icon={<Wifi size={14}/>} />
                            <DetailItem label="Version" value={selectedNode.version} icon={<Layers size={14}/>} />
                            <DetailItem label="Stake" value={selectedNode.stake} icon={<TrendingUp size={14}/>} />
                            <DetailItem label="Score" value={selectedNode.healthScore.toString()} icon={<HeartPulse size={14}/>} highlight />
                        </div>
                    </div>
                </div>
            )}

            {/* --- ADVANCED DASHBOARD --- */}
            {viewMode === 'advanced' && (
                <div className="absolute inset-0 z-40 pt-40 px-6 pb-6 overflow-y-auto custom-scrollbar bg-black/80 backdrop-blur-md animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6 pointer-events-auto">
                        
                        {/* 1. ANOMALY DETECTION */}
                        <div className="col-span-1 md:col-span-2 bg-[#0a0a0a] border border-red-900/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                            <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-4 flex gap-2"><BrainCircuit size={16}/> Anomaly Detection</h3>
                            <div className="h-32 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={anomalies.slice(0, 10)}>
                                        <Bar dataKey="healthScore" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                        <Tooltip cursor={{fill: 'transparent'}} contentStyle={{background: '#000', border: '1px solid #333'}}/>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* 2. NETWORK GROWTH (SUPABASE GRAFİĞİ) */}
                        <div className="col-span-1 bg-[#0a0a0a] border border-green-900/30 rounded-2xl p-6 shadow-xl">
                            <h3 className="text-xs font-bold text-green-400 uppercase tracking-widest flex items-center gap-2 mb-4"><History size={16}/> Network Growth (DB)</h3>
                            {dbHistory.length > 0 ? (
                                <div className="h-32 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={dbHistory}>
                                            <defs>
                                                <linearGradient id="colorHist" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                                </linearGradient>
                                            </defs>
                                            <Tooltip contentStyle={{background:'#000', border:'1px solid #333', fontSize:'10px' }}/>
                                            <Area type="monotone" dataKey="stake" stroke="#10b981" strokeWidth={2} fill="url(#colorHist)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="h-32 flex flex-col items-center justify-center text-xs text-gray-600 border border-dashed border-white/10 rounded">
                                    <span>Fetching Database...</span>
                                    <span className="text-[9px] mt-1 opacity-50">Make sure CRON job is running</span>
                                </div>
                            )}
                        </div>

                        {/* 3. LOGS */}
                        <div className="col-span-1 bg-black border border-white/10 rounded-2xl flex flex-col h-[200px] shadow-xl font-mono text-[10px]">
                            <div className="p-3 border-b border-white/10 bg-white/5"><h3 className="font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><TerminalIcon size={12}/> System Logs</h3></div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
                                {logs.map((log, i) => (
                                    <div key={i} className={`truncate pb-0.5 border-b border-white/[0.02] ${log.includes('ERROR') ? 'text-red-400' : 'text-green-500/80'}`}>
                                        <span className="opacity-30 mr-2">{'>'}</span>{log}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
            `}</style>
        </main>
    );
}

// ============================================================================
// 5. COMPONENTS
// ============================================================================

function TabButton({ active, onClick, icon, label }: any) {
    return (
        <button onClick={onClick} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-[10px] font-bold tracking-wider transition-all ${active ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.5)]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
            {icon} {label}
        </button>
    );
}

function MetricBox({ label, value, sub, color = "text-white" }: any) {
    return (
        <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-5 py-2 flex flex-col min-w-[100px] pointer-events-auto">
            <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">{label}</span>
            <div className={`text-xl font-bold leading-none mt-1 ${color}`}>{value} <span className="text-[10px] text-gray-600 font-normal ml-1">{sub}</span></div>
        </div>
    );
}

function DetailItem({ label, value, icon, highlight = false }: any) {
    return (
        <div className={`p-3 rounded-lg border ${highlight ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/5'}`}>
            <div className="flex items-center gap-2 mb-1 text-gray-400">
                {icon} <span className="text-[10px] uppercase font-bold tracking-wider">{label}</span>
            </div>
            <div className={`text-sm font-mono truncate ${highlight ? 'text-green-400 font-bold' : 'text-white'}`}>{value || '-'}</div>
        </div>
    );
}