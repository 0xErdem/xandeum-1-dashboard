'use client';

import React, { useEffect, useRef, useState } from 'react';

// SSR Sorununu önlemek için
let Globe: any = () => null;
if (typeof window !== 'undefined') {
    Globe = require('react-globe.gl').default;
}

interface Node {
    pubkey: string;
    lat: number;
    lng: number;
    // GÜNCELLEME: null değerini kabul edecek şekilde ayarladık
    city?: string | null;
    country?: string | null;
    isp?: string | null;
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
        handleResize(); // İlk açılışta ayarla
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (globeEl.current) {
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = 0.3;
            globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 1.8 });
        }
    }, [mounted]);

    if (!mounted) return null;

    return (
        <Globe
            ref={globeEl}
            width={dimensions.width}
            height={dimensions.height}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            atmosphereColor="#3a86ff"
            atmosphereAltitude={0.25}
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointColor="avatarColor"
            pointAltitude={0.07}
            pointRadius={0.6}
            pointsMerge={true}
            ringsData={nodes}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => '#4cc9f0'}
            ringMaxRadius={3}
            ringPropagationSpeed={2}
            ringRepeatPeriod={800}
            labelsData={nodes}
            labelLat="lat"
            labelLng="lng"
            labelText={(d: any) => d.city}
            labelSize={0.8}
            labelDotRadius={0.4}
            labelColor={() => 'rgba(255, 255, 255, 0.9)'}
            labelResolution={2}
            labelAltitude={0.01}
            onPointClick={onNodeClick}
        />
    );
}