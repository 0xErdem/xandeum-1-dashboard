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
    city?: string;
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
            // Dönüş hızı ve açısı
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = 0.3;
            globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 1.8 }); // Daha yakından bakış
        }
    }, [mounted]);

    if (!mounted) return null;

    return (
        <Globe
            ref={globeEl}
            width={dimensions.width}
            height={dimensions.height}
            // DAHA AYDINLIK KAPLAMALAR
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png" // Yıldızlı arka plan
            
            // ATMOSFER AYARLARI (PARLAKLIK)
            atmosphereColor="#3a86ff" // Mavi Neon
            atmosphereAltitude={0.25} // Daha geniş atmosfer
            
            // NOKTA (NODE) AYARLARI
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointColor="avatarColor"
            pointAltitude={0.07} // Yerden daha yüksek
            pointRadius={0.6} // Daha büyük noktalar
            pointsMerge={true}
            
            // HALKA (SİNYAL) AYARLARI
            ringsData={nodes}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => '#4cc9f0'}
            ringMaxRadius={3}
            ringPropagationSpeed={2}
            ringRepeatPeriod={800}
            
            // ETİKET AYARLARI
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