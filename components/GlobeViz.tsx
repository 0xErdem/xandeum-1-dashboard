'use client';

import React, { useEffect, useRef, useState } from 'react';

// SSR Sorununu önlemek için Globe kütüphanesini conditional import yapıyoruz
let Globe: any = () => null;
if (typeof window !== 'undefined') {
    Globe = require('react-globe.gl').default;
}

interface Node {
    pubkey: string;
    lat: number;
    lng: number;
    city?: string;
    healthScore: number;
    avatarColor: string;
}

interface GlobeVizProps {
    nodes: Node[];
    onNodeClick: (node: Node) => void;
}

export default function GlobeViz({ nodes, onNodeClick }: GlobeVizProps) {
    // HATA BURADAYDI: Parantez içine 'null' eklendi.
    const globeEl = useRef<any>(null);
    
    const [mounted, setMounted] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

    useEffect(() => {
        setMounted(true);
        // Pencere boyutuna göre haritayı ayarla
        const handleResize = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight
            });
        };
        
        handleResize(); // İlk açılışta ayarla
        window.addEventListener('resize', handleResize);
        
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        // Harita yüklendiğinde otomatik dönme efekti ve bakış açısı
        if (globeEl.current) {
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = 0.5;
            globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });
        }
    }, [mounted]);

    if (!mounted) return null;

    return (
        <Globe
            ref={globeEl}
            width={dimensions.width}
            height={dimensions.height}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundColor="rgba(0,0,0,0)"
            atmosphereColor="#06b6d4"
            atmosphereAltitude={0.15}
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointColor="avatarColor"
            pointAltitude={0.01}
            pointRadius={0.5}
            pointsMerge={true}
            ringsData={nodes}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => '#06b6d4'}
            ringMaxRadius={2}
            ringPropagationSpeed={2}
            ringRepeatPeriod={1000}
            onPointClick={onNodeClick}
            labelsData={nodes}
            labelLat="lat"
            labelLng="lng"
            labelText="city"
            labelSize={0.5}
            labelDotRadius={0.3}
            labelColor={() => 'rgba(255, 255, 255, 0.75)'}
            labelResolution={2}
        />
    );
}