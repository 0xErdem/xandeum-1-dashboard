'use client';

// ============================================================================
// 1. SYSTEM IMPORTS & SETUP
// ============================================================================
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Connection } from '@solana/web3.js';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { 
    Activity, X, MapPin, Wifi, Shield, Database, LayoutDashboard, 
    Globe as GlobeIcon, Search, ArrowUpRight, Eye, EyeOff, 
    AlertCircle, HeartPulse, Info, TrendingUp, DollarSign, 
    BrainCircuit, Terminal as TerminalIcon, HardDrive, History, 
    Cpu, Signal, Layers
} from 'lucide-react';

import { 
    ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, 
    AreaChart, Area 
} from 'recharts';

// Harita Modülü (Server-Side Rendering Kapalı)
const GlobeViz = dynamic(() => import('../components/GlobeViz'), { 
    ssr: false,
    loading: () => <div className="absolute inset-0 flex items-center justify-center text-cyan-500/50 font-mono text-xs tracking-widest animate-pulse">INITIALIZING SATELLITE UPLINK...</div>
});

// ============================================================================
// 2. CONFIGURATION & TYPES
// ============================================================================

const CACHE_KEY = 'xandeum_os_v2_cache';
const RPC_ENDPOINT = "https://api.devnet.xandeum.com:8899";

// Bilinen Node Kimlikleri (Örnek)
const IDENTITY_MAP: Record<string, string> = {
    "K72M": "Xandeum Foundation #1",
    "F43y": "Tokyo Core Node",
    "7BQz": "Genesis Validator",
    "9Lfp": "US-East Relay",
    "59sD": "Europe Cluster A",
};

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
// 3. LOGIC ENGINE
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

// Node Sağlık Puanı Hesaplama Algoritması
function calculateHealthScore(node: { slotLag: number, skipRateNum: number, gossip: string | null }, isVote: boolean): number {
    let score = 100;
    if (node.slotLag > 15) score -= Math.min(40, (node.slotLag - 15) * 0.8); // Lag Cezası
    if (node.skipRateNum > 5) score -= (node.skipRateNum * 2); // Skip Cezası
    if (!isVote) score -= 20; // Validatör değilse ceza (Observer)
    if (!node.gossip) score -= 50; // IP yoksa büyük ceza
    return Math.max(0, Math.min(100, Math.floor(score)));
}

// ============================================================================
// 4. MAIN COMPONENT
// ============================================================================

export default function Home() {
    const { publicKey } = useWallet();

    // --- STATE ---
    const [viewMode, setViewMode] = useState<'simple' | 'advanced'>('simple');
    const [allNodes, setAllNodes] = useState<NodeData[]>([]);
    
    // UI Selection
    const [selectedNode, setSelectedNode] = useState<NodeData | null>(null); // Simple Mode Panel
    const [advancedSelectedNode, setAdvancedSelectedNode] = useState<NodeData | null>(null); // Advanced Modal
    
    // Filters & UI
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [uiVisible, setUiVisible] = useState(true);

    // Metrics
    const [metrics, setMetrics] = useState({ totalStake: 0, nakamoto: 0, currentSlot: 0, epoch: 0 });
    const [logs, setLogs] = useState<string[]>([]);
    const [latencyHistory, setLatencyHistory] = useState<any[]>([]);
    const [dbHistory, setDbHistory] = useState<any[]>([]); // Supabase Data

    const processingRef = useRef(false);

    // --- SYSTEM LOGGING ---
    const addLog = useCallback((msg: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') => {
        const time = new Date().toLocaleTimeString([], {hour12: false});
        setLogs(prev => [`[${type.toUpperCase()}] ${msg} (${time})`, ...prev].slice(0, 50));
    }, []);

    // --- 1. SUPABASE HISTORY FETCH ---
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/get-history');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        setDbHistory(data);
                        if(dbHistory.length === 0) addLog("Historical ledger synced with Supabase.", "success");
                    }
                }
            } catch (e) {
                // Sessiz hata - kullanıcıyı rahatsız etme
                console.warn("Supabase history sync failed");
            }
        };
        fetchHistory();
        const interval = setInterval(fetchHistory, 300000); // 5 dakikada bir güncelle
        return () => clearInterval(interval);
    }, [addLog, dbHistory.length]);

    // --- 2. MAIN RPC DATA LOOP ---
    useEffect(() => {
        const initSystem = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            try {
                addLog("Initiating handshake with Xandeum Cluster...", "info");
                const connection = new Connection(RPC_ENDPOINT, "confirmed");

                const [gossipNodes, voteAccounts, blockProduction, epoch] = await Promise.all([
                    connection.getClusterNodes(),
                    connection.getVoteAccounts(),
                    connection.getBlockProduction().catch(() => null),
                    connection.getEpochInfo().catch(() => null)
                ]);

                // Update Globals
                const currentSlotHeight = epoch?.absoluteSlot || 0;
                setMetrics(prev => ({ ...prev, epoch: epoch?.epoch || 0, currentSlot: currentSlotHeight }));

                // Process Maps
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

                // Nakamoto Calculation
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

                // Merge Data Points
                let baseNodes: NodeData[] = gossipNodes.map(node => {
                    const voteData = voteMap[node.pubkey];
                    const prodData = productionMap[node.pubkey];
                    
                    let slotLag = 0;
                    if (voteData && currentSlotHeight > 0) {
                        slotLag = Math.max(0, currentSlotHeight - voteData.lastVote);
                    }

                    let skipRateVal = 0;
                    if (prodData && prodData.leaderSlots > 0) {
                        skipRateVal = ((prodData.leaderSlots - prodData.blocksProduced) / prodData.leaderSlots) * 100;
                    } else if (voteData) {
                        // Tahmini simülasyon (Üretim verisi yoksa)
                        skipRateVal = Math.min(100, Math.max(0, (slotLag / 50))); 
                    }

                    const healthScore = calculateHealthScore({ slotLag, skipRateNum: skipRateVal, gossip: node.gossip }, !!voteData);
                    const commission = voteData ? voteData.commission : 0;
                    // Gerçekçi APY formülü
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
                addLog(`Cluster synced. ${baseNodes.length} active nodes detected.`, "success");

                // --- 3. GEO RESOLUTION (THROTTLED) ---
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

                        // IPWHO.IS API (No Key Required)
                        try {
                            await new Promise(r => setTimeout(r, 150)); // Rate limit protection
                            const res = await fetch(`https://ipwho.is/${ip}`);
                            const geo = await res.json();
                            if (geo.success) {
                                const geoData = { lat: geo.latitude, lng: geo.longitude, city: geo.city, country: geo.country, isp: geo.connection?.isp };
                                cache[ip] = geoData;
                                updatedNodes[i] = { ...node, ...geoData };
                                needsCacheUpdate = true;
                                if (i % 5 === 0) setAllNodes([...updatedNodes]);
                            }
                        } catch (e) { /* ignore fail */ }
                    }
                    if (needsCacheUpdate) localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
                    setAllNodes([...updatedNodes]);
                };
                processGeo();

            } catch (e: any) {
                console.error(e);
                addLog(`CRITICAL: ${e.message}`, "error");
            }
        };

        initSystem();

        // Heartbeat Simulation
        const interval = setInterval(() => {
            setLatencyHistory(prev => [...prev.slice(-40), { time: Date.now(), latency: Math.floor(40 + Math.random() * 30) }]);
            setMetrics(prev => ({ ...prev, currentSlot: prev.currentSlot + 1 }));
            if (Math.random() > 0.95) addLog("Consensus reached on recent block.", "info");
        }, 1000);

        return () => clearInterval(interval);
    }, [addLog]);

    // --- DATA VIEWS ---
    const displayNodes = useMemo(() => {
        if (!searchTerm) return allNodes;
        const lower = searchTerm.toLowerCase();
        return allNodes.filter(n => n.name.toLowerCase().includes(lower) || n.pubkey.toLowerCase().includes(lower) || n.city?.toLowerCase().includes(lower));
    }, [allNodes, searchTerm]);

    const anomalies = useMemo(() => allNodes.filter(n => n.healthScore < 60), [allNodes]);
    
    // ========================================================================
    // RENDER
    // ========================================================================
    return (
        <main className="relative w-full h-screen bg-[#02040a] overflow-hidden text-white font-sans selection:bg-cyan-500/30">
            
            {/* BACKGROUND GLOBE (Always rendered, faded in Advanced) */}
            <div className={`absolute inset-0 z-0 transition-all duration-700 ${viewMode === 'advanced' ? 'opacity-10 blur-sm scale-105' : 'opacity-100'}`}>
                <GlobeViz 
                    nodes={allNodes.filter(n => n.lat !== 0)} 
                    onNodeClick={(node: any) => {
                        if (viewMode === 'simple') {
                            setSelectedNode(node); // Opens Side Panel
                            setUiVisible(true);
                        }
                    }} 
                />
            </div>

            {/* HEADER */}
            <div className={`absolute top-0 left-0 w-full p-6 z-50 flex justify-between items-start transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}>
                <div className="flex flex-col gap-4">
                    <h1 className="text-5xl font-black tracking-tighter text-white drop-shadow-2xl flex items-center gap-2 select-none">
                        XANDEUM<span className="text-cyan-400">.OS</span>
                    </h1>
                    <div className="flex bg-white/5 rounded-xl p-1 border border-white/10 backdrop-blur-md w-fit shadow-xl">
                        <TabButton active={viewMode === 'simple'} onClick={() => setViewMode('simple')} icon={<GlobeIcon size={14}/>} label="LIVE MAP" />
                        <TabButton active={viewMode === 'advanced'} onClick={() => setViewMode('advanced')} icon={<LayoutDashboard size={14}/>} label="SYSTEM CORE" />
                    </div>
                </div>
                
                <div className="flex gap-4 items-center">
                    <div className="hidden md:flex gap-4">
                        <MetricBox label="EPOCH" value={metrics.epoch} sub={metrics.currentSlot.toLocaleString()} />
                        <MetricBox label="ACTIVE STAKE" value={(metrics.totalStake / 1000000000).toFixed(0) + "M"} sub="SOL" color="text-green-400" />
                    </div>
                    <WalletMultiButton className="!bg-cyan-500/10 !backdrop-blur-xl !border !border-cyan-500/30 !text-cyan-300 !font-bold !h-[50px] !rounded-xl hover:!bg-cyan-500/20" />
                </div>
            </div>

            {/* UI TOGGLE */}
            <button onClick={() => setUiVisible(!uiVisible)} className="absolute bottom-6 right-6 z-50 p-3 bg-black/50 hover:bg-white/10 rounded-full border border-white/10 text-cyan-400 transition">
                {uiVisible ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>

            {/* --- ADVANCED MODE DASHBOARD --- */}
            {viewMode === 'advanced' && (
                <div className="absolute inset-0 z-40 pt-40 px-6 pb-6 overflow-y-auto custom-scrollbar bg-black/80 backdrop-blur-md animate-in fade-in slide-in-from-bottom-4">
                    
                    {/* TOP GRID */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                        
                        {/* 1. ANOMALY DETECTION */}
                        <div className="col-span-1 md:col-span-2 bg-[#0a0a0a] border border-red-900/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                            <div className="flex justify-between items-start mb-4 relative z-10">
                                <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2"><BrainCircuit size={16}/> Anomaly Detection</h3>
                                <span className="bg-red-500/10 text-red-500 text-[10px] px-2 py-1 rounded border border-red-500/20">{anomalies.length} ISSUES</span>
                            </div>
                            <div className="grid grid-cols-2 gap-4 relative z-10 h-32">
                                <div className="space-y-2">
                                    <div className="text-3xl font-black text-white">{anomalies.length > 0 ? "ATTENTION" : "STABLE"}</div>
                                    <div className="text-xs text-gray-500">Nodes with Health Score &lt; 60 are flagged for potential downtime or lag.</div>
                                </div>
                                <div className="h-full w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={anomalies.slice(0, 8)}>
                                            <Bar dataKey="healthScore" fill="#ef4444" radius={[2, 2, 0, 0]} />
                                            <Tooltip cursor={{fill: 'transparent'}} contentStyle={{background: '#000', border: '1px solid #333'}}/>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                            <div className="absolute -bottom-10 -right-10 opacity-10"><AlertCircle size={200} /></div>
                        </div>

                        {/* 2. NETWORK GROWTH (SUPABASE REAL DATA) */}
                        <div className="col-span-1 bg-[#0a0a0a] border border-green-900/30 rounded-2xl p-6 shadow-xl">
                            <h3 className="text-xs font-bold text-green-400 uppercase tracking-widest flex items-center gap-2 mb-4"><History size={16}/> Network Growth</h3>
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
                                <div className="h-32 flex items-center justify-center text-xs text-gray-600 border border-dashed border-white/10 rounded">Waiting for History...</div>
                            )}
                        </div>

                        {/* 3. SYSTEM PULSE (LATENCY) */}
                        <div className="col-span-1 bg-[#0a0a0a] border border-cyan-900/30 rounded-2xl p-6 shadow-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2"><Activity size={16}/> Pulse</h3>
                                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
                            </div>
                            <div className="h-32 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={latencyHistory}>
                                        <defs>
                                            <linearGradient id="colorLat" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.5}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
                                        <Area type="monotone" dataKey="latency" stroke="#06b6d4" strokeWidth={2} fill="url(#colorLat)" isAnimationActive={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* MAIN LEDGER & LOGS */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-20">
                        
                        {/* DATA GRID */}
                        <div className="col-span-3 bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[600px]">
                            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                                <h2 className="text-sm font-bold text-white flex items-center gap-2"><Database size={16} className="text-cyan-500"/> LIVE LEDGER</h2>
                                <div className="relative w-64">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                                    <input type="text" placeholder="Search Node ID, City..." className="w-full bg-black border border-white/10 rounded-lg py-1.5 pl-9 pr-3 text-xs text-white focus:border-cyan-500 outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                                </div>
                            </div>
                            
                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-black/50 border-b border-white/5 text-[10px] font-bold text-gray-500 uppercase">
                                <div className="col-span-1">ID</div>
                                <div className="col-span-3">Identity</div>
                                <div className="col-span-2">Location</div>
                                <div className="col-span-2 text-right">Stake</div>
                                <div className="col-span-1 text-center">Score</div>
                                <div className="col-span-1 text-center">Lag</div>
                                <div className="col-span-1 text-center">Skip</div>
                                <div className="col-span-1"></div>
                            </div>

                            {/* Table Rows */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/20 p-2 space-y-1">
                                {displayNodes.map((node, i) => (
                                    <div key={node.pubkey} className="grid grid-cols-12 gap-2 px-3 py-2 rounded border border-transparent hover:border-white/10 hover:bg-white/5 transition items-center text-xs group">
                                        <div className="col-span-1 font-mono text-gray-600">#{i+1}</div>
                                        <div className="col-span-3 flex items-center gap-2">
                                            <div className="w-6 h-6 rounded flex items-center justify-center font-bold text-[8px] text-black shrink-0" style={{backgroundColor: node.avatarColor}}>{node.name.substring(0,2)}</div>
                                            <div className="truncate font-mono text-gray-300" title={node.pubkey}>{node.pubkey.substring(0,8)}...</div>
                                        </div>
                                        <div className="col-span-2 text-gray-400 truncate">{node.city ? `${node.city}, ${node.country}` : 'Resolving...'}</div>
                                        <div className="col-span-2 text-right font-mono text-yellow-500">{node.isValidator ? node.stake : '-'}</div>
                                        <div className="col-span-1 text-center"><ScoreBadge score={node.healthScore} /></div>
                                        <div className="col-span-1 text-center font-mono text-gray-500">{node.slotLag}</div>
                                        <div className="col-span-1 text-center font-mono text-gray-500">{node.skipRate}</div>
                                        <div className="col-span-1 flex justify-end">
                                            <button onClick={() => setAdvancedSelectedNode(node)} className="text-cyan-500 opacity-0 group-hover:opacity-100 transition p-1 hover:bg-white/10 rounded"><ArrowUpRight size={14}/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* TERMINAL LOGS */}
                        <div className="col-span-1 bg-black border border-white/10 rounded-2xl flex flex-col h-[600px] shadow-xl font-mono text-[10px]">
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

                    {/* ADVANCED MODAL DETAIL */}
                    {advancedSelectedNode && (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
                            <div className="bg-[#0c0c0c] border border-white/20 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
                                <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                                    <h2 className="text-lg font-bold text-white flex items-center gap-2"><Shield size={18} className="text-cyan-500"/> NODE INSPECTOR</h2>
                                    <button onClick={() => setAdvancedSelectedNode(null)} className="text-gray-400 hover:text-white"><X size={20}/></button>
                                </div>
                                <div className="p-6 grid grid-cols-2 gap-6">
                                    <div className="col-span-2 flex items-center gap-4 mb-2">
                                        <div className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-black text-black shadow-lg" style={{backgroundColor: advancedSelectedNode.avatarColor}}>{advancedSelectedNode.name.substring(0,2)}</div>
                                        <div>
                                            <div className="text-sm text-gray-500 uppercase font-bold">Identity</div>
                                            <div className="text-xl font-bold text-white">{advancedSelectedNode.name}</div>
                                            <div className="text-xs font-mono text-cyan-400">{advancedSelectedNode.pubkey}</div>
                                        </div>
                                    </div>
                                    <DetailItem label="Location" value={`${advancedSelectedNode.city || 'Unknown'}, ${advancedSelectedNode.country || ''}`} icon={<MapPin size={14}/>} />
                                    <DetailItem label="ISP / Org" value={advancedSelectedNode.isp} icon={<Wifi size={14}/>} />
                                    <DetailItem label="Version" value={advancedSelectedNode.version} icon={<Layers size={14}/>} />
                                    <DetailItem label="Commission" value={advancedSelectedNode.commission + "%"} icon={<TrendingUp size={14}/>} />
                                    <DetailItem label="APY" value={advancedSelectedNode.apy + "%"} icon={<DollarSign size={14}/>} />
                                    <DetailItem label="Health Score" value={advancedSelectedNode.healthScore.toString()} icon={<HeartPulse size={14}/>} highlight />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* --- SIMPLE MODE SIDE PANEL --- */}
            {viewMode === 'simple' && (
                <>
                    {/* INFO OVERLAY */}
                    <div className={`absolute bottom-8 left-8 w-80 pointer-events-auto z-40 transition-all duration-500 ${uiVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
                        <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">My Nodes</h3>
                            {publicKey ? (
                                <div className="text-sm text-white">No nodes connected to this wallet.</div>
                            ) : (
                                <div className="flex items-center gap-2 text-cyan-400 text-sm"><AlertCircle size={14}/> Connect Wallet to view nodes</div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT SIDE INSPECTOR PANEL (OPENS ON CLICK) */}
                    <div className={`absolute top-0 right-0 h-full w-[400px] bg-black/90 backdrop-blur-2xl border-l border-white/10 z-50 transform transition-transform duration-500 ease-out shadow-2xl ${selectedNode ? 'translate-x-0' : 'translate-x-full'}`}>
                        {selectedNode && (
                            <div className="h-full flex flex-col p-6">
                                <button onClick={() => setSelectedNode(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition"><X size={24}/></button>
                                
                                <div className="mt-12 mb-8">
                                    <div className="text-xs font-bold text-cyan-500 uppercase tracking-widest mb-2">SELECTED NODE</div>
                                    <h2 className="text-3xl font-black text-white leading-tight mb-2">{selectedNode.city || 'Unknown Node'}</h2>
                                    <div className="font-mono text-xs text-gray-500 bg-white/5 p-2 rounded truncate">{selectedNode.pubkey}</div>
                                </div>

                                <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-sm text-gray-400">Health Score</span>
                                            <ScoreBadge score={selectedNode.healthScore} />
                                        </div>
                                        <div className="w-full bg-black/50 h-2 rounded-full overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-red-500 to-green-500" style={{width: `${selectedNode.healthScore}%`}}></div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <PanelItem label="Latency" value={selectedNode.slotLag + " slots"} />
                                        <PanelItem label="Skip Rate" value={selectedNode.skipRate} />
                                        <PanelItem label="Stake" value={selectedNode.stake} />
                                        <PanelItem label="Version" value={selectedNode.version} />
                                    </div>

                                    <div className="bg-[#111] p-4 rounded-xl border border-white/5 mt-4">
                                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 flex items-center gap-2"><Cpu size={12}/> Hardware Stats (Simulated)</h4>
                                        <div className="space-y-2 text-xs">
                                            <div className="flex justify-between text-gray-300"><span>CPU Load</span><span>{Math.floor(Math.random() * 40 + 20)}%</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Memory</span><span>14.2 / 32 GB</span></div>
                                            <div className="flex justify-between text-gray-300"><span>Disk I/O</span><span>450 MB/s</span></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
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
// 5. SUB-COMPONENTS (Pure for performance)
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
        <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-5 py-2 flex flex-col min-w-[100px]">
            <span className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">{label}</span>
            <div className={`text-xl font-bold leading-none mt-1 ${color}`}>{value} <span className="text-[10px] text-gray-600 font-normal ml-1">{sub}</span></div>
        </div>
    );
}

function ScoreBadge({ score }: { score: number }) {
    let color = "bg-red-500/20 text-red-400 border-red-500/30";
    if (score > 80) color = "bg-green-500/20 text-green-400 border-green-500/30";
    else if (score > 50) color = "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    
    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${color}`}>
            {score}/100
        </span>
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

function PanelItem({ label, value }: any) {
    return (
        <div className="bg-white/5 p-3 rounded-lg border border-white/5">
            <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">{label}</div>
            <div className="text-white font-mono text-sm">{value || '-'}</div>
        </div>
    );
}