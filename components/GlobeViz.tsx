'use client';

import React, { useEffect, useRef, useState } from 'react';

// SSR Check
let Globe: any = () => null;
if (typeof window !== 'undefined') {
    Globe = require('react-globe.gl').default;
}

interface Node {
    pubkey: string;
    lat: number;
    lng: number;
    city?: string | null;
    country?: string | null;
    isp?: string | null;
    
    // GÜNCELLEME: İsim değişikliği ve opsiyonel yapma
    xriScore?: number;    // Yeni modeldeki isim
    healthScore?: number; // Eski model desteği (gerekirse)
    
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
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = 0.5;
            globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 2.0 });
        }
    }, [mounted]);

    if (!mounted) return null;

    return (
        <Globe
            ref={globeEl}
            width={dimensions.width}
            height={dimensions.height}
            
            // Visuals
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundColor="rgba(0,0,0,0)"
            
            // Atmosphere
            atmosphereColor="#7caeea"
            atmosphereAltitude={0.15}
            ambientLightColor="#ffffff"
            ambientLightIntensity={1.2}
            
            // Points
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointColor="avatarColor"
            pointAltitude={0.1}
            pointRadius={0.5}
            pointsMerge={true}
            
            // Rings
            ringsData={nodes}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => '#38bdf8'}
            ringMaxRadius={2}
            ringPropagationSpeed={3}
            ringRepeatPeriod={800}
            
            // Labels
            labelsData={nodes}
            labelLat="lat"
            labelLng="lng"
            labelText={(d: any) => d.city ? d.city : ''}
            labelSize={1.2}
            labelDotRadius={0.4}
            labelColor={() => 'rgba(255, 255, 255, 1)'}
            labelResolution={2}
            labelAltitude={0.05}

            onPointClick={onNodeClick}
            onLabelClick={onNodeClick}
        />
    );
}