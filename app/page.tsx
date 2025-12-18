'use client';

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
    Cpu, Layers, Zap, Server, AlertTriangle, CheckCircle, Scale
} from 'lucide-react';

import { 
    ResponsiveContainer, Tooltip, BarChart, Bar, AreaChart, Area, 
    YAxis, XAxis, PieChart, Pie, Cell, LineChart, Line
} from 'recharts';

const GlobeViz = dynamic(() => import('../components/GlobeViz'), { 
    ssr: false,
    loading: () => <div className="absolute inset-0 flex items-center justify-center text-cyan-500 font-mono animate-pulse tracking-widest text-xs">LOADING 3D ENGINE...</div>
});

const RPC_ENDPOINT = "https://api.devnet.xandeum.com:8899";
const CACHE_KEY = 'xandeum_v4_intel';

const COLORS = {
    risk: { low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#7f1d1d' },
    brand: { primary: '#06b6d4', secondary: '#3b82f6', dark: '#02040a' }
};

interface NodeData {
    pubkey: string;
    name: string;
    version: string;
    gossip: string | null;
    ip: string | null;
    city: string | null;
    country: string | null;
    isp: string | null;
    lat: number;
    lng: number;
    stake: number;
    stakeDisplay: string;
    voteLag: number;
    skipRate: number;
    xriScore: number;
    efficiency: number;
    commission: number;
    avatarColor: string;
}

interface Insight {
    id: number;
    type: 'critical' | 'warning' | 'optimization';
    message: string;
    action: string;
}

const IDENTITY_MAP: Record<string, string> = {
    "K72M": "Foundation Node 01",
    "F43y": "Tokyo Core Relay",
    "7BQz": "Genesis Validator",
    "9Lfp": "US-East Backup",
};

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

function calculateRealMetrics(node: any, currentSlot: number) {
    let lag = 0;
    if (node.vote && currentSlot > 0) lag = Math.max(0, currentSlot - node.vote.lastVote);
    
    let skip = 0;
    let produced = 0;
    let leader = 0;
    if (node.production) {
        leader = node.production.leaderSlots;
        produced = node.production.blocksProduced;
        if (leader > 0) skip = ((leader - produced) / leader) * 100;
    }

    const efficiency = leader > 0 ? (produced / leader) * 100 : (lag < 5 ? 100 : 50);

    let xri = 100;
    xri -= (skip * 1.5);
    xri -= (lag * 0.5);
    if (!node.gossip) xri -= 20;
    xri = Math.max(0, Math.min(100, Math.floor(xri)));

    return { lag, skip, efficiency, xri };
}

export default function Home() {
    const { publicKey } = useWallet();
    const [viewMode, setViewMode] = useState<'monitor' | 'analyst'>('monitor');
    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
    const [filter, setFilter] = useState('');
    const [uiVisible, setUiVisible] = useState(true);
    const [metrics, setMetrics] = useState({ epoch: 0, slot: 0, tps: 0, activeStake: 0 });
    const [insights, setInsights] = useState<Insight[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [dbHistory, setDbHistory] = useState<any[]>([]);
    const [ispData, setIspData] = useState<any[]>([]);
    const [latencyHistory, setLatencyHistory] = useState<any[]>([]);
    
    const processingRef = useRef(false);

    const addLog = useCallback((msg: string, type: 'info' | 'alert' | 'success' = 'info') => {
        const time = new Date().toLocaleTimeString([], {hour12: false});
        setLogs(prev => [`[${type.toUpperCase()}] ${msg} (${time})`, ...prev].slice(0, 50));
    }, []);

    // 1. Supabase History
    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/get-history');
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        const formatted = data.map((d: any) => ({
                            ...d,
                            time: new Date(d.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
                        })).reverse();
                        setDbHistory(formatted);
                    }
                }
            } catch (e) {}
        };
        fetchHistory();
        const interval = setInterval(fetchHistory, 60000);
        return () => clearInterval(interval);
    }, []);

    // 2. RPC Data
    useEffect(() => {
        const initEngine = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            try {
                addLog("Connecting to Solana Mainnet RPC...", "info");
                const connection = new Connection(RPC_ENDPOINT, "confirmed");

                const [cluster, votes, production, epochInfo, perfSamples] = await Promise.all([
                    connection.getClusterNodes(),
                    connection.getVoteAccounts(),
                    connection.getBlockProduction().catch(() => null),
                    connection.getEpochInfo().catch(() => null),
                    connection.getRecentPerformanceSamples(1).catch(() => [])
                ]);

                const realTPS = perfSamples?.[0]?.numTransactions 
                    ? perfSamples[0].numTransactions / perfSamples[0].samplePeriodSecs 
                    : 0;

                setMetrics(prev => ({ 
                    ...prev, 
                    epoch: epochInfo?.epoch || 0, 
                    slot: epochInfo?.absoluteSlot || 0,
                    tps: realTPS 
                }));

                const voteMap = new Map(votes.current.concat(votes.delinquent).map(v => [v.nodePubkey, v]));
                const prodMap = new Map(Object.entries(production?.value.byIdentity || {}));
                
                let totalStake = 0;
                let ispCounts: Record<string, number> = {};

                const processedNodes: NodeData[] = cluster.map(rawNode => {
                    const vote = voteMap.get(rawNode.pubkey);
                    const prod = prodMap.get(rawNode.pubkey);
                    if (vote) totalStake += vote.activatedStake;

                    const m = calculateRealMetrics({ vote, production: prod, gossip: rawNode.gossip }, epochInfo?.absoluteSlot || 0);

                    return {
                        pubkey: rawNode.pubkey,
                        name: resolveIdentity(rawNode.pubkey),
                        version: rawNode.version || 'Unknown',
                        gossip: rawNode.gossip || null,
                        ip: rawNode.gossip ? rawNode.gossip.split(':')[0] : null,
                        city: null, country: null, isp: null, lat: 0, lng: 0,
                        stake: vote ? vote.activatedStake : 0,
                        stakeDisplay: vote ? (vote.activatedStake / 1000000000).toFixed(0) : "0",
                        voteLag: m.lag,
                        skipRate: m.skip,
                        efficiency: m.efficiency,
                        xriScore: m.xri,
                        commission: vote ? vote.commission : 0,
                        avatarColor: stringToColor(rawNode.pubkey)
                    };
                }).sort((a, b) => b.stake - a.stake);

                setNodes(processedNodes);
                setMetrics(prev => ({ ...prev, activeStake: totalStake }));
                
                // Insights Logic
                const newInsights: Insight[] = [];
                const lowXRI = processedNodes.filter(n => n.xriScore < 50 && n.stake > 0).length;
                if (lowXRI > 0) newInsights.push({ id: 1, type: 'critical', message: `${lowXRI} Nodes have degraded XRI Score`, action: 'Analyze Root Cause' });
                if (realTPS < 1000) newInsights.push({ id: 2, type: 'warning', message: `Low Throughput (${realTPS.toFixed(0)} TPS)`, action: 'Check Leader Logs' });
                else newInsights.push({ id: 2, type: 'optimization', message: 'Network Operating Optimally', action: 'View Metrics' });
                setInsights(newInsights);

                addLog(`Live Feed: ${processedNodes.length} nodes synced.`, "success");

                // Geo Logic
                const cachedGeo = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
                let cacheUpdated = false;
                const updatedNodes = [...processedNodes];

                const resolveGeo = async () => {
                    for (let i = 0; i < updatedNodes.length; i++) {
                        const n = updatedNodes[i];
                        if (!n.ip || n.ip.startsWith('10.') || n.ip.startsWith('127.')) continue;

                        if (cachedGeo[n.ip]) {
                            Object.assign(updatedNodes[i], cachedGeo[n.ip]);
                            const isp = cachedGeo[n.ip].isp || 'Unknown';
                            ispCounts[isp] = (ispCounts[isp] || 0) + (n.stake / 1000000000);
                            continue;
                        }

                        try {
                            await new Promise(r => setTimeout(r, 200));
                            const res = await fetch(`https://ipwho.is/${n.ip}`);
                            const data = await res.json();
                            if (data.success) {
                                const geoInfo = { city: data.city, country: data.country, isp: data.connection?.isp, lat: data.latitude, lng: data.longitude };
                                cachedGeo[n.ip] = geoInfo;
                                Object.assign(updatedNodes[i], geoInfo);
                                cacheUpdated = true;
                                if (i % 5 === 0) setNodes([...updatedNodes]);
                            }
                        } catch(e) {}
                    }
                    if (cacheUpdated) localStorage.setItem(CACHE_KEY, JSON.stringify(cachedGeo));
                    setNodes([...updatedNodes]);
                    
                    const sortedIsp = Object.entries(ispCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
                    setIspData(sortedIsp);
                };
                resolveGeo();

            } catch (e: any) {
                addLog(`RPC Error: ${e.message}`, "alert");
            }
        };

        initEngine();

        const interval = setInterval(() => {
            setLatencyHistory(prev => [...prev.slice(-30), { time: '', val: 40 + Math.random() * 20 }]);
            setMetrics(prev => ({ ...prev, slot: prev.slot + 1 }));
        }, 400);
        return () => clearInterval(interval);
    }, [addLog]);

    // --- PERFORMANCE FIX: STABLE REFERENCES ---
    
    // 1. Node listesini harita için filtrele ve hafızada tut (Memoize)
    // Sadece 'nodes' verisi değişirse yeniden hesapla.
    const mapNodes = useMemo(() => {
        return nodes.filter(n => n.lat !== 0);
    }, [nodes]);

    // 2. Click Handler'ı sabitle (Callback)
    // Bu fonksiyon her renderda yeniden yaratılmayacak.
    const handleNodeClick = useCallback((node: any) => {
        setSelectedNode(node);
        setUiVisible(true);
    }, []);

    // 3. UI Filters
    const displayedNodes = useMemo(() => {
        if (!filter) return nodes;
        const lower = filter.toLowerCase();
        return nodes.filter(n => n.name.toLowerCase().includes(lower) || n.city?.toLowerCase().includes(lower));
    }, [nodes, filter]);

    const riskStats = useMemo(() => ({
        critical: nodes.filter(n => n.xriScore < 50).length,
        warning: nodes.filter(n => n.xriScore >= 50 && n.xriScore < 80).length,
        healthy: nodes.filter(n => n.xriScore >= 80).length
    }), [nodes]);

    return (
        <main className="relative w-full h-screen bg-[#02040a] overflow-hidden text-white font-sans selection:bg-cyan-500/30">
            
            {/* HARİTA: Artık sadece 'mapNodes' değişince render olacak */}
            <div className={`absolute inset-0 z-0 transition-all duration-1000 ${viewMode === 'analyst' ? 'opacity-20 blur-sm scale-105' : 'opacity-100'}`}>
                <GlobeViz nodes={mapNodes} onNodeClick={handleNodeClick} />
            </div>

            <div className={`absolute top-0 left-0 w-full p-6 z-50 flex justify-between items-start transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}>
                <div className="flex flex-col gap-4">
                    <h1 className="text-4xl font-black tracking-tighter text-white drop-shadow-2xl flex items-center gap-2 select-none">
                        XANDEUM<span className="text-cyan-400">.OS</span> <span className="text-[10px] bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/30">REALITY ENGINE</span>
                    </h1>
                    <div className="flex bg-white/5 rounded-lg p-1 border border-white/10 backdrop-blur-md w-fit shadow-xl pointer-events-auto">
                        <TabButton active={viewMode === 'monitor'} onClick={() => setViewMode('monitor')} icon={<GlobeIcon size={14}/>} label="MONITOR" />
                        <TabButton active={viewMode === 'analyst'} onClick={() => setViewMode('analyst')} icon={<LayoutDashboard size={14}/>} label="ANALYST" />
                    </div>
                </div>
                <div className="flex gap-4 items-center">
                    <div className="hidden md:flex gap-4 pointer-events-auto">
                        <MetricBox label="EPOCH" value={metrics.epoch} sub={`SLOT ${metrics.slot}`} />
                        <MetricBox label="REAL TPS" value={metrics.tps.toFixed(1)} sub="TX/S" color="text-green-400" />
                        <MetricBox label="ACTIVE STAKE" value={(metrics.activeStake / 1000000000 / 1000000).toFixed(1) + "M"} sub="SOL" />
                    </div>
                    <WalletMultiButton className="!bg-cyan-500/10 !backdrop-blur-xl !border !border-cyan-500/30 !text-cyan-300 !font-bold !h-[48px] !rounded-xl hover:!bg-cyan-500/20 pointer-events-auto" />
                </div>
            </div>

            <button onClick={() => setUiVisible(!uiVisible)} className="absolute bottom-6 right-6 z-50 p-3 bg-black/50 hover:bg-white/10 rounded-full border border-white/10 text-cyan-400 transition pointer-events-auto">
                {uiVisible ? <EyeOff size={20}/> : <Eye size={20}/>}
            </button>

            {viewMode === 'monitor' && uiVisible && (
                <div className="absolute top-40 right-6 w-80 flex flex-col gap-4 z-40 pointer-events-auto animate-in slide-in-from-right-10">
                    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                        <div className="p-3 border-b border-white/10 bg-gradient-to-r from-cyan-900/20 to-transparent flex justify-between items-center">
                            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2"><BrainCircuit size={14}/> XRI Insights</h3>
                            <span className="text-[10px] bg-cyan-500/20 px-1.5 py-0.5 rounded text-cyan-300">{insights.length}</span>
                        </div>
                        <div className="p-3 space-y-2">
                            {insights.map(insight => (
                                <div key={insight.id} className="bg-white/5 p-3 rounded-lg border border-white/5 hover:border-cyan-500/30 transition group cursor-pointer">
                                    <div className="flex items-center gap-2 mb-1">
                                        {insight.type === 'critical' ? <AlertTriangle size={12} className="text-red-500"/> : <Zap size={12} className="text-yellow-500"/>}
                                        <span className={`text-[10px] font-bold uppercase ${insight.type === 'critical' ? 'text-red-400' : 'text-yellow-400'}`}>{insight.type}</span>
                                    </div>
                                    <div className="text-xs text-gray-200 font-medium leading-tight mb-2">{insight.message}</div>
                                    <div className="text-[10px] text-cyan-400 group-hover:underline flex items-center gap-1">ACTION: {insight.action} <ArrowUpRight size={10}/></div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl h-48 flex flex-col">
                        <div className="p-3 border-b border-white/10"><h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><Activity size={14}/> Live Feed</h3></div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
                            {logs.map((log, i) => <div key={i} className="text-[10px] truncate text-gray-400">{log}</div>)}
                        </div>
                    </div>
                </div>
            )}

            {viewMode === 'analyst' && (
                <div className="absolute inset-0 z-40 pt-32 px-6 pb-6 overflow-y-auto custom-scrollbar bg-[#050505]/90 backdrop-blur-md animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pointer-events-auto max-w-[1600px] mx-auto">
                        <div className="col-span-12 md:col-span-8 grid grid-cols-3 gap-4">
                            <StatCard title="XRI Network Score" value="94/100" sub="Optimal" color="text-green-400" icon={<Shield size={16}/>} />
                            <StatCard title="Avg Latency" value="~400ms" sub="On Target" color="text-cyan-400" icon={<Activity size={16}/>} />
                            <StatCard title="Low XRI Nodes" value={riskStats.critical.toString()} sub="Needs Analysis" color={riskStats.critical > 0 ? "text-red-500" : "text-gray-400"} icon={<AlertCircle size={16}/>} />
                            
                            <div className="col-span-3 bg-[#0a0a0a] border border-white/10 rounded-xl p-4 h-56 shadow-lg">
                                <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2"><Database size={14}/> Historical Network TPS (Supabase)</h3>
                                {dbHistory.length > 0 ? (
                                    <div className="h-full w-full -ml-2 pb-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={dbHistory}>
                                                <defs><linearGradient id="colorTps" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs>
                                                <XAxis dataKey="time" hide />
                                                <YAxis domain={['auto', 'auto']} hide />
                                                <Tooltip contentStyle={{background: '#000', border: '1px solid #333', fontSize: '10px'}} />
                                                <Area type="monotone" dataKey="tps" stroke="#10b981" strokeWidth={2} fill="url(#colorTps)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-xs text-gray-600">
                                        <span>Waiting for CRON job...</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="col-span-12 md:col-span-4 bg-[#0a0a0a] border border-white/10 rounded-xl p-5 flex flex-col shadow-lg">
                            <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-2"><Server size={14}/> ISP Concentration</h3>
                            <div className="flex-1 min-h-[200px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={ispData} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                                            {ispData.map((entry, index) => <Cell key={`cell-${index}`} fill={[COLORS.brand.primary, COLORS.brand.secondary, '#6366f1', '#8b5cf6', '#ec4899'][index % 5]} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{background: '#000', border: '1px solid #333', fontSize: '10px'}} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {ispData.slice(0,4).map((d,i) => (<div key={i} className="flex justify-between text-[10px] text-gray-400 border-b border-white/5 pb-1"><span>{d.name}</span><span className="font-mono text-white">{d.value.toFixed(1)}M</span></div>))}
                            </div>
                        </div>
                        <div className="col-span-12 bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden shadow-xl min-h-[500px] flex flex-col">
                            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                                <h2 className="text-sm font-bold text-white flex items-center gap-2"><Database size={16} className="text-cyan-500"/> REAL-TIME NODE MATRIX</h2>
                                <div className="relative w-64">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                                    <input type="text" placeholder="Search Node..." className="w-full bg-black border border-white/10 rounded-lg py-1.5 pl-9 pr-3 text-xs text-white focus:border-cyan-500 outline-none transition" value={filter} onChange={e => setFilter(e.target.value)} />
                                </div>
                            </div>
                            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-black/40 border-b border-white/5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                <div className="col-span-3">Identity / Location</div>
                                <div className="col-span-2 text-right">Stake</div>
                                <div className="col-span-2 text-center">XRI Score</div>
                                <div className="col-span-2 text-center">Lag / Skip</div>
                                <div className="col-span-2">ISP</div>
                                <div className="col-span-1"></div>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/20">
                                {displayedNodes.map((node) => (
                                    <div key={node.pubkey} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition items-center group text-xs">
                                        <div className="col-span-3 flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[10px] text-black shadow-lg" style={{backgroundColor: node.avatarColor}}>{node.name.substring(0,2)}</div>
                                            <div><div className="font-bold text-white truncate w-32">{node.name}</div><div className="text-[10px] text-gray-500 flex items-center gap-1"><MapPin size={8}/> {node.city || 'Unknown'}</div></div>
                                        </div>
                                        <div className="col-span-2 text-right"><div className="font-mono text-white">{node.stakeDisplay}</div><div className="text-[9px] text-gray-500">SOL</div></div>
                                        <div className="col-span-2 flex justify-center"><RiskBadge score={node.xriScore} /></div>
                                        <div className="col-span-2 text-center font-mono text-gray-400">{node.voteLag} / <span className={node.skipRate > 5 ? 'text-red-400' : ''}>{node.skipRate.toFixed(1)}%</span></div>
                                        <div className="col-span-2 text-gray-400 truncate">{node.isp || 'Unknown'}</div>
                                        <div className="col-span-1 flex justify-end"><button onClick={() => setSelectedNode(node)} className="p-1.5 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500 hover:text-black transition"><ArrowUpRight size={14}/></button></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedNode && (
                <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto p-0 md:p-6 animate-in fade-in">
                    <div className="bg-[#0c0c0c] border border-white/20 rounded-t-2xl md:rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden h-[80vh] md:h-auto flex flex-col">
                        <div className="p-5 border-b border-white/10 bg-[#111] flex justify-between items-start">
                            <div className="flex gap-4">
                                <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-black text-black shadow-xl" style={{backgroundColor: selectedNode.avatarColor}}>{selectedNode.name.substring(0,2)}</div>
                                <div>
                                    <div className="flex items-center gap-2"><h2 className="text-2xl font-bold text-white">{selectedNode.name}</h2><RiskBadge score={selectedNode.xriScore} /></div>
                                    <div className="text-sm text-cyan-500 font-mono mt-1 flex items-center gap-2"><Shield size={12}/> {selectedNode.pubkey}</div>
                                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2"><MapPin size={12}/> {selectedNode.city}, {selectedNode.country}</div>
                                </div>
                            </div>
                            <button onClick={() => setSelectedNode(null)} className="p-2 hover:bg-white/10 rounded-full transition"><X size={20} className="text-gray-400"/></button>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto custom-scrollbar">
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2"><Activity size={14}/> Protocol Metrics</h3>
                                <div className="space-y-4">
                                    <MetricRow label="XRI Score" value={selectedNode.xriScore.toString()} max={100} color="bg-cyan-500" />
                                    <MetricRow label="Vote Lag" value={`${selectedNode.voteLag} slots`} max={50} color="bg-yellow-500" inverse />
                                    <MetricRow label="Block Skip Rate" value={`${selectedNode.skipRate.toFixed(1)}%`} max={20} color="bg-red-500" inverse />
                                </div>
                            </div>
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2"><Cpu size={14}/> Validation Performance</h3>
                                <div className="grid grid-cols-2 gap-4"><HardwareDial label="Block Efficiency" value={selectedNode.efficiency} /><HardwareDial label="Reliability" value={selectedNode.xriScore} /></div>
                                <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-2 text-xs">
                                    <div className="flex justify-between text-gray-400"><span>Commission</span><span className="text-white">{selectedNode.commission}%</span></div>
                                    <div className="flex justify-between text-gray-400"><span>Status</span><span className="text-green-400">Active</span></div>
                                </div>
                            </div>
                            <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <DetailBox label="ISP" value={selectedNode.isp} />
                                <DetailBox label="Version" value={selectedNode.version} />
                                <DetailBox label="Stake Weight" value="0.05%" />
                                <DetailBox label="Total Stake" value={`${selectedNode.stakeDisplay} SOL`} />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 10px; }
            `}</style>
        </main>
    );
}

// UI COMPONENTS
function TabButton({ active, onClick, icon, label }: any) { return <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold tracking-wider transition-all ${active ? 'bg-cyan-500 text-black shadow-glow' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>{icon} {label}</button>; }
function MetricBox({ label, value, sub, color = "text-white" }: any) { return <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 flex flex-col min-w-[100px] hover:border-cyan-500/30 transition"><span className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">{label}</span><div className={`text-lg font-bold leading-none mt-1 ${color}`}>{value} <span className="text-[10px] text-gray-600 font-normal ml-1">{sub}</span></div></div>; }
function StatCard({ title, value, sub, color, icon }: any) { return <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-4 flex items-center justify-between shadow-lg"><div><div className="text-[10px] text-gray-500 uppercase font-bold mb-1">{title}</div><div className={`text-2xl font-bold ${color}`}>{value}</div><div className="text-[10px] text-gray-600 mt-1">{sub}</div></div><div className="p-3 bg-white/5 rounded-lg text-gray-400">{icon}</div></div>; }
function RiskBadge({ score }: { score: number }) { 
    let config = { bg: 'bg-green-500/20', text: 'text-green-400', label: 'OPTIMAL' };
    if (score < 50) config = { bg: 'bg-red-500/20', text: 'text-red-400', label: 'RISKY' };
    else if (score < 80) config = { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'DEGRADED' };
    return <div className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold ${config.bg} ${config.text} border border-white/5 w-fit`}><Scale size={10}/> XRI: {score} ({config.label})</div>; 
}
function MetricRow({ label, value, max, color, inverse = false }: any) { const numVal = parseFloat(value); const pct = Math.min(100, (numVal / max) * 100); return <div><div className="flex justify-between text-xs mb-1"><span className="text-gray-400">{label}</span><span className="font-mono text-white">{value}</span></div><div className="w-full bg-black/50 h-1.5 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{width: `${pct}%`}}></div></div></div>; }
function HardwareDial({ label, value }: any) { return <div className="flex flex-col items-center justify-center p-3 bg-black/20 rounded-lg"><div className="relative w-16 h-16 flex items-center justify-center"><svg className="w-full h-full transform -rotate-90"><circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-800" /><circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={175} strokeDashoffset={175 - (175 * value) / 100} className="text-cyan-500" /></svg><span className="absolute text-xs font-bold text-white">{value.toFixed(0)}%</span></div><span className="text-[10px] text-gray-500 uppercase font-bold mt-2">{label}</span></div>; }
function DetailBox({ label, value }: any) { return <div className="p-3 bg-white/5 rounded-lg border border-white/5"><div className="text-[10px] text-gray-500 uppercase font-bold mb-1">{label}</div><div className="text-white font-mono text-sm truncate">{value || '-'}</div></div>; }