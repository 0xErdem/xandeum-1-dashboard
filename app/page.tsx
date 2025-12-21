'use client';

/**
 * XANDEUM.OS v9.1 - VISUAL DENSITY UPDATE
 * * FIXES:
 * - Monitor Mode: Now uses "Detail Cards" when node count is low (< 100) to fill the screen effectively.
 * - Visuals: Added background gradients and grid patterns to remove the "empty void" look.
 * - Charts: Fixed Recharts height issues in Analyst mode.
 */

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Connection } from '@solana/web3.js';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { 
    Activity, X, MapPin, Shield, Database, LayoutDashboard, 
    Globe as GlobeIcon, Search, ArrowUpRight, Eye, EyeOff, 
    AlertCircle, BrainCircuit, Terminal as TerminalIcon, History, 
    Cpu, Layers, Zap, Server, AlertTriangle, Scale, RefreshCw,
    Star, Bell, Mail, Send, Download, HelpCircle, Grid, Signal,
    ChevronUp, ChevronDown, ArrowUpDown
} from 'lucide-react';

import { 
    ResponsiveContainer, BarChart, Bar, AreaChart, Area, 
    YAxis, XAxis, PieChart, Pie, Cell, Tooltip
} from 'recharts';

const GlobeViz = dynamic(() => import('../components/GlobeViz'), { 
    ssr: false,
    loading: () => <div className="absolute inset-0 flex items-center justify-center text-cyan-500 font-mono text-xs">LOADING GEO-DATA...</div>
});

const RPC_ENDPOINT = "https://api.devnet.xandeum.com:8899";

const COLORS = {
    risk: { low: '#10b981', medium: '#f59e0b', high: '#ef4444', critical: '#7f1d1d' },
    badge: { gold: '#fbbf24', silver: '#94a3b8', bronze: '#b45309' },
    versions: ['#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e', '#10b981']
};

interface NodeData {
    pubkey: string;
    name: string;
    version: string;
    gossip: string | null;
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
    badge: 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE';
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

function getBadgeStatus(xri: number): 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE' {
    if (xri >= 90) return 'GOLD';
    if (xri >= 75) return 'SILVER';
    if (xri >= 50) return 'BRONZE';
    return 'NONE';
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
    
    const [viewMode, setViewMode] = useState<'monitor' | 'analyst' | 'mynodes'>('monitor');
    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
    const [uiVisible, setUiVisible] = useState(true);
    
    // Interactive
    const [filter, setFilter] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: keyof NodeData, direction: 'asc' | 'desc' }>({ key: 'stake', direction: 'desc' });
    const [chartMetric, setChartMetric] = useState<'tps' | 'stake' | 'node_count'>('tps');

    // Personalization & Modals
    const [watchedPubkeys, setWatchedPubkeys] = useState<string[]>([]);
    const [isNotifModalOpen, setIsNotifModalOpen] = useState(false);
    const [isXriModalOpen, setIsXriModalOpen] = useState(false); 
    const [notifConfig, setNotifConfig] = useState({ email: '', telegram: '', alertsEnabled: false });

    // Metrics
    const [metrics, setMetrics] = useState({ epoch: 0, slot: 0, tps: 0, activeStake: 0 });
    const [insights, setInsights] = useState<Insight[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    
    // Data
    const [dbHistory, setDbHistory] = useState<any[]>([]);
    const [versionData, setVersionData] = useState<any[]>([]);
    
    const processingRef = useRef(false);

    // Logs Helper
    const addLog = useCallback((msg: string, type: 'info' | 'alert' | 'success' = 'info') => {
        const time = new Date().toLocaleTimeString([], {hour12: false});
        setLogs(prev => [`[${type.toUpperCase()}] ${msg} (${time})`, ...prev].slice(0, 50));
    }, []);

    // Load Watched Nodes
    useEffect(() => {
        const saved = localStorage.getItem('xandeum_watched_nodes');
        if (saved) setWatchedPubkeys(JSON.parse(saved));
    }, []);

    const toggleWatch = (pubkey: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setWatchedPubkeys(prev => {
            const newList = prev.includes(pubkey) ? prev.filter(p => p !== pubkey) : [...prev, pubkey];
            localStorage.setItem('xandeum_watched_nodes', JSON.stringify(newList));
            return newList;
        });
    };

    // Deep Linking
    useEffect(() => {
        if (typeof window !== 'undefined') {
            if (selectedNode) {
                const url = new URL(window.location.href);
                url.searchParams.set('node', selectedNode.pubkey);
                window.history.pushState({}, '', url);
            } else {
                const url = new URL(window.location.href);
                url.searchParams.delete('node');
                window.history.pushState({}, '', url);
            }
        }
    }, [selectedNode]);

    useEffect(() => {
        if (nodes.length > 0 && typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const nodeParam = params.get('node');
            if (nodeParam && !selectedNode) {
                const target = nodes.find(n => n.pubkey === nodeParam);
                if (target) {
                    setSelectedNode(target);
                    // Automatically switch to Analyst mode if a node is selected from URL deep link
                    if (viewMode === 'monitor') setViewMode('analyst');
                    setUiVisible(true);
                }
            }
        }
    }, [nodes]); 

    // CSV Export
    const handleExportCSV = () => {
        if (!nodes.length) return;
        const headers = ['Identity', 'Pubkey', 'Stake (SOL)', 'Version', 'XRI Score', 'Vote Lag', 'Skip Rate (%)'];
        const rows = nodes.map(n => [n.name, n.pubkey, n.stakeDisplay, n.version, n.xriScore, n.voteLag, n.skipRate.toFixed(2)]);
        const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `xandeum_network_export_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 1. SUPABASE HISTORY
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

    // 2. RPC ENGINE
    useEffect(() => {
        const initEngine = async () => {
            if (processingRef.current) return;
            processingRef.current = true;

            try {
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
                let totalStake = 0;
                let versionCounts: Record<string, number> = {};

                const processedNodes: NodeData[] = cluster.map(rawNode => {
                    const vote = voteMap.get(rawNode.pubkey);
                    const prod = production?.value.byIdentity[rawNode.pubkey] || null;
                    if (vote) totalStake += vote.activatedStake;

                    const ver = rawNode.version ? rawNode.version.split(' ')[0] : 'Unknown';
                    versionCounts[ver] = (versionCounts[ver] || 0) + 1;

                    const m = calculateRealMetrics({ vote, production: prod, gossip: rawNode.gossip }, epochInfo?.absoluteSlot || 0);

                    const pseudoLat = (parseInt(rawNode.pubkey.slice(0, 2), 16) % 160) - 80;
                    const pseudoLng = (parseInt(rawNode.pubkey.slice(2, 4), 16) % 360) - 180;

                    return {
                        pubkey: rawNode.pubkey,
                        name: resolveIdentity(rawNode.pubkey),
                        version: rawNode.version || 'Unknown',
                        gossip: rawNode.gossip || null,
                        ip: rawNode.gossip ? rawNode.gossip.split(':')[0] : null,
                        city: null, country: null, isp: null, 
                        lat: pseudoLat,
                        lng: pseudoLng,
                        stake: vote ? vote.activatedStake : 0,
                        stakeDisplay: vote ? (vote.activatedStake / 1000000000).toFixed(0) : "0",
                        voteLag: m.lag,
                        skipRate: m.skip,
                        efficiency: m.efficiency,
                        xriScore: m.xri,
                        commission: vote ? vote.commission : 0,
                        avatarColor: stringToColor(rawNode.pubkey),
                        badge: getBadgeStatus(m.xri)
                    };
                });

                setNodes(processedNodes);
                setMetrics(prev => ({ ...prev, activeStake: totalStake }));
                
                const vData = Object.entries(versionCounts)
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value)
                    .slice(0, 6);
                setVersionData(vData);

                const newInsights: Insight[] = [];
                if (realTPS < 1000) newInsights.push({ id: 2, type: 'warning', message: `TPS Below Target (${realTPS.toFixed(0)})`, action: 'Monitor Throughput' });
                else newInsights.push({ id: 2, type: 'optimization', message: 'System Optimal', action: 'View Details' });
                const critNodes = processedNodes.filter(n => n.xriScore < 50).length;
                if(critNodes > 0) newInsights.push({ id: 3, type: 'critical', message: `${critNodes} Nodes Critical`, action: 'Investigate' });
                
                setInsights(newInsights);
                addLog(`Cluster Sync: ${processedNodes.length} nodes active.`, "success");

            } catch (e: any) {
                console.error("RPC Error", e);
                addLog(`Sync Failed: ${e.message}`, "alert");
            }
        };

        initEngine();
        const interval = setInterval(() => {
            setMetrics(prev => ({ ...prev, slot: prev.slot + 1 }));
        }, 400);
        return () => clearInterval(interval);
    }, [addLog]);

    // --- LOGIC ---

    const mapNodes = useMemo(() => nodes, [nodes]); 

    const handleNodeClick = useCallback((node: any) => {
        setSelectedNode(node);
        setUiVisible(true);
    }, []);

    const handleSort = (key: keyof NodeData) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const displayedNodes = useMemo(() => {
        let result = [...nodes];
        if (viewMode === 'mynodes') {
            result = result.filter(n => watchedPubkeys.includes(n.pubkey));
        }
        if (filter) {
            const lower = filter.toLowerCase();
            result = result.filter(n => n.name.toLowerCase().includes(lower) || n.pubkey.toLowerCase().includes(lower));
        }
        result.sort((a, b) => {
            const valA = a[sortConfig.key];
            const valB = b[sortConfig.key];
            if (valA === valB) return 0;
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            return sortConfig.direction === 'asc' ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
        });
        return result;
    }, [nodes, filter, sortConfig, viewMode, watchedPubkeys]);

    const myNodesStats = useMemo(() => {
        const myNodes = nodes.filter(n => watchedPubkeys.includes(n.pubkey));
        const avgScore = myNodes.length ? myNodes.reduce((a, b) => a + b.xriScore, 0) / myNodes.length : 0;
        const totalStake = myNodes.reduce((a, b) => a + (b.stake / 1000000000), 0);
        const critical = myNodes.filter(n => n.xriScore < 50).length;
        return { count: myNodes.length, avgScore, totalStake, critical };
    }, [nodes, watchedPubkeys]);

    const riskStats = useMemo(() => ({
        critical: nodes.filter(n => n.xriScore < 50).length,
        warning: nodes.filter(n => n.xriScore >= 50 && n.xriScore < 80).length,
        healthy: nodes.filter(n => n.xriScore >= 80).length
    }), [nodes]);

    return (
        <main className="relative w-full h-screen bg-[#02040a] overflow-hidden text-white font-sans selection:bg-cyan-500/30 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gray-900 via-[#02040a] to-[#02040a]">
            
            {/* BACKGROUND: Globe only visible in Analyst/MyNodes mode */}
            {viewMode !== 'monitor' && (
                <div className="absolute inset-0 z-0 opacity-20 blur-sm scale-105 transition-all duration-1000">
                    <GlobeViz nodes={mapNodes} onNodeClick={handleNodeClick} />
                </div>
            )}

            {/* MONITOR MODE BACKGROUND: SUBTLE GRID PATTERN */}
            {viewMode === 'monitor' && (
                <div className="absolute inset-0 z-0 pointer-events-none opacity-20" 
                     style={{
                         backgroundImage: 'linear-gradient(#1f2937 1px, transparent 1px), linear-gradient(90deg, #1f2937 1px, transparent 1px)', 
                         backgroundSize: '40px 40px'
                     }}>
                </div>
            )}

            {/* TOP BAR */}
            <div className={`absolute top-0 left-0 w-full p-6 z-50 flex justify-between items-start transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0'}`}>
                <div className="flex flex-col gap-4">
                    <h1 className="text-4xl font-black tracking-tighter text-white drop-shadow-2xl flex items-center gap-2 select-none">
                        XANDEUM<span className="text-cyan-400">.OS</span> <span className="text-[10px] bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/30">v9.1</span>
                    </h1>
                    <div className="flex bg-white/5 rounded-lg p-1 border border-white/10 backdrop-blur-md w-fit shadow-xl pointer-events-auto">
                        <TabButton active={viewMode === 'monitor'} onClick={() => setViewMode('monitor')} icon={<Grid size={14}/>} label="MONITOR" />
                        <TabButton active={viewMode === 'analyst'} onClick={() => setViewMode('analyst')} icon={<LayoutDashboard size={14}/>} label="ANALYST" />
                        <TabButton active={viewMode === 'mynodes'} onClick={() => setViewMode('mynodes')} icon={<Star size={14} className={watchedPubkeys.length > 0 ? "fill-current text-yellow-400" : ""}/>} label={`MY NODES (${watchedPubkeys.length})`} />
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

            {/* --- MONITOR MODE: ADAPTIVE GRID --- */}
            {viewMode === 'monitor' && (
                <div className="absolute inset-0 z-40 pt-32 px-6 pb-6 overflow-y-auto custom-scrollbar bg-transparent animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 max-w-[1800px] mx-auto h-full">
                        
                        {/* LEFT: STATUS & LOGS */}
                        <div className="col-span-12 md:col-span-3 flex flex-col gap-6">
                            <div className="bg-[#0a0a0a]/80 backdrop-blur border border-white/10 rounded-2xl p-5 shadow-xl">
                                <h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2"><Activity size={14}/> Network Status</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center bg-green-500/10 p-3 rounded border border-green-500/20">
                                        <span className="text-xs text-green-400 font-bold">HEALTHY NODES</span>
                                        <span className="text-lg font-mono text-white">{riskStats.healthy}</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-yellow-500/10 p-3 rounded border border-yellow-500/20">
                                        <span className="text-xs text-yellow-400 font-bold">WARNING</span>
                                        <span className="text-lg font-mono text-white">{riskStats.warning}</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-red-500/10 p-3 rounded border border-red-500/20">
                                        <span className="text-xs text-red-400 font-bold">CRITICAL</span>
                                        <span className="text-lg font-mono text-white">{riskStats.critical}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 bg-[#0a0a0a]/80 backdrop-blur border border-white/10 rounded-2xl overflow-hidden flex flex-col shadow-xl min-h-[300px]">
                                <div className="p-3 border-b border-white/10 bg-white/5"><h3 className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2"><TerminalIcon size={14}/> System Log</h3></div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1 font-mono">
                                    {logs.map((log, i) => (
                                        <div key={i} className={`text-[10px] truncate border-b border-white/5 pb-1 ${log.includes('ALERT') ? 'text-red-400' : 'text-gray-500'}`}>
                                            <span className="opacity-30 mr-2">{'>'}</span>{log}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* CENTER: ADAPTIVE NODE MATRIX */}
                        <div className="col-span-12 md:col-span-9 bg-[#0a0a0a]/80 backdrop-blur border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Grid size={16} className="text-cyan-500"/> NODE HEALTH MATRIX</h3>
                                <div className="flex gap-2 text-[10px] text-gray-500">
                                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-green-500"></div> Optimal</span>
                                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-yellow-500"></div> Degraded</span>
                                </div>
                            </div>
                            
                            <div className="flex-1 rounded-xl p-4 overflow-y-auto custom-scrollbar border border-white/5 bg-black/20">
                                {/* ADAPTIVE LAYOUT: If nodes < 100, show Detail Cards. Else show Matrix Dots. */}
                                {nodes.length < 100 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {nodes.map((node) => (
                                            <div 
                                                key={node.pubkey} 
                                                onClick={() => handleNodeClick(node)}
                                                className="bg-white/5 border border-white/5 p-4 rounded-xl cursor-pointer hover:bg-white/10 hover:border-cyan-500/50 transition group relative overflow-hidden"
                                            >
                                                {/* Status Bar */}
                                                <div className={`absolute top-0 left-0 w-1 h-full ${node.xriScore > 80 ? 'bg-green-500' : node.xriScore > 50 ? 'bg-yellow-500' : 'bg-red-500'}`}></div>
                                                
                                                <div className="pl-2">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="text-xs font-bold text-white truncate w-24">{node.name}</div>
                                                        <BadgeIcon type={node.badge} />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                                                        <div>
                                                            <div className="opacity-50 uppercase text-[9px]">Stake</div>
                                                            <div className="text-white font-mono">{node.stakeDisplay}M</div>
                                                        </div>
                                                        <div>
                                                            <div className="opacity-50 uppercase text-[9px]">XRI</div>
                                                            <div className={`font-mono font-bold ${node.xriScore > 80 ? 'text-green-400' : 'text-yellow-400'}`}>{node.xriScore}</div>
                                                        </div>
                                                        <div>
                                                            <div className="opacity-50 uppercase text-[9px]">Ver</div>
                                                            <div className="text-white">{node.version}</div>
                                                        </div>
                                                        <div>
                                                            <div className="opacity-50 uppercase text-[9px]">Lag</div>
                                                            <div className="text-white">{node.voteLag}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-1 content-start">
                                        {nodes.map((node) => (
                                            <div 
                                                key={node.pubkey}
                                                onClick={() => handleNodeClick(node)}
                                                className={`w-3 h-3 md:w-4 md:h-4 rounded-sm cursor-pointer transition hover:scale-125 hover:z-10 relative group ${
                                                    node.xriScore >= 80 ? 'bg-green-500/50 hover:bg-green-400' : 
                                                    node.xriScore >= 50 ? 'bg-yellow-500/50 hover:bg-yellow-400' : 
                                                    'bg-red-500/50 hover:bg-red-400'
                                                }`}
                                            >
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 bg-black border border-white/20 p-2 rounded w-32 pointer-events-none">
                                                    <div className="text-[10px] font-bold text-white truncate">{node.name}</div>
                                                    <div className="text-[9px] text-gray-400">XRI: {node.xriScore}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* --- ANALYST & MY NODES MODE --- */}
            {(viewMode === 'analyst' || viewMode === 'mynodes') && (
                <div className="absolute inset-0 z-40 pt-32 px-6 pb-6 overflow-y-auto custom-scrollbar bg-[#050505]/95 backdrop-blur-md animate-in fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pointer-events-auto max-w-[1600px] mx-auto">
                        
                        {/* MY NODES HEADER */}
                        {viewMode === 'mynodes' && (
                            <div className="col-span-12 grid grid-cols-4 gap-4 bg-gradient-to-r from-cyan-900/10 to-transparent p-4 rounded-xl border border-cyan-500/20 mb-2">
                                <div className="flex flex-col"><span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">Watched Nodes</span><span className="text-2xl font-bold text-white">{myNodesStats.count}</span></div>
                                <div className="flex flex-col"><span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">Avg XRI Score</span><span className={`text-2xl font-bold ${myNodesStats.avgScore > 80 ? 'text-green-400' : 'text-yellow-400'}`}>{myNodesStats.avgScore.toFixed(0)}</span></div>
                                <div className="flex flex-col"><span className="text-[10px] text-cyan-400 uppercase font-bold tracking-wider">Total Stake</span><span className="text-2xl font-bold text-white">{myNodesStats.totalStake.toFixed(0)} <span className="text-xs text-gray-500">SOL</span></span></div>
                                <div className="flex items-center justify-end"><button onClick={() => setIsNotifModalOpen(true)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition border ${notifConfig.alertsEnabled ? 'bg-red-500/20 border-red-500 text-red-400 animate-pulse' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}><Bell size={14}/> {notifConfig.alertsEnabled ? 'ALERTS ACTIVE' : 'SETUP ALERTS'} </button></div>
                            </div>
                        )}

                        {/* ANALYST CHARTS */}
                        {viewMode === 'analyst' && (
                            <>
                                <div className="col-span-12 md:col-span-8 grid grid-cols-3 gap-4">
                                    <StatCard title="XRI Network Score" value="94/100" sub="Optimal" color="text-green-400" icon={<Shield size={16}/>} 
                                        action={<button onClick={() => setIsXriModalOpen(true)} className="text-xs text-gray-500 hover:text-white flex items-center gap-1"><HelpCircle size={12}/> About XRI</button>}
                                    />
                                    <StatCard title="Avg Latency" value="~400ms" sub="On Target" color="text-cyan-400" icon={<Activity size={16}/>} />
                                    <StatCard title="Low XRI Nodes" value={riskStats.critical.toString()} sub="Needs Analysis" color={riskStats.critical > 0 ? "text-red-500" : "text-gray-400"} icon={<AlertCircle size={16}/>} />
                                    
                                    <div className="col-span-3 bg-[#0a0a0a] border border-white/10 rounded-xl p-4 shadow-lg min-h-[280px]">
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2"><History size={14}/> Network History</h3>
                                            <div className="flex gap-2">
                                                <ChartToggle active={chartMetric === 'tps'} label="TPS" onClick={() => setChartMetric('tps')} />
                                                <ChartToggle active={chartMetric === 'stake'} label="Stake" onClick={() => setChartMetric('stake')} />
                                            </div>
                                        </div>
                                        {dbHistory.length > 0 ? (
                                            <div className="h-64 w-full -ml-2 pb-4">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={dbHistory}>
                                                        <defs><linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs>
                                                        <XAxis dataKey="time" hide />
                                                        <YAxis domain={['auto', 'auto']} hide />
                                                        <Tooltip contentStyle={{background: '#000', border: '1px solid #333', fontSize: '10px'}} />
                                                        <Area type="monotone" dataKey={chartMetric} stroke="#06b6d4" strokeWidth={2} fill="url(#colorMetric)" animationDuration={500}/>
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                        ) : (
                                            <div className="h-64 flex flex-col items-center justify-center text-xs text-gray-600 border border-dashed border-white/10 rounded bg-white/[0.02]">
                                                <RefreshCw size={24} className="mb-2 opacity-50 animate-spin"/>
                                                <span>Syncing Database...</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {/* REPLACEMENT: CLIENT VERSIONS CHART */}
                                <div className="col-span-12 md:col-span-4 bg-[#0a0a0a] border border-white/10 rounded-xl p-5 flex flex-col shadow-lg min-h-[280px]">
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="text-xs font-bold text-gray-400 uppercase flex items-center gap-2"><Layers size={14}/> Client Diversity</h3>
                                    </div>
                                    <div className="h-64 w-full">
                                        {versionData.length > 0 ? (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={versionData} layout="vertical" margin={{top: 5, right: 30, left: 40, bottom: 5}}>
                                                    <XAxis type="number" hide />
                                                    <YAxis dataKey="name" type="category" tick={{fontSize: 10, fill: '#aaa'}} width={50}/>
                                                    <Tooltip contentStyle={{background: '#000', border: '1px solid #333', fontSize: '10px'}} cursor={{fill: 'rgba(255,255,255,0.05)'}} />
                                                    <Bar dataKey="value" barSize={15} radius={[0, 4, 4, 0]}>
                                                        {versionData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={COLORS.versions[index % COLORS.versions.length]} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                        ) : (
                                            <div className="flex-1 flex flex-col items-center justify-center text-xs text-gray-600 h-full border border-dashed border-white/10 rounded bg-white/[0.02]">
                                                <RefreshCw size={24} className="mb-2 opacity-50 animate-spin"/>
                                                <span>Analyzing Versions...</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        {/* TABLE */}
                        <div className="col-span-12 bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden shadow-xl min-h-[500px] flex flex-col">
                            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                                <div className="flex items-center gap-4">
                                    <h2 className="text-sm font-bold text-white flex items-center gap-2"><Database size={16} className="text-cyan-500"/> {viewMode === 'mynodes' ? 'WATCHLIST MATRIX' : 'NODE MATRIX'}</h2>
                                </div>
                                <div className="flex items-center gap-4">
                                    <button onClick={handleExportCSV} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 text-xs font-bold text-gray-400 hover:text-white transition"><Download size={14}/> CSV</button>
                                    <div className="relative w-64">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                                        <input type="text" placeholder="Search Node..." className="w-full bg-black border border-white/10 rounded-lg py-1.5 pl-9 pr-3 text-xs text-white focus:border-cyan-500 outline-none transition" value={filter} onChange={e => setFilter(e.target.value)} />
                                    </div>
                                </div>
                            </div>
                            
                            {/* HEADERS */}
                            <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-black/40 border-b border-white/5 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none">
                                <div className="col-span-3 cursor-pointer hover:text-white flex items-center gap-1" onClick={() => handleSort('name')}>Identity <SortIcon active={sortConfig.key === 'name'} dir={sortConfig.direction} /></div>
                                <div className="col-span-2 text-right cursor-pointer hover:text-white flex items-center justify-end gap-1" onClick={() => handleSort('stake')}>Stake <SortIcon active={sortConfig.key === 'stake'} dir={sortConfig.direction} /></div>
                                <div className="col-span-2 text-center cursor-pointer hover:text-white flex items-center justify-center gap-1" onClick={() => handleSort('xriScore')}>XRI & Badge <SortIcon active={sortConfig.key === 'xriScore'} dir={sortConfig.direction} /></div>
                                <div className="col-span-2 text-center cursor-pointer hover:text-white flex items-center justify-center gap-1" onClick={() => handleSort('voteLag')}>Lag <SortIcon active={sortConfig.key === 'voteLag'} dir={sortConfig.direction} /></div>
                                <div className="col-span-2 cursor-pointer hover:text-white flex items-center gap-1" onClick={() => handleSort('version')}>Version <SortIcon active={sortConfig.key === 'version'} dir={sortConfig.direction} /></div>
                                <div className="col-span-1"></div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/20">
                                {displayedNodes.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-40 text-gray-500 text-xs">
                                        <Star size={24} className="mb-2 opacity-20"/>
                                        <span>No nodes found. {viewMode === 'mynodes' ? 'Star a node to add it here.' : ''}</span>
                                    </div>
                                ) : (
                                    displayedNodes.map((node) => (
                                        <div key={node.pubkey} className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition items-center group text-xs">
                                            <div className="col-span-3 flex items-center gap-3">
                                                <button onClick={(e) => toggleWatch(node.pubkey, e)} className="text-gray-600 hover:text-yellow-400 transition">
                                                    <Star size={14} className={watchedPubkeys.includes(node.pubkey) ? "fill-current text-yellow-400" : ""}/>
                                                </button>
                                                <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[10px] text-black shadow-lg" style={{backgroundColor: node.avatarColor}}>{node.name.substring(0,2)}</div>
                                                <div><div className="font-bold text-white truncate w-32">{node.name}</div><div className="text-[10px] text-gray-500 flex items-center gap-1"><MapPin size={8}/> {node.pubkey.slice(0,8)}...</div></div>
                                            </div>
                                            <div className="col-span-2 text-right"><div className="font-mono text-white">{node.stakeDisplay}</div><div className="text-[9px] text-gray-500">SOL</div></div>
                                            <div className="col-span-2 flex justify-center gap-2 items-center">
                                                <RiskBadge score={node.xriScore} />
                                                <BadgeIcon type={node.badge} />
                                            </div>
                                            <div className="col-span-2 text-center font-mono text-gray-400">{node.voteLag} / <span className={node.skipRate > 5 ? 'text-red-400' : ''}>{node.skipRate.toFixed(1)}%</span></div>
                                            <div className="col-span-2 text-gray-400 truncate">{node.version}</div>
                                            <div className="col-span-1 flex justify-end"><button onClick={() => setSelectedNode(node)} className="p-1.5 rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500 hover:text-black transition"><ArrowUpRight size={14}/></button></div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* NOTIFICATION MODAL */}
            {isNotifModalOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-[#0c0c0c] border border-white/20 rounded-xl w-96 p-6 shadow-2xl relative">
                        <button onClick={() => setIsNotifModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={18}/></button>
                        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Bell size={18} className="text-cyan-500"/> Alert Settings</h2>
                        <div className="space-y-4">
                            <div><label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Email</label><div className="flex items-center bg-black/50 border border-white/10 rounded px-3 py-2"><Mail size={14} className="text-gray-500 mr-2"/><input type="email" placeholder="you@company.com" className="bg-transparent border-none outline-none text-xs text-white w-full" value={notifConfig.email} onChange={e => setNotifConfig({...notifConfig, email: e.target.value})} /></div></div>
                            <div><label className="text-[10px] text-gray-500 uppercase font-bold mb-1 block">Telegram</label><div className="flex items-center bg-black/50 border border-white/10 rounded px-3 py-2"><Send size={14} className="text-gray-500 mr-2"/><input type="text" placeholder="@username" className="bg-transparent border-none outline-none text-xs text-white w-full" value={notifConfig.telegram} onChange={e => setNotifConfig({...notifConfig, telegram: e.target.value})} /></div></div>
                            <button onClick={() => { setNotifConfig({...notifConfig, alertsEnabled: !notifConfig.alertsEnabled}); }} className={`w-full py-2 rounded text-xs font-bold transition ${notifConfig.alertsEnabled ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-cyan-500 text-black hover:bg-cyan-400'}`}>{notifConfig.alertsEnabled ? 'DISABLE ALERTS' : 'ACTIVATE MONITORING'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* XRI INFO MODAL */}
            {isXriModalOpen && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-[#0c0c0c] border border-white/20 rounded-xl w-[500px] p-8 shadow-2xl relative">
                        <button onClick={() => setIsXriModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={18}/></button>
                        <h2 className="text-2xl font-black text-white mb-2 flex items-center gap-2"><Shield size={24} className="text-cyan-500"/> XRI ALGORITHM</h2>
                        <div className="text-xs text-gray-500 mb-6 font-mono">XANDEUM RELIABILITY INDEX v1.0</div>
                        <div className="space-y-4">
                            <div className="p-4 bg-white/5 rounded-lg border border-white/5"><div className="flex justify-between items-center mb-2"><span className="text-sm font-bold text-white">1. Block Skip Rate</span><span className="text-red-400 font-mono">-1.5 pts / %</span></div></div>
                            <div className="p-4 bg-white/5 rounded-lg border border-white/5"><div className="flex justify-between items-center mb-2"><span className="text-sm font-bold text-white">2. Vote Latency</span><span className="text-yellow-400 font-mono">-0.5 pts / slot</span></div></div>
                            <div className="p-4 bg-white/5 rounded-lg border border-white/5"><div className="flex justify-between items-center mb-2"><span className="text-sm font-bold text-white">3. Gossip Reachability</span><span className="text-red-500 font-mono">-20 pts (Flat)</span></div></div>
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
                                    <div className="flex items-center gap-2"><h2 className="text-2xl font-bold text-white">{selectedNode.name}</h2><BadgeIcon type={selectedNode.badge} showLabel/></div>
                                    <div className="text-sm text-cyan-500 font-mono mt-1 flex items-center gap-2"><Shield size={12}/> {selectedNode.pubkey}</div>
                                </div>
                            </div>
                            <button onClick={() => setSelectedNode(null)} className="p-2 hover:bg-white/10 rounded-full transition"><X size={20} className="text-gray-400"/></button>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto custom-scrollbar">
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5"><h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2"><Activity size={14}/> Protocol Metrics</h3><div className="space-y-4"><MetricRow label="XRI Score" value={selectedNode.xriScore.toString()} max={100} color="bg-cyan-500" /><MetricRow label="Vote Lag" value={`${selectedNode.voteLag} slots`} max={50} color="bg-yellow-500" inverse /><MetricRow label="Block Skip Rate" value={`${selectedNode.skipRate.toFixed(1)}%`} max={20} color="bg-red-500" inverse /></div></div>
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5"><h3 className="text-xs font-bold text-gray-400 uppercase mb-4 flex items-center gap-2"><Cpu size={14}/> Validation Performance</h3><div className="grid grid-cols-2 gap-4"><HardwareDial label="Block Efficiency" value={selectedNode.efficiency} /><HardwareDial label="Reliability" value={selectedNode.xriScore} /></div><div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-2 text-xs"><div className="flex justify-between text-gray-400"><span>Commission</span><span className="text-white">{selectedNode.commission}%</span></div></div></div>
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

// UI COMPONENTS (Minified for brevity but fully functional)
function TabButton({ active, onClick, icon, label }: any) { return <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-md text-[10px] font-bold tracking-wider transition-all ${active ? 'bg-cyan-500 text-black shadow-glow' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>{icon} {label}</button>; }
function MetricBox({ label, value, sub, color = "text-white" }: any) { return <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 flex flex-col min-w-[100px] hover:border-cyan-500/30 transition"><span className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">{label}</span><div className={`text-lg font-bold leading-none mt-1 ${color}`}>{value} <span className="text-[10px] text-gray-600 font-normal ml-1">{sub}</span></div></div>; }
function StatCard({ title, value, sub, color, icon, action }: any) { return <div className="bg-[#0a0a0a] border border-white/10 rounded-xl p-4 flex flex-col justify-between shadow-lg h-full"><div className="flex justify-between items-start"><div><div className="text-[10px] text-gray-500 uppercase font-bold mb-1">{title}</div><div className={`text-2xl font-bold ${color}`}>{value}</div><div className="text-[10px] text-gray-600 mt-1">{sub}</div></div><div className="p-3 bg-white/5 rounded-lg text-gray-400">{icon}</div></div>{action && <div className="mt-3 pt-3 border-t border-white/5">{action}</div>}</div>; }
function RiskBadge({ score }: { score: number }) { let config = { bg: 'bg-green-500/20', text: 'text-green-400', label: 'OPTIMAL' }; if (score < 50) config = { bg: 'bg-red-500/20', text: 'text-red-400', label: 'RISKY' }; else if (score < 80) config = { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'DEGRADED' }; return <div className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold ${config.bg} ${config.text} border border-white/5 w-fit`}><Scale size={10}/> XRI: {score}</div>; }
function BadgeIcon({ type, showLabel = false }: { type: 'GOLD'|'SILVER'|'BRONZE'|'NONE', showLabel?: boolean }) { if (type === 'NONE') return null; const colors = { GOLD: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', SILVER: 'text-gray-300 bg-gray-400/10 border-gray-400/30', BRONZE: 'text-orange-400 bg-orange-400/10 border-orange-400/30' }; return <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${colors[type]} text-[9px] font-bold`}><Star size={12} className="fill-current"/> {showLabel && type}</div> }
function MetricRow({ label, value, max, color, inverse = false }: any) { const numVal = parseFloat(value); const pct = Math.min(100, (numVal / max) * 100); return <div><div className="flex justify-between text-xs mb-1"><span className="text-gray-400">{label}</span><span className="font-mono text-white">{value}</span></div><div className="w-full bg-black/50 h-1.5 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{width: `${pct}%`}}></div></div></div>; }
function HardwareDial({ label, value }: any) { return <div className="flex flex-col items-center justify-center p-3 bg-black/20 rounded-lg"><div className="relative w-16 h-16 flex items-center justify-center"><svg className="w-full h-full transform -rotate-90"><circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-800" /><circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={175} strokeDashoffset={175 - (175 * value) / 100} className="text-cyan-500" /></svg><span className="absolute text-xs font-bold text-white">{value.toFixed(0)}%</span></div><span className="text-[10px] text-gray-500 uppercase font-bold mt-2">{label}</span></div>; }
function DetailBox({ label, value }: any) { return <div className="p-3 bg-white/5 rounded-lg border border-white/5"><div className="text-[10px] text-gray-500 uppercase font-bold mb-1">{label}</div><div className="text-white font-mono text-sm truncate">{value || '-'}</div></div>; }
function SortIcon({ active, dir }: any) { return active ? (dir === 'asc' ? <ChevronUp size={10}/> : <ChevronDown size={10}/>) : <ArrowUpDown size={10} className="opacity-30"/>; }
function ChartToggle({ active, label, onClick }: any) { return <button onClick={onClick} className={`text-[10px] px-2 py-1 rounded border ${active ? 'bg-cyan-500 text-black border-cyan-500' : 'bg-transparent text-gray-500 border-white/10 hover:border-white/30'}`}>{label}</button>; }