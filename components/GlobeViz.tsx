'use client';

import React, { useEffect, useRef, useState } from 'react';

// SSR (Server Side Rendering) Hatasını Önleme
let Globe: any = () => null;
if (typeof window !== 'undefined') {
    Globe = require('react-globe.gl').default;
}

// TİP TANIMLAMALARI (Null hatalarını önlemek için güncellendi)
interface Node {
    pubkey: string;
    lat: number;
    lng: number;
    city?: string | null;  // null olabilir
    country?: string | null; // null olabilir
    isp?: string | null;     // null olabilir
    healthScore: number;
    avatarColor: string;
}

interface GlobeVizProps {
    nodes: Node[];
    onNodeClick: (node: Node) => void;
}

export default function GlobeViz({ nodes, onNodeClick }: GlobeVizProps) {
    const globeEl = useRef<any>(null);
    const [mounted, setMounted] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    useEffect(() => {
        setMounted(true);
        const handleResize = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight
            });
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (globeEl.current) {
            // Harita kontrolleri
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = 0.5;
            // Açılışta biraz daha uzaktan bak
            globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 2.0 });
        }
    }, [mounted]);

    if (!mounted) return null;

    return (
        <Globe
            ref={globeEl}
            width={dimensions.width}
            height={dimensions.height}
            
            // --- GÖRSEL AYARLAR (AYDINLIK MOD) ---
            // Daha net görünen "Blue Marble" kaplaması
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            // Arka planı tamamen şeffaf yapıyoruz (CSS ile halledeceğiz)
            backgroundColor="rgba(0,0,0,0)"
            
            // ATMOSFER & IŞIK (Karanlığı önlemek için)
            atmosphereColor="#7caeea"
            atmosphereAltitude={0.15}
            ambientLightColor="#ffffff" // Beyaz ortam ışığı
            ambientLightIntensity={1.2} // Işık şiddetini artırdık
            
            // --- DATA NOKTALARI ---
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointColor="avatarColor"
            pointAltitude={0.1} // Noktalar haritaya gömülmesin diye yükselttik
            pointRadius={0.5}
            pointsMerge={true} // Performans için
            
            // --- HALKALAR (SİNYAL EFEKTİ) ---
            ringsData={nodes}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => '#38bdf8'} // Açık mavi halkalar
            ringMaxRadius={2}
            ringPropagationSpeed={3}
            ringRepeatPeriod={800}
            
            // --- ETİKETLER ---
            labelsData={nodes}
            labelLat="lat"
            labelLng="lng"
            labelText={(d: any) => d.city ? d.city : ''}
            labelSize={1.2}
            labelDotRadius={0.4}
            labelColor={() => 'rgba(255, 255, 255, 1)'}
            labelResolution={2}
            labelAltitude={0.05}

            // --- ETKİLEŞİM ---
            onPointClick={onNodeClick}
            onLabelClick={onNodeClick}
        />
    );
}