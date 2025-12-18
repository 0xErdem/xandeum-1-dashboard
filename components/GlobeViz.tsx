'use client';

import React, { useEffect, useRef, useState, memo } from 'react';

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
    xriScore?: number;
    healthScore?: number;
    avatarColor: string;
}

interface GlobeVizProps {
    nodes: Node[];
    onNodeClick: (node: Node) => void;
}

// 1. Bileşeni normal fonksiyon olarak tanımlıyoruz
const GlobeVizComponent = ({ nodes, onNodeClick }: GlobeVizProps) => {
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
        // İlk renderda boyutu al
        if (typeof window !== 'undefined') {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight
            });
        }
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (globeEl.current) {
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = 0.6; // Hızı biraz artırdım, daha akıcı dursun
            globeEl.current.pointOfView({ lat: 20, lng: 0, altitude: 1.8 });
        }
    }, [mounted]);

    if (!mounted) return null;

    return (
        <Globe
            ref={globeEl}
            width={dimensions.width}
            height={dimensions.height}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundColor="rgba(0,0,0,0)"
            atmosphereColor="#7caeea"
            atmosphereAltitude={0.15}
            ambientLightColor="#ffffff"
            ambientLightIntensity={1.2}
            
            // Performance Optimizations
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointColor="avatarColor"
            pointAltitude={0.1}
            pointRadius={0.5}
            pointsMerge={true} // ÇOK ÖNEMLİ: Binlerce noktayı tek obje gibi işler (FPS artırır)
            
            ringsData={nodes}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => '#38bdf8'}
            ringMaxRadius={2}
            ringPropagationSpeed={3}
            ringRepeatPeriod={800}
            
            labelsData={nodes}
            labelLat="lat"
            labelLng="lng"
            labelText={(d: any) => d.city ? d.city : ''}
            labelSize={1.2}
            labelDotRadius={0.4}
            labelColor={() => 'rgba(255, 255, 255, 1)'}
            labelResolution={1} // Performans için çözünürlüğü 2'den 1'e çektim (gözle fark edilmez)
            labelAltitude={0.05}

            onPointClick={onNodeClick}
            onLabelClick={onNodeClick}
        />
    );
};

// 2. React.memo ile sarmalayarak export ediyoruz.
// Bu sayede "nodes" prop'u değişmedikçe harita ASLA yeniden render edilmez.
export default memo(GlobeVizComponent, (prevProps, nextProps) => {
    // Sadece node sayısı veya referansı değişirse render et
    return prevProps.nodes === nextProps.nodes;
});