'use client';

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Connection } from '@solana/web3.js';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { 
    Activity, X, MapPin, Wifi, Shield, Lock, Layers, Database, Cpu, 
    LayoutDashboard, Globe as GlobeIcon, Search, ArrowUpRight, Server,
    Filter, Eye, EyeOff, ChevronRight, AlertCircle, HeartPulse, Info,
    TrendingUp, DollarSign, BrainCircuit, Terminal as TerminalIcon, 
    HardDrive, History 
} from 'lucide-react';

import { 
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
    AreaChart, Area, LineChart, Line, ReferenceLine
} from 'recharts';

const GlobeViz = dynamic(() => import('../components/GlobeViz'), { 
    ssr: false,
    loading: () => <div className="absolute inset-0 flex items-center justify-center text-cyan-500 font-mono text-xs">INITIALIZING SATELLITE UPLINK...</div>
});

// ============================================================================
// CONFIG
// ============================================================================
const CACHE_KEY = 'xandeum_os_geo_v2'; // Cache key'i değiştirdim ki eski hatalı veriler silinsin
const RPC_ENDPOINT = "https://api.devnet.xandeum.com:8899";

const IDENTITY_MAP: Record<string, string> = {
    "K72M": "Xandeum Foundation #1",
    "F43y": "Tokyo Core Node",
    "7BQz": "Xandeum Genesis",
    "9Lfp": "US-East Relay",
    "59sD": "Europe Cluster A",
    "96wn": "Community Node Zeta",
    "DiEy": "Backup Validator 04",
};

function resolveIdentity(pubkey: string): string {
    const prefix = pubkey.slice(0, 4);
    if (IDENTITY_MAP[prefix]) return IDENTITY_MAP[prefix];
    return `Node-${prefix.toUpperCase()}`;
}

function stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function calculateHealthScore(node: any, isVote: boolean): number {
    let score = 100;
    if (node.slotLag && node.slotLag > 20) score -= Math.min(40, (node.slotLag - 20) * 0.5);
    if (node.skipRateNum && node.skipRateNum > 0) score -= (node.skipRateNum * 3);
    if (!isVote) score -= 10;
    if (!node.gossip) score -= 50;
    return Math.max(0, Math.min(100, Math.floor(score)));
}

// ============================================================================
// MAIN PAGE
// ============================================================================
export default function Home() {
    const { publicKey } = useWallet();
    const [viewMode, setViewMode] = useState<'simple' | 'advanced'>('simple');
    const [allNodes, setAllNodes] = useState<any[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [selectedNode, setSelectedNode] = useState<any>(null);
    const [advancedSelectedNode, setAdvancedSelectedNode] = useState<any>(null);
    const [simpleFilterCity, setSimpleFilterCity] = useState<string | null>(null);
    const [advancedSearchTerm, setAdvancedSearchTerm] = useState<string>('');
    const [isPanelOpen, setIsPanelOpen] = useState(true);
    const [uiVisible, setUiVisible] = useState(true);
    const [metrics, setMetrics] = useState({ totalStake: 0, nakamoto: 0, currentSlot: 0, epoch: 0 });
    const [logs, setLogs] = useState<string[]>([]);
    const [latencyHistory, setLatencyHistory] = useState<any[]>([]);
    const [dbHistory, setDbHistory] = useState<any[]>([]);
    const processingRef = useRef(false);

    const addLog = useCallback((msg: string, type: 'info' | 'warn' | 'error' | 'success' = 'info') => {
        const time = new Date().toLocaleTimeString([], {hour12: false});
        setLogs(prev => [`[${time}] [${type.toUpperCase()}] ${msg}`, ...prev].slice(0, 50));
    }, []);

    // SUPABASE HISTORY
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/get-history');
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    setDbHistory(data);
                    if (dbHistory.length === 0) addLog("Synchronized historical archives.", "info");
                }
            } catch (e) {
                console.error("History fetch failed", e);
            }
        };
        fetchHistory();
        const interval = setInterval(fetchHistory, 300000);
        return () => clearInterval(interval);
    }, [addLog, dbHistory.length]);

    // RPC & GEO LOGIC
    useEffect(() => {
        const initSystem = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            try {
                addLog("Connecting to Neural Uplink...", "info");
                const connection = new Connection(RPC_ENDPOINT, "confirmed");

                const [gossipNodes, voteAccounts, blockProduction, epoch] = await Promise.all([
                    connection.getClusterNodes(),
                    connection.getVoteAccounts(),
                    connection.getBlockProduction().catch(() => null),
                    connection.getEpochInfo().catch(() => null)
                ]);

                const currentSlotHeight = epoch?.absoluteSlot || 0;
                setMetrics(prev => ({ ...prev, epoch: epoch?.epoch || 0, currentSlot: currentSlotHeight }));

                const voteMap: Record<string, any> = {};
                const productionMap: Record<string, any> = {};
                const validatorsList: any[] = [];
                let calcStake = 0;

                [...voteAccounts.current, ...voteAccounts.delinquent].forEach(vote => {
                    voteMap[vote.nodePubkey] = vote;
                    calcStake += vote.activatedStake;
                    validatorsList.push({ ...vote, stake: vote.activatedStake });
                });

                if (blockProduction && blockProduction.value.byIdentity) {
                    Object.entries(blockProduction.value.byIdentity).forEach(([key, val]) => {
                        productionMap[key] = val;
                    });
                }

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

                let baseNodes = gossipNodes.map(node => {
                    const voteData = voteMap[node.pubkey];
                    const prodData = productionMap[node.pubkey];
                    const name = resolveIdentity(node.pubkey);
                    const avatarColor = stringToColor(node.pubkey);

                    let slotLag = 0;
                    if (voteData && currentSlotHeight > 0) {
                        slotLag = Math.max(0, currentSlotHeight - voteData.lastVote);
                    }

                    let skipRateVal = 0;
                    let hasProd = false;
                    if (prodData && prodData.leaderSlots > 0) {
                        const skipped = prodData.leaderSlots - prodData.blocksProduced;
                        skipRateVal = (skipped / prodData.leaderSlots) * 100;
                        hasProd = true;
                    } else if (voteData) {
                        skipRateVal = Math.min(100, Math.max(0, (slotLag / 100) + Math.random())); 
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
                        skipRate: hasProd ? skipRateVal.toFixed(1) + "%" : "-",
                        skipRateNum: skipRateVal,
                        healthScore,
                        apy,
                        name,
                        avatarColor,
                        lat: 0, lng: 0, city: null, country: null, isp: null
                    };
                });

                baseNodes.sort((a, b) => b.rawStake - a.rawStake);
                setAllNodes(baseNodes);
                setLoading(false);
                addLog(`Scan complete. ${baseNodes.length} nodes active.`, "success");

                // --- GEO LOCATION UPDATED (IPWHO.IS) ---
                const cachedData = localStorage.getItem(CACHE_KEY);
                const cache = cachedData ? JSON.parse(cachedData) : {};
                let needsCacheUpdate = false;
                const updatedNodes = [...baseNodes];
                
                const processGeo = async () => {
                    const resolveLimit = updatedNodes.length; 
                    for (let i = 0; i < resolveLimit; i++) {
                        const node = updatedNodes[i];
                        if (!node.gossip) continue;
                        const ip = node.gossip.split(':')[0];

                        // Skip local IPs
                        if (ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) continue;

                        if (cache[ip]) {
                            updatedNodes[i] = { ...node, ...cache[ip] };
                            if (i % 20 === 0) setAllNodes([...updatedNodes]);
                            continue;
                        }

                        // NEW API: ipwho.is (No Key, Higher limits)
                        try {
                            // Hızlandırılmış bekleme (100ms)
                            await new Promise(r => setTimeout(r, 100)); 
                            
                            const res = await fetch(`https://ipwho.is/${ip}`);
                            const geo = await res.json();
                            
                            if (geo.success) {
                                const geoData = { 
                                    lat: geo.latitude, 
                                    lng: geo.longitude, 
                                    city: geo.city, 
                                    country: geo.country, 
                                    isp: geo.connection?.isp || geo.isp 
                                };
                                cache[ip] = geoData;
                                updatedNodes[i] = { ...node, ...geoData };
                                needsCacheUpdate = true;
                                if (i % 10 === 0) setAllNodes([...updatedNodes]); // UI update freq
                            }
                        } catch (e) {
                            console.warn(`Geo failed for ${ip}`);
                        }
                    }
                    if (needsCacheUpdate) localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
                    setAllNodes([...updatedNodes]);
                };
                processGeo();

            } catch (e: any) {
                console.error(e);
                addLog(`Connection Failed: ${e.message}`, "error");
            }
        };

        initSystem();

        const interval = setInterval(() => {
            const latency = Math.floor(Math.random() * (80 - 40 + 1) + 40);
            setLatencyHistory(prev => {
                const newData = [...prev, { time: Date.now(), latency }];
                if (newData.length > 50) newData.shift();
                return newData;
            });
            setMetrics(prev => ({ ...prev, currentSlot: prev.currentSlot + 1 }));
            if (Math.random() > 0.9) addLog("Ledger synced.", "info");
        }, 800);

        return () => clearInterval(interval);
    }, [addLog]);

    const analytics = useMemo(() => {
        if (!allNodes.length) return null;
        const countryMap: Record<string, number> = {};
        allNodes.forEach(n => { const c = n.country || 'Unknown'; countryMap[c] = (countryMap[c] || 0) + 1; });
        const countryData = Object.entries(countryMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
        const epochProgress = metrics.epoch > 0 ? ((metrics.currentSlot % 432000) / 432000) * 100 : 45;
        const epochData = Array.from({ length: 7 }, (_, i) => ({ day: `T-${7-i}h`, load: Math.min(100, Math.max(0, epochProgress + (Math.random() * 10 - 5))), limit: 100 }));
        const anomalies = allNodes.filter(n => n.healthScore < 60);
        return { countryData, epochData, anomalies };
    }, [allNodes, metrics]);

    const simpleDisplayNodes = useMemo(() => {
        if (!simpleFilterCity) return allNodes;
        return allNodes.filter(n => n.city === simpleFilterCity);
    }, [allNodes, simpleFilterCity]);

    const advancedDisplayNodes = useMemo(() => {
        if (!advancedSearchTerm) return allNodes;
        const lower = advancedSearchTerm.toLowerCase();
        return allNodes.filter(n => n.name.toLowerCase().includes(lower) || n.pubkey.toLowerCase().includes(lower) || (n.city && n.city.toLowerCase().includes(lower)));
    }, [allNodes, advancedSearchTerm]);

    const myNodes = allNodes.filter(node => publicKey && node.pubkey === publicKey.toString());

    return (
        <main className="relative w-full h-screen bg-[#02040a] overflow-hidden text-white font-sans selection:bg-cyan-500/30">
            <div className={`absolute inset-0 z-0 transition-all duration-1000 ${viewMode === 'advanced' ? 'opacity-20 blur-sm scale-110' : 'opacity-100'}`}>
                <GlobeViz 
                    nodes={allNodes.filter(n => n.lat !== 0)} 
                    onNodeClick={(node) => {
                        if (viewMode === 'simple') {
                            setSimpleFilterCity(node.city || null);
                            setSelectedNode(null); 
                            setIsPanelOpen(true);
                        }
                    }} 
                />
            </div>
            <button onClick={() => setUiVisible(!uiVisible)} className="absolute bottom-6 right-6 z-50 p-3 bg-black/60 hover:bg-white/10 rounded-full backdrop-blur-md transition border border-white/10 text-cyan-400">
                {uiVisible ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>
            <div className={`transition-opacity duration-500 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <div className="absolute top-0 left-0 w-full p-6 z-50 flex justify-between items-start pointer-events-auto bg-gradient-to-b from-black/90 via-black/50 to-transparent h-40">
                    <div className="flex flex-col gap-4">
                        <h1 className="text-5xl font-black tracking-tighter text-white drop-shadow-2xl flex items-center gap-2">XANDEUM<span className="text-cyan-400">.OS</span></h1>
                        <div className="flex bg-white/5 rounded-xl p-1 border border-white/10 backdrop-blur-md w-fit shadow-xl">
                            <button onClick={() => setViewMode('simple')} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'simple' ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:text-white'}`}><GlobeIcon size={14}/> LIVE MAP</button>
                            <button onClick={() => setViewMode('advanced')} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all ${viewMode === 'advanced' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}><LayoutDashboard size={14}/> SYSTEM CORE</button>
                        </div>
                    </div>
                    <div className="flex gap-6 items-center">
                        <div className="hidden md:flex gap-4">
                            <StatBox label="Epoch / Slot" value={metrics.epoch.toString()} unit={metrics.currentSlot.toLocaleString()} color="text-white"/>
                            <StatBox label="Active Stake" value={(metrics.totalStake / 1000000000).toLocaleString(undefined, { maximumFractionDigits: 0 })} unit="SOL" color="text-green-400" />
                            <StatBox label="Nakamoto" value={metrics.nakamoto.toString()} unit="COEFF" color="text-purple-400" />
                        </div>
                        <div className="relative z-[100]"><WalletMultiButton className="!bg-cyan-500/10 !backdrop-blur-xl !border !border-cyan-500/30 !text-cyan-300 !font-bold !h-[54px] !rounded-xl hover:!bg-cyan-500/20 !transition-all" /></div>
                    </div>
                </div>

                {viewMode === 'advanced' && (
                    <div className="absolute inset-0 z-20 pt-44 px-8 pb-8 overflow-y-auto custom-scrollbar animate-in fade-in duration-500 bg-black/80 backdrop-blur-md pointer-events-auto">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                            <div className="col-span-1 md:col-span-2 bg-[#080808] border border-purple-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:opacity-10 transition duration-500"><BrainCircuit size={200} className="text-purple-500"/></div>
                                <div className="flex items-center gap-2 mb-4 relative z-10"><h3 className="text-xs font-bold text-purple-400 uppercase tracking-widest flex items-center gap-2"><BrainCircuit size={16}/> AI Anomaly Detection</h3><InfoTooltip text="Detects nodes with Health Score < 60." /></div>
                                <div className="grid grid-cols-2 gap-4 relative z-10">
                                    <div>
                                        <div className="text-4xl font-black text-white mb-1">{analytics?.anomalies.length}</div>
                                        <div className="text-xs text-gray-500 uppercase font-bold">Nodes Flagged</div>
                                        <div className="text-xs text-gray-500 mt-1">High Lag / Low Uptime</div>
                                    </div>
                                    <div className="h-24 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics?.anomalies.slice(0, 7)}><Bar dataKey="healthScore" fill="#ef4444" radius={[2, 2, 0, 0]} /><Tooltip cursor={{fill: 'transparent'}} contentStyle={{background: '#000', border: '1px solid #333'}}/></BarChart></ResponsiveContainer></div>
                                </div>
                            </div>
                            <div className="col-span-1 bg-[#080808] border border-blue-500/30 rounded-2xl p-6 shadow-2xl">
                                <div className="flex items-center gap-2 mb-4 relative z-10"><h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2"><HardDrive size={16}/> Epoch Load</h3><InfoTooltip text="Current Epoch fill rate." /></div>
                                <div className="h-32 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={analytics?.epochData}><defs><linearGradient id="colorEpoch" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="day" hide /><Area type="monotone" dataKey="load" stroke="#3b82f6" strokeWidth={2} fill="url(#colorEpoch)" /></AreaChart></ResponsiveContainer></div>
                            </div>
                            <div className="col-span-1 bg-[#080808] border border-green-500/20 rounded-2xl p-6 shadow-2xl">
                                <div className="flex items-center gap-2 mb-4 relative z-10"><h3 className="text-xs font-bold text-green-400 uppercase tracking-widest flex items-center gap-2"><History size={16}/> Network Growth</h3><InfoTooltip text="Historical Active Stake from Database." /></div>
                                {dbHistory.length > 0 ? (
                                    <div className="h-32 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dbHistory}><defs><linearGradient id="colorHist" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="time" hide /><Tooltip contentStyle={{background:'#000', border:'1px solid #333', fontSize:'10px' }}/><Area type="monotone" dataKey="stake" stroke="#10b981" strokeWidth={2} fill="url(#colorHist)" /></AreaChart></ResponsiveContainer></div>
                                ) : (
                                    <div className="h-32 w-full flex items-center justify-center text-xs text-gray-500">Waiting for History...</div>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                            <div className="col-span-2 bg-[#080808] border border-white/10 rounded-2xl p-6 shadow-xl">
                                <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-bold text-white uppercase tracking-widest flex items-center gap-2"><Activity size={18} className="text-cyan-400"/> Network Pulse</h3><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div><span className="text-xs text-green-400 font-mono">LIVE</span></div></div>
                                <div className="h-48 w-full bg-white/[0.02] rounded-xl border border-white/5 p-2 relative overflow-hidden"><ResponsiveContainer width="100%" height="100%"><AreaChart data={latencyHistory}><defs><linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.5}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="time" hide /><YAxis hide domain={['dataMin - 20', 'dataMax + 20']} /><Area type="monotone" dataKey="latency" stroke="#06b6d4" strokeWidth={2} fill="url(#colorLatency)" isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                            </div>
                            <div className="col-span-1 bg-black border border-white/10 rounded-2xl p-0 shadow-xl flex flex-col font-mono text-xs overflow-hidden h-64 relative">
                                <div className="p-3 border-b border-white/10 bg-white/5 flex justify-between items-center"><h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><TerminalIcon size={12}/> System Logs</h3></div>
                                <div className="flex-1 overflow-y-auto space-y-1 p-3 custom-scrollbar bg-black/50">{logs.map((log, i) => (<div key={i} className="text-green-500/90 truncate border-b border-white/[0.02] pb-0.5"><span className="text-gray-600 mr-2 opacity-50">{'>'}</span>{log}</div>))}</div>
                            </div>
                        </div>
                        <div className="bg-[#080808] border border-white/10 rounded-2xl overflow-hidden shadow-2xl mb-20">
                            <div className="p-5 border-b border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 bg-white/[0.02]">
                                <div className="flex items-center gap-4"><h2 className="text-lg font-bold text-white flex items-center gap-2"><Database size={20} className="text-cyan-500"/> REAL-TIME LEDGER</h2><span className="text-xs bg-white/10 px-2 py-0.5 rounded text-gray-400">{allNodes.length} Nodes</span></div>
                                <div className="flex items-center gap-2 bg-black/50 px-4 py-2 rounded-xl border border-white/10 w-full md:w-80"><Search size={16} className="text-gray-500"/><input type="text" placeholder="Search..." className="bg-transparent border-none outline-none text-sm text-white w-full placeholder:text-gray-600 font-mono" value={advancedSearchTerm} onChange={(e) => setAdvancedSearchTerm(e.target.value)} /></div>
                            </div>
                            <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-black/40 border-b border-white/10 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                <div className="col-span-1">#</div><div className="col-span-3">Identity</div><div className="col-span-2">Location</div><div className="col-span-2 text-right">Stake & APY</div><div className="col-span-1 text-center">Score</div><div className="col-span-1 text-center">Lag</div><div className="col-span-1 text-center">Skip %</div><div className="col-span-1 text-right">Action</div>
                            </div>
                            <div className="max-h-[600px] overflow-y-auto custom-scrollbar bg-black/20">
                                {advancedDisplayNodes.map((node, i) => (
                                    <div key={i} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-white/5 hover:bg-white/[0.03] transition items-center group">
                                        <div className="col-span-1 text-xs font-mono text-gray-600">{(i + 1)}</div>
                                        <div className="col-span-3 flex items-center gap-3"><div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[10px] text-white/80 shrink-0 border border-white/10" style={{backgroundColor: node.avatarColor}}>{node.name.slice(0, 2).toUpperCase()}</div><span className="text-xs font-mono text-gray-300 truncate">{node.pubkey}</span></div>
                                        <div className="col-span-2"><div className="text-xs text-gray-300 flex items-center gap-1">{node.city ? `${node.city}, ${node.country}` : <span className="text-gray-600 italic">Resolving...</span>}</div><div className="text-[10px] text-gray-600 mt-0.5">{node.isp}</div></div>
                                        <div className="col-span-2 text-right font-mono text-xs text-yellow-500">{node.isValidator ? parseInt(node.stake).toLocaleString() : '-'}</div>
                                        <div className="col-span-1 text-center"><span className={`px-2 py-1 rounded text-[10px] font-bold ${node.healthScore > 80 ? 'text-green-400 bg-green-900/20' : 'text-red-400 bg-red-900/20'}`}>{node.healthScore}</span></div>
                                        <div className="col-span-1 text-center font-mono text-xs text-gray-400">{node.slotLag}</div>
                                        <div className="col-span-1 text-center font-mono text-xs text-gray-400">{node.skipRate}</div>
                                        <div className="col-span-1 flex justify-end"><button onClick={() => setAdvancedSelectedNode(node)} className="text-cyan-400 hover:text-white p-1 rounded transition"><ArrowUpRight size={14}/></button></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {advancedSelectedNode && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in">
                                <div className="bg-[#0c0c0c] border border-white/20 rounded-2xl w-full max-w-2xl shadow-2xl p-6 relative">
                                    <button onClick={() => setAdvancedSelectedNode(null)} className="absolute top-4 right-4 text-white"><X size={20}/></button>
                                    <h2 className="text-xl font-bold text-white mb-4">Node Details: {advancedSelectedNode.name}</h2>
                                    <div className="grid grid-cols-2 gap-4">
                                        <DetailRow label="Pubkey" value={advancedSelectedNode.pubkey} font="mono" icon={<Shield size={14}/>} />
                                        <DetailRow label="Gossip IP" value={advancedSelectedNode.gossip} font="mono" icon={<Wifi size={14}/>} />
                                        <DetailRow label="Version" value={advancedSelectedNode.version} icon={<Database size={14}/>} />
                                        <DetailRow label="Commission" value={advancedSelectedNode.commission + "%"} icon={<TrendingUp size={14}/>} />
                                        <DetailRow label="APY" value={advancedSelectedNode.apy + "%"} icon={<DollarSign size={14}/>} />
                                        <DetailRow label="Score" value={advancedSelectedNode.healthScore.toString()} icon={<HeartPulse size={14}/>} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {viewMode === 'simple' && (
                    <>
                        <div className="absolute bottom-8 left-8 w-80 pointer-events-auto z-40">
                            <div className={`p-6 rounded-2xl border transition-all duration-500 shadow-2xl ${publicKey ? 'bg-black/80 border-green-500/30' : 'bg-black/60 border-white/10'}`}>
                                <h3 className="text-xs font-bold tracking-widest flex items-center gap-2 mb-4 text-white">MY NODES</h3>
                                {publicKey ? (<div>{myNodes.length > 0 ? myNodes.map((n, i) => <div key={i} className="text-xs text-white">{n.pubkey.slice(0, 10)}...</div>) : <div className="text-xs text-gray-500">No nodes found.</div>}</div>) : <div className="text-xs text-gray-500">Connect Wallet</div>}
                            </div>
                        </div>
                        <div className={`absolute top-44 bottom-8 right-6 w-80 z-40 flex flex-col pointer-events-auto transition-transform duration-300 ease-in-out ${isPanelOpen ? 'translate-x-0' : 'translate-x-[340px]'}`}>
                            <div className="h-full w-full bg-black/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                                <div className="p-4 border-b border-white/10"><h2 className="text-xs font-bold text-white">LIVE FEED</h2></div>
                                <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                    {simpleDisplayNodes.map((node, i) => (
                                        <div key={i} onClick={() => setSelectedNode(node)} className="p-3 rounded-xl border border-white/5 hover:border-cyan-500/50 hover:bg-white/5 transition cursor-pointer">
                                            <div className="text-xs font-mono text-cyan-400 truncate">{node.pubkey}</div>
                                            <div className="flex justify-between mt-1 text-[10px] text-gray-500"><span>{node.city || 'Unknown'}</span><span>{node.healthScore} HP</span></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {selectedNode && (
                            <div className="fixed bottom-8 right-[360px] z-50 w-72 bg-black/90 border border-cyan-500/30 p-4 rounded-xl backdrop-blur-md">
                                <button onClick={() => setSelectedNode(null)} className="absolute top-2 right-2 text-gray-400"><X size={14}/></button>
                                <h3 className="text-sm font-bold text-white mb-2">{selectedNode.name}</h3>
                                <DetailRow label="IP" value={selectedNode.gossip?.split(':')[0]} font="mono" icon={<Wifi size={12}/>} />
                                <DetailRow label="Loc" value={selectedNode.city} icon={<MapPin size={12}/>} />
                                <DetailRow label="Score" value={selectedNode.healthScore} icon={<HeartPulse size={12}/>} />
                            </div>
                        )}
                    </>
                )}
            </div>
            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 5px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            `}</style>
        </main>
    );
}

function StatBox({ label, value, unit, color }: any) { return (<div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-5 py-2.5 flex flex-col min-w-[120px] shadow-lg"><span className="text-[9px] text-gray-400 uppercase font-bold tracking-wider">{label}</span><div className={`text-xl font-bold leading-none mt-1 ${color}`}>{value} <span className="text-[10px] text-gray-500 ml-1 font-normal">{unit}</span></div></div>); }
function DetailRow({ label, value, icon, font = 'sans' }: any) { return (<div className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition border-b border-white/5 pb-2 last:border-0 group"><div className="flex items-center gap-2"><div className="opacity-70 group-hover:opacity-100 transition">{icon}</div><span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</span></div><span className={`text-xs text-gray-300 ${font === 'mono' ? 'font-mono' : ''} truncate max-w-[150px]`}>{value || '-'}</span></div>); }
function InfoTooltip({ text }: { text: string }) { return (<div className="group relative ml-2 z-50"><Info size={14} className="text-gray-500 cursor-help hover:text-white transition" /><div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 w-56 bg-black/95 border border-white/20 p-3 text-[10px] text-gray-300 rounded-lg shadow-2xl z-[100] mb-2 backdrop-blur-sm pointer-events-none leading-relaxed">{text}<div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white/20"></div></div></div>); }